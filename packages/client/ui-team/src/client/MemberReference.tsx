/** Authorized display names link to the same member inspector across Team views. */
import { Avatar, Button, HoverCard } from '@clocky/clocky-client-ui-primitives'
import type { ParticipantId, TeamIdentityState } from '@clocky/clocky-client-runtime/client'
import { referencedMemberName } from './member-labels.ts'
import type { TeamKey } from './locales.ts'
import css from './TeamWorkspace.module.css'

/** Render an assigned identity without inferring unassignment from missing names.
 * @param props - Exact reference, authorized names and optional inspection action.
 * @returns a named inspection button, unavailable identity or unassigned label.
 */
export function MemberReference({ id, loadedName, identities, inspect, translate, className }: {
  id: ParticipantId | undefined
  loadedName?: string | undefined
  identities?: TeamIdentityState | undefined
  inspect?: ((id: ParticipantId) => void) | undefined
  translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  className?: string | undefined
}) {
  const label = referencedMemberName(id, loadedName, identities, translate)
  const identity = identities?.forbidden === true ? undefined : identities?.items.find(item => item.participantId === id)
  const unavailable = identities?.forbidden || identity?.state === 'unavailable'
  if (id === undefined || inspect === undefined || unavailable) return <>{label}</>
  const button = <Button size="sm" variant="ghost" className={className} onClick={() => { inspect(id) }}>{label}</Button>
  // A resolved identity previews who this is before the inspector opens.
  return identity?.state === 'resolved'
    ? <HoverCard anchor={button} content={<span className={css.memberPreview} data-member-preview>
      <Avatar name={identity.displayName.text} size={24} decorative />
      <span><strong>{identity.displayName.text}</strong><small>{translate(`detail.participant.phase.${identity.phase}`)}</small></span>
    </span>} />
    : button
}
