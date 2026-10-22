/** Read-only forensic aggregation. Does not replay or resume an old Native format. */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { scanZstdFrames, createZstdFrameDecoder } = await import(pathToFileURL(resolve('packages/session/session-persistence-jsonl/src/zstd.ts')).href)
const { scanLog } = await import(pathToFileURL(resolve('packages/session/session-persistence-jsonl/src/format.ts')).href)

const runId = '25e846c3-9afa-4917-bd74-cd32dd9e709c'
const root = resolve('.local/simulation-harbor-365-20261021/home')
const databasePath = join(root, 'simulations', createHash('sha256').update(runId).digest('hex'), 'journal.sqlite')
const database = new DatabaseSync(databasePath, { readOnly: true })
database.exec('BEGIN')
const rows = database.prepare('select value from log_entries order by sequence').all()
const sourceHash = createHash('sha256')
const reservations = new Map(), settlements = new Map(), bindings = new Map()
for (const row of rows) {
  sourceHash.update(String(row.value)).update('\n')
  const record = JSON.parse(String(row.value))
  if ((record.runId ?? record.spec?.runId) !== runId) throw new Error('Foreign Native row')
  if (record.kind === 'run/participant-reserved') bindings.set(record.entityId, record.binding.sessionId)
  if (record.kind !== 'run/business') continue
  const change = record.change
  if (change.kind === 'token/reserved' || change.kind === 'token/compaction-reserved') {
    if (reservations.has(change.id)) throw new Error('Duplicate reservation')
    reservations.set(change.id, change)
  } else if (change.kind === 'token/settled') {
    if (!reservations.has(change.id)) throw new Error('Settlement without reservation')
    if (settlements.has(change.id)) throw new Error('Repeated settlement: explicit reconciliation needed')
    settlements.set(change.id, change.outcome)
  }
}
database.exec('ROLLBACK'); database.close()
const sessionRequests = new Map(), sessionHashes = {}, sessionFrames = {}
for (const [entityId, sessionId] of bindings) {
  try {
    const compressed = await readFile(join(root, 'sessions/_no-cwd', sessionId, 'session.jsonl.zstd'))
    const frames = scanZstdFrames(compressed)
    if (frames.tornStart !== undefined) throw new Error('Incomplete original Session frame')
    const decoder = createZstdFrameDecoder()
    let decoded
    try { decoded = Buffer.concat(Array.from(decoder.decode(compressed, frames.frames), part => Buffer.from(part))) }
    finally { decoder.close() }
    const parsed = scanLog(decoded)
    if (parsed.events.some((event, index) => event.seq !== index)) throw new Error('Noncontiguous original Session events')
    sessionHashes[sessionId] = createHash('sha256').update(decoded).digest('hex')
    sessionFrames[sessionId] = { frames: frames.frames.length, events: parsed.events.length }
    const requests = new Map()
    for (const event of parsed.events) {
      if (event.type === 'compaction/request') requests.set(event.seq, event.data)
    }
    sessionRequests.set(entityId, requests)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
const zero = () => ({ attempts: 0, complete: 0, unknown: 0, reserved: 0, notDispatched: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, unknownReported: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
const categories = { compaction: zero(), unknown: zero() }, total = zero(), nativeDeclaredCompaction = zero()
const add = (bucket, outcome) => {
  bucket.attempts++
  if (outcome === undefined) bucket.reserved++
  else if (outcome.kind === 'complete') { bucket.complete++; addUsage(bucket.usage, outcome.usage) }
  else if (outcome.kind === 'unknown') { bucket.unknown++; if (outcome.observedUsage !== undefined) addUsage(bucket.unknownReported, outcome.observedUsage) }
  else if (outcome.kind === 'not-dispatched') bucket.notDispatched++
  else throw new Error('Unknown settlement outcome')
}
function addUsage(target, source) {
  for (const key of Object.keys(target)) {
    const amount = source[key] ?? 0
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(target[key] + amount)) throw new Error('Unsafe token bucket')
    target[key] += amount
  }
}
let uncorroboratedCompaction = 0
for (const reservation of reservations.values()) {
  let category = 'unknown'
  if (reservation.kind === 'token/compaction-reserved') {
    const request = sessionRequests.get(reservation.entityId)?.get(reservation.request.sessionSequence)
    if (request?.compactionId === reservation.request.compactionId
      && request.request.provider === reservation.request.provider && request.request.model === reservation.request.model) category = 'compaction'
    else uncorroboratedCompaction++
  }
  const outcome = settlements.get(reservation.id)
  if (reservation.kind === 'token/compaction-reserved') add(nativeDeclaredCompaction, outcome)
  add(categories[category], outcome); add(total, outcome)
}
for (const key of Object.keys(total.usage)) {
  if (Object.values(categories).reduce((sum, bucket) => sum + bucket.usage[key], 0) !== total.usage[key]) throw new Error('Attribution does not reconcile')
}
const report = { runId, source: { databasePath, canonicalRowsSha256: sourceHash.digest('hex'), rows: rows.length, sessionHashes, sessionFrames },
  scope: 'Forensic ledger projection only; no new-format Native replay, writer, provider call or run resume.',
  coverage: { sessionCorroboratedCompaction: categories.compaction.attempts, uncorroboratedCompaction,
    otherRequests: 'unknown: this forensic reader does not reinterpret historical business context or split mixed requests' },
  nativePurposeEvidence: { compaction: nativeDeclaredCompaction,
    limitation: 'Additional Native declaration view only; never added to the mutually exclusive categories.' },
  total, categories, totalSettledTokens: Object.values(total.usage).reduce((sum, value) => sum + value, 0),
  savings: { actualHistoricalSavings: null, reason: 'Historical requests already occurred; no counterfactual bill or costs inferred.' } }
await writeFile(resolve('.tmp/w5-evidence/original-ledger-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ attempts: total.attempts, settledTokens: report.totalSettledTokens, compactionAttempts: categories.compaction.attempts, unknownAttempts: categories.unknown.attempts }))
