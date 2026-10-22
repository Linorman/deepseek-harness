/** All portable definitions use the same Loader/driver and preserve the complete original run in two cold processes. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'].flatMap(backend => ['company', 'laboratory', 'association'].map(scene => ({ backend, scene }))))(
  '$backend $scene complete portable world', ({ backend, scene }) => {
    it.concurrent('executes the authored domain combination and restores paused without models', async () => {
      const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const evidence = resolve(process.env.WORLD_COMPLETE_EVIDENCE_ROOT ?? '.local/world-completion/c42-nonempty-handoff/loader')
      await mkdir(evidence, { recursive: true })
      const seeds = process.env.WORLD_COMPLETE_REPLAY_SEEDS
      let root: string
      if (seeds === undefined) root = await mkdtemp(resolve(evidence, `${face}-${backend}-${scene}-`))
      else {
        const names = (await readdir(resolve(seeds))).filter(name => name.startsWith(`${face}-${backend}-${scene}-`))
        expect(names).toHaveLength(1); root = resolve(seeds, names[0]!)
      }
      const source = resolve('examples/simulation-company/tests/complete-world-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/complete-world/cordis.yml')],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          TMPDIR: resolve('.local/world-completion/tmp') } })
      const rawStart = process.env.WORLD_COMPLETE_REPLAY_ROUND_START ?? '3', replayStart = Number(rawStart)
      if (seeds !== undefined) expect(/^[1-9][0-9]*$/.test(rawStart) && Number.isSafeInteger(replayStart)
        && replayStart >= 3 && replayStart < Number.MAX_SAFE_INTEGER).toBe(true)
      for (const round of seeds === undefined ? [0, 1, 2] : [replayStart, replayStart + 1]) {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_COMPLETE_ROUND: String(round), WORLD_COMPLETE_RECOVER: String(round !== 0) }, stdio: ['ignore', 'pipe', 'pipe'] })
        const exited = once(child, 'exit').then((values: unknown[]) => values)
        let stdout = '', stderr = '', timedOut = false
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 120000)
        try {
          const [code, signal] = await exited
          expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
          const result = JSON.parse(stdout) as { modelCalls: number }
          expect(result).toMatchObject({ phase: 'paused', actualAuthoredWorkflow: true })
          if (round === 0) expect(result.modelCalls).toBeGreaterThan(0)
          else expect(result.modelCalls).toBe(0)
        } finally {
          clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
          await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ face, backend, scene, round, pid: child.pid,
            command: launch.command, args: launch.args, exitCode: code, signal, timedOut, stdout, stderr }, null, 2) + '\n')
        }
      }
      if (seeds === undefined) await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, scene, root, rounds: 3 }) + '\n')
    })
  })
