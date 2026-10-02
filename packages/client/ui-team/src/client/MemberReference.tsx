/** Authorized display names link to the same member inspector across Team views. */
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { ParticipantId, TeamIdentityState } from '@clocky/clocky-client-runtime/client'
import { referencedMemberName } from './member-labels.ts'
import type { TeamKey } from './locales.ts'

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
  const unavailable = identities?.forbidden || identities?.items.find(item => item.participantId === id)?.state === 'unavailable'
  return id !== undefined && inspect !== undefined && !unavailable
    ? <Button size="sm" variant="ghost" className={className} onClick={() => { inspect(id) }}>{label}</Button>
    : <>{label}</>
}
