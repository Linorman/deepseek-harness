/** Loader budget scans retain real AgentClient usage and refuse activation after a zero-budget stall. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { Context } from '@clocky/cordis'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-usage-budget-boundaries.cordis.yml')
const driver = 'headless-usage-budget-boundaries-driver.ts'
const expected = join(import.meta.dirname, 'snapshots/usage-budget-boundaries/output.expected.json')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Check independent journal and Session evidence after the Loader process has disposed its real activations. */
async function inspect(root: string, kind: Backend) {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  const sessions = new Context()
  try {
    await sessions.plugin(SessionStore)
    await sessions.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
    const teams = (await backend.log.list()).filter(info => info.name.startsWith('team/'))
    expect(teams).toHaveLength(3)
    for (const info of teams) {
      const stream = await backend.log.open(info)
      try {
        const records = (await stream.read(-1, 128)).map(entry => object(entry.value))
        const created = records.find(record => record.type === 'team/created')
        if (created === undefined) throw new Error('Budget scenario omitted its Team creation')
        const scenario = object(created.goal).objective
        const usageRecords = records.filter(record => record.type === 'usage/changed')
        const phase = records.filter(record => record.type === 'team/phase').at(-1)
        expect(phase?.phase).toBe('stalled')
        expect(object(object(created.rules).teamLimits).maxModelTokensPerTeam).toBe(1)
        if (scenario === 'zero-input') {
          expect(created.budgets).toEqual({ maxInputTokens: 0 })
          expect(usageRecords).toEqual([])
          expect(records.filter(record => record.type === 'activation/changed')).toEqual([])
          expect(object(phase?.reason).code).toBe('TEAM_INPUT_TOKENS_BUDGET_EXCEEDED')
          continue
        }
        expect(usageRecords).toHaveLength(1)
        const sample = object(usageRecords[0]?.sample)
        const usage = object(usageRecords[0]?.usage)
        const expectedUsage = scenario === 'stricter-output' ? { inputTokens: 0, outputTokens: 1 } : { inputTokens: 1, outputTokens: 0 }
        expect(sample.usage).toEqual(expectedUsage)
        expect(usage).toMatchObject(expectedUsage)
        expect(sample.costUnits).toBe(scenario === 'stricter-output' ? 0 : 0.5)
        expect(created.budgets).toEqual(scenario === 'stricter-output' ? { maxOutputTokens: 20 } : { maxCostUnits: 0.5 })
        expect(object(phase?.reason).code).toBe(scenario === 'stricter-output' ? 'TEAM_TOKEN_BUDGET_EXCEEDED' : 'TEAM_COST_BUDGET_EXCEEDED')
        const binding = object(records.filter(record => record.type === 'activation/changed').at(-1)?.binding)
        expect(object(binding.activation).status).toBe('offline')
        expect(binding.quiescedAt).toBeTypeOf('number')
        const log = await sessions.sessionPersistence.inspect(SessionId(String(sample.sessionId)))
        expect(log.meta).toMatchObject({ id: sample.sessionId, teamId: sample.teamId, participantId: sample.participantId })
        const messages = log.events.filter(event => event.type === 'assistant/message' && event.data.usage !== undefined)
        expect(messages).toHaveLength(1)
        const message = messages[0]
        if (message?.type !== 'assistant/message') throw new Error('Usage did not come from an actual assistant message')
        expect(message.data).toMatchObject({ turn: sample.turn, step: sample.step, usage: sample.usage })
        expect(message.data.message.source).toMatchObject({ provider: sample.provider, model: sample.model })
        expect(sample.id).toBe(`${String(sample.sessionId)}:${String(sample.turn)}:${String(sample.step)}`)
        expect(log.events.some(event => event.type === 'turn/end')).toBe(true)
      } finally { await stream.close() }
    }
  } finally {
    await sessions.fiber.dispose()
    await backend.close()
  }
}

describe('usage budget boundaries through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`stalls on tighter, fractional and zero ceilings with actual producer evidence on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/usage-budget-loader-'))
      try {
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_USAGE_BOUNDARY_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          },
        })
        const result = await execa(launch.command, launch.args, { cwd: root, env: launch.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode,
          signal: result.signal, stdout: result.stdout, stderr: result.stderr })
        expect(result.timedOut, diagnostic).toBe(false)
        expect(result.exitCode, diagnostic).toBe(0)
        expect(result.stderr).toBe('')
        await inspect(root, backend)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') {
          await mkdir(dirname(expected), { recursive: true })
          await writeFile(expected, result.stdout)
        } else { expect(result.stdout).toBe(await readFile(expected, 'utf8')) }
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Usage budget Loader evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
