import type { WorldExternalArchiveProviders } from './external-archive.ts'
import type {} from '@clocky/clocky-storage-log'
import { acquireLocalFileOwner } from '@clocky/clocky-storage'
import { simulationWorldDomainPinSchema, WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN,
  WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_ROUTE_PIN,
  WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN,
  WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, WORLD_HIRING_MARKET_PIN,
  WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN, WORLD_REPRESENTATION_PIN, WORLD_LOCAL_OBJECT_PIN } from '@clocky/clocky-simulation'
import type { SimulationWorldDomainPin } from '@clocky/clocky-simulation'
/** Full checkpoint-reference closure archives. These functions never compact or delete original owner history. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rename, stat, rm } from 'node:fs/promises'
import { join, dirname, basename, isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import type { SessionHeader, SessionEvent } from '@clocky/clocky-session'
import type { ImageAttachmentRef } from '@clocky/clocky-attachment'
import type { LogArchive, LogArchiveLimits, LogFacet } from '@clocky/clocky-storage'
import type { SimulationCheckpointCollection } from './types.ts'

const entry = z.strictObject({ sequence: z.number().int().nonnegative(), value: z.json() })
const log = z.strictObject({ name: z.string().min(1), version: z.number().int().nonnegative(), entries: z.array(entry) })
const externalArchiveSchema = z.strictObject({ provider: z.string().min(1).max(128),
  pins: z.array(simulationWorldDomainPinSchema).min(1), payload: z.json() })
const bodySchema = z.strictObject({ version: z.literal(1), snapshot: z.json(), references: z.json(), native: log,
  owners: z.array(log), sessions: z.array(z.strictObject({ header: z.json(), events: z.array(z.json()) })),
  attachments: z.array(z.strictObject({ ref: z.json(), data: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  provenance: z.array(z.json()).max(1).optional(), external: z.array(externalArchiveSchema).optional() })
/** Portable owner records retain original history; deployment configuration and credentials are excluded. */
export type WorldArchiveBody = z.infer<typeof bodySchema>
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const serialized = (value: unknown) => JSON.stringify(value)

/** Explicit unsupported-closure diagnostic; callers may expose this static category without private source bodies. */
export class WorldArchiveUnsupportedError extends Error {
  /** Stable refusal for dependencies without a portable archive contract. */
  readonly code = 'SIMULATION_ARCHIVE_UNSUPPORTED'
}

const coveredDomainPins: readonly SimulationWorldDomainPin[] = Object.freeze([
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN,
  WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_ROUTE_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN,
  WORLD_NORM_ENACT_PIN, WORLD_NORM_REVOKE_PIN, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN,
  WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, WORLD_HIRING_MARKET_PIN,
  WORLD_ENVIRONMENT_PIN, WORLD_EXPERIENCE_PIN, WORLD_REPRESENTATION_PIN, WORLD_LOCAL_OBJECT_PIN,
])
/**
 * Require an explicit complete-reference coverage contract rather than equating installation with portability.
 * @param pins - Exact original domain schema, implementation and generation identities.
 * @param external - Explicit exact pins covered by installed external archive contracts.
 * @returns nothing only for the closed builtin owner formats covered by this archive version.
 */
export function assertArchiveDomainCoverage(pins: readonly SimulationWorldDomainPin[],
  external: readonly SimulationWorldDomainPin[] = []): void {
  if (pins.some(pin => ![...coveredDomainPins, ...external].some(covered => isDeepStrictEqual(covered, pin))))
    throw new WorldArchiveUnsupportedError('Archive does not cover this custom domain/provider pin; an explicit reference-export contract is required')
}

/**
 * Reject external workspace/resource owners that this archive version cannot carry.
 * @param state - Actual Team owner projection captured at the protected cut.
 * @returns nothing for a self-contained root Team without task workspace ownership.
 */
export function assertArchiveTeamClosure(state: Pick<TeamStateSnapshot, 'team' | 'tasks' | 'workspaceAllocations' | 'participants'>): void {
  if (state.team.workspacePath !== undefined || state.team.parentTeamId !== undefined || state.team.childRun !== undefined
    || state.workspaceAllocations.length !== 0 || state.tasks.length !== 0
    || state.participants.some(participant => participant.provider !== undefined && participant.provider !== 'in-process'))
    throw new WorldArchiveUnsupportedError('Archive does not support custom runtimes, Team/task workspaces, provider artifacts or child-Team ownership; export adapters are required')
}

/**
 * Capture every Native, Team, Channel, materialized Session and image attachment under the existing checkpoint cut.
 * @param ctx - Actual source owner services.
 * @param collection - Live sealed owner collection; retains all history, including unmaterialized Session identities.
 * @param native - Complete Native prefix read through that collection's run cut.
 * @param limits - Aggregate entry/byte bounds and per-page IO bound.
 * @returns verified portable body; caller must publish before releasing collection.
 */
export async function captureWorldArchive(ctx: Context, collection: SimulationCheckpointCollection,
  native: LogArchive, limits: LogArchiveLimits): Promise<WorldArchiveBody> {
  await collection.validate()
  const providers = ctx.simulationTeams.worldArchiveProviders()
  const pins = collection.snapshot.world?.definition.operations ?? []
  const selected = [...providers.values()].filter(provider => provider.pins.some(pin => pins.some(value => isDeepStrictEqual(pin, value))))
  assertArchiveDomainCoverage(pins, selected.flatMap(provider => [...provider.pins]))
  if (collection.team.owner.kind !== 'team') throw new Error('Archive requires its original root Team owner')
  assertArchiveTeamClosure(await ctx.teams.getTeam({ teamId: collection.team.owner.teamId }))
  const count = native.entries.length + [collection.team, ...collection.channels].reduce((sum, ref) => sum + ref.cursor + 1, 0)
    + collection.sessions.reduce((sum, ref) => sum + (ref.kind === 'unmaterialized' ? 0 : ref.sequence + 1), 0)
  if (count > limits.maxEntries) throw new Error('Archive reference closure exceeds aggregate entry budget')
  const owners: LogArchive[] = []
  for (const reference of [collection.team, ...collection.channels]) {
    if (reference.owner.kind === 'channel') {
      const channel = await ctx.teams.getChannel({ channelId: reference.owner.channelId })
      if (channel.manifest.adapter.type !== 'direct' || channel.manifest.adapter.version !== 4 || channel.manifest.viewPolicy !== undefined)
        throw new WorldArchiveUnsupportedError('Archive does not cover custom Channel adapters or view providers')
    }
    const result = await ctx.teams.exportPersistenceArchive({ ...reference.owner, expectedCursor: reference.cursor }, limits)
    if (!isDeepStrictEqual(result.reference, reference)) throw new Error('Archive owner reference moved')
    owners.push({ ...reference.stream, entries: result.entries })
  }
  const sessions: { header: SessionHeader; events: SessionEvent[] }[] = []
  for (const reference of collection.sessions) {
    if (reference.kind === 'unmaterialized') continue
    const stored = await ctx.sessionPersistence.readFrom(reference.header.id, 0)
    if (!isDeepStrictEqual(stored.meta, reference.header) || stored.events.length !== reference.sequence + 1)
      throw new Error('Archive Session prefix differs from retained reference')
    // Parent lineage beyond this closed run is unsupported until its independent owner can be pinned.
    if (stored.meta.parentSession !== undefined && !collection.sessions.some(r =>
      (r.kind === 'unmaterialized' ? r.sessionId : r.header.id) === stored.meta.parentSession))
      throw new Error('Archive Session parent lies outside the protected closure')
    sessions.push({ header: stored.meta, events: stored.events })
  }
  const references = { run: collection.run, team: collection.team, channels: collection.channels, sessions: collection.sessions }
  const images = new Map<string, ImageAttachmentRef>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    if (value === null || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (object.attachment !== undefined && object.type !== 'image'
      || Array.isArray(object.artifacts) && object.artifacts.length !== 0
      || object.workspacePath !== undefined && object.workspacePath !== null)
      throw new Error('Archive contains unsupported external workspace or non-image attachment ownership')
    if (object.type === 'image' && object.attachment !== undefined) {
      const ref = object.attachment as ImageAttachmentRef
      if (typeof ref.attachmentId !== 'string') throw new Error('Archive contains a malformed image reference')
      const previous = images.get(ref.attachmentId)
      if (previous !== undefined && !isDeepStrictEqual(previous, ref)) throw new Error('Archive image identity has conflicting metadata')
      images.set(ref.attachmentId, ref)
    }
    for (const child of Object.values(object)) visit(child)
  }
  visit({ native, owners, sessions })
  const attachments: { ref: ImageAttachmentRef; data: string; sha256: string }[] = []
  for (const ref of images.values()) {
    const store = ctx.get('attachments')
    if (store === undefined) throw new Error('Archive requires the original attachment owner')
    if (ref.bytes > limits.maxBytes) throw new Error('Archive image exceeds complete byte budget')
    const image = await store.readImage(ref)
    attachments.push({ ref, data: Buffer.from(image.data).toString('base64'), sha256: digest(image.data) })
  }
  let provenance: WorldArchiveBody[] | undefined
  if (collection.snapshot.experiment !== undefined) {
    const storage = ctx.get('storageLog')
    if (storage === undefined) throw new Error('Branch archive requires its retained provenance storage owner')
    const stream = await storage.open({ name: `experiment-provenance:${collection.snapshot.experiment.namespace}`, version: 1 })
    try {
      if (stream.firstSequence !== 0 || stream.tailSequence !== 0) throw new Error('Branch provenance is missing or incomplete')
      const original = await stream.read(-1, 1)
      provenance = [verifyWorldArchive(serialized(original[0]?.value), limits, providers)]
    } finally { await stream.close() }
  }
  const source = { snapshot: collection.snapshot, references, native }
  const external: z.infer<typeof externalArchiveSchema>[] = []
  for (const provider of selected) {
    const payload = await provider.capture(collection.snapshot, source, limits, () => collection.validate())
    if (ctx.simulationTeams.worldArchiveProviders().get(provider.id) !== provider) throw new Error('External archive provider was retired')
    provider.verify(payload, source, limits)
    external.push({ provider: provider.id, pins: pins.filter(pin => provider.pins.some(value => isDeepStrictEqual(pin, value))), payload })
  }
  const body = bodySchema.parse({ version: 1, snapshot: collection.snapshot, references, native, owners, sessions, attachments,
    ...provenance === undefined ? {} : { provenance }, ...external.length === 0 ? {} : { external } })
  verifyWorldArchive(serialized(body), limits, providers)
  await collection.validate()
  return body
}

/**
 * Verify byte limits, format, complete sequences, retained reference metadata and attachment hashes before import or archive read.
 * @param text - Untrusted exact serialized body.
 * @param limits - Complete body limits.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns parsed body without opening any run, materializing identities or calling a model.
 */
export function verifyWorldArchive(text: string, limits: LogArchiveLimits, providers?: WorldExternalArchiveProviders): WorldArchiveBody {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1
    || Buffer.byteLength(text) > limits.maxBytes) throw new Error('Archive exceeds declared byte bounds')
  const body = bodySchema.parse(JSON.parse(text))
  const domainSource = z.object({ world: z.object({
    definition: z.object({ operations: z.array(simulationWorldDomainPinSchema) }) }).optional() })
    .parse(body.snapshot)
  const externalPins: SimulationWorldDomainPin[] = []
  let externalEntries = 0
  const seen = new Set<string>()
  for (const external of body.external ?? []) {
    const provider = providers?.get(external.provider)
    if (provider === undefined || seen.has(external.provider)
      || external.pins.some(pin => !provider.pins.some(value => isDeepStrictEqual(pin, value))))
      throw new WorldArchiveUnsupportedError('External archive requires its exact installed provider parser')
    seen.add(external.provider)
    provider.verify(external.payload, { snapshot: body.snapshot, native: body.native, references: body.references }, limits)
    const count = provider.entryCount(external.payload)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('External archive record count is invalid')
    externalEntries += count
    if (!Number.isSafeInteger(externalEntries)) throw new Error('External archive record count exceeds safe capacity')
    externalPins.push(...external.pins)
  }
  assertArchiveDomainCoverage(domainSource.world?.definition.operations ?? [], externalPins)
  let lineageDepth = 0, ancestor: WorldArchiveBody = body
  while (ancestor.provenance !== undefined && ancestor.provenance.length !== 0) {
    if (++lineageDepth > 8) throw new Error('Archive provenance exceeds maximum depth')
    ancestor = bodySchema.parse(ancestor.provenance[0])
  }
  let entries = externalEntries
  for (const raw of body.provenance ?? []) {
    const parent = verifyWorldArchive(serialized(raw), limits, providers)
    let current: WorldArchiveBody | undefined = parent
    while (current !== undefined) {
      entries += current.native.entries.length + current.owners.reduce((sum, owner) => sum + owner.entries.length, 0)
        + current.sessions.reduce((sum, session) => sum + session.events.length, 0)
      current = current.provenance?.[0] === undefined ? undefined : bodySchema.parse(current.provenance[0])
    }
    const experiment = z.object({ experiment: z.object({ sourceHash: z.string(), parentRunId: z.string(),
      sourceRevision: z.number().int() }) }).parse(body.snapshot).experiment
    const source = z.object({ spec: z.object({ runId: z.string() }), revision: z.number().int() }).parse(parent.snapshot)
    if (digest(serialized(parent)) !== experiment.sourceHash || source.spec.runId !== experiment.parentRunId
      || source.revision !== experiment.sourceRevision) throw new Error('Archive branch provenance differs from its source commitment')
  }
  if (z.object({ experiment: z.unknown().optional() }).parse(body.snapshot).experiment !== undefined
    && body.provenance?.length !== 1) throw new Error('Archive branch is missing its original provenance closure')
  const names = new Set<string>()
  for (const [index, stream] of [body.native, ...body.owners].entries()) {
    const key = `${index === 0 ? 'native' : 'owner'}:${stream.name}`
    if (names.has(key)) throw new Error('Archive duplicates an owner stream')
    names.add(key)
    for (const [sequence, entry] of stream.entries.entries()) if (entry.sequence !== sequence) throw new Error('Archive sequence is incomplete')
    entries += stream.entries.length
  }
  const sessionIds = new Set<string>()
  for (const session of body.sessions) {
    const header = z.object({ id: z.string().min(1), version: z.literal(0), cwd: z.string().optional() }).parse(session.header)
    if (sessionIds.has(header.id)) throw new Error('Archive duplicates a Session identity')
    sessionIds.add(header.id)
    session.events.forEach((event, index) => { if (z.object({ seq: z.number().int() }).parse(event).seq !== index) throw new Error('Archive Session has a sequence gap') })
    entries += session.events.length
  }
  if (entries > limits.maxEntries) throw new Error('Archive exceeds complete entry bounds')
  const attachmentIds = new Set<string>()
  for (const attachment of body.attachments) {
    const ref = z.object({ attachmentId: z.string(), bytes: z.number().int().nonnegative() }).parse(attachment.ref)
    const bytes = Buffer.from(attachment.data, 'base64')
    if (attachmentIds.has(ref.attachmentId) || bytes.toString('base64') !== attachment.data || bytes.length !== ref.bytes
      || digest(bytes) !== attachment.sha256) throw new Error('Archive attachment is duplicate, missing or corrupt')
    attachmentIds.add(ref.attachmentId)
  }
  const snapshot = z.object({ phase: z.literal('paused'), revision: z.number().int().nonnegative(),
    spec: z.object({ runId: z.string() }), lineage: z.never().optional(), branches: z.never().optional(),
    parentRunId: z.never().optional() }).parse(body.snapshot)
  const refSchema = z.object({ stream: z.object({ name: z.string(), version: z.number().int() }), cursor: z.number().int(),
    firstSequence: z.literal(0) })
  const references = z.object({ run: refSchema.extend({ runId: z.string() }), team: refSchema,
    channels: z.array(refSchema), sessions: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('materialized'), header: z.looseObject({ id: z.string() }), sequence: z.number().int() }),
      z.object({ kind: z.literal('unmaterialized'), sessionId: z.string() }),
    ])) }).parse(body.references)
  if (snapshot.spec.runId !== references.run.runId || snapshot.revision !== references.run.cursor
    || body.native.name !== references.run.stream.name || body.native.version !== references.run.stream.version
    || body.native.entries.length !== references.run.cursor + 1) throw new Error('Archive Native closure does not match its cut')
  const ownerRefs = [references.team, ...references.channels]
  const ownerKeys = ownerRefs.map(ref => ref.stream.name)
  if (new Set(ownerKeys).size !== ownerKeys.length || ownerRefs.length !== body.owners.length
    || ownerRefs.some(ref => !body.owners.some(stream => stream.name === ref.stream.name
      && stream.version === ref.stream.version && stream.entries.length === ref.cursor + 1))
    || body.owners.some(stream => !ownerRefs.some(ref => ref.stream.name === stream.name)))
    throw new Error('Archive owner closure is incomplete or contains duplicate references')
  const materialized = references.sessions.filter(ref => ref.kind === 'materialized')
  const referenceSessionIds = references.sessions.map(ref => ref.kind === 'materialized' ? ref.header.id : ref.sessionId)
  if (new Set(referenceSessionIds).size !== referenceSessionIds.length || materialized.length !== body.sessions.length
    || references.sessions.some(ref => ref.kind === 'materialized' ? !body.sessions.some(session =>
      z.object({ id: z.string() }).parse(session.header).id === ref.header.id && session.events.length === ref.sequence + 1)
      : sessionIds.has(ref.sessionId))
    || [...sessionIds].some(id => !materialized.some(ref => ref.header.id === id)))
    throw new Error('Archive Session closure is incomplete or contains duplicate references')
  for (const session of body.sessions) {
    const header = z.object({ parentSession: z.string().optional() }).parse(session.header)
    if (header.parentSession !== undefined && !referenceSessionIds.includes(header.parentSession))
      throw new WorldArchiveUnsupportedError('Archive Session parent lies outside the protected closure')
    const reference = materialized.find(ref => ref.header.id === z.object({ id: z.string() }).parse(session.header).id)
    if (!isDeepStrictEqual(reference?.header, session.header))
      throw new Error('Archive Session header differs from its retained reference')
  }
  const requiredImages = new Set<string>()
  const attachmentReferences = new Map(body.attachments.map(attachment =>
    [z.object({ attachmentId: z.string() }).parse(attachment.ref).attachmentId, attachment.ref]))
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(scan); return }
    if (value === null || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (object.attachment !== undefined && object.type !== 'image'
      || Array.isArray(object.artifacts) && object.artifacts.length !== 0
      || object.workspacePath !== undefined && object.workspacePath !== null)
      throw new Error('Archive contains unsupported external workspace or non-image attachment ownership')
    if (object.type === 'image') {
      const id = z.object({ attachmentId: z.string() }).parse(object.attachment).attachmentId
      requiredImages.add(id)
      if (attachmentReferences.has(id) && !isDeepStrictEqual(attachmentReferences.get(id), object.attachment))
        throw new Error('Archive image metadata differs from its retained reference')
    }
    Object.values(object).forEach(scan)
  }
  scan({ native: body.native, owners: body.owners, sessions: body.sessions })
  if (requiredImages.size !== attachmentIds.size || [...requiredImages].some(id => !attachmentIds.has(id)))
    throw new Error('Archive attachment closure is incomplete')
  return body
}

/**
 * Copy and validate an immutable content-addressed body, then atomically publish its location and conservative pins.
 * @param root - Dedicated archive directory owned by this installation.
 * @param body - Validated full closure.
 * @param limits - Complete-result limits.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns body hash, usable for bounded readback; original files are never deleted.
 */
export async function publishWorldArchive(root: string, body: WorldArchiveBody, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): Promise<string> {
  const text = serialized(body); verifyWorldArchive(text, limits, providers)
  const hash = digest(text)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const objectPath = join(root, `${hash}.json`)
  const staging = join(root, `${hash}.${randomUUID()}.tmp`)
  const object = await open(staging, 'wx', 0o600)
  try { await object.writeFile(text); await object.sync() } finally { await object.close() }
  if (digest(await readFile(staging)) !== hash) throw new Error('Archive staging hash differs')
  await rename(staging, objectPath)
  if (digest(await readFile(objectPath)) !== hash) throw new Error('Archive copied object hash differs')
  const pointer = join(root, `${hash}.${randomUUID()}.location.tmp`)
  const handle = await open(pointer, 'w', 0o600)
  try { await handle.writeFile(serialized({ version: 1, hash, pins: body.references, location: `${hash}.json`, physicalDeletion: false })); await handle.sync() }
  finally { await handle.close() }
  await rename(pointer, join(root, `${hash}.location.json`))
  const directory = await open(root, 'r'); try { await directory.sync() } finally { await directory.close() }
  return hash
}

/** Read a published immutable archive through its verified location; corrupt or unpublished objects reject.
 * @param root - Dedicated archive directory.
 * @param hash - Original content SHA-256 returned at publication.
 * @param limits - Complete read budgets.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns original verified body and owner identities.
 */
export async function readWorldArchive(root: string, hash: string, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): Promise<WorldArchiveBody> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid archive identity')
  if ((await stat(join(root, `${hash}.location.json`))).size > limits.maxBytes) throw new Error('Archive location exceeds byte budget')
  const pointer = z.strictObject({ version: z.literal(1), hash: z.literal(hash), pins: z.json(),
    location: z.literal(`${hash}.json`), physicalDeletion: z.literal(false) }).parse(JSON.parse(await readFile(join(root, `${hash}.location.json`), 'utf8')))
  if ((await stat(join(root, pointer.location))).size > limits.maxBytes) throw new Error('Archive exceeds byte budget before read')
  const text = await readFile(join(root, pointer.location), 'utf8')
  if (digest(text) !== hash) throw new Error('Archive object hash mismatch')
  const body = verifyWorldArchive(text, limits, providers)
  if (!isDeepStrictEqual(pointer.pins, body.references)) throw new Error('Archive pin manifest mismatch')
  return body
}

/** Restore original full log records into an empty isolated backend; existing identities reject before any append.
 * @param facet - Isolated staging backend, never an active original owner.
 * @param streams - Verified original streams, including their exact versions.
 * @returns completion after every original sequence has been appended.
 */
export async function importArchiveLogs(facet: LogFacet, streams: readonly LogArchive[]): Promise<void> {
  const existing = new Set((await facet.list()).map(stream => stream.name))
  if (streams.some(stream => existing.has(stream.name))) throw new Error('Archive import target identity already exists')
  for (const stream of streams) {
    const target = await facet.open({ name: stream.name, version: stream.version })
    try { if (stream.entries.length) await target.append(-1, stream.entries.map(entry => entry.value)) }
    finally { await target.close() }
  }
}

/**
 * Restore immutable Sessions and images into isolated owners; replay preparation validates all event versions.
 * @param ctx - Target isolated owners, never source or production live identities.
 * @param body - Previously verified archive.
 * @param cwdMapping - Explicit source-to-target working directories; missing mappings reject.
 * @returns recorded header path mappings; original IDs and events remain unchanged and no inference occurs.
 */
export async function importArchiveSessions(ctx: Context, body: WorldArchiveBody, cwdMapping: Readonly<Record<string, string>>):
Promise<readonly { sessionId: string; sourceCwd: string; targetCwd: string }[]> {
  const mappings: { sessionId: string; sourceCwd: string; targetCwd: string }[] = []
  if (body.provenance?.[0] !== undefined) {
    const namespace = z.object({ experiment: z.object({ namespace: z.uuid() }) }).parse(body.snapshot).experiment.namespace
    await retainWorldExperimentProvenance(ctx, namespace, bodySchema.parse(body.provenance[0]),
      { maxEntries: Number.MAX_SAFE_INTEGER, maxBytes: Buffer.byteLength(serialized(body)), pageSize: 1 })
  }

  for (const session of body.sessions) {
    const header = session.header as unknown as SessionHeader
    if (!await ctx.sessionPersistence.isUnmaterialized(header.id)) throw new Error('Archive Session identity already exists')
  }
  for (const attachment of body.attachments) {
    const ref = attachment.ref as unknown as ImageAttachmentRef, store = ctx.get('attachments')
    if (store === undefined) throw new Error('Archive restore requires an attachment provider')
    const saved = await store.saveImage({ data: Buffer.from(attachment.data, 'base64'), mediaType: ref.mediaType,
      ...ref.name === undefined ? {} : { name: ref.name } })
    if (saved.attachmentId !== ref.attachmentId) throw new Error('Archive image import changed its original identity')
    await store.readImage(ref)
  }
  for (const session of body.sessions) {
    const original = session.header as unknown as SessionHeader, events = session.events as unknown as SessionEvent[]
    const targetCwd = original.cwd === undefined ? undefined : cwdMapping[original.cwd]
    if (original.cwd !== undefined && (targetCwd === undefined || !isAbsolute(targetCwd))) throw new Error('Archive Session requires an explicit absolute cwd mapping')
    const header: SessionHeader = { ...original, ...targetCwd === undefined ? {} : { cwd: targetCwd } }
    if (original.cwd !== undefined && targetCwd !== undefined) mappings.push({ sessionId: original.id, sourceCwd: original.cwd, targetCwd })
    const validated = ctx.sessions.prepare(header.id, { meta: structuredClone(header), seed: structuredClone(events), seedSource: 'persistence' })
    // Restore validation may add an in-memory end-seed marker; an empty physical history must stay empty.
    const prepared = events.length === 0 ? ctx.sessions.prepare(header.id, { meta: structuredClone(header) }) : validated
    await ctx.sessionPersistence.create(header)
    if (events.length) await ctx.sessionPersistence.append(header.id, events)
    else await ctx.sessionPersistence.materializeHeader(prepared)
    const stored = await ctx.sessionPersistence.readFrom(header.id, 0)
    if (!isDeepStrictEqual(stored.meta, header) || !isDeepStrictEqual(stored.events, events)) throw new Error('Archive Session readback differs')
  }
  return mappings
}


/** Isolated target owners supplied by the deployment after configuring every persistence root below staging. */
export interface WorldArchiveRestoreTarget {
  readonly ctx: Context
  readonly native: LogFacet
  readonly owners: LogFacet
  /** Replay with installed owner parsers and publish a legal new checkpoint for mapped headers,
    preserving every imported prefix; never activate actors. */
  validate(body: WorldArchiveBody): Promise<{ readonly checkpointId: string; readonly implementationVersion: string }>
  /** Drain and close all target handles before directory publication. */
  close(): Promise<void>
}

/**
 * Restore into a fresh invisible sibling directory and publish only after every owner validates and closes.
 * @param text - Exact portable body, retained unchanged by this operation.
 * @param destination - New target storage directory; existing directories reject rather than merge.
 * @param limits - Complete body bounds.
 * @param cwdMapping - Explicit final host path mapping; staging paths must not escape into Session headers.
 * @param prepare - Deployment-owned creation of isolated backends and their validation capability.
 * @returns published receipt path; failures remove only this operation's staging directory and are retryable.
 */
export async function restoreWorldArchive(text: string, destination: string, limits: LogArchiveLimits,
  cwdMapping: Readonly<Record<string, string>>, prepare: (staging: string) => Promise<WorldArchiveRestoreTarget>): Promise<string> {
  if (Buffer.byteLength(text) > limits.maxBytes) throw new Error('Archive exceeds declared byte bounds')
  const body = bodySchema.parse(JSON.parse(text))
  if (!isAbsolute(destination)) throw new Error('Archive restore destination must be absolute')
  const exists = await stat(destination).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (exists !== undefined) {
    const receiptPath = join(destination, 'archive-restore.json')
    const receipt = z.object({ version: z.literal(1), sourceHash: z.literal(digest(text)), phase: z.literal('paused'),
      originalPackageRetained: z.literal(true), cwdMappings: z.array(z.object({ sessionId: z.string(),
        sourceCwd: z.string(), targetCwd: z.string() })) })
      .parse(JSON.parse(await readFile(receiptPath, 'utf8')))
    if (receipt.cwdMappings.some(mapping => cwdMapping[mapping.sourceCwd] !== mapping.targetCwd))
      throw new Error('Archive restore retry changed its cwd mapping')
    const existing = await prepare(destination)
    try {
      const providers = existing.ctx.simulationTeams.worldArchiveProviders()
      verifyWorldArchive(text, limits, providers)
      for (const external of body.external ?? []) await providers.get(external.provider)?.restore(external.payload,
        { snapshot: body.snapshot, native: body.native, references: body.references }, limits)
      const anchor = await existing.validate(body)
      const expected = z.object({ anchor: z.strictObject({ checkpointId: z.string(), implementationVersion: z.string() }) }).parse(JSON.parse(await readFile(receiptPath, 'utf8')))
      if (!isDeepStrictEqual(anchor, expected.anchor)) throw new Error('Archive retry changed its legal import anchor')
    } finally { await existing.close() }
    return receiptPath
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(dirname(destination), `.${basename(destination)}-restore-`))
  let target: WorldArchiveRestoreTarget | undefined
  let closed = false
  try {
    target = await prepare(staging)
    const providers = target.ctx.simulationTeams.worldArchiveProviders()
    verifyWorldArchive(text, limits, providers)
    for (const external of body.external ?? []) await providers.get(external.provider)?.restore(external.payload,
      { snapshot: body.snapshot, native: body.native, references: body.references }, limits)
    await importArchiveLogs(target.owners, body.owners)
    const mappings = await importArchiveSessions(target.ctx, body, cwdMapping)
    await importArchiveLogs(target.native, [body.native])
    const anchor = z.strictObject({ checkpointId: z.string().min(1),
      implementationVersion: z.string().min(1) }).parse(await target.validate(body))
    await target.close(); closed = true
    const receipt = { version: 1, sourceHash: digest(text), cwdMappings: mappings, anchor, phase: 'paused', originalPackageRetained: true }
    const handle = await open(join(staging, 'archive-restore.json'), 'wx', 0o600)
    try { await handle.writeFile(serialized(receipt)); await handle.sync() } finally { await handle.close() }
    // An exclusive publication reservation prevents two in-process or cross-process restores selecting this destination.
    const releasePublication = acquireLocalFileOwner(`${destination}.restore-owner.sqlite`)
    try {
      if (await stat(destination).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }) !== undefined) throw new Error('Archive restore destination appeared before publication')
      await rename(staging, destination)
      const parent = await open(dirname(destination), 'r'); try { await parent.sync() } finally { await parent.close() }
    } finally { releasePublication() }
    return join(destination, 'archive-restore.json')
  } catch (error) {
    if (target !== undefined && !closed) await target.close()
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

/** Full conservative retention plan: all closure owners are pinned, with no physical deletion eligibility.
 * @param body - Complete protected archive closure.
 * @param limits - Preview budgets identical to publication.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns original pins and exact byte/object counts; the preview performs no IO.
 */
export function planWorldArchive(body: WorldArchiveBody, limits: LogArchiveLimits, providers?: WorldExternalArchiveProviders): { version: 1; hash: string; bytes: number; nativeEntries: number; ownerStreams: number; materializedSessions: number; attachments: number; pins: WorldArchiveBody['references']; destructive: false; reclaimableBytes: 0 } {
  const text = serialized(body); verifyWorldArchive(text, limits, providers)
  return { version: 1 as const, hash: digest(text), bytes: Buffer.byteLength(text), nativeEntries: body.native.entries.length,
    ownerStreams: body.owners.length, materializedSessions: body.sessions.length, attachments: body.attachments.length,
    pins: body.references, destructive: false as const, reclaimableBytes: 0 as const }
}

/** Retain an immutable parent archive as read-only provenance before creating any branch execution owner.
 * @param ctx - Current storage-log owner; no parent executable identity is imported.
 * @param namespace - Original branch command UUID.
 * @param body - Exact complete parent closure.
 * @param limits - Complete parent and retained-entry byte bounds.
 * @returns after durable original bytes; changed retries or extra records reject.
 */
export async function retainWorldExperimentProvenance(ctx: Context, namespace: string,
  body: WorldArchiveBody, limits: LogArchiveLimits): Promise<void> {
  z.uuid().parse(namespace)
  verifyWorldArchive(serialized(body), limits, ctx.simulationTeams.worldArchiveProviders())
  const storage = ctx.get('storageLog')
  if (storage === undefined) throw new Error('Branch initialization requires a provenance storage owner')
  const stream = await storage.open({ name: `experiment-provenance:${namespace}`, version: 1 })
  try {
    if (stream.tailSequence === -1) await stream.append(-1, [body])
    const retained = await stream.read(-1, 1)
    if (stream.firstSequence !== 0 || stream.tailSequence !== 0 || !isDeepStrictEqual(retained[0]?.value, body))
      throw new Error('Branch provenance namespace has another original source')
  } finally { await stream.close() }
}
