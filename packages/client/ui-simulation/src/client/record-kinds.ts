/** Read labels describe journal categories, not the success of the business action inside a record. */
import type { Key } from './locales.ts'

/** Known native journal families; extensions remain searchable by their exact raw kind. */
export const recordKinds = [
  ['run/created', 'recordType.created'], ['run/phase', 'recordType.phase'],
  ['run/checkpoint', 'recordType.checkpoint'], ['run/management', 'recordType.management'],
  ['run/channel-reserved', 'recordType.channelReserved'], ['run/channel-confirmed', 'recordType.channelConfirmed'],
  ['run/participant-reserved', 'recordType.participantReserved'], ['run/team-reserved', 'recordType.teamReserved'],
  ['run/team-confirmed', 'recordType.teamConfirmed'], ['run/change', 'recordType.change'],
  ['run/writer', 'recordType.writer'], ['run/business', 'recordType.business'],
  ['run/scheduler', 'recordType.scheduler'], ['run/outbox', 'recordType.outbox'],
] as const satisfies readonly (readonly [string, Key])[]

/**
 * Label complete known native kinds while preserving extension identities.
 * @param kind - Authorized kind text, without whitespace normalization.
 * @param t - Current locale.
 * @param truncated - Whether the full kind is withheld.
 * @returns a known label or unchanged extension/prefix text.
 */
export function recordKindLabel(kind: string, t: (key: Key) => string, truncated = false): string {
  if (truncated) return kind
  const entry = recordKinds.find(([value]) => value === kind)
  return entry === undefined ? kind : t(entry[1])
}
