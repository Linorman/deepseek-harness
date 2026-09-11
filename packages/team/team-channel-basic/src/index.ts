/** Consult and discussion Team-channel adapter provider. @module @clocky/clocky-team-channel-basic */

import type { Context } from '@clocky/cordis'
import { consultChannelAdapter, discussionChannelAdapter } from './basic.ts'

export {
  resolveConsultTextDraft,
  CONSULT_CHANNEL_ADAPTER,
  CONSULT_CHANNEL_ADAPTER_V1,
  CONSULT_CHANNEL_TYPE,
  CONSULT_CHANNEL_VERSION,
  CONSULT_CHANNEL_VERSION_V1,
  CONSULT_INITIATOR_ROLE,
  CONSULT_REQUEST_KIND,
  CONSULT_REVIEW_REQUEST_KIND,
  CONSULT_RESPONDENT_ROLE,
  CONSULT_RESPONSE_KIND,
  DISCUSSION_CHANNEL_ADAPTER,
  DISCUSSION_CHANNEL_ADAPTER_V1,
  DISCUSSION_CHANNEL_TYPE,
  DISCUSSION_CHANNEL_VERSION,
  DISCUSSION_CHANNEL_VERSION_V1,
  DISCUSSION_MAX_TURNS_LIMIT,
  DISCUSSION_SPEAKER_POLICY_LIMIT,
  consultChannelAdapter,
  discussionChannelAdapter,
  parseConsultChannelManifest,
  parseConsultTextPayload,
  parseConsultReviewAssignmentPayload,
  parseConsultReviewResponsePayload,
  parseDiscussionChannelManifest,
  parseDiscussionTextPayload,
} from './basic.ts'
export type { ConsultTextDraftInput, ConsultTextRequestAnchor, ConsultChannelManifest, ConsultReviewAssignmentPayload, ConsultReviewResponsePayload, DiscussionChannelManifest, DiscussionSpeakerPolicy } from './basic.ts'

/** Cordis plugin name. */
export const name = 'team-channel-basic'
/** The Team adapter registry must exist before these protocols register. */
export const inject = ['teams']

/** Register consult and discussion adapters on the active Team runtime. */
export function apply(ctx: Context): void {
  ctx.teams.registerAdapter(consultChannelAdapter)
  ctx.teams.registerAdapter(discussionChannelAdapter)
}
