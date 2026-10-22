/** Read-only administrative prerequisites derive from native ownership, lifecycle and retained command capacity. */
import type { SimulationSnapshot, SimulationOwnerObservation } from '@clocky/clocky-simulation'
import type { SimulationProductText } from './types.ts'
import type { SimulationProductAdministrationControl, SimulationProductMaintenanceReason } from './control-types.ts'
import type { SimulationWorldBranchCreation } from './experiment-store.ts'
import type { SimulationCreation, SimulationCompanyCreation } from './creation-types.ts'
import { simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { resolveScenarioTopology } from './scenario-topology.ts'

/** Current product facts used by the administrative projection, without taking ownership. */
export interface MaintenanceControlFacts {
  readonly nativeOwner: SimulationOwnerObservation
  readonly held: boolean
  readonly unstarted: boolean
  readonly driver: 'retiring' | 'checkpointing' | 'other'
  readonly pending: boolean
  /** Original World user or cancellation work; it does not turn into preparation or disable pause. */
  readonly management?: boolean | undefined
  /** Current callbacks must drain before replacing the owner; retained unknown originals may be explicitly restored. */
  readonly managementActive?: boolean | undefined
  readonly capacity: boolean
  readonly ingressLimit: number
}
/**
 * Project administrative actions and original allowed ingress targets from a single native observation.
 * @param creation - Immutable registered scenario selection.
 * @param state - Current authoritative world, or missing native history.
 * @param facts - Live product owner and retained command admission facts.
 * @param text - Bounded public display-name projection.
 * @returns hints and redacted original recovery anchor; each operation rechecks its native admission.
 */
export function maintenanceControl(creation: SimulationCreation | SimulationCompanyCreation | SimulationWorldBranchCreation,
  state: SimulationSnapshot | undefined,
  facts: MaintenanceControlFacts, text: (value: string) => SimulationProductText): SimulationProductAdministrationControl {
  const latest = state?.latestCheckpointId === undefined ? undefined : state.checkpoints?.[state.latestCheckpointId]
  const world = 'kind' in creation && creation.kind !== 'company'
  const anchor = latest?.status === 'completed' && latest.manifest.implementationVersion === (world ? 'world/1' : 'company/1') ? latest : undefined
  const base: SimulationProductMaintenanceReason = facts.pending ? 'preparation-in-progress'
    : !facts.capacity ? 'request-capacity' : 'ready'
  const ownership = facts.nativeOwner === 'other-owner' || facts.nativeOwner === 'unavailable' ? 'ownership-unavailable' : base
  const checkpoint = base !== 'ready' ? base : facts.management ? 'management-in-progress' : !facts.held ? 'recovery-required' : facts.driver === 'retiring' ? 'retiring'
    : facts.driver === 'checkpointing' || Object.values(state?.checkpoints ?? {}).some(value => value.status === 'in-progress')
      ? 'checkpoint-in-progress' : Object.values(state?.management ?? {}).some(value => value.status === 'in-progress')
        ? 'management-in-progress' : 'ready'
  const restore = ownership !== 'ready' ? ownership : facts.managementActive ? 'management-in-progress' : anchor === undefined ? 'checkpoint-required' : 'ready'
  const unstarted = state === undefined || state.phase === 'paused' && state.time === '0'
    && Object.keys(state.decisions).length === 0 && Object.keys(state.operations).length === 0
    && Object.keys(state.ingresses ?? {}).length === 0 && Object.values(state.entities).every(entity => entity.writer === undefined)
  const prepare = 'kind' in creation && creation.kind === 'world-branch' ? 'scenario-progressed' : ownership !== 'ready' ? ownership : facts.management ? 'management-in-progress' : !facts.unstarted || !unstarted ? 'scenario-progressed' : 'ready'
  const actors = 'kind' in creation && creation.kind !== 'company'
    ? Object.values(state?.entities ?? {}).filter(entity => entity.cognition === 'agent' && entity.readiness === 'ready' && entity.kind !== 'generation-assistant')
      .map(entity => ({ id: simulationEntityIdSchema.parse(entity.id), name: typeof entity.profile['name'] === 'string'
        ? entity.profile['name'] : entity.id }))
    : resolveScenarioTopology(creation.preparation).actors
  const targets = actors.flatMap(({ id, name }) => {
    const entity = state?.entities[id]
    return entity?.phase === 'active' ? [{ id: entity.id, name: text(name) }] : []
  })
  const ingress = facts.pending ? 'preparation-in-progress' : facts.management ? 'management-in-progress' : !facts.held ? 'recovery-required'
    : facts.driver === 'retiring' ? 'retiring' : facts.driver === 'checkpointing' ? 'checkpoint-in-progress'
      : Object.keys(state?.ingresses ?? {}).length >= facts.ingressLimit ? 'ingress-capacity' : targets.length === 0 ? 'target-unavailable' : 'ready'
  const action = (reason: SimulationProductMaintenanceReason) => ({ allowed: reason === 'ready', reason })
  return { actions: { checkpoint: action(checkpoint), restore: action(restore), prepare: action(prepare), ingress: action(ingress) },
    ingress: { maxTime: creation.record.spec.maxTime, maxBytes: creation.record.spec.maxIngressBytes,
      targets },
    ...anchor === undefined ? {} : { recovery: { checkpointId: anchor.request.id, publishedAt: anchor.publishedAt,
      time: anchor.manifest.state.time, revision: anchor.manifest.run.cursor,
      references: { runs: 1, teams: 1, channels: anchor.manifest.channels.length, sessions: anchor.manifest.sessions.length } } } }
}

/**
 * Project the same administration actions from a live bounded Native control observation.
 * @param creation - Immutable original topology and ingress limits.
 * @param state - Current scalar counts, bounded targets and checkpoint metadata; no retained bodies.
 * @param facts - Current authenticated product ownership and command admission.
 * @param text - Public display-text bound applied after Native metadata truncation.
 * @returns control availability without detached world copying or journal IO.
 */
export function maintenanceControlFromObservation(creation: SimulationCreation | SimulationCompanyCreation | SimulationWorldBranchCreation,
  state: import('@clocky/clocky-simulation').SimulationControlObservation, facts: MaintenanceControlFacts,
  text: (value: string) => SimulationProductText): SimulationProductAdministrationControl {
  const world = 'kind' in creation && creation.kind !== 'company'
  const anchor = state.latestCheckpoint?.implementationVersion === (world ? 'world/1' : 'company/1') ? state.latestCheckpoint : undefined
  const base = facts.pending ? 'preparation-in-progress' : !facts.capacity ? 'request-capacity' : 'ready'
  const ownership = facts.nativeOwner === 'other-owner' || facts.nativeOwner === 'unavailable' ? 'ownership-unavailable' : base
  const checkpoint = base !== 'ready' ? base : facts.management ? 'management-in-progress' : !facts.held ? 'recovery-required'
    : facts.driver === 'retiring' ? 'retiring' : facts.driver === 'checkpointing' || state.checkpointInProgress
      ? 'checkpoint-in-progress' : state.managementInProgress ? 'management-in-progress' : 'ready'
  const restore = ownership !== 'ready' ? ownership : facts.managementActive ? 'management-in-progress' : anchor === undefined ? 'checkpoint-required' : 'ready'
  const prepare = 'kind' in creation && creation.kind === 'world-branch' ? 'scenario-progressed' : ownership !== 'ready' ? ownership : facts.management
    ? 'management-in-progress' : !facts.unstarted || !state.unstarted ? 'scenario-progressed' : 'ready'
  const companyNames = 'kind' in creation && creation.kind !== 'company' ? undefined : new Map(resolveScenarioTopology(creation.preparation).actors.map(value => [value.id, value.name]))
  const targets = state.targets.flatMap((value) => {
    const name = companyNames?.get(value.id)
    if (!world && name === undefined) return []
    const projected = text(name ?? value.name)
    return [{ id: value.id, name: { ...projected, truncated: projected.truncated || name === undefined && value.truncated } }]
  })
  const ingress = facts.pending ? 'preparation-in-progress' : facts.management ? 'management-in-progress' : !facts.held ? 'recovery-required'
    : facts.driver === 'retiring' ? 'retiring' : facts.driver === 'checkpointing' ? 'checkpoint-in-progress'
      : state.ingressCount >= facts.ingressLimit ? 'ingress-capacity' : targets.length === 0 ? 'target-unavailable' : 'ready'
  const action = (reason: SimulationProductMaintenanceReason) => ({ allowed: reason === 'ready', reason })
  return { actions: { checkpoint: action(checkpoint), restore: action(restore), prepare: action(prepare), ingress: action(ingress) },
    ingress: { maxTime: creation.record.spec.maxTime, maxBytes: creation.record.spec.maxIngressBytes, targets,
      ...state.targetCount <= targets.length ? {} : { coverage: { complete: false, returned: targets.length, total: state.targetCount } } },
    ...anchor === undefined ? {} : { recovery: { checkpointId: anchor.id, publishedAt: anchor.publishedAt,
      time: anchor.time, revision: anchor.revision, references: anchor.references } } }
}
