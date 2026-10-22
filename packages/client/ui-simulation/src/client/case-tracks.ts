/** Four independently projected Host facts; names, chat and run-wide stops never supply state. */
import type { SimulationProductWorldCaseDetail } from '@clocky/clocky-client-runtime/client'
import type { CommandProps } from './command-props.ts'
import type { Track, TrackNodeState } from './world-domain.ts'

/**
 * Format one exact Native-prefix lifecycle through the shared track primitive.
 * @param summary - Host metadata, independent of body and Persona grants.
 * @param t - Current product locale.
 * @returns four named tracks without inferring business or delivery from callback confirmation.
 */
export function caseTracks(summary: SimulationProductWorldCaseDetail['summary'], t: CommandProps['t']): readonly Track[] {
  const { request, plan, execution, notification } = summary.lifecycle
  const track = (kind: Track['kind'], state: TrackNodeState, text: string): Track => ({
    kind, steps: [{ id: kind, label: text, state }], summary: text,
  })
  const requestClosed = request.status === 'committed' || request.status === 'rejected' || request.status === 'cancelled'
  const requestTrack = track('request', requestClosed ? 'done' : request.status === 'open' ? 'active' : 'waiting',
    requestClosed ? t('cases.track.requestClosed') : t(`cases.status.${request.status}`))
  const planTrack = plan.status === 'none' ? track('plan', 'pending', t('cases.track.planNone'))
    : track('plan', plan.status === 'stale' ? 'blocked' : plan.resolution === 'awaiting-evidence' ? 'waiting' : 'done',
      `${t(`cases.plan.${plan.status}`)} · ${t(`cases.resolution.${plan.resolution}`)}`)
  const callback = execution.callback, business = execution.business
  const result = business.status === 'none' ? t('cases.noResult') : t(`cases.status.${business.status}`)
  const executionTrack = callback.status === 'none'
    ? track('execution', business.status === 'none' ? 'pending' : business.status === 'rejected' ? 'rejected' : 'done',
      business.status === 'none' ? t('cases.track.executionNone') : result)
    : track('execution', callback.status === 'outcome-unknown' ? 'unknown' : callback.status === 'blocked' ? 'blocked' : 'done',
      `${t(`cases.execution.${callback.status}`)} · ${result}`)
  const post = notification.result?.post ?? notification.request
  let notificationTrack: Track
  if (notification.result !== undefined && notification.result.post === undefined) {
    notificationTrack = track('notification', notification.request === null && notification.result.wake.status === 'completed' ? 'done' : 'waiting',
      t(notification.request === null ? 'cases.scenarioNoResultPost' : 'cases.noPost'))
  } else if (post === null) notificationTrack = track('notification', 'pending',
    t(summary.origin.kind === 'authenticated-user' ? 'cases.userNoRequestPost' : 'cases.scenarioNoRequestPost'))
  else {
    const state = post.publication === 'unknown' ? 'unknown' : post.status === 'rejected' ? 'rejected'
      : post.status === 'blocked-authority' || post.status === 'blocked-dependency' ? 'blocked'
        : post.publication === 'in-flight' ? 'active' : post.publication === 'unpublished' ? 'pending'
          : post.delivery === 'received' ? 'done' : 'waiting'
    notificationTrack = track('notification', state,
      `${t(`cases.publication.${post.publication}`)} · ${t(`cases.delivery.${post.delivery}`)}`)
  }
  return [requestTrack, planTrack, executionTrack, notificationTrack]
}
