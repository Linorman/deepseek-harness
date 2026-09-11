/** A real Host question retains its request history when terminal intent outlives the Host. */
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
const configs = ['headless-human-question.cordis.yml', 'headless-human-question-restart.cordis.yml']
const drivers = ['headless-human-question-driver.ts', 'headless-human-question-restart-driver.ts']
type Backend = 'json' | 'sqlite'
type Outcome = 'failure' | 'cancellation'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Preserve the original lock/WAL for the new Loader while inspecting a separate copy. */
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
        const entries = await stream.read(-1, 128)
        expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
        return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
      } finally { await stream.close() }
    }))
  } finally { await backend.close() }
}

function bindings(entries: readonly { value: Record<string, unknown> }[]): Record<string, unknown>[] {
  const result = new Map<unknown, Record<string, unknown>>()
  for (const entry of entries) {
    if (entry.value.type !== 'activation/changed') continue
    const binding = object(entry.value.binding)
    result.set(object(binding.activation).id, binding)
  }
  return [...result.values()]
}

function launch(root: string, backend: Backend, outcome: Outcome, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', ...configs.flatMap(config => ['--patch', join(fixtures, config)])],
    tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
      CLOCKY_QUESTION_BACKEND: backend, CLOCKY_QUESTION_STAGE: stage, CLOCKY_QUESTION_OUTCOME: outcome,
      ...(teamId === undefined ? {} : { CLOCKY_QUESTION_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('pending Host question cleanup after abrupt terminal intent', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const outcome of ['failure', 'cancellation'] as const) {
      it(`retains the real question history after ${outcome} on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/hqr-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          for (const driver of drivers) await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
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
          const questions = team.entries.filter(entry => entry.value.type === 'human-action/changed')
            .map(entry => object(entry.value.action))
          expect(questions).toHaveLength(outcome === 'failure' ? 1 : 2)
          const pending = questions[0]!
          expect(pending).toEqual(checkpoint.question)
          expect(pending).toMatchObject({ kind: 'question', phase: 'pending' })
          expect(pending.id).toBe(`question:${String(pending.sessionId)}:${String(pending.sourceId)}`)
          expect(object(pending.details).questionRpcId).toBe(pending.sourceId)
          const taskEntries = team.entries.filter(entry => entry.value.type === 'task/changed')
          const task = object(taskEntries.at(-1)?.value.task)
          expect(task).toEqual(checkpoint.task)
          expect(task).toMatchObject({ id: pending.taskId, phase: 'running', attemptCount: 1, attemptHistory: [] })
          expect(object(task.lease).participantId).toBe(pending.participantId)
          const priorBindings = bindings(team.entries)
          expect(priorBindings).toHaveLength(2)
          expect(priorBindings.every(binding => binding.quiescedAt === undefined && binding.recovery === undefined)).toBe(true)
          const worker = priorBindings.find(binding => binding.sessionId === pending.sessionId)!
          expect(object(worker.activation).id).toBe(object(task.lease).activationId)
          const allocation = team.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)!
          expect(object(allocation.value.allocation)).toMatchObject({ taskId: task.id,
            attemptId: object(task.lease).attemptId, sessionId: pending.sessionId, lifecycle: 'active' })
          const intents = team.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))
          expect(intents).toHaveLength(1)
          const intent = object(intents[0]!.value[outcome === 'failure' ? 'closure' : 'cancellation'])
          const expectedOutcome = outcome === 'failure' ? { kind: 'team-failed', reason: intent.reason } : { kind: 'team-cancelled' }
          if (outcome === 'cancellation') expect(questions[1]).toEqual({ ...pending, phase: 'cancelled',
            outcome: expectedOutcome, updatedAt: questions[1]!.updatedAt })
          expect(team.entries.filter(entry => entry.value.type === 'team/phase').at(-1)?.value.phase).toBe('quiescing')
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
          const finalQuestions = settled.entries.filter(entry => entry.value.type === 'human-action/changed')
            .map(entry => object(entry.value.action))
          expect(finalQuestions).toHaveLength(2)
          expect(finalQuestions[0]).toEqual(pending)
          expect(finalQuestions[1]).toEqual({ ...pending, phase: 'cancelled', outcome: expectedOutcome,
            updatedAt: finalQuestions[1]!.updatedAt })
          expect(settled.entries.filter(entry => entry.value.type === 'task/changed')).toEqual(taskEntries)
          expect(settled.entries.filter(entry => entry.value.type === 'workspace-allocation/changed').at(-1)).toEqual(allocation)
          expect(bindings(settled.entries)).toEqual(priorBindings)
          expect(settled.entries.filter(entry => entry.value.type === (outcome === 'failure' ? 'team/closure' : 'team/cancellation'))).toEqual(intents)
          expect(settled.entries.some(entry => entry.value.type === 'team/final-admitted')).toBe(false)
          const { pid: _pid, stage: _stage, outcome: _outcome, ...summary } = output
          const snapshot = `${JSON.stringify({ scenario: 'human-question-restart', backend, outcome, independentHost: true,
            initialQuestion: outcome === 'failure' ? 'pending' : 'cancelled', cleanupAt: outcome === 'failure' ? 'recovery' : 'intent',
            originalPendingRetained: true, questionHistoryRecords: finalQuestions.length, recovered: summary }, null, 2)}\n`
          const expected = join(import.meta.dirname, `snapshots/human-question-restart/${backend}-${outcome}.expected.json`)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, snapshot) }
          else expect(snapshot).toBe(await readFile(expected, 'utf8'))
        } catch (error: unknown) {
          const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
          await cp(root, evidence, { recursive: true })
          throw new Error(`Human question restart evidence: ${evidence}`, { cause: error })
        } finally { await rm(root, { recursive: true, force: true }) }
      }, 90_000)
    }
  }
})
