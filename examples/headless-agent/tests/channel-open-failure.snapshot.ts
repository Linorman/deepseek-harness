/** Channel-open cleanup through real TeamRun admission, protocol leases, and durable backends. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-channel-open-failure.cordis.yml')
const driver = 'headless-channel-open-failure-driver.ts'
const expected = join(import.meta.dirname, 'snapshots/channel-open-failure/output.expected.json')
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Read the closed process's actual source streams, including the committed orphan. */
async function inspect(root: string, kind: Backend): Promise<void> {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const infos = await backend.log.list()
    const streams = await Promise.all(infos.filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
      .map(async (info) => {
        const stream = await backend.log.open(info)
        try {
          const entries = await stream.read(-1, 128)
          expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
          return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
        } finally { await stream.close() }
      }))
    const teams = streams.filter(stream => stream.name.startsWith('team/'))
    expect(teams).toHaveLength(2)
    const objectives: unknown[] = []
    for (const team of teams) {
      const records = team.entries.map(entry => entry.value)
      const created = records.find(record => record.type === 'team/created')!
      objectives.push(object(created.goal).objective)
      expect(records.filter(record => record.type === 'channel/attached')).toEqual([])
      expect(records.filter(record => record.type === 'activation/changed')).toEqual([])
      expect(records.filter(record => record.type === 'team/phase').at(-1)?.phase).toBe('failed')
      const closure = object(records.find(record => record.type === 'team/closure')?.closure)
      expect(closure).toMatchObject({ kind: 'fail', reason: { code: 'TEAM_RUN_CREATION_FAILED' } })
      expect(records.some(record => record.type === 'team/final-admitted')).toBe(false)
      expect(records.some(record => record.type === 'goal/changed' && object(record.goal).phase === 'complete')).toBe(false)
    }
    expect(objectives.sort()).toEqual(['Reject channel creation after-append.', 'Reject channel creation before-append.'])
    const channels = streams.filter(stream => stream.name.startsWith('channel/'))
    expect(channels).toHaveLength(1)
    const orphan = channels[0]!
    const manifest = object(orphan.entries[0]!.value.manifest)
    const participantCount = Array.isArray(manifest.participants) ? manifest.participants.length : 0
    expect(orphan.entries.map(entry => entry.sequence)).toEqual(Array.from({ length: participantCount + 2 }, (_, index) => index))
    expect(orphan.entries.map(entry => entry.value.type)).toEqual([
      'channel/opened', 'channel/phase', ...Array.from({ length: participantCount }, () => 'channel/invitation'),
    ])
    expect(orphan.name).toBe(`channel/${String(manifest.id)}`)
    expect(manifest.adapter).toEqual({ type: 'direct', version: 4 })
    const owner = teams.find(team => team.name === `team/${String(manifest.teamId)}`)!
    const created = owner.entries.find(entry => entry.value.type === 'team/created')!.value
    expect(object(created.goal).objective).toBe('Reject channel creation after-append.')
  } finally { await backend.close() }
}

describe('channel creation failure through the headless Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`settles every cleanup and retains only a committed orphan on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/channel-open-failure-'))
      try {
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
          env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_CHANNEL_OPEN_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
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
        throw new Error(`Channel creation failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
