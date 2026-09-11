/**
 * Function plugin registering the version-one through version-four direct
 * Team-channel adapters. It owns only protocol validation and delivery
 * planning; Team persistence and delivery execution remain with their
 * respective providers.
 *
 * @module @clocky/clocky-team-channel-direct
 */

import type { Context } from '@clocky/cordis'
import { directChannelAdapter, directChannelV2Adapter, directChannelV3Adapter, directChannelV4Adapter } from './direct.ts'
import {
  DIRECTED_VIEW_POLICY,
  FULL_TRANSCRIPT_VIEW_POLICY,
  RECENT_WINDOW_VIEW_POLICY,
  SUMMARIZED_WINDOW_VIEW_POLICY,
} from './view.ts'

export {
  DIRECT_CHANNEL_ADAPTER_V1,
  DIRECT_CHANNEL_ADAPTER_V2,
  DIRECT_CHANNEL_ADAPTER_V3,
  DIRECT_CHANNEL_ADAPTER_V4,
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
  DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
  DIRECT_CHANNEL_TYPE,
  DIRECT_CHANNEL_VERSION_V1,
  DIRECT_CHANNEL_VERSION_V2,
  DIRECT_CHANNEL_VERSION_V3,
  DIRECT_CHANNEL_VERSION_V4,
  directChannelAdapter,
  directChannelV2Adapter,
  directChannelV3Adapter,
  directChannelV4Adapter,
  directChannelV4Recipients,
  directChannelV3Peer,
  directProductChannelPeer,
  parseDirectChannelV3Manifest,
  parseDirectChannelV3MessagePayload,
  parseDirectChannelV4Manifest,
  parseDirectChannelV4MessagePayload,
  parseDirectProductChannelManifest,
  directChannelV2Peer,
  parseDirectChannelV2Manifest,
} from './direct.ts'
export {
  DIRECTED_VIEW_POLICY,
  FULL_TRANSCRIPT_VIEW_POLICY,
  RECENT_WINDOW_VIEW_POLICY,
  SUMMARIZED_WINDOW_VIEW_POLICY,
} from './view.ts'
export type {
  DirectChannelHumanContentBlock,
  DirectChannelHumanImageBlock,
  DirectChannelHumanTextBlock,
  DirectChannelV2Manifest,
  DirectChannelV3Manifest,
  DirectChannelV3MessagePayload,
  DirectChannelV4Manifest,
  DirectChannelV4MessagePayload,
  DirectProductChannelManifest,
} from './direct.ts'

/** Cordis plugin name. */
export const name = 'team-channel-direct'
/** The Team adapter registry must exist before this protocol registers. */
export const inject = ['teams']

/**
 * Register all direct-channel protocol versions on the Team runtime. The
 * runtime scopes each registration to the calling plugin fiber and removes it
 * on HMR or disposal.
 * @param ctx - context carrying the Team runtime adapter registry.
 */
export function apply(ctx: Context): void {
  ctx.teams.registerAdapter(directChannelAdapter)
  ctx.teams.registerAdapter(directChannelV2Adapter)
  ctx.teams.registerAdapter(directChannelV3Adapter)
  ctx.teams.registerAdapter(directChannelV4Adapter)
  ctx.teams.registerViewPolicy(DIRECTED_VIEW_POLICY)
  ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
  ctx.teams.registerViewPolicy(RECENT_WINDOW_VIEW_POLICY)
  ctx.teams.registerViewPolicy(SUMMARIZED_WINDOW_VIEW_POLICY)
}
