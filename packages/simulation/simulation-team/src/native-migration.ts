/** Explicit offline conversion: original bytes remain a separate retained artifact and old backends are never opened for writing. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { NATIVE_101_RUNTIME_COMMIT, simulationArchivePrefixSchema, simulationNativeMigrationSchema } from '@clocky/clocky-simulation'
import type { SimulationArchivePrefix, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogArchiveLimits } from '@clocky/clocky-storage'
import { createWorldBackup, verifyWorldBackup } from './backup.ts'
import type { WorldBackupBundle } from './backup.ts'
import type { WorldExternalArchiveProviders } from './external-archive.ts'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Host-owned offline capabilities. Source must execute the pinned W0 parser, with no writable original-owner access. */
export interface WorldNativeMigrationValidators {
  /** Exact source artifact identity; arbitrary compatible parsers are not accepted. */
  readonly sourceRuntimeCommit: string
  /** Replay the archived 101 prefix under the pinned source runtime without models, CLI mutations, or source log writes. */
  source(prefix: SimulationArchivePrefix): Promise<unknown>
  /** Replay the converted prefix under the current installed exact domain implementations. */
  target(prefix: SimulationArchivePrefix): SimulationSnapshot
}
/** Reviewable conversion report binds raw source bytes, unchanged evidence and both independently replayed projections. */
export interface WorldNativeMigrationResult {
  readonly converter: 'native101-to102/1'
  readonly sourceRuntimeCommit: typeof NATIVE_101_RUNTIME_COMMIT
  readonly originalText: string
  readonly originalHash: string
  readonly converted: WorldBackupBundle
  readonly outputHash: string
  readonly sourcePrefixHash: string
  readonly snapshotHash: string
  readonly losses: readonly never[]
}
/**
 * Convert one complete paused full backup into a separately published target format, retaining every original byte.
 * The caller must publish the original and result under distinct immutable identities before isolated restore.
 * This operation never opens original databases, changes IDs/record sequences, or supplies execution credentials.
 * @param text - Complete private backup with Native format 101, including external original state when required.
 * @param limits - Aggregate source and output limits; the original is never truncated to fit.
 * @param validators - Trusted host-owned old/current replay capabilities; both projections must equal the archived cut.
 * @param providers - Exact installed external-owner contracts; unavailable rebind ownership refuses conversion.
 * @returns converted bundle plus complete immutable original and fixed conversion evidence.
 */
export async function migrateWorldNative101(text: string, limits: LogArchiveLimits,
  validators: WorldNativeMigrationValidators, providers?: WorldExternalArchiveProviders): Promise<WorldNativeMigrationResult> {
  if (validators.sourceRuntimeCommit !== NATIVE_101_RUNTIME_COMMIT) throw new Error('Pinned Native 101 verifier is unavailable')
  const source = verifyWorldBackup(text, limits, providers)
  // Only creation provenance, the enclosing stream descriptor and external binding hashes change.
  // Share immutable evidence arrays; cloning every private Session would multiply full-package memory.
  const body = { ...source.body, native: { ...source.body.native, entries: source.body.native.entries.map((entry, index) =>
    index === 0 ? { ...entry } : entry) }, ...source.body.external === undefined ? {}
    : { external: source.body.external.map(owner => ({ ...owner })) } }
  if (body.native.name !== 'simulation' || body.native.version !== 101) throw new Error('Native migration requires exact original journal 101')
  if (body.provenance !== undefined) throw new Error('Native migration of retained experiment parents requires a separate exact converter')
  const snapshot = z.object({ spec: z.json(), revision: z.number().int().nonnegative(),
    world: z.object({ definition: z.object({ operations: z.array(z.looseObject({ domain: z.string() })) }) }).optional(),
  }).parse(body.snapshot)
  const prefix = simulationArchivePrefixSchema.parse({ version: 101, spec: snapshot.spec, entries: body.native.entries })
  const originalState = await validators.source(prefix)
  if (!isDeepStrictEqual(originalState, body.snapshot)) throw new Error('Pinned source replay differs from archived paused cut')
  const contexts = (snapshot.world?.definition.operations ?? []).map((pin) => {
    if (pin.domain !== 'harbor') throw new Error('Native migration lacks an exact historical domain context profile')
    return { pin, profile: 'clocky.harbor.context/101' }
  })
  const sourcePrefixHash = digest(body.native)
  const migration = simulationNativeMigrationSchema.parse({ format: 'native101-to102/1', sourceVersion: 101, targetVersion: 102,
    sourceRuntimeCommit: NATIVE_101_RUNTIME_COMMIT, sourceRevision: snapshot.revision, sourceHash: sourcePrefixHash, contexts })
  const first = body.native.entries[0]
  if (first === undefined) throw new Error('Native migration has no creation evidence')
  const created = z.looseObject({ kind: z.literal('run/created') }).parse(first.value)
  if ('migration' in created) throw new Error('Original Native 101 already contains migration provenance')
  first.value = z.json().parse({ ...created, migration })
  body.native.version = 102
  const refs = z.looseObject({ run: z.looseObject({ stream: z.looseObject({ version: z.literal(101) }) }) }).parse(body.references)
  body.references = z.json().parse({ ...refs, run: { ...refs.run, stream: { ...refs.run.stream, version: 102 } } })
  const current = validators.target(simulationArchivePrefixSchema.parse({ ...prefix, version: 102, entries: body.native.entries }))
  if (!isDeepStrictEqual(current, originalState)) throw new Error('Native conversion changes the independently replayed source projection')
  for (const external of body.external ?? []) {
    const provider = providers?.get(external.provider)
    if (provider?.rebindNativeMigration === undefined) throw new Error('External owner has no exact Native migration rebind contract')
    external.payload = provider.rebindNativeMigration(external.payload,
      { snapshot: source.body.snapshot, native: source.body.native, references: source.body.references },
      { snapshot: body.snapshot, native: body.native, references: body.references }, limits)
  }
  const converted = createWorldBackup(body, limits, source.productJournal, providers)
  const result: WorldNativeMigrationResult = { converter: 'native101-to102/1', sourceRuntimeCommit: NATIVE_101_RUNTIME_COMMIT,
    originalText: text, originalHash: createHash('sha256').update(text).digest('hex'), converted, outputHash: digest(converted),
    sourcePrefixHash, snapshotHash: digest(originalState), losses: [] }
  const { originalText: _sourceBytes, converted: _targetBundle, ...proof } = result
  if (Buffer.byteLength(JSON.stringify(proof)) > limits.maxBytes) throw new Error('Native migration proof exceeds byte allowance')
  return result
}

/**
 * Publish a separate raw source, complete conversion proof, and converted full backup without overwrite.
 * @param root - New private migration output directory; original owner paths are never opened.
 * @param text - Exact original full-backup bytes.
 * @param limits - Aggregate bounds for each complete retained conversion result.
 * @param validators - Pinned offline source and current pure replay capabilities.
 * @param providers - Exact external archive contracts installed by this deployment.
 * @returns immutable source, proof and target content identities; interruption preserves any completed source artifact.
 */
export async function publishWorldNative101(root: string, text: string, limits: LogArchiveLimits,
  validators: WorldNativeMigrationValidators, providers?: WorldExternalArchiveProviders): Promise<{
  sourceHash: string
  proofHash: string
  targetHash: string
}> {
  const result = await migrateWorldNative101(text, limits, validators, providers)
  const { mkdir, open, link, readFile, unlink } = await import('node:fs/promises')
  const pathModule = await import('node:path')
  const crypto = await import('node:crypto')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const publish = async (bytes: string, extension: string): Promise<string> => {
    const hash = createHash('sha256').update(bytes).digest('hex')
    const path = pathModule.join(root, `${hash}.${extension}`), staging = pathModule.join(root, `.${crypto.randomUUID()}.tmp`)
    const handle = await open(staging, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try {
      try { await link(staging, path) } catch (cause: unknown) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
        if ((await readFile(path, 'utf8')) !== bytes) throw new Error('Native migration output identity conflicts')
      }
    } finally { await unlink(staging) }
    return hash
  }
  const sourceHash = await publish(text, 'source.backup.json')
  const { originalText: _sourceBytes, converted: _targetBundle, ...proof } = result
  const proofHash = await publish(JSON.stringify(proof), 'migration.json')
  const targetHash = await publish(JSON.stringify(result.converted), 'backup.json')
  const directory = await open(root, 'r'); try { await directory.sync() } finally { await directory.close() }
  return { sourceHash, proofHash, targetHash }
}
