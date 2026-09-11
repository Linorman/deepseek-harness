/** Workflow cancellation through coordinator tools and authenticated Host APIs on JSON and SQLite. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-human-approval.cordis.yml')
const driver = 'headless-workflow-task-cancellation-driver.ts'
const cancellationConfig = join(fixtures, 'headless-workflow-task-cancellation.cordis.yml')
const goldenRoot = join(import.meta.dirname, 'snapshots/task-cancellation')

describe('workflow cancellation through coordinator and Host entry points', () => {
  for (const scenario of ['tool', 'api'] as const) {
    for (const backend of ['json', 'sqlite'] as const) {
      const expected = join(goldenRoot, `workflow-${scenario}.expected.json`)
      it(`cancels a workflow branch through ${scenario} and completes independent work on ${backend}`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const root = await mkdtemp(join(repository, '.tmp/wtc-'))
        const work = join(root, 'work')
        try {
          await mkdir(work)
          await writeFile(join(work, 'approval.txt'), 'before\n')
          await writeFile(join(work, 'independent.txt'), 'before\n')
          const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
          await writeFile(join(target, 'headless-human-approval-driver.ts'), await readFile(join(fixtures, 'headless-human-approval-driver.ts')))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
            configArgs: ['--profile', 'headless', '--patch', configPath, '--patch', cancellationConfig], tsconfigPath: join(repository, 'tsconfig.json'),
            env: {
              CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
              CLOCKY_APPROVAL_BACKEND: backend, CLOCKY_WORKFLOW_CANCEL_VIA: scenario, CLOCKY_PERMISSION_MODE: 'read-only', CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
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
          await writeFile(join(repository, '.tmp', `workflow-cancel-${scenario}-${backend}-host-diagnostics.jsonl`), diagnostics)
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
