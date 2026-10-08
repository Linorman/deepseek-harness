/** Bounded child-process runner retaining raw measurements and exact source identities. @module */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { cpus, totalmem, platform, release } from 'node:os'
import { resolve, join } from 'node:path'
import { resolveExampleLaunch, resolveExampleMode } from '../packages/test-support/loader-smoke/src/index.ts'
import { parseSimulationBenchmarkOptions } from './simulation-benchmark-options.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(2))
await mkdir(options.output, { recursive: true })
const directory = await mkdtemp(join(options.output, `${options.backend}-${options.workload}-`))
// Restrict the Git inventory before capture: unrelated notes and runtime files can exceed spawn's buffer.
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard', '--',
  'packages', 'vendor', 'examples/simulation-company',
  'scripts/benchmark-simulation.ts', 'scripts/simulation-benchmark-options.ts', 'scripts/simulation-benchmark-metrics.ts',
  'pnpm-lock.yaml', 'package.json', 'tsconfig.base.json', 'tsconfig.host.json',
], { encoding: 'utf8' }).split('\0').filter(path => path.length > 0))]
  .filter(path => existsSync(path))
  .filter(path => !/(^|\/)\.tmp[^/]*\//.test(path))
  .filter(path => /^(packages|vendor)\/.*\.(ts|json)$/.test(path) && !/\/(lib|node_modules)\/|\.d\.ts$/.test(path)
    || /^examples\/simulation-company\/.*\.(ts|yml)$/.test(path)
    || /^scripts\/(benchmark-simulation|simulation-benchmark-(options|metrics))\.ts$/.test(path)
    || ['pnpm-lock.yaml', 'package.json', 'tsconfig.base.json', 'tsconfig.host.json'].includes(path)).sort()
const sources: Record<string, string> = {}
for (const path of files) sources[path] = createHash('sha256').update(await readFile(path)).digest('hex')
await writeFile(join(directory, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`)
const messages = options.workload === 'messages' || options.workload === 'parallel-messages'
const cognitive = options.workload === 'actors' || options.workload === 'actors-world' || messages
const organization = options.workload === 'organization'
const live = options.workload === 'live-model'
const layer = live ? 'real-model-sample' : options.workload === 'actors-world' ? 'scripted-cognition-with-world-history' : organization ? 'deterministic-organization' : messages ? 'team-delivery' : cognitive ? 'scripted-cognition' : 'zero-model-storage'
const fixture = resolve(live ? 'examples/simulation-company/tests/live-model-benchmark-scenario.ts' : organization ? 'examples/simulation-company/tests/organization-benchmark-scenario.ts' : messages ? 'examples/simulation-company/tests/message-benchmark-scenario.ts'
  : options.workload === 'actors' || options.workload === 'actors-world' ? 'examples/simulation-company/tests/actor-benchmark-scenario.ts'
    : 'examples/simulation-company/tests/benchmark-scenario.ts')
const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
  configArgs: [resolve('examples/simulation-company/cordis.yml'), ...process.argv.slice(2)],
  env: { SIMULATION_COMPANY_ROOT: join(directory, 'data'), SIMULATION_COMPANY_BACKEND: options.backend,
    SIMULATION_REPLAY_PAGE_SIZE: String(options.replayPageSize),
    ...organization ? { SIMULATION_BENCHMARK_TEAM_LIMITS: JSON.stringify({
      maxParticipantsPerTeam: options.entities - options.departments, maxActivationsPerTeam: options.operations * 3,
    }) } : {},
    ...cognitive ? { SIMULATION_MODEL_LIMIT: String(options.models),
      SIMULATION_MODEL_QUEUE_LIMIT: String(options.residents),
      SIMULATION_BENCHMARK_TEAM_LIMITS: JSON.stringify({
        maxParticipantsPerTeam: options.entities, maxActivationsPerTeam: messages ? options.operations * 2 : options.operations,
        ...messages ? { maxChannelsPerTeam: options.entities } : {} }) } : {} } })
const raw = createWriteStream(join(directory, 'measurements.jsonl'))
const errors = createWriteStream(join(directory, 'stderr.log'))
const outputsFinished = Promise.all([once(raw, 'finish'), once(errors, 'finish')])
const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
void outputsFinished.catch(() => { child.kill('SIGKILL') })
const started = performance.now()
const outcome = { timedOut: false, interrupted: false }
let buffer = '', result: unknown, lastProgress: unknown
child.stdout.pipe(raw)
child.stderr.pipe(errors)
child.stdout.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  for (let newline = buffer.indexOf('\n'); newline !== -1; newline = buffer.indexOf('\n')) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    try {
      const value: unknown = JSON.parse(line)
      if (typeof value === 'object' && value !== null && 'kind' in value) {
        if (value.kind === 'result') result = value
        if (value.kind === 'progress') lastProgress = value
      }
    } catch (error: unknown) {
      // Non-JSON Loader diagnostics remain in the raw output; only structured records become measurements.
      if (!(error instanceof SyntaxError)) throw error
    }
  }
})
const interrupt = () => { outcome.interrupted = true; child.kill('SIGKILL') }
process.once('SIGTERM', interrupt)
process.once('SIGINT', interrupt)
const timer = setTimeout(() => { outcome.timedOut = true; child.kill('SIGKILL') }, options.timeoutMs)
let exitCode: unknown, signal: unknown
try { [exitCode, signal] = await once(child, 'close') as unknown[] }
finally { clearTimeout(timer); process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt) }
await outputsFinished
let lastPhase: 'workload' | 'cold-recovery' = 'workload'
let coldRecovery: unknown
let coldExitCode: unknown, coldSignal: unknown
let coldProcessMs: number | undefined
if (!outcome.timedOut && !outcome.interrupted && exitCode === 0 && result !== undefined) {
  lastPhase = 'cold-recovery'
  const remaining = options.timeoutMs - (performance.now() - started)
  if (remaining <= 0) outcome.timedOut = true
  else {
    const recoveryFixture = resolve('examples/simulation-company/tests/benchmark-recovery-scenario.ts')
    const recoveryLaunch = resolveExampleLaunch({ srcBin: recoveryFixture, libBin: recoveryFixture,
      tsconfigPath: resolve('tsconfig.base.json'), configArgs: [resolve('examples/simulation-company/cordis.yml')], env: launch.env })
    const coldStarted = performance.now()
    const recovering = spawn(recoveryLaunch.command, recoveryLaunch.args, {
      env: { ...process.env, ...recoveryLaunch.env }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', error = ''
    recovering.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    recovering.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
    const stop = () => { outcome.interrupted = true; recovering.kill('SIGKILL') }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
    const deadline = setTimeout(() => { outcome.timedOut = true; recovering.kill('SIGKILL') }, remaining)
    try { [coldExitCode, coldSignal] = await once(recovering, 'close') as unknown[] }
    finally { clearTimeout(deadline); process.off('SIGTERM', stop); process.off('SIGINT', stop) }
    coldProcessMs = performance.now() - coldStarted
    await writeFile(join(directory, 'cold-recovery.jsonl'), output)
    await writeFile(join(directory, 'cold-stderr.log'), error)
    for (const line of output.split('\n')) {
      if (!line.startsWith('{')) continue
      let value: unknown
      try { value = JSON.parse(line) }
      catch (error: unknown) {
        // Non-JSON startup diagnostics remain in the raw recovery output.
        if (error instanceof SyntaxError) continue
        throw error
      }
      if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'cold-recovery'
        && 'replayEqual' in value && value.replayEqual === true) coldRecovery = value
    }
  }
}
const report = { version: 2, layer, lastPhase, options, mode: resolveExampleMode(),
  hardware: { platform: platform(), release: release(), arch: process.arch, node: process.version,
    cpus: cpus().length, cpuModel: cpus()[0]?.model, memoryBytes: totalmem() },
  sourceDigest: createHash('sha256').update(JSON.stringify(sources)).digest('hex'), sourceFiles: files.length,
  elapsedMs: performance.now() - started, ...outcome, exitCode, signal, coldExitCode, coldSignal, coldProcessMs, coldRecovery,
  status: outcome.timedOut ? 'timeout' : outcome.interrupted ? 'interrupted' : exitCode === 0 && result !== undefined && coldExitCode === 0 && coldRecovery !== undefined ? 'measured' : 'failed', lastProgress, result }
const path = join(directory, 'report.json')
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ report: path, status: report.status }))
if (report.status !== 'measured') process.exitCode = 1
