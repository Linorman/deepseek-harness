/** Concurrent readiness notification must not withdraw the dependency it just activated. */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it('settles concurrent Loader waiters and one explicit restart without repeated consumer initialization', async () => {
  const repository = fileURLToPath(new URL('../../../../', import.meta.url))
  const launch = resolveExampleLaunch({ mode: 'src', srcBin: join(import.meta.dirname, 'fixtures/loader-await.ts'),
    tsconfigPath: join(repository, 'tsconfig.json') })
  const result = await execa(launch.command, launch.args, { cwd: repository, env: launch.env,
    timeout: 10_000, killSignal: 'SIGKILL', reject: false })
  const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode,
    signal: result.signal, stdout: result.stdout, stderr: result.stderr })
  expect(result.timedOut, diagnostic).toBe(false)
  expect(result.exitCode, diagnostic).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual({ initialStarts: 1, restartStarts: 2, active: 0 })
}, 15_000)
