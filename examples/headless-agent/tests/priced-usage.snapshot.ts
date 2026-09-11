/** Real Loader pricing replay preserves one Session-derived usage observation. */
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
const configPath = join(fixtures, 'headless-priced-usage.cordis.yml')
const driver = 'headless-priced-usage-driver.ts'
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Independently verify durable accounting and Session provenance after the real Host exits. */
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
      const usages = records.filter(record => record.type === 'usage/changed')
      expect(usages).toHaveLength(1)
      const usage = usages[0]!
      const sample = object(usage.sample)
      expect(sample).toMatchObject({ provider: 'priced-usage-model', model: 'priced-usage-model',
        usage: { inputTokens: 2, outputTokens: 1 }, costUnits: 7 })
      expect(sample.id).toBe(`${String(sample.sessionId)}:${String(sample.turn)}:${String(sample.step)}`)
      expect(usage.usage).toMatchObject({ inputTokens: 2, outputTokens: 1, costUnits: 7 })
      const created = records.find(record => record.type === 'team/created')!
      expect(object(created.rules).usageRates).toEqual({
        'priced-usage-model/priced-usage-model': { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
      })
      expect(records.filter(record => record.type === 'team/phase').at(-1)?.phase).toBe('cancelled')
      const binding = object(records.filter(record => record.type === 'activation/changed').at(-1)?.binding)
      expect(binding.sessionId).toBe(sample.sessionId)
      expect(object(binding.activation)).toMatchObject({ status: 'offline', participantId: sample.participantId })
      expect(binding.quiescedAt).toBeTypeOf('number')
      const ctx = new Context()
      try {
        await ctx.plugin(SessionStore)
        await ctx.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
        const log = await ctx.sessionPersistence.inspect(SessionId(String(sample.sessionId)))
        expect(log.meta).toMatchObject({ id: sample.sessionId, teamId: sample.teamId, participantId: sample.participantId })
        const messages = log.events.filter(event => event.type === 'assistant/message' && event.data.usage !== undefined)
        expect(messages).toHaveLength(1)
        const message = messages[0]!
        expect(message.data).toMatchObject({ turn: sample.turn, step: sample.step, usage: sample.usage })
        expect(message.type === 'assistant/message' && message.data.message.source)
          .toMatchObject({ provider: sample.provider, model: sample.model })
        expect(log.events.some(event => event.type === 'tool/call' && event.data.name === 'team_task_list')).toBe(true)
        expect(log.events.some(event => event.type === 'turn/end')).toBe(true)
      } finally { await ctx.fiber.dispose() }
    } finally { await stream.close() }
  } finally { await backend.close() }
}

describe('priced usage replay through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`replays AgentClient-priced Session usage with old and fresh cursors on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/priced-usage-'))
      try {
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_USAGE_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
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
        const expected = join(import.meta.dirname, `snapshots/priced-usage/${backend}.expected.json`)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') {
          await mkdir(dirname(expected), { recursive: true })
          await writeFile(expected, result.stdout)
        } else { expect(result.stdout).toBe(await readFile(expected, 'utf8')) }
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Priced usage failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
