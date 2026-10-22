/** Reproducible, keyless capacity matrix; every reader runs in a fresh process and never acquires a writer. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, stat, readdir, copyFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { promisify } from 'node:util'
import { cpus } from 'node:os'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { simulationChangeSchema, simulationInspectionSelectionSchema } from '@clocky/clocky-simulation'
import { readSqliteLogPages } from '@clocky/clocky-storage-sqlite'
import { readJsonLogSnapshot } from '@clocky/clocky-storage-json'
import { LocalSimulationProvider } from '../src/index.ts'
import { SIMULATION_JOURNAL_VERSION } from '../src/journal.ts'
import { createBusinessHarness } from './business-harness.ts'

const MiB = 1024 * 1024
const directory = resolve('.tmp/simulation-system-development/capacity')
const modeSchema = z.enum(['cold-provider', 'warm-provider', 'concurrent-two'])
const inputSchema = z.strictObject({ root: z.string(), backend: z.enum(['json', 'sqlite']),
  selection: simulationInspectionSelectionSchema, expectedHash: z.string(), maxBytes: z.number().int().positive() })
const readReportSchema = z.strictObject({ baselineRssBytes: z.number().int().nonnegative(),
  samples: z.array(z.strictObject({ mode: z.enum(['cold-provider', 'warm-provider', 'concurrent-two']),
    elapsedMs: z.number().nonnegative(), rssBefore: z.number().int().nonnegative(), rssAfterRead: z.number().int().nonnegative(),
    rssAfterVerification: z.number().int().nonnegative(), maxRSSKiB: z.number().int().nonnegative(),
    readPeakRSSKiB: z.number().int().nonnegative(),
    identical: z.literal(true), readers: z.number().int().positive() })),
  emittedPageBytes: z.number().int().nonnegative(), largestPageBytes: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(), payloadBytes: z.number().int().nonnegative(), limitations: z.string(),
})
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function bytes(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isDirectory()) return info.size
  const sizes = await Promise.all((await readdir(path)).map(name => bytes(join(path, name))))
  return sizes.reduce((sum, size) => sum + size, 0)
}

/** Fixture journal files are hashed as bytes; read-only verification must preserve more than the owner's cached state. */
async function sourceFiles(path: string): Promise<Array<{ name: string; sha256: string }>> {
  const info = await stat(path)
  if (info.isDirectory()) {
    const nested = await Promise.all((await readdir(path)).sort().map(name => sourceFiles(join(path, name))))
    return nested.flat()
  }
  const digest = createHash('sha256')
  await pipeline(createReadStream(path), digest)
  return [{ name: path, sha256: digest.digest('hex') }]
}

if (process.argv[2] === 'read') {
  const inputPath = process.argv[3]
  if (inputPath === undefined) throw new Error('Capacity reader requires its saved input file')
  const input = inputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')))
  const selectedMode = modeSchema.parse(process.argv[4])
  const provider = () => new LocalSimulationProvider({ name: 'local', root: input.root, backend: input.backend,
    replayPageSize: 8, inspectionMaxBytes: input.maxBytes, inspectionMaxEntries: 10000 }, () => {})
  const reader = provider(), samples = [], baselineRssBytes = process.memoryUsage().rss
  try {
    for (const mode of [selectedMode]) {
      if (mode === 'warm-provider') await reader.inspect(input.selection)
      const second = mode === 'concurrent-two' ? provider() : undefined
      const rssBefore = process.memoryUsage().rss, start = performance.now()
      try {
        const observations = await Promise.all([reader.inspect(input.selection),
          ...second === undefined ? [] : [second.inspect(input.selection)]])
        const elapsedMs = performance.now() - start, rssAfterRead = process.memoryUsage().rss
        const readPeakRSSKiB = process.resourceUsage().maxRSS
        for (const observation of observations) {
          assert.ok(observation)
          assert.equal(hash(observation.snapshot), input.expectedHash)
        }
        samples.push({ mode, elapsedMs, rssBefore, rssAfterRead, rssAfterVerification: process.memoryUsage().rss,
          readPeakRSSKiB, maxRSSKiB: process.resourceUsage().maxRSS, identical: true, readers: observations.length })
      } finally { await second?.close() }
    }
    let emittedPageBytes = 0, largestPageBytes = 0, pages = 0, payloadBytes = 0
    if (input.backend === 'sqlite') {
      const path = join(input.root, createHash('sha256').update(input.selection.spec.runId).digest('hex'), 'journal.sqlite')
      for await (const page of readSqliteLogPages(path, { name: 'simulation', version: SIMULATION_JOURNAL_VERSION }, {
        maxEntries: 10000, maxBytes: input.maxBytes, pageEntries: 8, pageBytes: 2 * MiB,
      })) {
        const size = Buffer.byteLength(JSON.stringify(page))
        emittedPageBytes += size; largestPageBytes = Math.max(largestPageBytes, size); pages++
        for (const entry of page.entries) payloadBytes += Buffer.byteLength(JSON.stringify(entry.value))
      }
      assert.ok(largestPageBytes <= 2 * MiB)
    } else {
      const path = join(input.root, createHash('sha256').update(input.selection.spec.runId).digest('hex'), 'journal')
      const prefix = await readJsonLogSnapshot(path, { name: 'simulation', version: SIMULATION_JOURNAL_VERSION },
        { maxEntries: 10000, maxBytes: input.maxBytes })
      assert.ok(prefix)
      emittedPageBytes = Buffer.byteLength(JSON.stringify(prefix)); largestPageBytes = emittedPageBytes; pages = 1
      for (const entry of prefix.entries) payloadBytes += Buffer.byteLength(JSON.stringify(entry.value))
    }
    console.log(JSON.stringify({ samples, baselineRssBytes, emittedPageBytes, largestPageBytes, pages, payloadBytes,
      limitations: 'Each mode uses a fresh process; warm includes one prior read. Cold is not OS cache eviction. Read peak excludes later assertion hashing; verification peak is separate. Bytes describe application output, not physical IO.' }))
  } finally { await reader.close() }
} else {
  const backend = z.enum(['json', 'sqlite']).parse(process.argv[2])
  const sizeMiB = z.coerce.number().int().refine(value => [1, 10, 100, 200].includes(value)).parse(process.argv[3])
  await mkdir(directory, { recursive: true })
  // Budgets are fixed before measurement. Detailed reads necessarily materialize their returned projection.
  const budgets = { controlP95Ms: 250, controlRssGrowthBytes: 8 * MiB, detailMs: 30000,
    runtimeBaselineBytes: 256 * MiB, readerPeakGrowthBytes: 8 * sizeMiB * MiB + 64 * MiB, inspectionMaxBytes: 256 * MiB }
  const h = await createBusinessHarness(backend, { maxEntities: 4096 })
  try {
    const body = 'x'.repeat(MiB / 16)
    const changes = Array.from({ length: sizeMiB * 16 }, (_, index) => simulationChangeSchema.parse({
      kind: 'entity/create', id: `capacity-${index}`, entityKind: 'org', cognition: 'none', readiness: 'ready',
      profile: { body, name: `Capacity ${index}` },
    }))
    await h.run.changeMany(changes, h.run.controlObservation().revision)
    await h.run.setPhase('paused', h.run.controlObservation().revision)
    const rssBefore = process.memoryUsage().rss, times = []
    for (let index = 0; index < 100; index++) {
      const start = performance.now(), control = h.run.controlObservation()
      times.push(performance.now() - start)
      assert.equal(control.phase, 'paused')
      assert.equal(control.activeDecisions, 0)
    }
    const controlRssGrowth = Math.max(0, process.memoryUsage().rss - rssBefore)
    const p95 = times.sort((a, b) => a - b)[94]
    assert.ok(p95 !== undefined)
    const original = h.run.snapshot(), expectedHash = hash(original)
    const input = { root: h.root, backend, selection: { provider: 'local', spec: h.selection.spec },
      expectedHash, maxBytes: budgets.inspectionMaxBytes }
    const inputPath = join(directory, `${backend}-${sizeMiB}-input.json`)
    await writeFile(inputPath, JSON.stringify(input) + '\n')
    const history = join(h.root, createHash('sha256').update(h.selection.spec.runId).digest('hex'),
      backend === 'json' ? 'journal' : 'journal.sqlite')
    const sourcePaths = [history]
    if (backend === 'sqlite' && await stat(history + '-wal').then(() => true, (cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw cause
    })) sourcePaths.push(history + '-wal')
    const originalFiles = (await Promise.all(sourcePaths.map(sourceFiles))).flat()
    const measurements = []
    for (const mode of modeSchema.options) {
      const { stdout } = await promisify(execFile)(process.execPath,
        ['--import', 'tsx/esm', import.meta.filename, 'read', inputPath, mode], {
          cwd: process.cwd(), env: process.env, timeout: 120000, maxBuffer: 2 * MiB,
        })
      measurements.push(readReportSchema.parse(JSON.parse(stdout)))
    }
    const first = measurements[0]
    assert.ok(first)
    const reads = { ...first, baselineRssBytes: Math.max(...measurements.map(value => value.baselineRssBytes)),
      samples: measurements.flatMap(value => value.samples.map(sample => ({ ...sample, baselineRssBytes: value.baselineRssBytes }))) }
    let physicalBytes = await bytes(history)
    if (backend === 'sqlite') {
      const walBytes = await bytes(history + '-wal').catch((cause: unknown) => {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw cause
      })
      physicalBytes += walBytes
    }
    assert.equal(hash(h.run.snapshot()), expectedHash)
    assert.deepEqual((await Promise.all(sourcePaths.map(sourceFiles))).flat(), originalFiles)
    const passed = p95 <= budgets.controlP95Ms && controlRssGrowth <= budgets.controlRssGrowthBytes
      && reads.baselineRssBytes <= budgets.runtimeBaselineBytes
      && reads.samples.every(sample => sample.elapsedMs <= budgets.detailMs
        && sample.readPeakRSSKiB * 1024 - sample.baselineRssBytes <= budgets.readerPeakGrowthBytes)
    const report = { version: 2, backend, sizeMiB, physicalBytes, budgets,
      host: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
      control: { calls: 100, p95Ms: p95, rssGrowthBytes: controlRssGrowth }, reads,
      passed, unchangedSource: true, sourceFiles: originalFiles, modelCalls: 0, expectedHash }
    const reportPath = join(directory, `${backend}-${sizeMiB}-report.json`)
    await copyFile(reportPath, reportPath.replace('-report.json', '-previous-report.json')).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ backend, sizeMiB, passed, physicalBytes, controlP95Ms: p95 }))
    assert.ok(passed, 'Capacity budget exceeded; inspect the complete retained report before changing code or support limits')
  } finally { await h.close() }
}
