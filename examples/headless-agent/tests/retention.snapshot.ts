/** Real cancelled Host work produces multiple terminal WALs for bounded scheduler retention. */
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
const configs = ['headless-human-question.cordis.yml', 'headless-retention.cordis.yml']
const drivers = ['headless-human-question-driver.ts', 'headless-retention-driver.ts']
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Inspect physical source prefixes and checkpointed business state through the actual backend. */
async function inspect(root: string, kind: Backend): Promise<void> {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
    expect(infos.filter(info => info.name.startsWith('team/'))).toHaveLength(1)
    expect(infos.filter(info => info.name.startsWith('channel/'))).toHaveLength(2)
    for (const info of infos) {
      const stream = await backend.log.open(info)
      try {
        expect(stream.firstSequence).toBeGreaterThan(0)
        expect(stream.firstSequence).toBe(info.tailSequence - 1)
        const tail = await stream.read(stream.firstSequence - 1, 16)
        expect(tail.map(entry => entry.sequence)).toEqual([info.tailSequence - 1, info.tailSequence])
        expect(await stream.read(info.tailSequence, 1)).toEqual([])
        const checkpoint = await stream.readCheckpoint()
        expect(checkpoint?.sequence).toBe(info.tailSequence)
        const data = object(checkpoint?.value)
        const projection = object(data.projection)
        if (info.name.startsWith('team/')) {
          expect(data.kind).toBe('team-projection')
          expect(object(projection.team).phase).toBe('cancelled')
          const question = (projection.humanActions as unknown[]).map(object)
          expect(question).toHaveLength(1)
          expect(question[0]).toMatchObject({ kind: 'question', phase: 'cancelled', outcome: { kind: 'team-cancelled' } })
          expect((projection.tasks as unknown[]).map(object)[0]).toMatchObject({ phase: 'cancelled' })
        } else {
          expect(data.kind).toBe('channel-projection')
          expect(projection.phase).toBe('closed')
        }
      } finally { await stream.close() }
    }
  } finally { await backend.close() }
}

describe('terminal retention through a real Host producer', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`advances both terminal channels before their Team journal with one slot on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/rt-'))
      const work = join(root, 'work')
      try {
        await mkdir(work)
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        for (const driver of drivers) await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', ...configs.flatMap(config => ['--patch', join(fixtures, config)])],
          tsconfigPath: join(repository, 'tsconfig.json'),
          env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_QUESTION_BACKEND: backend, CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
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
        await inspect(root, backend)
        const expected = join(import.meta.dirname, `snapshots/retention/${backend}.expected.json`)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
        else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Retention failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
