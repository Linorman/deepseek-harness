/** Actual model clarification retains the original case through private delivery, hiring and two cold processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'].flatMap(backend => ['generate-and-hire', 'hire-existing'].map(mode => ({ backend, mode }))))(
  '$backend $mode actual evidence hiring', ({ backend, mode }) => {
    it.concurrent('retains the original funded hiring and identities across two cold processes', async () => {
      const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const evidence = resolve(process.env.WORLD_EVIDENCE_ROOT ?? '.local/world-completion/thread-01a1336a-evidence-native/loader')
      await mkdir(evidence, { recursive: true }); const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${mode}-`))
      const fixture = resolve('examples/simulation-company/tests/hiring-resources-scenario.ts')
      const config = resolve('examples/simulation-company/tests/fixtures/hiring-resources/cordis.yml')
      const inputs = await Promise.all([fixture, config,
        resolve('examples/simulation-company/tests/world-evidence.snapshot.ts'),
        resolve('examples/simulation-company/tests/fixtures/hiring-resources/source.ts'),
        resolve('examples/simulation-company/tests/fixtures/hiring-resources/model.ts'),
        resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts')].map(async (path) => {
        const bytes = await readFile(path), name = path.split('/').at(-1)!
        await writeFile(resolve(root, `input-${name}`), bytes)
        return { path, copy: `input-${name}`, sha256: createHash('sha256').update(bytes).digest('hex') }
      }))
      await writeFile(resolve(root, 'fixture-inputs.json'), JSON.stringify(inputs, null, 2))
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_HIRING_MODE: mode, WORLD_HIRING_EVIDENCE: 'true', TMPDIR: resolve('.local/world-completion/tmp') } })
      for (const round of [0, 1, 2]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_CALENDAR_TIME_ROUND: String(round), WORLD_CALENDAR_TIME_RECOVER: String(round !== 0) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit').then((values: unknown[]) => values)
        let stdout = '', stderr = '', timedOut = false, failure: string | undefined
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
        try {
          const [code, signal] = await exited; expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
          const output = JSON.parse(stdout) as { modelCalls: number }
          expect(output).toMatchObject({ phase: 'paused', conserved: true, actualFundedHire: true, evidenceExchange: true })
          if (round === 0) expect(output.modelCalls).toBeGreaterThan(0)
          else expect(output.modelCalls).toBe(0)
        } catch (error) { failure = String(error); throw error }
        finally {
          clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
          await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ round, face, backend, pid: child.pid, command: launch.command,
            args: launch.args, exitCode: code, signal, timedOut, failure, stdout, stderr }, null, 2) + '\n')
        }
      }
      await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, rounds: 3, root }) + '\n')
    })
  })
