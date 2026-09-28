/** Actual FS and shell tools leave durable bounded workspace observations through the Headless Loader. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { teamWorkspaceObservationSchema, teamWorkspaceAllocationSnapshotSchema, teamTaskSnapshotSchema } from '@clocky/clocky-team'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const driver = 'headless-workspace-observation-driver.ts'
const configPath = join(fixtures, 'headless-workspace-observation.cordis.yml')
const scenarios = ['output', 'materialization-loss', 'unconfirmed-recovery', 'closure-loss'] as const
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected durable observation JSON')
  return value as Record<string, unknown>
}
async function inspect(root: string, kind: 'json' | 'sqlite', scenario: typeof scenarios[number]): Promise<void> {
  const materializationLoss = scenario !== 'output', unconfirmedRecovery = scenario === 'unconfirmed-recovery'
  const closureLoss = scenario === 'closure-loss'
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  const sessions = new Context()
  try {
    await sessions.plugin(SessionStore)
    await sessions.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
    const teams = (await backend.log.list()).filter(info => info.name.startsWith('team/'))
    expect(teams).toHaveLength(1)
    const stream = await backend.log.open(teams[0]!)
    try {
      const rows = (await stream.read(-1, 256)).map(row => object(row.value))
      if (materializationLoss) {
        const allocation = teamWorkspaceAllocationSnapshotSchema.parse(rows.filter(row => row.type === 'workspace-allocation/changed').at(-1)?.allocation)
        const task = teamTaskSnapshotSchema.parse(rows.filter(row => row.type === 'task/changed').at(-1)?.task)
        expect(allocation).toMatchObject({ lifecycle: unconfirmedRecovery ? 'unavailable' : 'released',
          taskId: task.id, loss: { terminationProven: !unconfirmedRecovery } })
        expect(task).toMatchObject({ phase: closureLoss ? 'cancelled' : 'failed', attemptHistory: [{ id: allocation.attemptId,
          outcome: closureLoss ? { kind: 'released' } : { kind: 'failed', failure: { code: 'WORKSPACE_LOST' } } }] })
        const log = await sessions.sessionPersistence.inspect(allocation.sessionId)
        expect(log.events.filter(event => event.type === 'user/message' || event.type === 'assistant/message')).toEqual([])
        return
      }
      const observations = rows.filter(row => row.type === 'workspace/observed').map(row => teamWorkspaceObservationSchema.parse(row.observation))
      expect(observations.map(value => value.stage)).toEqual(['baseline', 'publish', 'release'])
      expect(observations.every(value => !value.truncated && value.final.complete)).toBe(true)
      const publication = observations[1]!
      const released = rows.filter(row => row.type === 'workspace-allocation/changed').at(-1)
      expect(released).toMatchObject({ allocation: { lifecycle: 'released', observation: { id: observations[2]?.id } } })
      const allocation = object(released?.allocation)
      expect(publication).toMatchObject({ allocationId: allocation.id, taskId: allocation.taskId, attemptId: allocation.attemptId })
      const log = await sessions.sessionPersistence.inspect(SessionId(String(allocation.sessionId)))
      const toolCalls = log.events.filter(event => event.type === 'tool/call')
      expect(toolCalls.map(event => event.type === 'tool/call' ? event.data.name : '')).toEqual(['write', 'bash', 'team_task_report'])
      expect(log.events.filter(event => event.type === 'tool/result')).toHaveLength(3)
      expect(await readFile(join(root, 'work/declared/from-fs.txt'), 'utf8')).toBe('Written by the actual FS tool.\n')
      expect(await readFile(join(root, 'work/undeclared-from-shell.txt'), 'utf8')).toBe('Written by the actual shell.\n')
    } finally { await stream.close() }
  } finally { await sessions.fiber.dispose(); await backend.close() }
}

describe('shared workspace observation without artifact publication', () => {
  for (const backend of ['json', 'sqlite'] as const) for (const scenario of scenarios) it(
    `records ${scenario} on ${backend}`, async () => {
      const materializationLoss = scenario !== 'output'
      const unconfirmedRecovery = scenario === 'unconfirmed-recovery'
      const closureLoss = scenario === 'closure-loss'
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/workspace-observation-loader-'))
      let passed = false
      try {
        const work = join(root, 'work')
        await mkdir(join(work, 'declared'), { recursive: true })
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_OBSERVATION_BACKEND: backend, CLOCKY_SNAPSHOT: 'replay', CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1',
            CLOCKY_OBSERVATION_LOSS: materializationLoss ? '1' : '0',
            CLOCKY_OBSERVATION_UNCONFIRMED: unconfirmedRecovery ? '1' : '0',
            CLOCKY_OBSERVATION_CLOSURE: closureLoss ? '1' : '0',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          } })
        const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '', timeout: 30_000,
          killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        if (result.exitCode !== 0 || result.timedOut) throw new Error(`Observation Loader failed (${root})\n${result.stdout}\n${result.stderr}`)
        expect(result.stderr).toBe('')
        const output = object(JSON.parse(result.stdout))
        expect(output).toMatchObject(materializationLoss
          ? { allocation: unconfirmedRecovery ? 'unavailable' : 'released', task: closureLoss ? 'cancelled' : 'failed',
            ...closureLoss ? {} : { failure: 'WORKSPACE_LOST' }, workerRequests: 0, preparations: 1, abandoned: 1 }
          : { artifactCount: 0, truncated: false, allocation: 'released', sourceVersionChanged: true })
        await inspect(root, backend, scenario)
        const golden = join(import.meta.dirname, `snapshots/workspace-observation/${scenario}.expected.json`)
        if (process.env['CLOCKY_SNAPSHOT'] === 'refresh') {
          await mkdir(dirname(golden), { recursive: true })
          await writeFile(golden, `${JSON.stringify(output, null, 2)}\n`)
        }
        expect(output).toEqual(JSON.parse(await readFile(golden, 'utf8')))
        passed = true
      } finally { if (passed) await rm(root, { recursive: true, force: true }) }
    }, 40_000)
})
