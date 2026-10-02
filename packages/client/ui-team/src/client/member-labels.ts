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


/** Select the same bounded overview members for rendering and readiness reads.
 * @param state - Team selection containing the independently resolved coordinator.
 * @param members - Loaded member labels.
 * @returns at most four participating non-human member labels.
 */
export function overviewMemberLabels(state: TeamTaskSelection['state'], members: readonly MemberLabel[]): readonly MemberLabel[] {
  return memberLabels(state, members).filter(member => member.kind !== 'human' && member.phase !== 'left')
    .sort((a, b) => Number(b.role === 'coordinator') - Number(a.role === 'coordinator')).slice(0, 4)
}

/** Resolve display names without treating a missing member page as unassignment.
 * @param id - Authoritative participant reference, if assigned.
 * @param loadedName - Name from the current authorized member window.
 * @param identities - Independent runtime identity observation.
 * @param translate - Localized assignment and availability labels.
 * @returns an authorized name, explicit unavailable state or assigned-ID fallback.
 */
export function referencedMemberName(id: string | undefined, loadedName: string | undefined,
  identities: import('@clocky/clocky-client-runtime/client').TeamIdentityState | undefined,
  translate: (key: import('./locales.ts').TeamKey, vars?: Record<string, unknown>) => string): string {
  if (id === undefined) return translate('detail.task.unassigned')
  if (identities?.forbidden) return translate('identity.unavailable')
  const resolved = identities?.items.find(item => item.participantId === id)
  if (resolved?.state === 'unavailable') return translate('identity.unavailable')
  if (resolved?.state === 'resolved') {
    const name = resolved.displayName.text + (resolved.displayName.truncated ? '…' : '')
    return resolved.phase === 'left' ? translate('identity.left', { name }) : name
  }
  return loadedName ?? translate('detail.task.assignedId', { id })
}
