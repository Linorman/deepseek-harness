/** Exact UTF-8 limits apply to actual Loader/model Native acceptance batches and survive two cold restores. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

interface AcceptanceBatch {
  expectedRevision: number
  bytes: number
  values: Array<{
    kind: string
    runId: string
    expectedRevision: number
    change?: { kind: string; id?: string; action?: { kind: string } }
  }>
}
interface Original { acceptedBatches: AcceptanceBatch[]; journal: Array<{ sequence: number; value: unknown }> }
function requestBatch(original: Original): AcceptanceBatch {
  const batches = original.acceptedBatches.filter(batch => batch.values.some(value =>
    value.kind === 'run/business' && value.change?.kind === 'operation/intent' && value.change?.action?.kind === 'world/request'))
  expect(batches).toHaveLength(1)
  const batch = batches[0]!
  expect(batch.bytes).toBe(Buffer.byteLength(JSON.stringify(batch.values), 'utf8'))
  const accepted = batch.values.find(value => value.change?.kind === 'decision/accepted')!
  expect(original.acceptedBatches.some(value => value.expectedRevision <= batch.expectedRevision
    && value.values.some(row => row.change?.kind === 'decision/finished' && row.change?.id === accepted.change?.id))).toBe(true)
  expect(batch.values.some(value => value.change?.kind === 'decision/accepted')).toBe(true)
  expect(batch.values.some(value => value.change?.kind === 'event/queued')).toBe(true)
  expect(batch.values.some(value => value.change?.action?.kind === 'communication/post')).toBe(true)
  batch.values.forEach((value, index) => {
    expect(value.runId).toBe('hiring-world')
    expect(value.expectedRevision).toBe(batch.expectedRevision + index)
    expect(original.journal.find(row => row.sequence === value.expectedRevision + 1)?.value).toEqual(value)
  })
  return batch
}

describe.each(['json', 'sqlite'].flatMap(backend => ['generate-and-hire', 'hire-existing'].map(mode => ({ backend, mode }))))(
  '$backend $mode complete World acceptance bytes', ({ backend, mode }) => {
    it.concurrent('calibrates the real append, admits N bytes, refuses N−1 and cold-restores every original case twice', async () => {
      const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
      const evidence = resolve(process.env.WORLD_ACCEPTANCE_BYTES_EVIDENCE_ROOT
        ?? '.local/world-completion/thread-01a1336a-acceptance-bytes/loader-source')
      const temp = resolve('.local/wab-tmp')
      await mkdir(evidence, { recursive: true }); await mkdir(temp, { recursive: true })
      const suite = await mkdtemp(resolve(evidence, `${face}-${backend}-${mode}-`))
      const fixture = resolve('examples/simulation-company/tests/hiring-resources-scenario.ts')
      const config = resolve('examples/simulation-company/tests/fixtures/hiring-resources/cordis.yml')
      const inputs = await Promise.all([fixture, config,
        resolve('examples/simulation-company/tests/world-acceptance-bytes.snapshot.ts'),
        resolve('examples/simulation-company/tests/fixtures/hiring-resources/source.ts'),
        resolve('examples/simulation-company/tests/fixtures/hiring-resources/model.ts'),
        resolve('examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts')].map(async (path) => {
        const bytes = await readFile(path), copy = `input-${path.split('/').at(-1)!}`
        await writeFile(resolve(suite, copy), bytes)
        return { path, copy, sha256: createHash('sha256').update(bytes).digest('hex') }
      }))
      await writeFile(resolve(suite, 'fixture-inputs.json'), JSON.stringify(inputs, null, 2) + '\n')
      const execute = async (label: string, limit?: number, blocked = false) => {
        const root = resolve(suite, label); await mkdir(root)
        const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
          env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_HIRING_MODE: mode, TMPDIR: temp,
            WORLD_HIRING_EXPECT_BYTE_BLOCK: String(blocked),
            ...limit === undefined ? {} : { WORLD_HIRING_REQUEST_BYTES: String(limit) } } })
        for (const round of [0, 1, 2]) {
          const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
            WORLD_CALENDAR_TIME_ROUND: String(round), WORLD_CALENDAR_TIME_RECOVER: String(round !== 0) }, stdio: ['ignore', 'pipe', 'pipe'] })
          const exited = once(child, 'exit').then((values: unknown[]) => values)
          let stdout = '', stderr = '', timedOut = false, failure: string | undefined
          child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
          child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
          const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 90000)
          try {
            const [code, signal] = await exited
            expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
            const output = JSON.parse(stdout) as { modelCalls: number }
            expect(output).toMatchObject({ phase: 'paused', conserved: true, actualFundedHire: !blocked, requestByteBlocked: blocked })
            if (round === 0) expect(output.modelCalls).toBeGreaterThan(0)
            else expect(output.modelCalls).toBe(0)
          } catch (error) { failure = String(error); throw error }
          finally {
            clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
            await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ round, face, backend, mode, label, limit, blocked,
              pid: child.pid, command: launch.command, args: launch.args, environment: launch.env,
              exitCode: code, signal, timedOut, failure, stdout, stderr }, null, 2) + '\n')
          }
        }
        return JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as Original
      }
      const calibration = requestBatch(await execute('calibration'))
      const exact = requestBatch(await execute('exact', calibration.bytes))
      expect(exact.bytes).toBe(calibration.bytes)
      const refused = await execute('minus-one', calibration.bytes - 1, true)
      expect(refused.acceptedBatches.some(batch => batch.values.some(value => value.change?.action?.kind === 'world/request'))).toBe(false)
      await writeFile(resolve(suite, 'complete.json'), JSON.stringify({ face, backend, mode, root: suite,
        cases: 3, processes: 9, coldProcesses: 6, bytes: calibration.bytes, refusedBytes: calibration.bytes - 1 }) + '\n')
    }, 280000)
  })
