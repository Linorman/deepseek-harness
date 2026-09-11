/** Real Host approval and participant review tasks cancel independently on JSON and SQLite. */
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
const configPath = join(fixtures, 'headless-human-approval.cordis.yml')
const driver = 'headless-task-cancellation-driver.ts'
const cancellationConfig = join(fixtures, 'headless-task-cancellation.cordis.yml')
const goldenRoot = join(import.meta.dirname, 'snapshots/task-cancellation')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Cross-check the Host request against the actual Team and Session histories after exit. */
async function inspect(root: string, kind: Backend, scenario: 'approval' | 'review'): Promise<void> {
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
      if (scenario === 'review') {
        const tasks = records.filter(record => record.type === 'task/changed').map(record => object(record.task))
        const reviewed = tasks.find(task => task.phase === 'review')!
        const cancelled = tasks.find(task => task.id === reviewed.id && task.phase === 'cancelled')!
        expect(cancelled.attemptHistory).toEqual(reviewed.attemptHistory)
        expect(cancelled.reviewHistory).toEqual([])
        expect(object(cancelled.cancellation).target).toMatchObject({ kind: 'review', attemptId: object((reviewed.attemptHistory as unknown[])[0]).id })
        expect(tasks.some(task => task.id !== reviewed.id && task.phase === 'completed')).toBe(true)
        expect(records.some(record => record.type === 'human-action/changed')).toBe(false)
        return
      }
      const actions = records.filter(record => record.type === 'human-action/changed').map(record => object(record.action))
      expect(actions).toHaveLength(2)
      const pending = actions[0]!
      const cancelled = actions[1]!
      expect(pending).toMatchObject({ kind: 'approval', phase: 'pending' })
      expect(pending.id).toBe(`approval:${String(pending.sessionId)}:${String(pending.sourceId)}`)
      expect(object(pending.details).approvalId).toBe(pending.sourceId)
      expect(object(pending.details).rpcId).toBeTypeOf('string')
      expect(object(pending.details).callId).toBe('human-approval-escalated-write')
      expect(object(pending.details).toolName).toBe('write')
      expect(cancelled).toMatchObject({ ...pending, phase: 'cancelled', updatedAt: cancelled.updatedAt })
      expect(Number(cancelled.updatedAt)).toBeGreaterThanOrEqual(Number(pending.createdAt))
      const tasks = records.filter(record => record.type === 'task/changed').map(record => object(record.task))
      expect(tasks.find(task => task.id === pending.taskId && task.phase === 'cancelled')).toBeDefined()
      const cancelledIndex = records.findIndex(record => record.type === 'task/changed' && object(record.task).id === pending.taskId && object(record.task).phase === 'cancelled')
      const releaseIndex = records.findIndex(record => record.type === 'workspace-allocation/changed' && object(record.allocation).taskId === pending.taskId && object(record.allocation).lifecycle === 'released')
      expect(releaseIndex).toBeGreaterThan(-1)
      expect(releaseIndex).toBeLessThan(cancelledIndex)
      expect(tasks.some(task => task.id !== pending.taskId && task.phase === 'completed')).toBe(true)
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
        const calls = session.events.filter(event => event.type === 'tool/call').filter(event => event.data.name === 'write')
        expect(calls).toHaveLength(2)
        const initial = JSON.parse(calls[0]!.data.arguments) as Record<string, unknown>
        const escalated = JSON.parse(calls[1]!.data.arguments) as Record<string, unknown>
        expect(initial).toEqual({ file_path: join(root, 'work/approval.txt'), content: 'after\n' })
        expect(escalated).toMatchObject({ ...initial, sandbox_permissions: 'workspace-write' })
        const denied = session.events.filter(event => event.type === 'tool/result')
          .find(event => event.data.message.source.callId === calls[0]!.data.callId)
        expect(denied?.data.error?.code).toBe('FS_SANDBOX_DENIED')
        expect(JSON.stringify(denied)).toContain('[sandbox: file access denied under read-only mode]')
        const asked = session.events.filter(event => event.type === 'approval/asked')
        const decided = session.events.filter(event => event.type === 'approval/decided')
        expect(asked).toHaveLength(1)
        expect(decided).toHaveLength(1)
        expect(asked[0]!.data).toMatchObject({ id: pending.sourceId, toolName: 'write', callId: object(pending.details).callId })
        expect(decided[0]!.data).toEqual({ id: pending.sourceId, outcome: 'cancelled' })
        expect(asked[0]!.seq).toBeLessThan(decided[0]!.seq)
        expect(await readFile(join(root, 'work/approval.txt'), 'utf8')).toBe('before\n')
        expect(session.events.some(event => event.type === 'turn/end')).toBe(true)
      } finally { await ctx.fiber.dispose() }
    } finally { await stream.close() }
  } finally { await backend.close() }
}

describe('single-task cancellation through the formal Host gateway', () => {
  for (const scenario of ['approval', 'review'] as const) {
    for (const backend of ['json', 'sqlite'] as const) {
      const expected = join(goldenRoot, `${scenario}.expected.json`)
      it(`cancels one real worker ${scenario} and continues its Team on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/tc-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          await writeFile(join(work, 'approval.txt'), 'before\n')
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
          await writeFile(join(target, 'headless-human-approval-driver.ts'), await readFile(join(fixtures, 'headless-human-approval-driver.ts')))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
            configArgs: ['--profile', 'headless', '--patch', configPath, '--patch', cancellationConfig], tsconfigPath: join(repository, 'tsconfig.json'),
            env: {
              CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
              CLOCKY_APPROVAL_BACKEND: backend, CLOCKY_TASK_CANCEL_KIND: scenario, CLOCKY_PERMISSION_MODE: 'read-only', CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
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
          await inspect(root, backend, scenario)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
          else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
        } catch (error: unknown) {
          const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
          await cp(root, evidence, { recursive: true })
          throw new Error(`Task cancellation failure evidence: ${evidence}`, { cause: error })
        } finally { await rm(root, { recursive: true, force: true }) }
      }, 45_000)
    }
  }
})
