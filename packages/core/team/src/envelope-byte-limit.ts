/** Typed pre-append Envelope byte refusal and draft identity. @module @clocky/clocky-team/envelope-byte-limit */
import { TeamError } from './error.ts'
import { fingerprintTeamPersistenceProjection } from './human-actor.ts'
import { jsonValueSchema, teamEnvelopeByteLimitDetailsSchema, teamEnvelopeDraftSchema } from './schema.ts'
import type { TeamEnvelopeByteLimitDetails, TeamEnvelopeDraft } from './types.ts'

/**
 * Read only a direct Hub refusal carrying complete strict post identity and byte evidence.
 * @param error - Provider error; generic invalid arguments and aggregate causes do not prove this rejection.
 * @returns validated pre-append refusal, or undefined when its code or evidence does not match.
 */
export function envelopeByteLimitDetails(error: unknown): TeamEnvelopeByteLimitDetails | undefined {
  if (!(error instanceof TeamError) || error.code !== 'TEAM_INVALID_ARGUMENT') return undefined
  const parsed = teamEnvelopeByteLimitDetailsSchema.safeParse(error.details)
  return parsed.success ? parsed.data : undefined
}

/**
 * Bind all strict caller-owned draft fields without Hub-generated Envelope identity or time.
 * @param draft - Original post draft; absent priority is equivalent to explicit normal priority.
 * @returns canonical SHA-256 identity; invalid fields reject and optional undefined fields are omitted.
 */
export function fingerprintTeamEnvelopeDraft(draft: TeamEnvelopeDraft): string {
  const parsed = teamEnvelopeDraftSchema.parse(draft)
  const value = jsonValueSchema.parse(JSON.parse(JSON.stringify({ ...parsed, priority: parsed.priority ?? 'normal' })))
  return fingerprintTeamPersistenceProjection(value)
}
