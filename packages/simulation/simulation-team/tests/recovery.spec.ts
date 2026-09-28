import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

import { createContext } from './harness.ts'
import { recoverScenario } from './fixtures/recovery-scenario.ts'

const fixture = resolve('packages/simulation/simulation-team/tests/fixtures/recovery.ts')
const config = resolve('examples/headless-agent/tests/fixtures/simulation/simulation-team/cordis.yml')
function launch(root: string, backend: string, stage?: string) {
  return resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [config], env: { SIMULATION_TEST_ROOT: root, SIMULATION_TEST_BACKEND: backend,
      SIMULATION_TEST_CHECKPOINT_FIRST: String(stage?.startsWith('checkpoint-') ?? false),
      SIMULATION_TEST_RESTORE_FIRST: String(stage?.startsWith('restore-') ?? false), SIMULATION_TEST_TOOL_MODE: stage === 'model-role' ? 'both' : 'native' } })
}
async function recover(root: string, backend: string, stage?: string) {
  const spec = launch(root, backend, stage)
  const child = spawn(spec.command, [...spec.args, 'recover'], { env: { ...process.env, ...spec.env }, stdio: 'pipe' })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
  const [code] = await once(child, 'exit') as [number | null]
  return { code, output, error }
}

describe.each(['json', 'sqlite'] as const)('%s coordinated local writer recovery', (backend) => {
  it.each(['restore-bound', 'restore-revoked', 'restore-unpublished', 'restore-team-reserved', 'checkpoint-bound', 'checkpoint-revoked', 'checkpoint-unpublished', 'checkpoint-team-reserved', 'channel-reserved', 'channel-wal', 'channel-attached', 'channel-consent', 'channel-admitted', 'channel-confirmed', 'participant-reserved', 'participant-invited', 'participant-provisioning', 'participant-active', 'participant-bound', 'root-reserved', 'root-created', 'root-confirmed', 'model-role', 'model-staged', 'model-submitted', 'bound', 'revoked', 'unpublished', 'team-reserved', 'business-accepted', 'business-applied', 'business-written', 'scheduler-queued', 'scheduler-consumed', 'scheduler-claimed', 'outbox-started', 'outbox-published', 'outbox-uncertain', 'context-prepared', 'context-queued', 'context-flushed', 'context-consumed', 'team-delivery-abandoned', 'team-delivery-failed', 'team-invitation-acked', 'team-invitation-closing', 'team-post-scheduled', 'team-post-published', 'team-receive-claimed', 'team-receive-flushed', 'team-receive-recorded', 'team-receive-acked'])('%s: proves termination before Session takeover', async (stage) => {
    const root = await simulationTemp('crash')
    const spec = launch(root, backend, stage)
    const child = fork(fixture, [config, 'create', stage.replace(/^(?:checkpoint-|restore-)/, '')], {
      execArgv: spec.args.slice(0, -2), env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let error = ''
    child.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
    const exited = once(child, 'exit')
    try {
      const ready = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(error) })])
      expect(ready[0]).toBe('durable')
      const duplicate = await recover(root, backend, stage)
      expect(duplicate.code).not.toBe(0)
      expect(duplicate.error).toMatch(/coordinator/)
      child.kill('SIGKILL')
      await exited
      if (resolveExampleMode() === 'lib' || stage === 'model-role') {
        const recovered = await recover(root, backend, stage)
        expect(recovered.code, recovered.error).toBe(0)
        expect(JSON.parse(recovered.output)).toMatchSnapshot()
      } else {
        const { ctx } = await createContext(root, backend)
        try { expect(await recoverScenario(ctx, root, stage.startsWith('checkpoint-'), stage.startsWith('restore-'))).toMatchSnapshot() }
        finally { await ctx.fiber.dispose() }
      }
    } finally {
      child.kill('SIGKILL')
      await exited
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})
