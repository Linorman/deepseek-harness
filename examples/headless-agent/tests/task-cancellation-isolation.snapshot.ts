/** Real Host approval and participant review tasks cancel independently on JSON and SQLite. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-human-approval.cordis.yml')
const driver = 'headless-task-cancellation-isolation-driver.ts'
const cancellationConfig = join(fixtures, 'headless-task-cancellation-isolation.cordis.yml')
const goldenRoot = join(import.meta.dirname, 'snapshots/task-cancellation')

describe('single-task cancellation through the formal Host gateway', () => {
  for (const scenario of ['queued', 'running', 'rebuild'] as const) {
    for (const backend of ['json', 'sqlite'] as const) {
      const expected = join(goldenRoot, `isolation-${scenario}.expected.json`)
      it(`cancels one real worker ${scenario} and continues its Team on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/tci-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          await writeFile(join(work, 'approval.txt'), 'before\n')
          await writeFile(join(work, 'b.txt'), 'before\n')
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
          await writeFile(join(target, 'headless-human-approval-driver.ts'), await readFile(join(fixtures, 'headless-human-approval-driver.ts')))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
            configArgs: ['--profile', 'headless', '--patch', configPath, '--patch', cancellationConfig], tsconfigPath: join(repository, 'tsconfig.json'),
            env: {
              CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
              CLOCKY_APPROVAL_BACKEND: backend, CLOCKY_TASK_CANCEL_ISOLATION: scenario, CLOCKY_PERMISSION_MODE: 'read-only', CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
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
          const diagnostics = await readFile(join(work, 'task-cancellation-host-diagnostics.jsonl'), 'utf8').catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
            throw error
          })
          await writeFile(join(repository, '.tmp', `task-isolation-${scenario}-${backend}-host-diagnostics.jsonl`), diagnostics)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
          else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
        } catch (error: unknown) {
          const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
          await cp(root, evidence, { recursive: true })
          throw new Error(`Task cancellation failure evidence: ${evidence}`, { cause: error })
        } finally { await rm(root, { recursive: true, force: true }) }
      }, 45_000)
    }
  }
})
