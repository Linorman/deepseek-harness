/** Controlled process-loss boundaries cover actual independent votes, closure and institution atomic publication. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s original institution responsibilities', (backend) => {
  it.each(['vote-before', 'vote-after', 'close-before', 'close-after', 'enact-before', 'enact-after', 'notification-lost'])(
    'retains the exact atomic prefix at SIGKILL %s', async (stage) => {
      const temp = resolve('.local/world-completion/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'norm-crash-'))
      const fixture = resolve('examples/simulation-company/tests/world-norm-crash-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-norm/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend,
          WORLD_SCENARIO: 'company', WORLD_NORM_CRASH: stage, TMPDIR: temp } })
      const start = (recover: boolean) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        return { child, exited, output: () => output, errors: () => errors }
      }
      const first = start(false)
      try {
        const message = once(first.child, 'message')
        const ready = await Promise.race([message.then((values: unknown[]) => values[0]), first.exited.then(() => {
          throw new Error(`Actual append barrier was not reached: ${first.errors()}`)
        })])
        expect(ready).toBe('durable')
        first.child.kill('SIGKILL')
        const [code, signal] = await first.exited as [number | null, string | null]
        expect(code).toBeNull()
        expect(signal).toBe('SIGKILL')
        const evidence = resolve('.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c5-crash-proofs')
        await mkdir(evidence, { recursive: true })
        await writeFile(resolve(evidence, `${backend}-${stage}.json`), await readFile(resolve(root, 'norm-crash-proof.json')))
        let original: unknown
        for (const _restore of [1, 2]) {
          const restored = start(true)
          try {
            const [exit] = await restored.exited as [number | null]
            expect(exit, restored.errors()).toBe(0)
            const observed: unknown = JSON.parse(restored.output())
            expect(observed).toMatchObject({ scenario: 'company', stage, restored: true, modelCalls: 0 })
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
