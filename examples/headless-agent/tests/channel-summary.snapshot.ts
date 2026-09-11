import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { Context } from '@clocky/cordis'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { channelRecordSchema, fingerprintChannelSummarySources } from '@clocky/clocky-team'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const configPath = join(fixtureRoot, 'headless-channel-summary.cordis.yml')
const driverPath = join(fixtureRoot, 'headless-channel-summary-driver.ts')
const llmPath = join(fixtureRoot, 'headless-channel-summary-llm.ts')
const clockyBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

async function prepare(cwd: string): Promise<void> {
  const target = join(cwd, '.clocky', 'profiles', 'headless', 'snapshot-fixtures')
  await mkdir(target, { recursive: true })
  await Promise.all([
    writeFile(join(target, 'headless-channel-summary-driver.ts'), await readFile(driverPath)),
    writeFile(join(target, 'headless-channel-summary-llm.ts'), await readFile(llmPath)),
    writeFile(join(target, 'package.json'), '{"type":"module"}\n'),
  ])
}

async function runProductSnapshot(backend: 'json' | 'sqlite'): Promise<{ readonly cwd: string; readonly stdout: string; readonly stderr: string }> {
  const tempRoot = join(repoRoot, '.tmp')
  await mkdir(tempRoot, { recursive: true, mode: 0o700 })
  const cwd = await mkdtemp(join(tempRoot, 'headless-channel-summary-'))
  try {
    await prepare(cwd)
    const launch = resolveExampleLaunch({
      srcBin: clockyBinScript,
      configArgs: ['--profile', 'headless', '--patch', configPath],
      tsconfigPath,
      env: {
        CLOCKY_HOME: join(cwd, '.clocky'),
        CLOCKY_AGENTS_HOME: join(cwd, '.agents'),
        CLOCKY_SNAPSHOT: 'replay',
        CLOCKY_SUMMARY_BACKEND: backend,
        TSX_DISABLE_CACHE: '1',
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
    })
    const result = await execa(launch.command, launch.args, {
      cwd,
      env: launch.env,
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    if (result.timedOut) throw new Error(`product snapshot timed out\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    if (result.exitCode !== 0) throw new Error(`product snapshot exited ${String(result.exitCode)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    return { cwd, stdout: result.stdout, stderr: result.stderr }
  } catch (error: unknown) {
    throw new Error(`${String(error)}\nRetained summary fixture: ${cwd}`, { cause: error })
  }
}

/** Read storage and Session artifacts independently after the actual Loader has stopped. */
async function inspect(root: string, kind: 'json' | 'sqlite'): Promise<void> {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  const sessions = new Context()
  try {
    await sessions.plugin(SessionStore)
    await sessions.plugin(JsonlSessionPersistence, { root: join(root, '.clocky/sessions') })
    const channels = (await backend.log.list()).filter(info => info.name.startsWith('channel/'))
    expect(channels).toHaveLength(2)
    let summaries = 0
    for (const info of channels) {
      const stream = await backend.log.open(info)
      try {
        const records = (await stream.read(-1, 128)).map(entry => channelRecordSchema.parse(entry.value))
        for (const record of records) {
          if (record.type !== 'channel/summary') continue
          summaries += 1
          const sources = records.flatMap(item => item.type === 'channel/envelope'
            && item.envelope.sequence >= record.coveredSequenceRange.from
            && item.envelope.sequence <= record.coveredSequenceRange.to ? [item.envelope] : [])
          expect(record.sourceEnvelopeIds).toEqual(sources.map(source => source.id))
          expect(record.sourceFingerprint).toBe(fingerprintChannelSummarySources(sources))
        }
      } finally { await stream.close() }
    }
    expect(summaries).toBe(3)
    const logs = await sessions.sessionPersistence.list()
    const coordinator = logs.find(log => log.id.startsWith('team-coordinator-'))
    if (coordinator === undefined) throw new Error('Summary fixture has no persisted coordinator Session')
    const log = await sessions.sessionPersistence.inspect(SessionId(coordinator.id))
    expect(log.events.some(event => event.type === 'tool/result')).toBe(true)
    const views = log.events.filter(event => event.type === 'team/channel-view')
    const summarized = views.find(event => event.type === 'team/channel-view' && event.data.sourceEnvelopeIds.length === 2)
    expect(summarized?.type).toBe('team/channel-view')
    if (summarized?.type !== 'team/channel-view') throw new Error('Summary plus raw tail was not persisted')
    const content = summarized.data.content[0]
    if (content?.type !== 'text') throw new Error('Summary view has no text')
    expect(content.text).toContain('Shared discussion source.')
    expect(JSON.parse(content.text)).toMatchObject({ view: { messages: [
      { kind: 'summary' },
      { payload: { text: 'Uncovered discussion tail.' } },
    ] } })
  } finally { await sessions.fiber.dispose(); await backend.close() }
}

describe('explicit channel summary through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) it(`runs the coordinator tool and authenticated human API on ${backend}`, async () => {
    const result = await runProductSnapshot(backend)
    try {
      expect(result.stderr).toBe('')
      const output = JSON.parse(result.stdout) as Record<string, unknown>
      expect(output).toMatchObject({ sameFingerprint: true, retry: 'same durable record' })
      expect(output.coordinatorTool).toBe(output.humanApi)
      expect(output.coordinatorTool).toMatch(/Alpha source\. Beta detail\./u)
      await inspect(result.cwd, backend)
      const expected = join(import.meta.dirname, 'snapshots/channel-summary/output.expected.json')
      if (process.env['CLOCKY_SNAPSHOT'] === 'refresh') {
        await mkdir(dirname(expected), { recursive: true })
        await writeFile(expected, `${JSON.stringify(output, null, 2)}\n`)
      }
      expect(output).toEqual(JSON.parse(await readFile(expected, 'utf8')))
    } finally { await rm(result.cwd, { recursive: true, force: true }) }
  }, 40_000)
})
