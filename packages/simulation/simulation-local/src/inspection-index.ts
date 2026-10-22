/** Rebuildable journal reference index; publication never grants authority to cached state. */
import { createHash, randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { LogEntry } from '@clocky/clocky-storage'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const recordKindSchema = z.object({ kind: z.string().min(1) })
/** Persisted references contain no projected business bodies or authorization decisions. */
export const inspectionIndexSchema = z.strictObject({
  schema: z.literal('clocky/simulation-inspection-index'), version: z.literal(1),
  journalVersion: z.number().int().positive(), sourceHash: hashSchema,
  cursor: z.number().int().nonnegative(),
  rows: z.array(z.strictObject({ sequence: z.number().int().nonnegative(), kind: z.string().min(1), hash: hashSchema })),
}).superRefine((value, context) => {
  if (value.rows.length !== value.cursor + 1 || value.rows.some((row, index) => row.sequence !== index))
    context.addIssue({ code: 'custom', message: 'Index does not cover its contiguous source prefix' })
})
/** Exact published source prefix and per-record references. */
export type InspectionIndex = z.infer<typeof inspectionIndexSchema>

/**
 * Hash exact record boundaries and sequences before reusing any private projection.
 * @param entries - Complete source prefix obtained under the owner's scan budget.
 * @returns deterministic source identity, independent of index files.
 */
export function inspectionPrefixHash(entries: readonly LogEntry[]): string {
  const hash = createHash('sha256')
  for (const entry of entries) {
    const bytes = JSON.stringify(entry)
    hash.update(`${Buffer.byteLength(bytes)}:`).update(bytes)
  }
  return hash.digest('hex')
}

/**
 * Build from a complete already validated journal; source hash includes record boundaries and sequence.
 * @param entries - Original complete prefix, never projection-generated replacements.
 * @param journalVersion - Original journal format.
 * @returns strict manifest ready for publication; gaps or missing record kinds reject.
 */
export function buildInspectionIndex(entries: readonly LogEntry[], journalVersion: number): InspectionIndex {
  const hash = createHash('sha256')
  const rows = entries.map((entry) => {
    const bytes = JSON.stringify(entry)
    hash.update(`${Buffer.byteLength(bytes)}:`).update(bytes)
    const record = recordKindSchema.parse(entry.value)
    return { sequence: entry.sequence, kind: record.kind, hash: createHash('sha256').update(bytes).digest('hex') }
  })
  return inspectionIndexSchema.parse({ schema: 'clocky/simulation-inspection-index', version: 1,
    journalVersion, sourceHash: hash.digest('hex'), cursor: entries.length - 1, rows })
}

/**
 * Read only an exact manifest; stale, malformed and missing indexes require bounded source fallback.
 * @param directory - Existing owner directory.
 * @param source - Manifest independently reconstructed from the bounded authoritative prefix.
 * @returns validated references, or undefined; filesystem access errors remain errors.
 */
export async function readInspectionIndex(directory: string, source: InspectionIndex): Promise<InspectionIndex | undefined> {
  let file
  try { file = await open(join(directory, 'inspection-index.json'), 'r') }
  catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  let bytes: string
  try {
    const limit = Buffer.byteLength(JSON.stringify(source)) + 1
    const buffer = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset < buffer.length) {
      const read = await file.read(buffer, offset, buffer.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    if (offset > limit) return undefined
    bytes = buffer.subarray(0, offset).toString('utf8')
  } finally { await file.close() }
  let value: unknown
  try { value = JSON.parse(bytes) }
  catch { return undefined } // A partial or corrupted derived file is never a source of world facts.
  const parsed = inspectionIndexSchema.safeParse(value)
  if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(source)) return undefined
  return parsed.data
}

/**
 * Publish a fully validated reference index using a same-directory atomic rename.
 * @param directory - Existing private owner directory; never creates run history.
 * @param index - Complete validated derived prefix.
 * @param authorize - Optional live admission fence rechecked after staging IO.
 * @returns after durable file data and directory publication. Pre-rename failures retain the previous file;
 * a directory-sync failure requires rereading publication.
 */
export async function publishInspectionIndex(directory: string, index: InspectionIndex, authorize: () => void = () => {}): Promise<void> {
  const bytes = JSON.stringify(inspectionIndexSchema.parse(index)) + '\n'
  const temporary = join(directory, `.inspection-index-${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    try { await file.writeFile(bytes); await file.sync() }
    finally { await file.close() }
    authorize()
    await rename(temporary, join(directory, 'inspection-index.json'))
    // Windows cannot open directories read-only; its rename still atomically replaces this rebuildable derivative.
    /* v8 ignore next -- Windows platform matrix owns the namespace-sync fallback. */
    if (process.platform === 'win32') return
    const directoryHandle = await open(directory, 'r')
    try { await directoryHandle.sync() }
    finally { await directoryHandle.close() }
  } finally {
    try { await unlink(temporary) }
    catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
}
