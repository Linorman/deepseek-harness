/** Immutable admission anchors keep receipt lookups independent of compacted display history. */
import type { Context } from '@clocky/cordis'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { TeamError, teamHumanInboxFinalSchema, teamHumanInboxMessageSchema, teamHumanInboxActionSchema } from '@clocky/clocky-team'
import type { EnvelopeId, TeamHumanActionId, TeamHumanInboxItem } from '@clocky/clocky-team'
import type { LogStream } from '@clocky/clocky-storage-log'

/** Final lookup carries proposed text for digest validation; delivery identity retains action revision identity. */
export type InboxAdmissionKey = Pick<TeamHumanInboxItem, 'principalId' | 'teamId'> & (
  { readonly kind: 'final'; readonly envelopeId: EnvelopeId; readonly text: string }
  | { readonly kind: 'message'; readonly envelopeId: EnvelopeId }
  | { readonly kind: 'action'; readonly action: { readonly id: TeamHumanActionId; readonly updatedAt: number } }
)

const finalAnchorSchema = teamHumanInboxFinalSchema.omit({ text: true }).extend({
  textSha256: z.string().regex(/^[a-f0-9]{64}$/u),
})
const anchorSchema = z.discriminatedUnion('kind', [finalAnchorSchema, teamHumanInboxMessageSchema, teamHumanInboxActionSchema])

function textDigest(text: string): string {
  // JSON encoding preserves distinct lone UTF-16 surrogates that UTF-8 encoding alone replaces.
  return createHash('sha256').update(JSON.stringify(text), 'utf8').digest('hex')
}

function anchorValue(item: TeamHumanInboxItem) {
  if (item.kind !== 'final') return item
  const { text, ...metadata } = item
  return { ...metadata, textSha256: textDigest(text) }
}

/** Measure the complete stored anchor, including digest metadata for short final text.
 * @param item - Committed inbox record selected for retention.
 * @returns UTF-8 bytes of the serialized admission anchor.
 */
export function inboxAdmissionBytes(item: TeamHumanInboxItem): number {
  return Buffer.byteLength(JSON.stringify(anchorValue(item)), 'utf8')
}

function identity(key: InboxAdmissionKey): string {
  return JSON.stringify(key.kind === 'action'
    ? [key.principalId, key.kind, key.teamId, key.action.id, key.action.updatedAt]
    : [key.principalId, key.kind, key.teamId, key.envelopeId])
}

/** Compare the complete principal and delivery identity, including action revision.
 * @param item - Validated durable admission.
 * @param key - Requested admission identity.
 * @returns Whether this record belongs to the exact requested admission.
 */
export function isInboxAdmission<Key extends InboxAdmissionKey>(item: TeamHumanInboxItem,
  key: Key): item is Extract<TeamHumanInboxItem, { kind: Key['kind'] }> {
  return identity(item) === identity(key)
}

function descriptor(key: InboxAdmissionKey) {
  const principal = createHash('sha256').update(key.principalId).digest('hex')
  const admission = createHash('sha256').update(identity(key)).digest('hex')
  return { name: `principal-inbox-admission/${principal}/${admission}`, version: 2 }
}

async function read<Key extends InboxAdmissionKey>(stream: LogStream, key: Key): Promise<Extract<TeamHumanInboxItem, { kind: Key['kind'] }> | undefined> {
  const rows = await stream.read(-1, 2)
  if (rows.length === 0 && stream.tailSequence === -1) return undefined
  const row = rows[0]
  if (rows.length !== 1 || row?.sequence !== 0 || stream.tailSequence !== 0) {
    throw new TeamError('Principal admission index must contain one immutable record', 'TEAM_INVALID_ARGUMENT')
  }
  const anchor = anchorSchema.parse(row.value)
  if (anchor.kind === 'final') {
    if (key.kind !== 'final') throw new TeamError('Principal admission index identity does not match its key', 'TEAM_INVALID_ARGUMENT')
    const { textSha256, ...metadata } = anchor
    const item = { ...metadata, text: key.text }
    if (!isInboxAdmission(item, key)) throw new TeamError('Principal admission index identity does not match its key', 'TEAM_INVALID_ARGUMENT')
    if (textDigest(key.text) !== textSha256) throw new TeamError('Principal delivery retry changed its exact final content', 'TEAM_FINAL_INVALID')
    return item
  }
  const item = anchor
  if (!isInboxAdmission(item, key)) throw new TeamError('Principal admission index identity does not match its key', 'TEAM_INVALID_ARGUMENT')
  return item
}

/** Read an exact admission anchor; the caller serializes access with its principal inbox.
 * @param ctx - Routed log owner.
 * @param key - Exact principal and delivery identity selected by the authorized caller.
 * @returns The original admission, reconstructing final text only after digest validation, or undefined before indexing.
 */
export async function readInboxAdmission<Key extends InboxAdmissionKey>(ctx: Context, key: Key): Promise<Extract<TeamHumanInboxItem, { kind: Key['kind'] }> | undefined> {
  const stream = await ctx.storageLog.open(descriptor(key))
  try { return await read(stream, key) }
  finally { await stream.close() }
}

/** Persist an original admission under the caller's principal-inbox serializer before compaction removes its row.
 * @param ctx - Routed log owner.
 * @param item - Committed, validated inbox record with its original sequence.
 * @returns Completion after the immutable anchor is durable; final text is represented by its digest and changed retries reject.
 */
export async function indexInboxAdmission(ctx: Context, item: TeamHumanInboxItem): Promise<void> {
  const stream = await ctx.storageLog.open(descriptor(item))
  try {
    const existing = await read(stream, item)
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, item)) throw new TeamError('Principal admission index content is immutable', 'TEAM_INVALID_ARGUMENT')
      return
    }
    await stream.append(-1, [anchorValue(item)])
  } finally { await stream.close() }
}
