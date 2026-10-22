/** Original representative preparation is shared by pinned Actor and mediated adapters; Native owns its allocation and result. */
import { simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationExternalRepresentativeReservation } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from '@clocky/clocky-simulation-team'
import type { SimulationWorldDriverAnchor } from './types.ts'

/**
 * Reconcile exact accepted canonical IO and finish its original maintenance without model generation.
 * @param run - Exclusive Native owner retaining the accepted reservation and frozen Persona.
 * @param connection - Original canonical Team lifecycle and topology owner.
 * @param anchor - Original finite drain and retry limits.
 * @param lifetime - Adapter lifetime; interruption leaves original Native responsibility retained.
 * @param original - Exact reservation allocated before Participant or Channel IO.
 * @param resume - Allow continuation only when the original running phase and pause/cancel histories stay unchanged.
 * @returns completion after commit or proven cancellation and matching maintenance completion; unknown IO rejects.
 */
export async function reconcileExternalRepresentative(run: SimulationRun, connection: SimulationTeamConnection,
  anchor: SimulationWorldDriverAnchor, lifetime: AbortSignal, original: SimulationExternalRepresentativeReservation,
  resume: boolean): Promise<void> {
  const before = run.snapshot(), management = JSON.stringify(before.management ?? {})
  const cancellations = JSON.stringify(before.world?.cancellations)
  await connection.quiesceForMaintenance(original.request.maintenance,
    anchor.maxDrainRounds, anchor.maxAttempts, lifetime)
  lifetime.throwIfAborted()
  let current = run.snapshot().world?.external.representatives[original.id]
  if (current === undefined) throw new Error('External maintenance lost its original representative reservation')
  if (current.status === 'cancel-requested') {
    await run.settleExternalRepresentativeCancellation(current.id)
    current = run.snapshot().world?.external.representatives[original.id]
    if (current?.status !== 'abandoned') throw new Error('External cleanup lost its original abandonment result')
  }
  if (current.status !== 'committed' && current.status !== 'abandoned') {
    current = await run.prepareExternalRepresentative(original.id)
    try {
      const { modelVersion: _version, ...member } = current.request.member
      await connection.ensureParticipant(current.identities.entityId, member)
      const world = run.snapshot().world, intent = world?.intents[current.id]
      if (world === undefined || intent === undefined) throw new Error('External preparation lost its original accepted request')
      for (const channel of current.identities.channels) {
        await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: channel.key,
          members: [{ entityId: current.identities.entityId, role: 'member' },
            { entityId: channel.purpose === 'director' ? world.definition.directorEntityId : intent.requesterEntityId,
              role: channel.purpose }], limits: {} }))
      }
      await run.commitExternalRepresentative(current.id)
    } catch (error: unknown) {
      const withdrawn = run.snapshot().world?.external.representatives[original.id]
      if (withdrawn?.status !== 'cancel-requested') throw error
      await run.settleExternalRepresentativeCancellation(original.id)
    }
  }
  await run.finishMaintenance(original.request.maintenance)
  const state = run.snapshot()
  if (resume && before.phase === 'running' && !lifetime.aborted
    && JSON.stringify(state.management ?? {}) === management && JSON.stringify(state.world?.cancellations) === cancellations) {
    await run.setPhase('running', state.revision)
  }
}
