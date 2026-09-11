/** Real mixed Team resources are retained in source histories before current-owner cancellation. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configs = ['headless-human-approval.cordis.yml', 'headless-multi-resource.cordis.yml']
const drivers = ['headless-human-approval-driver.ts', 'headless-multi-resource-driver.ts']

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

async function inspect(root: string): Promise<void> {
  const backend = new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
  try {
    const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/'))
    expect(infos).toHaveLength(1)
    const stream = await backend.log.open(infos[0]!)
    try {
      const entries = await stream.read(-1, 256)
      expect(await stream.read(entries.at(-1)!.sequence, 1)).toEqual([])
      const records = entries.map(entry => object(entry.value))
      const tasks = new Map<unknown, Record<string, unknown>>()
      for (const record of records.filter(record => record.type === 'task/changed')) {
        const task = object(record.task); tasks.set(task.id, task)
      }
      expect(tasks.size).toBe(3)
      expect([...tasks.values()].every(task => task.phase === 'cancelled')).toBe(true)
      const review = [...tasks.values()].find(task => task.workflowPlanId === undefined)!
      expect(review.reviewHistory).toEqual([])
      expect((review.attemptHistory as unknown[]).map(object)).toMatchObject([{ outcome: { kind: 'completed' } }])
      const plans = records.filter(record => record.type === 'workflow-plan/changed').map(record => object(record.plan))
      expect(plans.some(plan => plan.phase === 'ready')).toBe(true)
      expect(plans.at(-1)?.phase).toBe('cancelled')
      expect(plans.at(-1)?.taskBindings).toHaveLength(2)
      const actions = records.filter(record => record.type === 'human-action/changed').map(record => object(record.action))
      expect(actions).toHaveLength(2)
      expect(actions[0]).toMatchObject({ kind: 'approval', phase: 'pending' })
      expect(actions[1]).toEqual({ ...actions[0], phase: 'cancelled', outcome: { kind: 'team-cancelled' }, updatedAt: actions[1]!.updatedAt })
      expect(records.filter(record => record.type === 'team/phase').at(-1)?.phase).toBe('cancelled')
      expect(records.some(record => record.type === 'team/final-admitted')).toBe(false)
    } finally { await stream.close() }
  } finally { await backend.close() }
  for (const file of ['approval.txt', 'review.txt']) expect(await readFile(join(root, 'work', file), 'utf8')).toBe('before\n')
}

describe('mixed resources through the actual workflow and Host producers', () => {
  it('coexists on JSON and cancels through the current TeamRun owner', async () => {
    await mkdir(join(repository, '.tmp'), { recursive: true })
    const root = await mkdtemp(join(repository, '.tmp/mr-'))
    try {
      const work = join(root, 'work'); await mkdir(work)
      for (const file of ['approval.txt', 'review.txt']) await writeFile(join(work, file), 'before\n')
      const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
      await mkdir(target, { recursive: true })
      for (const driver of drivers) await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
      await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
      const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
        configArgs: ['--profile', 'headless', ...configs.flatMap(config => ['--patch', join(fixtures, config)])],
        tsconfigPath: join(repository, 'tsconfig.json'), env: {
          CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
          CLOCKY_APPROVAL_BACKEND: 'json', CLOCKY_PERMISSION_MODE: 'read-only',
          CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        } })
      const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '',
        timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
      const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode,
        signal: result.signal, stdout: result.stdout, stderr: result.stderr })
      expect(result.timedOut, diagnostic).toBe(false)
      expect(result.exitCode, diagnostic).toBe(0)
      expect(result.stderr).toBe('')
      await inspect(root)
      const expected = join(import.meta.dirname, 'snapshots/multi-resource/producer.expected.json')
      if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
      else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
    } catch (error: unknown) {
      const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
      await cp(root, evidence, { recursive: true })
      throw new Error(`Mixed resource producer evidence: ${evidence}`, { cause: error })
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 45_000)
})
