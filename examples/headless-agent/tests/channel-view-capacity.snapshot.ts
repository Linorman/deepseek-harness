/** Actual non-direct delivery keeps a pure oversized source pending and delivers an independent smaller source. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { decompressZstdFrame, scanZstdFrames } from '@clocky/clocky-session-persistence-jsonl/src/zstd.ts'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-channel-view-capacity.cordis.yml')
const driver = 'headless-channel-view-capacity-driver.ts'
const expected = join(import.meta.dirname, 'snapshots/channel-view-capacity/output.expected.json')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Read actual persisted Session records after clean process exit. */
async function sessionViews(root: string): Promise<Record<string, unknown>[]> {
  const directory = join(root, '.clocky/sessions')
  const files = (await readdir(directory, { recursive: true })).filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  const views: Record<string, unknown>[] = []
  for (const file of files) {
    const bytes = await readFile(join(directory, file))
    let text: string
    if (file.endsWith('.zstd')) {
      const frames = scanZstdFrames(bytes)
      expect(frames.tornStart).toBeUndefined()
      text = Buffer.concat(await Promise.all(frames.frames.map(frame => decompressZstdFrame(bytes.subarray(frame.start, frame.end))))).toString('utf8')
    } else { text = bytes.toString('utf8') }
    const records = text.split('\n').filter(line => line.trim() !== '').map(line => object(JSON.parse(line)))
    for (const record of records) if (record.type === 'team/channel-view') views.push(object(record.data))
  }
  return views
}

/** Match the one persisted model view to a real small review request and a single durable receipt. */
async function inspect(root: string, kind: Backend): Promise<void> {
  const views = await sessionViews(root)
  expect(views).toHaveLength(1)
  const view = views[0]!
  expect(view.adapter).toEqual({ type: 'consult', version: 1 })
  expect(view.viewPolicy).toEqual({ type: 'directed', version: 1 })
  expect(view.sourceEnvelopeIds).toEqual([view.triggeringEnvelopeId])
  const content = view.content
  expect(Array.isArray(content)).toBe(true)
  const block = object((content as unknown[])[0])
  expect(block.type).toBe('text')
  expect(typeof block.text).toBe('string')
  const text = String(block.text)
  expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(32768)
  expect(object(object(JSON.parse(text)).view).padding).toBe('')
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const info = (await backend.log.list()).find(info => info.name === `channel/${String(view.channelId)}`)
    expect(info).toBeDefined()
    const stream = await backend.log.open(info!)
    try {
      const records = (await stream.read(-1, 128)).map(entry => object(entry.value))
      const envelope = records.find(record => record.type === 'channel/envelope' && object(record.envelope).id === view.triggeringEnvelopeId)
      expect(envelope).toBeDefined()
      expect(object(envelope!.envelope).kind).toBe('review-request')
      expect(Buffer.byteLength(JSON.stringify(object(envelope!.envelope)), 'utf8')).toBeLessThan(32768)
      expect(records.filter(record => record.type === 'channel/receipt' && record.envelopeId === view.triggeringEnvelopeId)).toHaveLength(1)
    } finally { await stream.close() }
  } finally { await backend.close() }
}

describe('channel view capacity through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects an immutable oversized source and delivers a smaller source through one pure policy on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/channel-view-capacity-'))
      try {
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_VIEW_CAPACITY_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          },
        })
        const result = await execa(launch.command, launch.args, { cwd: root, env: launch.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode, signal: result.signal,
          stdout: result.stdout, stderr: result.stderr })
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
        throw new Error(`Channel view capacity evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
