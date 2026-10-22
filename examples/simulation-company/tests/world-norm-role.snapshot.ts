/** Three actual Norm audience roles retain the original Loader/Session/model evidence across two cold restores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s v1 Norm role projections', (backend) => {
  it.concurrent('projects original norms into three actual roles and restores twice without models', async () => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const evidence = resolve(process.env.WORLD_NORM_ROLE_EVIDENCE_ROOT ?? '.local/world-completion/thread-01a1336a-norm-user-projection/loader')
    await mkdir(evidence, { recursive: true })
    await mkdir(resolve('.local/world-completion/thread-01a1336a-norm-user-projection/tmp'), { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-`))
    const source = resolve('examples/simulation-company/tests/world-norm-role-scenario.ts')
    const inputs = await Promise.all([source,
      resolve('examples/simulation-company/tests/world-norm-role.snapshot.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-norm-role/source.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-norm-role/cordis.yml'),
      resolve('examples/simulation-company/tests/world-external-actor-model.ts'),
      resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts'),
      resolve('packages/simulation/simulation-scenario/tests/fixtures.ts')].map(async (path, index) => {
      const bytes = await readFile(path), copy = `input-${index}-${path.split('/').at(-1)!}`
      await writeFile(resolve(root, copy), bytes)
      return { path, copy, sha256: createHash('sha256').update(bytes).digest('hex') }
    }))
    await writeFile(resolve(root, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n')
    const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-norm-role/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, TMPDIR: resolve('.local/world-completion/thread-01a1336a-norm-user-projection/tmp') } })
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        WORLD_NORM_ROLE_ROUND: String(round), WORLD_NORM_ROLE_RECOVER: String(round !== 0) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
      try {
        const [code, signal] = await exited
        expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
        const result = JSON.parse(stdout) as { modelCalls: number }
        expect(result).toMatchObject({ phase: 'paused', actualNormRoleMatrix: true })
        if (round === 0) expect(result.modelCalls).toBeGreaterThan(0)
        else expect(result.modelCalls).toBe(0)
      } finally {
        clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ face, backend, round, pid: child.pid,
          command: launch.command, args: launch.args, exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
      }
    }
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, root, rounds: 3 }) + '\n')
  })
})
