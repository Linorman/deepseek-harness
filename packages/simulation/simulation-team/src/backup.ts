import type { WorldExternalArchiveProviders } from './external-archive.ts'
/** Portable full backups wrap the original owner archive without rewriting durable evidence. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, link, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { LogArchiveLimits } from '@clocky/clocky-storage'
import { KNOWN_SESSION_EVENT_TYPES } from '@clocky/clocky-session'
import { simulationWorldDomainPinSchema } from '@clocky/clocky-simulation'
import { verifyWorldArchive, restoreWorldArchive, WorldArchiveUnsupportedError } from './archive.ts'
import type { WorldArchiveBody, WorldArchiveRestoreTarget } from './archive.ts'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const streamSchema = z.strictObject({ name: z.string().min(1), version: count, cursor: z.number().int().min(-1), sha256: hashSchema })
/** Immutable cuts and implementation requirements; private source histories are separate from executable host configuration. */
export const worldBackupManifestSchema = z.strictObject({
  format: z.literal('world-backup/1'), kind: z.literal('full-private-backup'), writableRestore: z.literal(true),
  productJournalHash: hashSchema.optional(),
  bodyHash: hashSchema, bodyBytes: count, snapshotHash: hashSchema, referencesHash: hashSchema,
  native: streamSchema, owners: z.array(streamSchema),
  sessions: z.array(z.strictObject({ id: z.string().min(1), version: z.literal(0),
    sequence: z.number().int().min(-1), sha256: hashSchema })),
  unmaterializedSessions: z.array(z.string().min(1)),
  attachments: z.array(z.strictObject({ attachmentId: z.string().min(1), bytes: count, sha256: hashSchema })),
  domains: z.array(simulationWorldDomainPinSchema),
  externalOwners: z.array(z.strictObject({ provider: z.string().min(1), pins: z.array(simulationWorldDomainPinSchema),
    payloadHash: hashSchema, records: count })).optional(),
  executionPolicy: z.strictObject({ credentials: z.literal('target-host-only'), paths: z.literal('explicit-target-mapping'),
    realEffects: z.literal('disabled'), activation: z.literal('explicit-start'),
    confidentiality: z.literal('private-plaintext-owner-only') }),
})
/** Exact full-backup metadata, including original owner versions and content digests. */
export type WorldBackupManifest = z.infer<typeof worldBackupManifestSchema>
/** Original closure plus independently verifiable metadata; no provider credentials or runnable host config. */
export interface WorldBackupBundle {
  readonly manifest: WorldBackupManifest
  readonly body: WorldArchiveBody
  readonly productJournal?: z.infer<ReturnType<typeof z.json>> | undefined
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => JSON.stringify(value)

/**
 * Create a full private bundle from a protected archive; source records and private memory remain exact.
 * Historical text can itself contain secrets. Store the package with owner-only permissions or external encryption;
 * the package contains no encryption keys and supplies no portable execution configuration.
 * @param body - Complete owner-validated paused closure.
 * @param limits - Complete serialized bundle limits, including metadata.
 * @param productJournal - Optional original Product creation records, retained solely as immutable provenance.
 * @throws WorldArchiveUnsupportedError when this run or retained provenance requires a federation mailbox cut.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns immutable-by-value metadata and original records; never invokes a model.
 */
export function createWorldBackup(body: WorldArchiveBody, limits: LogArchiveLimits,
  productJournal?: z.infer<ReturnType<typeof z.json>>, providers?: WorldExternalArchiveProviders): WorldBackupBundle {
  const original = verifyWorldArchive(json(body), limits, providers)
  const rejectFederation = (value: unknown): void => {
    const archive = z.object({ snapshot: z.object({ federationTime: z.unknown().optional() }),
      native: z.object({ entries: z.array(z.object({ value: z.json() })) }), provenance: z.array(z.json()).optional() }).parse(value)
    if (archive.snapshot.federationTime !== undefined || archive.native.entries.some(entry =>
      z.object({ kind: z.literal('run/federation-time') }).safeParse(entry.value).success))
      throw new WorldArchiveUnsupportedError('Federated world backup requires a complete federation checkpoint')
    archive.provenance?.forEach(rejectFederation)
  }
  rejectFederation(original)
  for (const session of original.sessions) for (const value of session.events) {
    const event = z.object({ type: z.string(), ignorable: z.boolean().optional() }).parse(value)
    if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable !== true)
      throw new Error('Backup contains an unknown required Session event')
  }
  const snapshot = z.object({ world: z.object({ definition: z.object({
    operations: z.array(simulationWorldDomainPinSchema) }) }).optional() }).parse(original.snapshot)
  const refs = z.object({ sessions: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('materialized') }),
    z.object({ kind: z.literal('unmaterialized'), sessionId: z.string() }),
  ])) }).parse(original.references)
  const stream = (value: WorldArchiveBody['native']) => ({ name: value.name, version: value.version,
    cursor: value.entries.length - 1, sha256: digest(json(value)) })
  const bodyText = json(original)
  const manifest = worldBackupManifestSchema.parse({
    ...productJournal === undefined ? {} : { productJournalHash: digest(json(productJournal)) },
    format: 'world-backup/1', kind: 'full-private-backup', writableRestore: true,
    bodyHash: digest(bodyText), bodyBytes: Buffer.byteLength(bodyText), snapshotHash: digest(json(original.snapshot)),
    referencesHash: digest(json(original.references)), native: stream(original.native), owners: original.owners.map(stream),
    sessions: original.sessions.map(session => ({ ...z.object({ id: z.string(), version: z.literal(0) }).parse(session.header),
      sequence: session.events.length - 1, sha256: digest(json(session)) })),
    unmaterializedSessions: refs.sessions.flatMap(ref => ref.kind === 'unmaterialized' ? [ref.sessionId] : []),
    attachments: original.attachments.map(attachment => ({
      ...z.object({ attachmentId: z.string(), bytes: count }).parse(attachment.ref), sha256: attachment.sha256 })),
    domains: snapshot.world?.definition.operations ?? [],
    ...original.external === undefined ? {} : { externalOwners: original.external.map(value => ({
      provider: value.provider, pins: value.pins, payloadHash: digest(json(value.payload)),
      records: providers?.get(value.provider)?.entryCount(value.payload) ?? 0,
    })) },
    executionPolicy: { credentials: 'target-host-only', paths: 'explicit-target-mapping', realEffects: 'disabled',
      activation: 'explicit-start', confidentiality: 'private-plaintext-owner-only' },
  })
  const bundle = { manifest, body: original, ...productJournal === undefined ? {} : { productJournal: structuredClone(productJournal) } }
  if (Buffer.byteLength(json(bundle)) > limits.maxBytes) throw new Error('Backup including manifest exceeds complete byte budget')
  return bundle
}

/**
 * Validate all hashes, versions, cuts and closure references without target IO or inference.
 * Installed reducers and providers are checked by the isolated target before restore publication.
 * @param text - Untrusted serialized full bundle; datasets and unknown formats reject.
 * @param limits - Complete bundle byte and entry bounds.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns validated original records; no missing evidence is synthesized.
 */
export function verifyWorldBackup(text: string, limits: LogArchiveLimits, providers?: WorldExternalArchiveProviders): WorldBackupBundle {
  if (Buffer.byteLength(text) > limits.maxBytes) throw new Error('Backup exceeds complete byte budget')
  const parsed = z.strictObject({ manifest: worldBackupManifestSchema, body: z.json(),
    productJournal: z.json().optional() }).parse(JSON.parse(text))
  const expected = createWorldBackup(verifyWorldArchive(json(parsed.body), limits, providers), limits, parsed.productJournal, providers)
  if (!isDeepStrictEqual(expected.manifest, parsed.manifest)) throw new Error('Backup manifest differs from original owner content')
  return expected
}

/**
 * Publish verified bytes under their content hash with no overwrite, including concurrent retries.
 * @param root - Dedicated private backup directory on this host.
 * @param bundle - Full bundle from the protected owner cut.
 * @param limits - Complete result limits.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns immutable content hash; interruption leaves source and every prior successful package untouched.
 */
export async function publishWorldBackup(root: string, bundle: WorldBackupBundle, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): Promise<string> {
  const text = json(bundle); verifyWorldBackup(text, limits, providers)
  const hash = digest(text)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(root, `${hash}.backup.json`), staging = join(root, `.${hash}.${randomUUID()}.tmp`)
  const handle = await open(staging, 'wx', 0o600)
  try { await handle.writeFile(text); await handle.sync() } finally { await handle.close() }
  try {
    if (digest(await readFile(staging)) !== hash) throw new Error('Backup staging hash mismatch')
    try { await link(staging, path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (digest(await readFile(path)) !== hash) throw new Error('Backup destination has conflicting bytes')
    }
    const directory = await open(root, 'r'); try { await directory.sync() } finally { await directory.close() }
    return hash
  } finally { await unlink(staging) }
}

/**
 * Read a published package after checking its complete size and content address.
 * @param root - Private backup owner directory.
 * @param hash - Published package content hash.
 * @param limits - Complete read bounds.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns full original private bundle; callers must authorize private history access before invoking.
 */
export async function readWorldBackup(root: string, hash: string, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): Promise<WorldBackupBundle> {
  hashSchema.parse(hash)
  const path = join(root, `${hash}.backup.json`)
  if ((await stat(path)).size > limits.maxBytes) throw new Error('Backup exceeds byte budget before read')
  const text = await readFile(path, 'utf8')
  if (digest(text) !== hash) throw new Error('Backup package hash mismatch')
  return verifyWorldBackup(text, limits, providers)
}

/**
 * Restore a full bundle into invisible empty owners and atomically publish a paused target.
 * @param text - Full private bundle; source bytes are never modified.
 * @param destination - New absolute directory, or an exact prior restore retry.
 * @param limits - Complete package limits.
 * @param cwdMapping - Explicit source-to-final-target path routing; historical paths are never execution defaults.
 * @param prepare - Host-owned isolated services with installed reducers/providers, validation and close capabilities.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns durable paused receipt path; the target must reject missing implementations before publication.
 */
export async function restoreWorldBackup(text: string, destination: string, limits: LogArchiveLimits,
  cwdMapping: Readonly<Record<string, string>>, prepare: (staging: string) => Promise<WorldArchiveRestoreTarget>,
  providers?: WorldExternalArchiveProviders): Promise<string> {
  const bundle = verifyWorldBackup(text, limits, providers)
  return restoreWorldArchive(json(bundle.body), destination, limits, cwdMapping, prepare)
}

/** Only evidence-preserving format conversion is supported; there is no inference of missing approvals or receipts. */
export const worldMigrationPlanSchema = z.strictObject({
  source: z.literal('world-archive/1'), target: z.literal('world-backup/1'), converter: z.literal('archive-envelope/1'),
  inputHash: hashSchema, outputHash: hashSchema, losses: z.array(z.never()), outputBytes: count,
})
/** Exact immutable offline conversion preview. */
export type WorldMigrationPlan = z.infer<typeof worldMigrationPlanSchema>
/**
 * Preview the supported archive-v1 to full-backup-v1 envelope conversion without IO or source mutation.
 * @param text - Exact original archive bytes; unknown versions and incomplete evidence reject.
 * @param limits - Complete output and source limits.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns fixed converter/version/hash identities and an empty loss set.
 */
export function planWorldBackupMigration(text: string, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): WorldMigrationPlan {
  const output = json(createWorldBackup(verifyWorldArchive(text, limits, providers), limits, undefined, providers))
  return worldMigrationPlanSchema.parse({ source: 'world-archive/1', target: 'world-backup/1', converter: 'archive-envelope/1',
    inputHash: digest(text), outputHash: digest(output), outputBytes: Buffer.byteLength(output), losses: [] })
}
/**
 * Convert into a new immutable package after binding the exact input and converter to an approved plan.
 * @param text - Original archive bytes retained by the caller and unchanged by conversion.
 * @param plan - Exact preview; altered input, converter or output metadata rejects before writing.
 * @param root - Private output directory; every successful original package is preserved.
 * @param limits - Complete source and output bounds.
 * @param providers - Explicit installed exact external-owner contracts; absence refuses custom-owner coverage.
 * @returns published new bundle content hash; no business records or authority evidence are invented.
 */
export async function migrateWorldBackup(text: string, plan: WorldMigrationPlan, root: string, limits: LogArchiveLimits,
  providers?: WorldExternalArchiveProviders): Promise<string> {
  const parsed = worldMigrationPlanSchema.parse(plan)
  if (!isDeepStrictEqual(planWorldBackupMigration(text, limits, providers), parsed))
    throw new Error('Migration plan no longer matches exact input or converter')
  const bundle = createWorldBackup(verifyWorldArchive(text, limits, providers), limits, undefined, providers)
  return publishWorldBackup(root, bundle, limits, providers)
}
