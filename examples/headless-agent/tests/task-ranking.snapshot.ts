/** Real worker training and two independent restarts choose the same ranked owner. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const golden = join(import.meta.dirname, 'snapshots/task-ranking.expected.json')

describe('durable outcome and latency ranking', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`replays actual worker history through independent ${backend} Loader restarts`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/rank-'))
      const work = join(root, 'work')
      const trained = join(root, 'trained')
      const results: unknown[] = []
      try {
        await mkdir(work)
        const fixtureHome = join(trained, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(fixtureHome, { recursive: true })
        await cp(join(fixtures, 'headless-task-ranking-driver.ts'), join(fixtureHome, 'headless-task-ranking-driver.ts'))
        await writeFile(join(fixtureHome, 'package.json'), '{"type":"module"}\n')
        for (const stage of ['train', 'restart-a', 'restart-b']) {
          const home = stage === 'train' ? trained : join(root, stage)
          if (stage !== 'train') await cp(trained, home, { recursive: true })
          const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
            configArgs: ['--profile', 'headless', '--patch', join(fixtures, 'headless-task-ranking.cordis.yml')],
            tsconfigPath: join(repository, 'tsconfig.json'), env: {
              CLOCKY_HOME: join(home, '.clocky'), CLOCKY_AGENTS_HOME: join(home, '.agents'),
              CLOCKY_RANKING_BACKEND: backend, CLOCKY_RANKING_STAGE: stage, TSX_DISABLE_CACHE: '1',
              CLOCKY_SNAPSHOT: 'replay', CLOCKY_TELEMETRY_DISABLED: '1',
              NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
            } })
          const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '',
            timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
          const diagnostic = JSON.stringify({ stage, timedOut: result.timedOut, exitCode: result.exitCode,
            stdout: result.stdout, stderr: result.stderr })
          await writeFile(join(root, `${stage}.json`), diagnostic)
          expect(result.timedOut, diagnostic).toBe(false)
          expect(result.exitCode, diagnostic).toBe(0)
          expect(result.stderr).toBe('')
          results.push(JSON.parse(result.stdout))
        }
        expect(results[1]).toEqual(results[2])
        const output = `${JSON.stringify(results, null, 2)}\n`
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') await writeFile(golden, output)
        else expect(output).toBe(await readFile(golden, 'utf8'))
      } catch (error: unknown) {
        const failed = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, failed, { recursive: true })
        throw new Error(`Ranking failure evidence: ${failed}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 100_000)
  }
})
