/** Actual original append/receipt barriers and SIGKILL recover personnel identities, obligations and effects without inference. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const stages = ['transfer-reserve-before', 'transfer-reserve-after', 'transfer-commit-before', 'transfer-commit-after',
  'depart-accepted-fence-after', 'depart-commit-after', 'notification-lost', 'transfer-maintenance-after', 'depart-retirement-unknown']
describe.each(['json', 'sqlite'])('%s actual personnel process loss', (backend) => {
  it.each(stages)('restores the original durable prefix at %s', async (stage) => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const root = await mkdtemp(resolve(temp, 'personnel-crash-'))
    const fixture = resolve('examples/simulation-company/tests/world-personnel-crash-scenario.ts')
    const mode = process.env.CLOCKY_EXAMPLE_MODE === 'lib' ? 'lib' : 'source'
    const evidenceRoot = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation',
      `c12-personnel-crash-${mode}-final18b-raw`)
    await mkdir(evidenceRoot, { recursive: true })
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-personnel-crash/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: 'company',
        WORLD_PERSONNEL_CRASH_STAGE: stage, WORLD_PERSONNEL_CRASH_EVIDENCE_ROOT: evidenceRoot, TMPDIR: temp } })
    const start = (recover: boolean, round: number) => {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_DRIVER_RECOVER: String(recover), WORLD_PERSONNEL_RESTORE_ROUND: String(round) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit')
      let output = '', errors = ''
      child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
      return { child, exited, output: () => output, errors: () => errors }
    }
    const first = start(false, 0)
    try {
      const ready = await Promise.race([once(first.child, 'message').then((values: unknown[]) => values[0]),
        first.exited.then(() => { throw new Error(`The actual original append barrier was not reached: ${first.errors()}`) })])
      expect(ready).toBe('durable')
      first.child.kill('SIGKILL')
      const [code, signal] = await first.exited as [number | null, string | null]
      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')
      await writeFile(resolve(evidenceRoot, `${backend}-${stage}-barrier.json`), await readFile(resolve(root, 'personnel-crash-proof.json')))
      let original: unknown
      for (const round of [1, 2]) {
        const restored = start(true, round)
        try {
          const [exit] = await restored.exited as [number | null]
          expect(exit, restored.errors()).toBe(0)
          const observed: unknown = JSON.parse(restored.output())
          expect(observed).toMatchObject({ scenario: 'company', stage, restored: true, modelCalls: 0,
            originalIdentity: true, originalMemory: true, originalDutiesRetained: true, noDuplicateEffect: true,
            exactNotificationReceipt: stage === 'notification-lost' })
          if (original === undefined) original = observed
          else expect(observed).toEqual(original)
        } finally { restored.child.kill('SIGKILL'); await restored.exited }
      }
    } finally {
      first.child.kill('SIGKILL')
      await first.exited
      await rm(root, { recursive: true, force: true })
    }
  })
})
