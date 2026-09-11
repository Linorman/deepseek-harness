/** Direct v4 preserves subset privacy and ordered broadcast content through real Loader Sessions. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { Context } from '@clocky/cordis'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-team-agent-client'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-channel-admission.cordis.yml')
const driver = 'headless-channel-admission-driver.ts'
const expected = join(import.meta.dirname, 'snapshots/channel-admission/output.expected.json')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Check each durable recipient against its actual persisted Session. */
async function inspect(root: string, kind: Backend) {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  const sessions = new Context()
  try {
    await sessions.plugin(SessionStore)
    await sessions.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
    const streams = await backend.log.list()
    const teams = streams.filter(info => info.name.startsWith('team/'))
    const channels = streams.filter(info => info.name.startsWith('channel/'))
    expect(teams).toHaveLength(1)
    expect(channels).toHaveLength(1)
    const team = await backend.log.open(teams[0]!)
    const channel = await backend.log.open(channels[0]!)
    try {
      const teamRecords = (await team.read(-1, 256)).map(entry => object(entry.value))
      const channelRecords = (await channel.read(-1, 128)).map(entry => object(entry.value))
      const envelopes = channelRecords.filter(record => record.type === 'channel/envelope').map(record => object(record.envelope))
      expect(channelRecords.filter(record => record.type === 'channel/acknowledged')).toHaveLength(3)
      expect(channelRecords.filter(record => record.type === 'channel/invitation')).toHaveLength(3)
      expect(envelopes).toHaveLength(2)
      const [subset, broadcast] = envelopes
      expect(subset?.audience).toHaveLength(1)
      expect(object(subset?.payload).content).toEqual([{ type: 'text', text: 'PRIVATE_SUBSET' }])
      expect(broadcast?.audience).toBeNull()
      const content = object(broadcast?.payload).content
      expect(Array.isArray(content)).toBe(true)
      expect((content as unknown[]).map(item => object(item).type)).toEqual(['text', 'image', 'text'])
      const receipts = channelRecords.filter(record => record.type === 'channel/receipt')
      expect(receipts).toHaveLength(3)
      const bindings = new Map<string, Record<string, unknown>>()
      for (const record of teamRecords.filter(record => record.type === 'activation/changed')) {
        const binding = object(record.binding)
        bindings.set(String(object(binding.activation).participantId), binding)
      }
      expect(bindings.size).toBe(3)
      for (const [participantId, binding] of bindings) {
        expect(object(binding.activation).status).toBe('offline')
        expect(binding.quiescedAt).toBeTypeOf('number')
        const log = await sessions.sessionPersistence.inspect(SessionId(String(binding.sessionId)))
        const messages = log.events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : [])
          .filter(message => message.source.kind === 'team-envelope')
        const received = receipts.filter(record => record.participantId === participantId)
        expect(messages).toHaveLength(received.length)
        expect(messages.map(message => object(message.source).envelopeId).sort())
          .toEqual(received.map(record => record.envelopeId).sort())
        if (received.length > 0) {
          const message = messages.find(message => object(message.source).envelopeId === broadcast?.id)
          expect(message?.content.slice(1)).toEqual(content)
          expect(JSON.stringify(log.events).includes('PRIVATE_SUBSET')).toBe(received.length === 2)
          expect(log.events.some(event => event.type === 'assistant/message')).toBe(true)
        }
      }
    } finally { await channel.close(); await team.close() }
  } finally {
    await sessions.fiber.dispose()
    await backend.close()
  }
}

describe('channel admission through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`blocks dispatch until actual endpoint consent and then delivers with Session receipts on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/channel-admission-loader-'))
      try {
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_DIRECT_V4_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
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
        throw new Error(`Channel admission Loader evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
