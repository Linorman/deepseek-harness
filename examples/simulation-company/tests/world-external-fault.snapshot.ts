/** Twelve actual append/receipt windows preserve external rule originals across SIGKILL and two independent zero-model restores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

const stages = ['request-append', 'evaluation-append', 'request-post-receipt', 'result-post-receipt',
  'request-recipient-receipt', 'result-recipient-receipt'].flatMap(value => ['before', 'after'].map(side => `${value}-${side}`))
const only = process.env.WORLD_EXTERNAL_FAULT_ONLY
const selected = only === undefined ? stages : [only]
describe.each(['company', 'laboratory'])('%s actual external rule faults', (scene) => {
  it.concurrent.each(['json', 'sqlite'].flatMap(backend => selected.map(stage => ({ backend, stage }))))(
    'recovers $backend original external records at $stage', async ({ backend, stage }) => {
      const evidence = resolve(process.env.WORLD_EXTERNAL_FAULT_EVIDENCE_ROOT ?? '.local/world-completion/c21-external-faults')
      await mkdir(evidence, { recursive: true })
      const root = await mkdtemp(resolve(evidence, 'loader-')), mode = resolveExampleMode()
      const prefix = `${mode}-${scene}-${backend}-${stage}`
      const fixture = resolve('examples/simulation-company/tests/world-external-fault-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/world-external-fault/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_EXTERNAL_FAULT_STAGE: stage, WORLD_EXTERNAL_FAULT_EVIDENCE: evidence, TMPDIR: evidence } })
      const start = (round: number) => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_EXTERNAL_FAULT_RECOVER: String(round !== 0), WORLD_EXTERNAL_FAULT_ROUND: String(round) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let stdout = '', stderr = ''
        child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        const timeout = setTimeout(() => { child.kill('SIGKILL') }, 60000)
        return { child, exited, stdout: () => stdout, stderr: () => stderr, timeout }
      }
      const first = start(0)
      try {
        const ready = await Promise.race([once(first.child, 'message').then((values: unknown[]) => values[0]),
          first.exited.then(() => { throw new Error(`Actual barrier missing: ${first.stderr()}`) })])
        expect(ready).toBe('durable')
        first.child.kill('SIGKILL')
        const [code, signal] = await first.exited as [number | null, string | null]
        expect(code).toBeNull(); expect(signal).toBe('SIGKILL')
        await copyFile(resolve(root, 'fault-barrier.json'), resolve(evidence, `${prefix}-barrier.json`))
        await copyFile(resolve(root, 'fault-input.json'), resolve(evidence, `${prefix}-input.json`))
        await writeFile(resolve(evidence, `${prefix}-process-0.json`), JSON.stringify({ command: launch.command, args: launch.args,
          root, stage, scene, backend, mode, round: 0, pid: first.child.pid, code, signal,
          stdout: first.stdout(), stderr: first.stderr() }, null, 2) + '\n')
        let observed: unknown
        for (const round of [1, 2]) {
          const next = start(round)
          try {
            const [code, signal] = await next.exited as [number | null, string | null]
            await writeFile(resolve(evidence, `${prefix}-process-${round}.json`), JSON.stringify({ command: launch.command,
              args: launch.args, root, stage, scene, backend, mode, round, pid: next.child.pid, code, signal,
              stdout: next.stdout(), stderr: next.stderr() }, null, 2) + '\n')
            expect(code, next.stderr()).toBe(0)
            const result: unknown = JSON.parse(next.stdout())
            expect(result).toMatchObject({ stage, scene, phase: 'paused', modelCalls: 0, originalPrefix: true, resourcesUnchanged: true })
            if (observed === undefined) observed = result
            else if (stage === 'evaluation-append-before') {
              if (observed === null || typeof observed !== 'object') throw new Error('Initial cold result is not a structured observation')
              expect(result).toEqual({ ...observed, recordedEvaluation: true })
            } else expect(result).toEqual(observed)
          } finally { clearTimeout(next.timeout); next.child.kill('SIGKILL'); await next.exited }
        }
        const input = JSON.parse(await readFile(resolve(evidence, `${prefix}-input.json`), 'utf8')) as unknown
        expect(input).toBeDefined()
      } finally { clearTimeout(first.timeout); first.child.kill('SIGKILL'); await first.exited }
    }, 180000,
  )
})
