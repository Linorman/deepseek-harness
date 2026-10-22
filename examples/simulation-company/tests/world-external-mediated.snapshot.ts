/** Strict director proposals use actual Native policy, Fact/resource owners and canonical receipts across independent cold processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'
const cases = ['facts', 'report', 'report-preflight', 'failure', 'delayed', 'fact-conflict', 'stock-conflict', 'money-private', 'bootstrap-private', 'delayed-blocked']
const selected = process.env.WORLD_MEDIATED_ONLY === undefined ? cases : process.env.WORLD_MEDIATED_ONLY.split(',')
describe.each(['company', 'laboratory'])('%s actual mediated adjudication', (scene) => {
  it.concurrent.each(['json', 'sqlite'].flatMap(backend => selected.map(scenarioCase => ({ backend, scenarioCase }))))(
    'retains $backend original $scenarioCase outcome and receipt', async ({ backend, scenarioCase }) => {
      const evidence = resolve(process.env.WORLD_MEDIATED_EVIDENCE_ROOT ?? '.local/world-completion/c23-mediated-loader')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), mode = resolveExampleMode()
      const prefix = `${mode}-${scene}-${backend}-${scenarioCase}`
      const fixture = resolve('examples/simulation-company/tests/world-external-mediated-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-mediated/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_MEDIATED_CASE: scenarioCase, CLOCKY_EXAMPLE_MODE: mode, TMPDIR: resolve('.local/world-completion/tmp') } })
      let original: unknown
      for (const recovering of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_MEDIATED_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let stdout = '', stderr = ''
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timeout = setTimeout(() => { child.kill('SIGKILL') }, 90000)
        try {
          const [code, signal] = await exited as [number | null, string | null]
          await writeFile(resolve(evidence, `${prefix}-${recovering ? 'cold' : 'create'}-process.json`), JSON.stringify({
            command: launch.command, args: launch.args, scene, backend, scenarioCase, root, mode, recovering, pid: child.pid,
            code, signal, stdout, stderr }, null, 2) + '\n')
          expect(code, stderr).toBe(0)
          const result: unknown = JSON.parse(stdout)
          expect(result).toMatchObject({ scene, scenarioCase, phase: 'paused', identities: 1, resourcesUnchanged: true,
            forgedSourceRejected: true, privateCanariesExcluded: true, originalPrefix: true })
          if (!recovering) original = result
          else {
            expect(result).toMatchObject({ modelCalls: 0 })
            expect(original).toBeTypeOf('object')
            expect(result).toEqual({ ...original as object, modelCalls: 0 })
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
    }, 180000,
  )
})
