/** Public v1 original-command preparation is inert and explicit restore across independent Loader processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s public v1 World product', (backend) => {
  it.concurrent('retains the original complete command and identities across two cold processes', async () => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const evidence = resolve(process.env.WORLD_V1_PRODUCT_EVIDENCE_ROOT ?? '.local/world-completion/c30-v1-product')
    await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-`))
    const fixture = resolve('examples/simulation-company/tests/world-v1-product-scenario.ts')
    const config = resolve('examples/simulation-company/tests/fixtures/world-v1-product/cordis.yml')
    const inputs = await Promise.all([fixture, config,
      resolve('examples/simulation-company/tests/world-v1-product.snapshot.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts'),
      resolve('examples/simulation-company/tests/world-external-mediated-model.ts')].map(async (path) => {
      const bytes = await readFile(path)
      const filename = path.split('/').at(-1)!
      await writeFile(resolve(root, `input-${filename}`), bytes)
      return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await writeFile(resolve(root, 'fixture-inputs.json'), JSON.stringify(inputs, null, 2))
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: evidence } })
    for (const round of [0, 1, 2, 3]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, WORLD_V1_PRODUCT_ROUND: String(round) },
        stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false, failure: string | undefined
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
      try {
        const [code, signal] = await exited
        expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ round, backend, face, phase: 'paused', modelCalls: 0,
          publicOriginalCommand: true, originalInitializedData: true, sameCanonicalIdentities: true, unmaterializedSessions: true,
          privateSourceRetained: true, exportedPreflightUnchanged: true, noAllocationDuringPreflight: true,
          explicitWritableRestore: round === 3 })
      } catch (error) { failure = String(error); throw error }
      finally {
        clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ round, backend, face, command: launch.command,
          args: launch.args, pid: child.pid, exitCode: code, signal, timedOut, failure, stdout, stderr }, null, 2) + '\n')
      }
    }
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ backend, face, rounds: 4, root }) + '\n')
  })
})
