/** A real prepared but undispatched scope canary remains outside Session and model after membership withdrawal. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World scope disclosure', (backend) => {
  it('refuses revoked prepared scope data before first Session input and provider IO, including cold recovery', async () => {
    const temp = resolve('.local/world-completion/tmp')
    await mkdir(temp, { recursive: true })
    const evidence = resolve(process.env.WORLD_SCOPE_EVIDENCE_ROOT ?? '.local/world-completion/thread-01a1336a-scope-disclosure/loader')
    await mkdir(evidence, { recursive: true })
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-`))
    const fixture = resolve('examples/simulation-company/tests/world-facts-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/tests/fixtures/world-protocol/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_RESOLUTION: 'apply', WORLD_SCOPE_ACCESS: 'true', TMPDIR: temp } })
    {
      for (const recovering of [false, true]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_FACTS_RECOVER: String(recovering) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ facts: 6, versions: 7, frozenViews: 2, scopeRevocation: true,
            privateAudience: true, sourceFrozen: true,
            beliefSeparate: true, unauthorizedToolRejected: true, intervalBoundaries: true, modelCalls: recovering ? 0 : 14 })
        } finally {
          child.kill('SIGKILL'); const [code, signal] = await exited as unknown[]
          await writeFile(resolve(root, recovering ? 'cold-process.json' : 'warm-process.json'), JSON.stringify({
            face, backend, recovering, pid: child.pid, code, signal, command: launch.command, args: launch.args,
            stdout: output, stderr: errors }, null, 2) + '\n')
        }
      }
      await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, root }) + '\n')
    }
  })
})
