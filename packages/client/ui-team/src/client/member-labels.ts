/** Display and form identities from the current member page and the independently resolved coordinator. */
import type { TeamCollectionsState, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'

/** Exact mutation identities with display-only names; no grants or execution history. */
export type MemberLabel = Pick<TeamCollectionsState['members']['items'][number], 'id' | 'kind' | 'phase' | 'role'> & { readonly displayName: string }

/** Preserve the resolved coordinator even when it is outside the current member window.
 * @param state - Bounded authoritative Team selection.
 * @param members - Current member page.
 * @returns loaded member labels and at most one additional coordinator.
 */
export function memberLabels(state: TeamTaskSelection['state'], members: readonly MemberLabel[]): readonly MemberLabel[] {
  const coordinator = state.coordinator
  if (coordinator.kind !== 'bound' || members.some(member => member.id === coordinator.binding.activation.participantId)) return members
  return [...members, { id: coordinator.binding.activation.participantId, kind: coordinator.participantKind,
    phase: coordinator.participantPhase, displayName: coordinator.name.text, role: 'coordinator' }]
}

/** Convert display prefixes without changing protocol roles or member identities.
 * @param members - The current summary page.
 * @returns labels without any member execution history.
 */
export function memberPageLabels(members: TeamCollectionsState['members']['items']): readonly MemberLabel[] {
  return members.map(member => ({ id: member.id, kind: member.kind, phase: member.phase,
    role: member.role, displayName: member.displayName.text }))
}
