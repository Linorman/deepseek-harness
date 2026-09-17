import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { decompressZstdFrame, scanZstdFrames } from '@clocky/clocky-session-persistence-jsonl/src/zstd.ts'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const configPath = join(fixtureRoot, 'headless-team-channel-view.cordis.yml')
const driverPath = join(fixtureRoot, 'headless-team-channel-view-driver.ts')
const llmPath = join(fixtureRoot, 'headless-team-channel-view-llm.ts')
const clockyBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface SessionRecord {
  readonly header: Record<string, unknown>
  readonly events: readonly Record<string, unknown>[]
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

async function prepare(cwd: string): Promise<void> {
  const target = join(cwd, '.clocky', 'profiles', 'headless', 'snapshot-fixtures')
  await mkdir(target, { recursive: true })
  await Promise.all([
    writeFile(join(target, 'headless-team-channel-view-driver.ts'), await readFile(driverPath)),
    writeFile(join(target, 'headless-team-channel-view-llm.ts'), await readFile(llmPath)),
    writeFile(join(target, 'package.json'), '{"type":"module"}\n'),
  ])
}

async function runProductSnapshot(): Promise<{ readonly cwd: string; readonly stdout: string; readonly stderr: string }> {
  const tempRoot = join(repoRoot, '.tmp')
  await mkdir(tempRoot, { recursive: true, mode: 0o700 })
  const cwd = await mkdtemp(join(tempRoot, 'headless-team-channel-view-'))
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
    await rm(cwd, { recursive: true, force: true })
    throw error
  }
}

async function persistedSessions(cwd: string): Promise<SessionRecord[]> {
  const root = join(cwd, '.clocky', 'sessions')
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  return await Promise.all(files.map(async (file) => {
    const path = join(root, file)
    const bytes = await readFile(path)
    const content = path.endsWith('.zstd')
      ? await decodedZstd(bytes, path)
      : bytes.toString('utf8')
    const records = content.split('\n')
      .filter(line => line.trim() !== '')
      .map(line => objectValue(JSON.parse(line), 'Session JSONL record'))
    const [header, ...events] = records
    if (header === undefined) throw new Error(`Session '${file}' has no header`)
    return { header, events }
  }))
}

async function decodedZstd(bytes: Buffer, path: string): Promise<string> {
  const scan = scanZstdFrames(bytes)
  if (scan.tornStart !== undefined) throw new Error(`Session '${path}' has a torn Zstandard frame`)
  const decoded = Buffer.concat(await Promise.all(scan.frames.map(async frame =>
    await decompressZstdFrame(bytes.subarray(frame.start, frame.end)))))
  return decoded.toString('utf8')
}

describe('headless Team channel-view snapshot', () => {
  it('persists a real TeamAgentClient non-direct channel view in the assembled composition', async () => {
    const result = await runProductSnapshot()
    try {
      expect(result.stdout).toBe('P0_VIEW_CHANNEL_VIEW_PERSISTED\n')
      expect(result.stderr).toBe('')
      const sessions = await persistedSessions(result.cwd)
      const viewSessions = sessions.filter(session => session.events.some(event => event['type'] === 'team/channel-view'))
      expect(viewSessions).toHaveLength(1)
      const viewEvent = viewSessions[0]?.events.find(event => event['type'] === 'team/channel-view')
      expect(viewEvent).toMatchObject({
        type: 'team/channel-view',
        data: {
          adapter: { type: 'consult', version: 1 },
          viewPolicy: { type: 'recent-window', version: 1 },
          delivery: 'turn',
          content: [{ type: 'text' }],
        },
      })
      const data = objectValue(viewEvent?.['data'], 'Team channel-view data')
      expect(JSON.stringify(data['content'])).toContain('Review Team task')
      const sourceEnvelopeIds = data['sourceEnvelopeIds']
      if (!Array.isArray(sourceEnvelopeIds) || sourceEnvelopeIds.length !== 1) {
        throw new Error('Team channel-view must retain exactly one source Envelope')
      }
      expect(sourceEnvelopeIds[0]).toBeTypeOf('string')
      expect(data['triggeringEnvelopeId']).toBe(sourceEnvelopeIds[0])
    } finally {
      await rm(result.cwd, { recursive: true, force: true })
    }
  }, 45_000)
})
