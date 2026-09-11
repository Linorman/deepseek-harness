/** The same authenticated task-linked request survives protocol advancement, closure and process restart. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { describe, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const driver = 'channel-task-input-driver.ts'

describe('authenticated task-linked consult input', () => {
  it.each(['json', 'sqlite'])('retains one request through close and process restart on %s', async (backend) => {
    await mkdir(join(repository, '.tmp'), { recursive: true })
    const root = await mkdtemp(join(repository, '.tmp/channel-task-input-'))
    try {
      const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
      await mkdir(target, { recursive: true })
      await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
      await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
      const outputs = []
      for (const phase of ['create', 'restart']) {
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', join(fixtures, 'human-inbox-question.cordis.yml'),
            '--patch', join(fixtures, 'channel-task-input.cordis.yml')], tsconfigPath: join(repository, 'tsconfig.json'),
          env: { CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
            CLOCKY_QUESTION_BACKEND: backend, CLOCKY_CHANNEL_INPUT_RESTART: phase === 'restart' ? '1' : '0',
            CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') } })
        const result = await execa(launch.command, launch.args, { cwd: root, env: launch.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false })
        const diagnostic = JSON.stringify({ phase, timedOut: result.timedOut, exitCode: result.exitCode,
          signal: result.signal, stdout: result.stdout, stderr: result.stderr })
        expect(result.timedOut, diagnostic).toBe(false)
        expect(result.exitCode, diagnostic).toBe(0)
        expect(result.stderr).toBe('')
        outputs.push(JSON.parse(result.stdout) as unknown)
      }
      expect(outputs).toMatchInlineSnapshot(`
        [
          {
            "changedTask": "conflict",
            "phase": "create",
            "retainedTask": true,
            "retryAfterAdvance": true,
            "retryAfterClose": true,
          },
          {
            "envelopeCount": 1,
            "originalEnvelope": true,
            "phase": "restart",
            "retainedTask": true,
          },
        ]
      `)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 70_000)
})
