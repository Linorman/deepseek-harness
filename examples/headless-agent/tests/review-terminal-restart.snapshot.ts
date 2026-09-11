/** Real review requests retain completed task history across terminal intent and Host loss. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-review-terminal-restart.cordis.yml')
const driver = 'headless-review-terminal-restart-driver.ts'
const CONTENT = 'The review task leaves this source unchanged.\n'
type Backend = 'json' | 'sqlite'
type Outcome = 'failure' | 'cancellation'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Inspect a copy so the second Loader receives the original crash lock and WAL. */
async function copyStore(root: string, backend: Backend): Promise<string> {
  const copy = join(root, 'crashed-store')
  const home = join(root, '.clocky')
  await mkdir(join(copy, '.clocky'), { recursive: true })
  if (backend === 'json') await cp(join(home, 'team-storage-json'), join(copy, '.clocky/team-storage-json'), { recursive: true })
  else {
    for (const file of (await readdir(home)).filter(name => name.startsWith('team-storage.sqlite'))) {
      await cp(join(home, file), join(copy, '.clocky', file))
    }
  }
  return copy
}

async function streams(root: string, kind: Backend) {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
    return await Promise.all(infos.map(async (info) => {
      const stream = await backend.log.open(info)
      try {
        const entries = await stream.read(-1, 256)
        expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
        return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
      } finally { await stream.close() }
    }))
  } finally { await backend.close() }
}

function bindings(records: readonly { value: Record<string, unknown> }[]): Record<string, unknown>[] {
  const values = new Map<unknown, Record<string, unknown>>()
  for (const record of records) {
    if (record.value.type !== 'activation/changed') continue
    const binding = object(record.value.binding)
    values.set(object(binding.activation).id, binding)
  }
  return [...values.values()]
}

function launch(root: string, backend: Backend, outcome: Outcome, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
      CLOCKY_REVIEW_BACKEND: backend, CLOCKY_REVIEW_OUTCOME: outcome, CLOCKY_REVIEW_STAGE: stage,
      ...(teamId === undefined ? {} : { CLOCKY_REVIEW_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('review task cleanup after terminal intent and Host loss', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const outcome of ['failure', 'cancellation'] as const) {
      it(`retains the completed attempt and review request after ${outcome} on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/review-terminal-restart-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          await writeFile(join(work, 'source.txt'), CONTENT)
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const first = launch(root, backend, outcome, 'crash')
          const killed = await execa(first.command, first.args, { cwd: work, env: first.env, input: '',
            timeout: 30_000, killSignal: 'SIGKILL', reject: false })
          const diagnostic = JSON.stringify({ timedOut: killed.timedOut, exitCode: killed.exitCode,
            signal: killed.signal, stdout: killed.stdout, stderr: killed.stderr })
          expect(killed.timedOut, diagnostic).toBe(false)
          expect(killed.signal, diagnostic).toBe('SIGKILL')
          expect(killed.stderr).toBe('')
          const checkpoint = object(JSON.parse(killed.stdout))
          expect(checkpoint).toMatchObject({ stage: 'crash', outcome })
          const before = await streams(await copyStore(root, backend), backend)
          const teams = before.filter(stream => stream.name.startsWith('team/'))
          expect(teams).toHaveLength(1)
          const team = teams[0]!
          const teamId = team.name.slice('team/'.length)
          expect(checkpoint.stream).toBe(team.name)
          const changes = team.entries.filter(entry => entry.value.type === 'task/changed').map(entry => object(entry.value.task))
          expect(changes.map(task => task.phase)).toEqual(['pending', 'assigned', 'running', 'review',
            ...outcome === 'cancellation' ? ['cancelled'] : []])
          const task = changes.find(candidate => candidate.phase === 'review')!
          expect(task).toEqual(checkpoint.task)
          expect(changes.at(-1)).toEqual(outcome === 'failure' ? task : { ...task, revision: Number(task.revision) + 1, phase: 'cancelled' })
          expect(task.attemptCount).toBe(1)
          expect(task.lease).toBeUndefined()
          expect(task.reviewHistory).toEqual([])
          expect(task.reviewPolicy).toMatchObject({ kind: 'participant' })
          expect(task.attemptHistory).toHaveLength(1)
          const attempt = object((task.attemptHistory as unknown[])[0])
          expect(object(attempt.outcome)).toMatchObject({ kind: 'completed', result: { summary: 'The assigned source file requires no changes.' } })
          const review = object(checkpoint.review)
          expect(review.kind).toBe('review-request')
          expect(review.taskId).toBe(task.id)
          expect(object(review.payload)).toMatchObject({ taskId: task.id, attemptId: attempt.id, reviewRevision: task.revision })
          expect(object(review.payload).result).toEqual(object(attempt.outcome).result)
          const reviewChannel = before.find(stream => stream.name === `channel/${String(review.channelId)}`)!
          expect(reviewChannel.entries.some(entry => entry.value.type === 'channel/envelope' && object(entry.value.envelope).id === review.id)).toBe(true)
          expect(reviewChannel.entries.some(entry => entry.value.type === 'channel/receipt'
            && entry.value.envelopeId === review.id && entry.value.participantId === object(task.reviewPolicy).reviewerId)).toBe(true)
          const priorBindings = bindings(team.entries)
          expect(priorBindings).toHaveLength(3)
          expect(priorBindings.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined)).toBe(true)
          expect(team.entries.filter(entry => entry.value.type === 'team/phase').at(-1)?.value.phase).toBe('quiescing')
          const intents = team.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))
          expect(intents).toHaveLength(1)
          const intent = object(intents[0]!.value[outcome === 'failure' ? 'closure' : 'cancellation'])
          expect(object(intent.reason).code).toBe(outcome === 'failure' ? 'REVIEW_TERMINAL_FAILURE' : 'USER_CANCELLED')
          const released = team.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)!
          expect(object(released.value.allocation)).toMatchObject({ taskId: task.id, attemptId: attempt.id, lifecycle: 'released' })
          const second = launch(root, backend, outcome, 'recover', teamId)
          const recovered = await execa(second.command, second.args, { cwd: work, env: second.env, input: '',
            timeout: 30_000, killSignal: 'SIGKILL', reject: false })
          const recoveryDiagnostic = JSON.stringify({ timedOut: recovered.timedOut, exitCode: recovered.exitCode,
            signal: recovered.signal, stdout: recovered.stdout, stderr: recovered.stderr })
          expect(recovered.timedOut, recoveryDiagnostic).toBe(false)
          expect(recovered.exitCode, recoveryDiagnostic).toBe(0)
          expect(recovered.stderr).toBe('')
          const output = object(JSON.parse(recovered.stdout))
          expect(output.pid).not.toBe(checkpoint.pid)
          const after = await streams(root, backend)
          expect(after.map(stream => stream.name).sort()).toEqual(before.map(stream => stream.name).sort())
          for (const old of before) {
            expect(after.find(stream => stream.name === old.name)!.entries.slice(0, old.entries.length)).toEqual(old.entries)
          }
          const settled = after.find(stream => stream.name === team.name)!
          const finalTasks = settled.entries.filter(entry => entry.value.type === 'task/changed').map(entry => object(entry.value.task))
          expect(finalTasks).toHaveLength(changes.length + (outcome === 'failure' ? 1 : 0))
          expect(finalTasks.at(-1)).toEqual({ ...task, revision: Number(task.revision) + 1, phase: 'cancelled' })
          expect(bindings(settled.entries)).toEqual(priorBindings)
          expect(settled.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)).toEqual(released)
          expect(settled.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))).toEqual(intents)
          expect(settled.entries.some(entry => entry.value.type === 'team/final-admitted')).toBe(false)
          const finalReview = after.find(stream => stream.name === reviewChannel.name)!
          expect(finalReview.entries.filter(entry => entry.value.type === 'channel/envelope'))
            .toEqual(reviewChannel.entries.filter(entry => entry.value.type === 'channel/envelope'))
          expect(await readFile(join(work, 'source.txt'), 'utf8')).toBe(CONTENT)
          const { pid: _pid, stage: _stage, outcome: _outcome, ...summary } = output
          const snapshot = `${JSON.stringify({ scenario: 'review-terminal-restart', backend, outcome,
            independentHost: true, initialTask: outcome === 'failure' ? 'review' : 'cancelled',
            cleanupAt: outcome === 'failure' ? 'recovery' : 'intent', completedHistoryRetained: true, reviewRequestRetained: true,
            singleCleanupRevision: true, recovered: summary }, null, 2)}\n`
          const expected = join(import.meta.dirname, `snapshots/review-terminal-restart/${backend}-${outcome}.expected.json`)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, snapshot) }
          else expect(snapshot).toBe(await readFile(expected, 'utf8'))
        } catch (error: unknown) {
          const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
          await cp(root, evidence, { recursive: true })
          throw new Error(`Review terminal failure evidence: ${evidence}`, { cause: error })
        } finally { await rm(root, { recursive: true, force: true }) }
      }, 90_000)
    }
  }
})
