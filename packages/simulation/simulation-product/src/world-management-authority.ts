/** A current authenticated policy and a stable canonical source observation accompany each Native queue admission. */
import { createHash } from 'node:crypto'
import stringify from 'fast-json-stable-stringify'
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall, ProductPrincipalId } from '@clocky/clocky-product-principal'
import type { SimulationEntityId, SimulationSnapshot, PersonnelObligationReport, SimulationInspectionSelection } from '@clocky/clocky-simulation'
import { PERSONNEL_OBLIGATION_MAX_ITEMS, PERSONNEL_OBLIGATION_MAX_BYTES } from '@clocky/clocky-simulation'
import type { SimulationWorldManagementAction, SimulationWorldManagementAuthority,
  SimulationWorldManagementFundingAuthority, SimulationWorldManagementPreview } from '@clocky/clocky-simulation/world-management-types'
import type { TeamEvent, TeamId, ChannelId } from '@clocky/clocky-team/types'
import { SimulationProductError } from './index.ts'

/** Explicit delegation to a real Native funds controller; no controller is inferred from a role or account. */
export interface WorldManagementFundingDelegation {
  readonly principalId: ProductPrincipalId
  readonly controllerEntityId: SimulationEntityId
}
/**
 * Hash business JSON with the same stable serialization used by Native validated actions.
 * @param value - Complete validated business input or source observation.
 * @returns algorithm-prefixed SHA-256 commitment to those exact values.
 */
export function worldManagementFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stringify(value)).digest('hex')}`
}

/**
 * Explain actual canonical responsibilities under the report fingerprint already committed by the Native quote.
 * @param action - Exact action whose selected assignment is excluded by its inventory selector.
 * @param report - Complete or explicitly incomplete current Native/Team/Channel inventory.
 * @param native - Original Native quote, including exact role relations its own settlement can close.
 * @returns distinct later settlement requirements; these describe responsibility and never grant admission or cleanup.
 */
export function worldManagementSettlement(action: SimulationWorldManagementAction, report: PersonnelObligationReport | undefined,
  native: SimulationWorldManagementPreview): SimulationWorldManagementPreview['settlementRequirements'] {
  if (action.kind === 'hire-existing' || action.kind === 'hiring-market') return native.settlementRequirements
  if (report === undefined) throw unavailable('Personnel change requires its original obligation report')
  const closing = new Set(native.impact !== null && 'authorityRelationIds' in native.impact ? native.impact.authorityRelationIds : [])
  const requirements = new Set(native.settlementRequirements)
  for (const item of report.items) {
    if (item.ref.kind === 'relation' && closing.has(item.ref.id)) continue
    if (item.dispositions.includes('handoff-required')) requirements.add('handoff-required')
    else requirements.add('existing-obligations')
  }
  return [...requirements]
}
/** Installed owner policy is distinct from current transport credentials and cannot be supplied by a command payload. */
export interface WorldManagementPolicy {
  readonly ownerPrincipalId: ProductPrincipalId
  readonly fundingDelegations: readonly WorldManagementFundingDelegation[]
  readonly maxBytes: number
  readonly authorize: () => void
  /** Synchronous current prefix; absent for a read-only provider preview. */
  readonly snapshot?: (() => SimulationSnapshot) | undefined
}
/**
 * Observe the real canonical inventory while retaining a finite local event fence through Native admission.
 * @param ctx - Product-owned Native, Team and event readers; no private source body is requested.
 * @param selection - Exact original registered Native identity/spec.
 * @param initial - Original Native prefix with the selected person and canonical binding.
 * @param action - Complete resolved action whose hash must remain identical at the Native queue position.
 * @param call - Actual authenticated principal and credential lifetime, independent of the original command ID.
 * @param policy - Current installed management and funds delegation policy.
 * @returns paired source snapshot/report, revocable synchronous authority and idempotent listener disposal.
 */
export async function observeWorldManagementAuthority(ctx: Context, selection: SimulationInspectionSelection,
  initial: SimulationSnapshot, action: SimulationWorldManagementAction, call: AuthenticatedProductCall,
  policy: WorldManagementPolicy): Promise<{
  readonly state: SimulationSnapshot
  readonly report: PersonnelObligationReport | undefined
  readonly authority: SimulationWorldManagementAuthority
  readonly dispose: () => void
}> {
  policy.authorize()
  if (action.kind === 'hiring-market') {
    // Finite draft edits change no person or Team obligation; only the exact Native prefix and user policy are sources.
    let disposed = false
    const policyRef = 'clocky.world-owner-management/1'
    const policyGeneration = worldManagementFingerprint({ policyRef, owner: policy.ownerPrincipalId,
      fundingDelegations: policy.fundingDelegations })
    return { state: initial, report: undefined, dispose: () => { disposed = true }, authority: { resolve: () => {
      try { policy.authorize() }
      catch { return undefined /* Revoked user authority cannot authorize an original Native review. */ }
      if (disposed || call.signal.aborted || call.principal.id !== policy.ownerPrincipalId
        || policy.snapshot !== undefined && policy.snapshot().revision !== initial.revision) return undefined
      return { source: { kind: 'authenticated-user', principalId: call.principal.id, credentialGeneration: call.credentialGeneration,
        policyRef, policyGeneration }, actionHash: worldManagementFingerprint(action),
      sourceFingerprint: worldManagementFingerprint({ nativeRevision: initial.revision, action }), sourceComplete: true, funding: null }
    } } }
  }
  const selected = initial.entities[action.payload.personId]
  if (selected?.kind !== 'person' || selected.binding === undefined)
    throw unavailable('World management requires its original canonical person binding')
  const binding = selected.binding
  const channels = new Set<ChannelId>()
  let moved = false, disposed = false
  const sourceMoved = (): boolean => moved
  const stopTeam = ctx.on('team/changed', (event) => { if (teamOf(event) === binding.teamId) moved = true })
  const stopChannel = ctx.on('channel/changed', (event) => { if (channels.has(event.channelId)) moved = true })
  const dispose = () => { if (!disposed) { disposed = true; stopTeam(); stopChannel() } }
  try {
    const team = await ctx.teams.getTeam({ teamId: binding.teamId })
    policy.authorize()
    if (sourceMoved()) throw stale('World management Team membership changed during observation')
    for (const id of team.channelIds) channels.add(id)
    const selector = action.kind === 'hire-existing' ? { kind: 'person' as const, personId: selected.id, personRevision: selected.revision }
      : { kind: 'assignment' as const, personId: selected.id, personRevision: selected.revision,
        assignmentId: action.payload.assignmentId, assignmentRevision: action.payload.assignmentRevision }
    const observed = await ctx.simulationTeams.inspectPersonnelObligations(selection, { selector, limit: PERSONNEL_OBLIGATION_MAX_ITEMS,
      maxBytes: Math.min(policy.maxBytes, PERSONNEL_OBLIGATION_MAX_BYTES) }, call.signal)
    policy.authorize()
    if (observed === undefined || sourceMoved()) throw stale('World management sources moved during their observation')
    const state = observed.snapshot, report = observed.report
    const policyRef = 'clocky.world-owner-management/1'
    const policyGeneration = worldManagementFingerprint({ policyRef, owner: policy.ownerPrincipalId,
      fundingDelegations: policy.fundingDelegations })
    const sourceFingerprint = worldManagementFingerprint({ nativeRevision: state.revision, report })
    const delegated = policy.fundingDelegations.filter(value => value.principalId === call.principal.id)
    if (delegated.length > 1) throw unavailable('World management funding policy has ambiguous controller delegation')
    const funding: SimulationWorldManagementFundingAuthority | null = delegated[0] === undefined ? null
      : { kind: 'native-controller', entityId: delegated[0].controllerEntityId, policyRef, policyGeneration }
    const authority: SimulationWorldManagementAuthority = { resolve: () => {
      try { policy.authorize() }
      catch { return undefined /* The Native owner receives refusal only; public transport authorization keeps its own typed error. */ }
      if (disposed || moved || call.signal.aborted || call.principal.id !== policy.ownerPrincipalId
        || policy.snapshot !== undefined && policy.snapshot().revision !== state.revision) return undefined
      return { source: { kind: 'authenticated-user', principalId: call.principal.id, credentialGeneration: call.credentialGeneration,
        policyRef, policyGeneration }, actionHash: worldManagementFingerprint(action), sourceFingerprint,
      sourceComplete: report.complete, funding }
    } }
    return { state, report, authority, dispose }
  } catch (error) { dispose(); throw error }
}
function teamOf(event: TeamEvent): TeamId {
  if ('teamId' in event) return event.teamId
  if ('team' in event) return event.team.id
  if ('goal' in event) return event.goal.teamId
  if ('participant' in event) return event.participant.teamId
  if ('binding' in event) return event.binding.activation.teamId
  if ('interrupt' in event) return event.interrupt.target.teamId
  if ('action' in event) return event.action.teamId
  if ('plan' in event) return event.plan.teamId
  if ('task' in event) return event.task.teamId
  if ('observation' in event) return event.observation.teamId
  if ('allocation' in event) return event.allocation.teamId
  return assertNever(event)
}
function assertNever(value: never): never { throw new Error(`Unknown management source event: ${String(value)}`) }
function stale(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_STALE') }
function unavailable(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE') }
