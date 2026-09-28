/** Owner-issued durable positions for cross-stream checkpoint collection. @module @clocky/clocky-team/persistence-reference */
import { z } from 'zod'
import { teamIdSchema, channelIdSchema } from './schema.ts'
import type { Branded } from '@clocky/clocky-brand'

/** Select one Team-owned stream at the exact cursor already observed by the collector. */
export const teamPersistenceReferenceRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('team'), teamId: teamIdSchema, expectedCursor: z.number().int().nonnegative(), prefixCursor: z.number().int().nonnegative().optional() }),
  z.strictObject({ kind: z.literal('channel'), channelId: channelIdSchema, expectedCursor: z.number().int().nonnegative(), prefixCursor: z.number().int().nonnegative().optional() }),
])
/** Exact owner and cursor to capture; the read does not pin history or stop future writes. */
export type TeamPersistenceReferenceRequest = z.infer<typeof teamPersistenceReferenceRequestSchema>
/** Hash of the owner's full durable projection in canonical JSON form. */
export type TeamPersistenceFingerprint = Branded<'TeamPersistenceFingerprint'>
/** Actual stream identity and retained prefix, captured with the corresponding projection under its owner queue. */
export interface TeamPersistenceReference {
  readonly owner: Omit<Extract<TeamPersistenceReferenceRequest, { kind: 'team' }>, 'expectedCursor' | 'prefixCursor'>
    | Omit<Extract<TeamPersistenceReferenceRequest, { kind: 'channel' }>, 'expectedCursor' | 'prefixCursor'>
  readonly stream: { readonly name: string; readonly version: number }
  /** Full history means this owner refuses destructive prefix compaction. */
  readonly retention: 'full' | 'compactable'
  readonly cursor: number
  readonly firstSequence: number
  readonly projectionVersion: number
  readonly fingerprint: TeamPersistenceFingerprint
}
