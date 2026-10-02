/** Read-only administrative prerequisites derive from native ownership, lifecycle and retained command capacity. */
import type { SimulationSnapshot, SimulationOwnerObservation } from '@clocky/clocky-simulation'
import type { SimulationProductText } from './types.ts'
import type { SimulationProductAdministrationControl, SimulationProductMaintenanceReason } from './control-types.ts'
import type { SimulationCompanyCreation } from './creation-types.ts'
import { resolveScenarioTopology } from './scenario-topology.ts'

/** Current product facts used by the administrative projection, without taking ownership. */
export interface MaintenanceControlFacts {
  readonly nativeOwner: SimulationOwnerObservation
  readonly held: boolean
  readonly unstarted: boolean
  readonly driver: 'retiring' | 'checkpointing' | 'other'
  readonly pending: boolean
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
export function maintenanceControl(creation: SimulationCompanyCreation, state: SimulationSnapshot | undefined,
  facts: MaintenanceControlFacts, text: (value: string) => SimulationProductText): SimulationProductAdministrationControl {
  const latest = state?.latestCheckpointId === undefined ? undefined : state.checkpoints?.[state.latestCheckpointId]
  const anchor = latest?.status === 'completed' && latest.manifest.implementationVersion === 'company/1' ? latest : undefined
  const base: SimulationProductMaintenanceReason = facts.pending ? 'preparation-in-progress'
    : !facts.capacity ? 'request-capacity' : 'ready'
  const ownership = facts.nativeOwner === 'other-owner' || facts.nativeOwner === 'unavailable' ? 'ownership-unavailable' : base
  const checkpoint = base !== 'ready' ? base : !facts.held ? 'recovery-required' : facts.driver === 'retiring' ? 'retiring'
    : facts.driver === 'checkpointing' || Object.values(state?.checkpoints ?? {}).some(value => value.status === 'in-progress')
      ? 'checkpoint-in-progress' : Object.values(state?.management ?? {}).some(value => value.status === 'in-progress')
        ? 'management-in-progress' : 'ready'
  const restore = ownership !== 'ready' ? ownership : anchor === undefined ? 'checkpoint-required' : 'ready'
  const unstarted = state === undefined || state.phase === 'paused' && state.time === '0'
    && Object.keys(state.decisions).length === 0 && Object.keys(state.operations).length === 0
    && Object.keys(state.ingresses ?? {}).length === 0 && Object.values(state.entities).every(entity => entity.writer === undefined)
  const prepare = ownership !== 'ready' ? ownership : !facts.unstarted || !unstarted ? 'scenario-progressed' : 'ready'
  const targets = resolveScenarioTopology(creation.preparation).actors.flatMap(({ id, name }) => {
    const entity = state?.entities[id]
    return entity?.phase === 'active' ? [{ id: entity.id, name: text(name) }] : []
  })
  const ingress = facts.pending ? 'preparation-in-progress' : !facts.held ? 'recovery-required'
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
