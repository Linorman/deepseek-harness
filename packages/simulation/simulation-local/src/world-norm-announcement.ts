/** Frozen institution disclosure duties use canonical Native wakes without impersonating a Channel sender. */
import { isDeepStrictEqual } from 'node:util'
import { simulationEventIdSchema, SimulationNormError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationNormAnnouncement,
  SimulationEntityId, SimulationNormVersion } from '@clocky/clocky-simulation'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'
import type { SchedulerRecord } from './scheduler.ts'

/**
 * Derive the sole original notification identity for an authorized frozen recipient.
 * @param announcement - Original Native publication responsibility.
 * @param recipient - One of its canonical recipients, never a model-selected sender.
 * @returns stable reserved wake identity; it does not claim delivery or understanding.
 */
export function normAnnouncementWakeId(announcement: SimulationNormAnnouncement, recipient: SimulationEntityId): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-norm-announcement:${announcement.id}:${recipient}`)
}
function action(announcement: SimulationNormAnnouncement, recipient: SimulationEntityId) {
  return { kind: 'wake' as const, entityId: recipient, reason: JSON.stringify({ kind: 'norm-announcement',
    announcementId: announcement.id, norm: announcement.norm, bodyHash: announcement.bodyHash }) }
}

/**
 * Queue each exact due disclosure responsibility in the original institution mutation's append batch.
 * @param state - Norm/result-retaining Native prefix, before publication events are appended.
 * @returns finite exact wakes; retained identities are reused and bodies remain in authorized context material.
 */
export function normAnnouncementRecords(state: SimulationSnapshot): SchedulerRecord[] {
  let projected = state
  const records: SchedulerRecord[] = []
  for (const announcement of Object.values(state.world?.norms.announcements ?? {})) {
    for (const recipient of announcement.recipients) {
      const id = normAnnouncementWakeId(announcement, recipient)
      if (Object.hasOwn(projected.scheduledEvents, id)) continue
      const next = action(announcement, recipient)
      const record: SchedulerRecord = { kind: 'event/queued', id,
        key: allocateEventKey(projected, announcement.availableAt, next), action: next }
      records.push(record)
      projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    }
  }
  return records
}

/**
 * Preserve actual institution effective/expiry times as pure scheduler boundaries, without synthetic actor receipts.
 * @param state - Original version-retaining Native prefix in its mutation batch.
 * @returns finite exact boundaries; retained identities are not regenerated on replay or retry.
 */
export function normBoundaryRecords(state: SimulationSnapshot): SchedulerRecord[] {
  let projected = state
  const records: SchedulerRecord[] = []
  for (const norm of Object.values(state.world?.norms.versions ?? {}).flat()) {
    for (const edge of ['from', 'until'] as const) {
      const time = edge === 'from' ? norm.effectiveFrom : norm.effectiveUntil
      if (time === null) continue
      const id = simulationEventIdSchema.parse(`simulation-norm-boundary:${norm.id}:${norm.version}:${edge}`)
      if (Object.hasOwn(projected.scheduledEvents, id)) continue
      const next = { kind: 'norm-boundary' as const, norm: { id: norm.id, version: norm.version }, edge, bodyHash: norm.bodyHash }
      const record: SchedulerRecord = { kind: 'event/queued', id, key: allocateEventKey(projected, time, next), action: next }
      records.push(record)
      projected = { ...foldSchedulerRecord(projected, record, projected.revision + 1), revision: projected.revision + 1 }
    }
  }
  return records
}

/**
 * Verify an institution clock boundary against its actual original version and declared simulated time.
 * @param state - Authoritative version history; no wall clock participates.
 * @param event - Proposed or retained original scheduler responsibility.
 * @returns the exact version; an unknown, altered or mis-timed boundary rejects before effects.
 */
export function assertNormBoundarySource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'key' | 'action'>): SimulationNormVersion {
  const action = event.action
  const norm = action.kind === 'norm-boundary' ? state.world?.norms.versions[action.norm.id]?.find(value =>
    value.version === action.norm.version) : undefined
  if (norm === undefined || action.kind !== 'norm-boundary'
    || event.id !== `simulation-norm-boundary:${norm.id}:${norm.version}:${action.edge}`
    || event.key.phase !== 'deadline' || event.key.time !== (action.edge === 'from' ? norm.effectiveFrom : norm.effectiveUntil)
    || action.bodyHash !== norm.bodyHash) {
    throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Institution boundary lost its original version, body or simulated time')
  }
  return norm
}

/**
 * Verify a publication wake against the original audience, available time and approved document reference.
 * @param state - Authoritative institution history.
 * @param event - Proposed or retained scheduler envelope; arbitrary administrative sender fields do not qualify.
 * @returns normally only when the wake is an exact owned publication consequence.
 */
export function assertNormAnnouncementSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'key' | 'action'>): void {
  const recipient = event.action.kind === 'wake' ? event.action.entityId : undefined
  const announcement = recipient === undefined ? undefined : Object.values(state.world?.norms.announcements ?? {}).find(value =>
    value.recipients.includes(recipient) && event.id === normAnnouncementWakeId(value, recipient))
  if (announcement === undefined || recipient === undefined || event.key.time !== announcement.availableAt
    || !isDeepStrictEqual(event.action, action(announcement, recipient))) {
    throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Publication wake lost its exact original audience, availability or document')
  }
}

/**
 * Reject a complete projection that lost or changed any frozen disclosure responsibility.
 * @param state - Complete Native append tail, outside intermediate mutation/scheduler folding.
 * @returns normally for original published duties; a scheduled wake never asserts an actor has read or understood it.
 */
export function assertNormAnnouncementProjection(state: SimulationSnapshot): void {
  for (const norm of Object.values(state.world?.norms.versions ?? {}).flat()) {
    for (const edge of ['from', 'until'] as const) {
      if (edge === 'until' && norm.effectiveUntil === null) continue
      const event = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-norm-boundary:${norm.id}:${norm.version}:${edge}`)]
      if (event === undefined || event.status === 'cancelled')
        throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Institution omitted an original effective/expiry boundary')
      assertNormBoundarySource(state, event)
    }
  }
  for (const announcement of Object.values(state.world?.norms.announcements ?? {})) {
    for (const recipient of announcement.recipients) {
      const event = state.scheduledEvents[normAnnouncementWakeId(announcement, recipient)]
      if (event === undefined) throw new SimulationNormError('SIM_NORM_INTEGRITY', 'Institution omitted an original disclosure wake')
      assertNormAnnouncementSource(state, event)
    }
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.id.startsWith('simulation-norm-announcement:')) assertNormAnnouncementSource(state, event)
    if (event.action.kind === 'norm-boundary') assertNormBoundarySource(state, event)
  }
}
