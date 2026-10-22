/** Freeze inputs before execution; never replace an earlier registration or raw result. */
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { environmentRegistrationSchema, evaluateRegisteredEnvironment, registeredEnvironmentSuiteSchema } from './environment-registered-evaluation.ts'

const root = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)))
const defaultDirectory = resolve(root, '.agents/plans/2026-10-16-world-post-mvp/evidence/implementation')
const directory = await realpath(resolve(root, process.argv[3] ?? defaultDirectory))
const outputRelative = relative(root, directory)
if (outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative))
  throw new Error('Evidence output directory must remain inside the project')
if (process.argv.length > 4) throw new Error('Expected mode and optional project-local output directory')
const suitePath = resolve(defaultDirectory, 'c3-v2-suite.json')
const registrationPath = resolve(directory, 'c3-v2-registration.json')
const resultPath = resolve(directory, 'c3-v2-results.json')
const sourcePaths = [
  '.agents/plans/2026-10-16-world-post-mvp/evidence/implementation/c3-v2-suite.json',
  'scripts/world-environment-registered-evaluate.ts',
  'packages/simulation/simulation/tests/environment-registered-evaluation.ts',
  'packages/simulation/simulation/tests/environment-registered-evaluate-command.ts',
  'packages/simulation/simulation/src/world-environment.ts',
  'packages/simulation/simulation-local/src/world-environment-domain.ts',
  'packages/simulation/simulation-world/src/evolution.ts',
]
const hash = (body: string) => createHash('sha256').update(body).digest('hex')
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, hash(await readFile(resolve(root, path), 'utf8'))] as const)))
const sources = await sourceHashes()
const suite = registeredEnvironmentSuiteSchema.parse(JSON.parse(await readFile(suitePath, 'utf8')))
const mode = process.argv[2]
if (mode === 'register') {
  await writeFile(registrationPath, JSON.stringify({ registeredAt: new Date().toISOString(), suiteVersion: suite.version,
    sources, executionMode: 'source/pure deterministic evaluator; backend integration verified separately',
    command: { executable: process.execPath, args: ['--import', resolve(root, 'node_modules/tsx/dist/esm/index.mjs'),
      resolve(root, 'scripts/world-environment-registered-evaluate.ts'), 'run', directory], cwd: root },
    priorExposure: suite.exposure }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ registered: registrationPath, sources }))
} else if (mode === 'run' || mode === 'verify') {
  const registrationRaw = await readFile(registrationPath, 'utf8')
  const registration = environmentRegistrationSchema.parse(JSON.parse(registrationRaw))
  if (JSON.stringify(registration.sources) !== JSON.stringify(sources)) throw new Error('Registered source or suite drift; create a separately versioned experiment')
  const startedAt = new Date().toISOString()
  if (Date.parse(registration.registeredAt) > Date.parse(startedAt)) throw new Error('Registration must precede execution')
  const start = performance.now()
  const report = evaluateRegisteredEnvironment(suite)
  const current = await sourceHashes()
  if (JSON.stringify(current) !== JSON.stringify(sources)) throw new Error('Source changed during evaluation; no result published')
  if (mode === 'verify') {
    // The remaining fields must equal the complete recomputed report, including its key set.
    const { registrationSha256, startedAt: retainedStart, completedAt,
      elapsedMs: _elapsedMs, runtime: _runtime, ...retained } = z.looseObject({
      registrationSha256: z.string().regex(/^[a-f0-9]{64}$/),
      startedAt: z.iso.datetime(), completedAt: z.iso.datetime(), elapsedMs: z.number().nonnegative(),
      runtime: z.strictObject({ node: z.string().min(1), platform: z.string().min(1), architecture: z.string().min(1) }),
    }).parse(JSON.parse(await readFile(resultPath, 'utf8')))
    if (Date.parse(retainedStart) < Date.parse(registration.registeredAt) || Date.parse(completedAt) < Date.parse(retainedStart))
      throw new Error('Retained execution must follow registration and finish after it starts')
    if (registrationSha256 !== hash(registrationRaw) || !isDeepStrictEqual(retained, report))
      throw new Error('Retained results differ from the registered deterministic computation')
  } else {
    await writeFile(resultPath, JSON.stringify({ registrationSha256: hash(registrationRaw), startedAt,
      completedAt: new Date().toISOString(), elapsedMs: performance.now() - start,
      runtime: { node: process.version, platform: process.platform, architecture: process.arch }, ...report }, null, 2) + '\n', { flag: 'wx' })
  }
  console.log(JSON.stringify({ trials: report.trials.length, samples: report.trials.reduce((sum, trial) => sum + trial.samples.length, 0),
    failures: report.failures, privacy: report.privacy, assessment: report.assessment, resultPath }))
  if (report.failures.length || report.privacy.some(probe => !probe.rejected)) process.exitCode = 1
} else throw new Error('Expected register, run or verify; existing evidence is never overwritten')
