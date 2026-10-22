/** Provider-owned Harbor bytes; Native/Team/Session cuts remain separate, content-bound owners. */
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { open, readdir, lstat, mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldJsonValue } from '@clocky/clocky-simulation'
import { HARBOR_CONTRACTS } from './harbor-protocol.ts'
import { HarborCase, harborHash } from './harbor-case.ts'

const byteHash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const sourceHash = 'fe07e4c2b255468d111711fff3011d94300b9ba90d65f18b3c84183f38f8b4d7'
const sourceManifest = z.strictObject({ version: z.literal(1), files: z.record(z.string().regex(/^[a-zA-Z0-9_.-]+$/), hash) })
/** Explicit aggregate, individual-file and file-count budgets; callers own deployment defaults. */
export const harborBackupLimitsSchema = z.strictObject({ maxBytes: count.positive(),
  maxFiles: count.positive(), maxFileBytes: count.positive() })
/** Aggregate capture and restore allowances validated at the provider boundary. */
export type HarborBackupLimits = z.infer<typeof harborBackupLimitsSchema>
/** Same paused Native prefix and exact Team/Channel/Session reference vector as the enclosing owner archive. */
export const harborBackupCutSchema = z.strictObject({ runId: z.string().min(1), nativeRevision: count,
  nativeHash: hash, ownerReferencesHash: hash, pins: z.array(simulationWorldDomainPinSchema).min(1) })
/** Exact paused enclosing owner vector; this evidence grants no execution authority. */
export type HarborBackupCut = z.infer<typeof harborBackupCutSchema>
const fileSchema = z.strictObject({ path: z.string().min(1).max(256), bytes: count, sha256: hash, data: z.string() })
/** Private full case copy; source, original journal/state and bridge receipts are retained byte-for-byte. */
export const harborBackupSchema = z.strictObject({ format: z.literal('clocky.harbor.private-backup/1'), cut: harborBackupCutSchema,
  day: count.max(365), revision: count, files: z.array(fileSchema), contentHash: hash })
/** Complete byte-preserving original judge package with its enclosing Native ownership proof. */
export type HarborBackup = z.infer<typeof harborBackupSchema>

function permitted(path: string, source: Readonly<Record<string, string>>): boolean {
  return path === 'manifest.json' || Object.hasOwn(source, path)
    || /^\.bridge\/[a-f0-9]{64}\.(input\.json|result\.json|decision\.json|memory\.txt)$/.test(path)
    || /^output\/(state\.json|journal\.jsonl|audit\.json|final-report\.md)$/.test(path)
    || /^output\/views\/view-[a-f0-9]{64}\.json$/.test(path)
    || /^output\/(checkpoints|recovery-checks)\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.json$/.test(path)
}
function canonical(value: SimulationWorldJsonValue): SimulationWorldJsonValue {
  return Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key] as SimulationWorldJsonValue)])) : value
}
function caseIdentity(files: Map<string, Buffer>): { day: number; revision: number } {
  const journal = files.get('output/journal.jsonl'), state = files.get('output/state.json')
  if (journal === undefined || state === undefined || !journal.toString('utf8').endsWith('\n'))
    throw new Error('Original Harbor journal/state is missing or incomplete; rebuilding is forbidden')
  const entries = journal.toString('utf8').trimEnd().split('\n').map(line => z.object({
    revision: count, day: count.max(365), stateHash: hash }).parse(JSON.parse(line)))
  const last = entries.at(-1), parsed = z.object({ version: z.literal(1), day: count.max(365), revision: count }).parse(JSON.parse(state.toString('utf8')))
  if (last === undefined || entries.some((entry, index) => entry.revision !== index)
    || parsed.day !== last.day || parsed.revision !== last.revision
    || harborHash(JSON.stringify(canonical(z.json().parse(JSON.parse(state.toString('utf8')))))) !== last.stateHash)
    throw new Error('Harbor journal and original state do not describe one consistent cut')
  return { day: parsed.day, revision: parsed.revision }
}

/**
 * Validate bounded bytes and the original pinned source without touching any filesystem or provider.
 * @param value - Untrusted provider bundle.
 * @param limits - Explicit complete-envelope and file bounds.
 * @returns validated bundle; missing originals, changed hashes, unsafe paths and unsupported pins reject.
 */
export function verifyHarborBackup(value: unknown, limits: HarborBackupLimits): HarborBackup {
  const bound = harborBackupLimitsSchema.parse(limits)
  if (Buffer.byteLength(JSON.stringify(value)) > bound.maxBytes) throw new Error('Complete Harbor backup exceeds byte allowance')
  const bundle = harborBackupSchema.parse(value)
  if (bundle.files.length > bound.maxFiles || bundle.files.length === 0
    || new Set(bundle.files.map(file => file.path)).size !== bundle.files.length)
    throw new Error('Harbor backup file count or identities are invalid')
  const files = new Map<string, Buffer>()
  for (const file of bundle.files) {
    if (file.bytes > bound.maxFileBytes || file.bytes > bound.maxBytes) throw new Error('Harbor backup file exceeds byte allowance')
    const bytes = Buffer.from(file.data, 'base64')
    if (bytes.length !== file.bytes || bytes.toString('base64') !== file.data || byteHash(bytes) !== file.sha256)
      throw new Error('Harbor backup file bytes or hash differ')
    files.set(file.path, bytes)
  }
  const manifest = files.get('manifest.json')
  if (manifest === undefined || byteHash(manifest) !== sourceHash) throw new Error('Harbor pinned manifest is missing or changed')
  const source = sourceManifest.parse(JSON.parse(manifest.toString('utf8')))
  for (const [path, digest] of Object.entries(source.files)) {
    const bytes = files.get(path)
    if (bytes === undefined || byteHash(bytes) !== digest) throw new Error('Harbor pinned source is missing or changed')
  }
  if (bundle.files.some(file => !permitted(file.path, source.files))) throw new Error('Harbor backup contains an unsupported or unsafe path')
  if (bundle.cut.pins.some(pin => !HARBOR_CONTRACTS.some(contract => isDeepStrictEqual(contract.pin, pin))))
    throw new Error('Harbor backup requires an unavailable exact protocol pin')
  const { contentHash, ...body } = bundle
  if (harborHash(JSON.stringify(body)) !== contentHash
    || !isDeepStrictEqual(caseIdentity(files), { day: bundle.day, revision: bundle.revision }))
    throw new Error('Harbor backup body or case cut changed')
  return bundle
}

async function boundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('Harbor archive requires bounded ordinary files without hard links')
    const chunks: Buffer[] = []
    let size = 0
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, maxBytes - size + 1))
      const { bytesRead } = await handle.read(chunk)
      if (bytesRead === 0) break
      size += bytesRead
      if (size > maxBytes) throw new Error('Harbor file grew beyond its byte allowance')
      chunks.push(chunk.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks, size)
  } finally { await handle.close() }
}
async function filePaths(root: string, limit: number, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const stat = await lstat(join(root, path))
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Harbor archive refuses links and special files')
    if (stat.isDirectory()) {
      if (!['output', '.bridge', 'output/views', 'output/checkpoints', 'output/recovery-checks'].includes(path))
        throw new Error('Harbor archive contains an unsupported directory')
      result.push(...await filePaths(root, limit - result.length, path))
    }
    else result.push(path)
    if (result.length > limit) throw new Error('Harbor archive file allowance exceeded')
  }
  return result.sort()
}

/**
 * Copy one paused provider cut while its Native/Team/Session collection remains sealed.
 * @param directory - Trusted provider-owned run directory; never a model-selected path.
 * @param state - Original paused Native snapshot.
 * @param cut - Hashes of the enclosing full Native prefix and protected owner references.
 * @param limits - Explicit aggregate/file bounds.
 * @param validate - Recheck the original sealed collection around file IO.
 * @returns complete private provider bundle; concurrent changes and missing original state refuse capture.
 */
export async function captureHarborBackup(directory: string, state: SimulationSnapshot, cut: HarborBackupCut,
  limits: HarborBackupLimits, validate: () => Promise<void>): Promise<HarborBackup> {
  const bound = harborBackupLimitsSchema.parse(limits), selected = harborBackupCutSchema.parse(cut)
  if (state.phase !== 'paused' || state.spec.runId !== selected.runId || state.revision !== selected.nativeRevision
    || basename(directory) !== harborHash(selected.runId)
    || !isDeepStrictEqual(state.world?.definition.operations.filter(pin => pin.domain === 'harbor'), selected.pins))
    throw new Error('Harbor archive is not bound to its original paused Native cut')
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Harbor source directory must be an ordinary private directory')
  await validate()
  const paths = await filePaths(directory, bound.maxFiles), files: z.infer<typeof fileSchema>[] = []
  let retained = 0
  for (const path of paths) {
    const bytes = await boundedFile(join(directory, path), Math.min(bound.maxFileBytes, bound.maxBytes - retained))
    retained += bytes.length
    files.push({ path, bytes: bytes.length, sha256: byteHash(bytes), data: bytes.toString('base64') })
  }
  const identity = caseIdentity(new Map(files.map(file => [file.path, Buffer.from(file.data, 'base64')])))
  const body = { format: 'clocky.harbor.private-backup/1' as const, cut: selected, ...identity, files }
  const bundle = verifyHarborBackup({ ...body, contentHash: harborHash(JSON.stringify(body)) }, bound)
  await validate()
  if (!isDeepStrictEqual(paths, await filePaths(directory, bound.maxFiles))) throw new Error('Harbor file set moved during capture')
  for (const file of files) if (byteHash(await boundedFile(join(directory, file.path), bound.maxFileBytes)) !== file.sha256)
    throw new Error('Harbor file moved during capture')
  await validate()
  return bundle
}

/**
 * Restore only inside a caller-owned invisible staging root, before its enclosing owner archive is published.
 * @param value - Original provider bundle.
 * @param root - Isolated trusted Harbor root; the hashed run directory must not exist.
 * @param limits - Complete bundle and file allowances.
 * @param signal - Owner cancellation.
 * @returns restored private directory after the pinned real CLI confirms the original day/revision.
 */
export async function restoreHarborBackupStaging(value: unknown, root: string, limits: HarborBackupLimits,
  signal: AbortSignal): Promise<string> {
  const bundle = verifyHarborBackup(value, limits), directory = join(root, harborHash(bundle.cut.runId))
  signal.throwIfAborted()
  await mkdir(root, { recursive: true, mode: 0o700 })
  await mkdir(directory, { recursive: false, mode: 0o700 })
  for (const file of bundle.files) {
    signal.throwIfAborted()
    const path = join(directory, file.path)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, Buffer.from(file.data, 'base64'), { flag: 'wx', mode: 0o600 })
  }
  const judge = new HarborCase(directory, root, bundle.cut.runId, signal, true)
  if (!isDeepStrictEqual(await judge.overview(), { day: bundle.day, revision: bundle.revision }))
    throw new Error('Restored Harbor CLI differs from the original provider cut')
  return directory
}

/**
 * Match every bridge input and committed receipt to its actual Native request and frozen source vector.
 * @param bundle - Structurally verified provider bytes.
 * @param snapshot - Enclosing Native archive projection; its Native parser still owns complete validation.
 * @param nativeHash - Hash of the exact enclosing Native stream archive.
 * @param referencesHash - Hash of the exact enclosing Team/Channel/Session reference vector.
 * @returns nothing for the original ownership relationships; foreign, missing and unaccounted effects reject.
 */
export function verifyHarborBackupBindings(bundle: HarborBackup, snapshot: unknown, nativeHash: string, referencesHash: string): void {
  const source = z.object({ phase: z.literal('paused'), revision: count, spec: z.object({ runId: z.string() }), world: z.object({
    definition: z.object({ operations: z.array(simulationWorldDomainPinSchema) }),
    intents: z.record(z.string(), z.object({ id: z.string(), pin: simulationWorldDomainPinSchema, requestId: z.string().optional() })),
    requests: z.record(z.string(), z.object({ id: z.string(), intentId: z.string(), requesterEntityId: z.string().nullable(),
      proposal: z.object({ payload: z.json() }),
      source: z.object({ kind: z.string(), binding: z.object({ teamId: z.string(), sessionId: z.string() }).optional() }) })),
    results: z.record(z.string(), z.object({ intentId: z.string(), requestId: z.string(),
      outcome: z.object({ kind: z.string() }), payload: z.json() })),
    executions: z.record(z.string(), z.object({ requestId: z.string(), phase: z.string() })),
  }) }).parse(snapshot)
  const expected = { runId: source.spec.runId, nativeRevision: source.revision, nativeHash, ownerReferencesHash: referencesHash,
    pins: source.world.definition.operations.filter(pin => pin.domain === 'harbor') }
  if (!isDeepStrictEqual(bundle.cut, expected)) throw new Error('Harbor bytes are bound to another Native or Team/Session cut')
  const files = new Map(bundle.files.map(file => [file.path, Buffer.from(file.data, 'base64').toString('utf8')]))
  const intents = Object.values(source.world.intents).filter(intent => intent.pin.domain === 'harbor')
  for (const file of bundle.files.filter(file => file.path.startsWith('.bridge/'))) {
    const id = file.path.slice('.bridge/'.length, '.bridge/'.length + 64)
    const intent = intents.find(intent => harborHash(intent.id) === id)
    const request = intent?.requestId === undefined ? undefined : source.world.requests[intent.requestId]
    if (intent === undefined || request?.source.kind !== 'decision' || request.source.binding === undefined || request.requesterEntityId === null)
      throw new Error('Harbor bridge evidence has no original Native role request')
    const input = files.get(`.bridge/${id}.input.json`)
    if (input === undefined) throw new Error('Harbor bridge evidence lost its original input')
    const contract = HARBOR_CONTRACTS.find(contract => isDeepStrictEqual(contract.pin, intent.pin))
    if (contract === undefined) throw new Error('Harbor bridge evidence requires an unavailable exact parser')
    const payload = z.object({ command: z.json() }).parse(contract.definition.schemas.request.parse(request.proposal.payload))
    const command = z.object({ kind: z.string(), actor: z.string().optional() }).parse(payload.command)
    const actor = command.kind === 'act' ? command.actor ?? request.requesterEntityId : request.requesterEntityId
    if (!isDeepStrictEqual(JSON.parse(input), { actor,
      teamIdentity: `${request.source.binding.teamId}/${request.source.binding.sessionId}`, command: payload.command }))
      throw new Error('Harbor bridge input differs from its original Native actor or request')
    const resultText = files.get(`.bridge/${id}.result.json`)
    const result = Object.values(source.world.results).find(value => value.requestId === request.id)
    if (resultText !== undefined) {
      const receipt = contract.definition.schemas.result.parse(JSON.parse(resultText))
      if (result?.outcome.kind === 'committed') {
        if (!isDeepStrictEqual(receipt, result.payload)) throw new Error('Harbor receipt differs from its committed Native result')
      } else if (!Object.values(source.world.executions).some(value => value.requestId === request.id
        && (value.phase === 'armed' || value.phase === 'outcome-unknown')))
        throw new Error('Harbor external receipt has no retained Native reconciliation responsibility')
    }
  }
  for (const result of Object.values(source.world.results)) {
    if (result.outcome.kind !== 'committed') continue
    const intent = source.world.intents[result.intentId]
    if (intent?.pin.domain !== 'harbor') continue
    const id = harborHash(intent.id)
    if (!files.has(`.bridge/${id}.input.json`) || !files.has(`.bridge/${id}.result.json`))
      throw new Error('Committed Harbor result lost its original bridge evidence')
  }
}
