/** Real authored prerequisite chains pause or cancel while actual owner IO or automatic resume is held. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

const processProof = z.strictObject({ kind: z.enum(['hire', 'representative', 'transfer', 'depart']),
  boundary: z.enum(['retirement', 'sealed', 'resume']), intent: z.enum(['pause', 'cancel', 'none']),
  recovering: z.boolean(), phase: z.literal('paused'), modelCalls: z.number().int().nonnegative() })

const defaults = ['hire:retirement:pause', 'hire:retirement:cancel', 'hire:sealed:pause', 'hire:sealed:cancel',
  'hire:resume:pause', 'hire:resume:cancel', 'representative:sealed:pause', 'representative:sealed:cancel',
  'representative:resume:pause', 'representative:resume:cancel', 'transfer:sealed:pause', 'transfer:sealed:cancel',
  'transfer:resume:pause', 'transfer:resume:cancel', 'depart:resume:pause', 'depart:resume:cancel',
  'hire:sealed:none', 'representative:sealed:none', 'transfer:sealed:none', 'depart:resume:none']
const cases = (process.env.WORLD_MAINTENANCE_ONLY?.split(',') ?? defaults).map((value) => {
  const [kind, boundary, intent] = value.split(':'); return { kind: kind!, boundary: boundary!, intent: intent! }
})
describe.each(['json', 'sqlite'].flatMap(backend => ['company', 'laboratory'].map(scene => ({ backend, scene }))))(
  '$backend $scene maintenance user intent', ({ backend, scene }) => {
    it.concurrent.each(cases)('$kind $boundary $intent stays authoritative through cold restore', async ({ kind, boundary, intent }) => {
      const face = resolveExampleMode(), base = resolve(process.env.WORLD_MAINTENANCE_EVIDENCE_ROOT ?? '.local/world-completion/r04-maintenance-intent/matrix')
      await mkdir(base, { recursive: true }); const root = await mkdtemp(resolve(base, `${face}-${backend}-${scene}-${kind}-${boundary}-${intent}-`))
      const fixture = resolve('examples/simulation-company/tests/world-maintenance-intent-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-maintenance-intent/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_MAINTENANCE_KIND: kind, WORLD_MAINTENANCE_BOUNDARY: boundary, WORLD_MAINTENANCE_INTENT: intent,
          TMPDIR: resolve('.local/world-completion/tmp') } })
      for (const recover of [false, true]) {
        const child = spawn(launch.command, launch.args, {
          env: { ...process.env, ...launch.env, WORLD_MAINTENANCE_RECOVER: String(recover) },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const exited = once(child, 'exit').then((values: unknown[]) => values); let stdout = '', stderr = '', timedOut = false
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
        try {
          const [code, signal] = await exited
          expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
          const proof = processProof.parse(JSON.parse(stdout))
          expect(proof).toMatchObject({ kind, boundary, intent, recovering: recover, phase: 'paused' })
          if (recover) expect(proof.modelCalls).toBe(0)
        } finally {
          clearTimeout(timer); child.kill('SIGKILL'); const [code, signal] = await exited
          await writeFile(resolve(root, `process-${recover ? 'cold' : 'warm'}.json`), JSON.stringify({ face, backend, scene, kind, boundary, intent,
            root, pid: child.pid, command: launch.command, args: launch.args, code, signal, timedOut, stdout, stderr }, null, 2))
        }
      }
    }, 190000)
  })
