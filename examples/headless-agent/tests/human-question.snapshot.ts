/** Real Host pending-question admission and cancellation over both durable Team backends. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@clocky/cordis'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-human-question.cordis.yml')
const driver = 'headless-human-question-driver.ts'
const expected = join(import.meta.dirname, 'snapshots/human-question/producer.expected.json')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Cross-check the Host request against the actual Team and Session histories after exit. */
async function inspect(root: string, kind: Backend): Promise<void> {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const teams = (await backend.log.list()).filter(info => info.name.startsWith('team/'))
    expect(teams).toHaveLength(1)
    const stream = await backend.log.open(teams[0]!)
    try {
      const entries = await stream.read(-1, 128)
      expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
      const records = entries.map(entry => object(entry.value))
      const actions = records.filter(record => record.type === 'human-action/changed').map(record => object(record.action))
      expect(actions).toHaveLength(2)
      const pending = actions[0]!
      const cancelled = actions[1]!
      expect(pending).toMatchObject({ kind: 'question', phase: 'pending' })
      expect(pending.id).toBe(`question:${String(pending.sessionId)}:${String(pending.sourceId)}`)
      expect(object(pending.details).questionRpcId).toBe(pending.sourceId)
      expect(object(pending.details).questions).toHaveLength(1)
      expect(cancelled).toEqual({ ...pending, phase: 'cancelled', outcome: { kind: 'team-cancelled' }, updatedAt: cancelled.updatedAt })
      expect(Number(cancelled.updatedAt)).toBeGreaterThanOrEqual(Number(pending.createdAt))
      const tasks = records.filter(record => record.type === 'task/changed').map(record => object(record.task))
      expect(tasks.at(-1)).toMatchObject({ id: pending.taskId, phase: 'cancelled' })
      const running = tasks.find(task => task.phase === 'running')!
      expect(object(running.lease).participantId).toBe(pending.participantId)
      const binding = records.filter(record => record.type === 'activation/changed').map(record => object(record.binding))
        .find(binding => binding.sessionId === pending.sessionId)!
      expect(object(binding.activation).id).toBe(object(running.lease).activationId)
      expect(records.filter(record => record.type === 'team/phase').at(-1)?.phase).toBe('cancelled')
      expect(records.some(record => record.type === 'team/final-admitted')).toBe(false)
      const ctx = new Context()
      try {
        await ctx.plugin(SessionStore)
        await ctx.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
        const session = await ctx.sessionPersistence.inspect(SessionId(String(pending.sessionId)))
        expect(session.meta).toMatchObject({ id: pending.sessionId, teamId: pending.teamId,
          participantId: pending.participantId, agentPreset: 'standard' })
        const calls = session.events.filter(event => event.type === 'tool/call' && event.data.name === 'ask_user_question')
        expect(calls).toHaveLength(1)
        expect(session.events.some(event => event.type === 'turn/end')).toBe(true)
      } finally { await ctx.fiber.dispose() }
    } finally { await stream.close() }
  } finally { await backend.close() }
}

describe('pending human question through the formal Host gateway', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`admits one real worker question and retains public cancellation on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/hq-'))
      const work = join(root, 'work')
      try {
        await mkdir(work)
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_QUESTION_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          },
        })
        const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode,
          signal: result.signal, stdout: result.stdout, stderr: result.stderr })
        expect(result.timedOut, diagnostic).toBe(false)
        expect(result.exitCode, diagnostic).toBe(0)
        expect(result.stderr).toBe('')
        await inspect(root, backend)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
        else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Human question failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
