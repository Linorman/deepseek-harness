/** Real configured ACP recovery, process termination and durable Session resume without a model key. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { expect, it } from 'vitest'

it('loads ACP recovery from configuration and fences its old process before resuming the same Session', async () => {
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const fixtures = join(import.meta.dirname, 'fixtures')
  await mkdir(join(repository, '.tmp'), { recursive: true })
  const root = await mkdtemp(join(repository, '.tmp/acp-recovery-loader-'))
  try {
    const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
    await mkdir(target, { recursive: true })
    const driver = 'agent-runtime-acp-recovery-driver.ts'
    await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
    await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
    const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
      configArgs: ['--profile', 'headless', '--patch', join(fixtures, 'headless-channel-admission.cordis.yml'),
        '--patch', join(fixtures, 'agent-runtime-acp-recovery.cordis.yml')], tsconfigPath: join(repository, 'tsconfig.json'),
      env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
        CLOCKY_DIRECT_V4_BACKEND: 'json', CLOCKY_TEST_MOCK_ACP_SERVER: join(repository, 'packages/compat/subagent-acp/tests/mock-acp-server.ts'),
        CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') } })
    const result = await execa(launch.command, launch.args, { cwd: root, env: launch.env, input: '',
      timeout: 30_000, killSignal: 'SIGKILL', reject: false })
    const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode,
      signal: result.signal, stdout: result.stdout, stderr: result.stderr })
    expect(result.timedOut, diagnostic).toBe(false)
    expect(result.exitCode, diagnostic).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
      {
        "durableSessionIdentity": true,
        "fenced": "offline",
        "final": "offline",
        "initial": "idle",
        "newGeneration": true,
        "sameSession": true,
      }
    `)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 40_000)
