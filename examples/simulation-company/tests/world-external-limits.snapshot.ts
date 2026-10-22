/** Frozen external quotas traverse actual Loader cognition, canonical topology and two independent paused restores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const modes = ['births', 'expansions', 'entities', 'participants', 'channels', 'reuse-channels', 'bytes-reserve', 'bytes-commit',
  'director-tokens', 'representative-tokens', 'director-pool', 'representative-pool', 'director-history',
  'representative-history', 'resident-owner']
describe.each(['company', 'laboratory'])('%s external quotas', (scene) => {
  it.concurrent.each(modes.flatMap(limit => ['json', 'sqlite'].map(backend => ({ limit, backend }))))(
    '$limit in $backend retains actual charges and restores twice without inference', async ({ limit, backend }) => {
      const evidence = resolve(process.env.WORLD_STRUCTURE_EVIDENCE_ROOT ?? '.local/world-completion/c18-external-limits')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const prefix = `${face}-${scene}-${backend}-${limit}`
      const fixture = resolve('examples/simulation-company/tests/world-external-limits-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-limits/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_EXTERNAL_LIMIT: limit, TMPDIR: resolve('.local/world-completion/tmp') } })
      for (const [round, recovering] of [false, true, true].entries()) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_DRIVER_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let timedOut = false
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code, signal] = await exited as unknown[]
          await writeFile(resolve(evidence, `${prefix}-process-${round}.json`), JSON.stringify({ scene, backend, face, limit,
            round, root, command: launch.command, args: launch.args, pid: child.pid, exitCode: code, signal, timedOut,
            stdout: output, stderr: errors }, null, 2))
          expect(code, errors).toBe(0)
          expect(timedOut).toBe(false)
          const result = JSON.parse(output) as { modelCalls: number; stop: string }
          expect(result).toMatchObject({ scene, mode: limit, stableStop: true, restored: recovering, phase: 'paused',
            finiteTemplateDirectorSelection: true, originalResponsibility: true })
          if (recovering) expect(result.modelCalls).toBe(0)
          else {
            expect(result.modelCalls).toBeGreaterThan(0)
            for (const name of ['original', 'input', 'sessions', 'model-inputs', 'journal']) {
              await copyFile(resolve(root, `limits-${name}.json`), resolve(evidence, `${prefix}-${name}.json`))
            }
          }
        } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
      }
      // Complete roots preserve actual backend WALs, immutable Sessions and accepted topology for independent inspection.
    })
})
