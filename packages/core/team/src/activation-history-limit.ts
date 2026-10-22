/** Historical activation refusal classification. @module @clocky/clocky-team/activation-history-limit */
import { TeamError } from './error.ts'
import { teamActivationHistoryLimitDetailsSchema } from './schema.ts'
import type { TeamActivationHistoryLimitDetails } from './types.ts'

/**
 * Read only the original typed refusal or a controller's explicit cleanup outcome.
 * @param error - Direct provider/controller error; aggregate causes are never treated as cleanup evidence.
 * @returns validated refusal details, or undefined for another code or malformed evidence.
 */
export function activationHistoryLimitDetails(error: unknown): TeamActivationHistoryLimitDetails | undefined {
  if (!(error instanceof TeamError) || error.code !== 'TEAM_CHANNEL_BACKPRESSURE') return undefined
  const parsed = teamActivationHistoryLimitDetailsSchema.safeParse(error.details)
  return parsed.success ? parsed.data : undefined
}
