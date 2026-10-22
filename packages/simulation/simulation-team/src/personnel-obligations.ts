/** Complete owner-reference inventory from Native and actual canonical Team books; this cannot authorize a personnel mutation. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { boundPersonnelObligationReport, personnelObligationQuerySchema, personnelObligationSchema,
  PersonnelObligationError } from '@clocky/clocky-simulation'
import type { PersonnelObligation, PersonnelObligationQuery, PersonnelObligationReport, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { PersonnelTeamSources } from './personnel-source-types.ts'

/**
 * Combine observed task, activation, workspace and pending-message metadata with the original Native report.
 * @param state - Exact Native snapshot used for the inventory selector and binding.
 * @param native - Original bounded Native inventory; an overflow remains incomplete.
 * @param sources - Actual canonical owner observations, never model-provided task or message claims.
 * @param input - Original strict query, including complete output bounds.
 * @returns stable metadata references and source coverage; neither an empty list nor complete coverage authorizes departure.
 */
export function projectPersonnelObligations(state: SimulationSnapshot, native: PersonnelObligationReport,
  sources: PersonnelTeamSources, input: PersonnelObligationQuery): PersonnelObligationReport {
  const query = personnelObligationQuerySchema.parse(input), person = state.entities[query.selector.personId]
  const binding = person?.binding, team = sources.team
  if (native.runId !== state.spec.runId || native.cursor !== state.revision || !isDeepStrictEqual(native.selector, query.selector)
    || binding === undefined || team.team.id !== binding.teamId || team.rules['simulationRunId'] !== state.spec.runId) {
    throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel sources differ from their original Native person and canonical Team')
  }
  const participant = team.participants.find(value => value.id === binding.participantId)
  if (participant === undefined || participant.teamId !== binding.teamId) {
    throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel sources lost their exact canonical Participant')
  }
  let resolvedNative = 0
  const retained = native.items.filter((item) => {
    const ref = item.ref
    if (ref.kind !== 'task-target' || !sources.complete) return true
    const task = team.tasks.find(value => value.id === ref.taskId)
    if (task === undefined) return true
    const creator = task.createCommand.creator
    if (!('kind' in creator) || creator.runId !== state.spec.runId
      || creator.operationId !== ref.operationId) {
      throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel task receipt differs from its actual original creation source')
    }
    if (!['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase) || task.lease !== undefined) return true
    // The external-target reference owns observation only; actual terminal evidence does not discharge a Native cleanup reservation.
    resolvedNative++
    return false
  })
  const extra = new Map<string, PersonnelObligation>()
  const add = (item: PersonnelObligation) => {
    const parsed = personnelObligationSchema.parse(item)
    extra.set(JSON.stringify([parsed.owner, parsed.ref]), parsed)
  }
  const owner = { kind: 'team' as const, teamId: binding.teamId }
  for (const task of team.tasks) {
    if (task.teamId !== binding.teamId) throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel task has another canonical owner')
    const terminal = ['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase)
    const roles: Array<Extract<PersonnelObligation['ref'], { kind: 'team-task' }>['relation']> = []
    if (!terminal) {
      if (task.createCommand.creator.participantId === binding.participantId) roles.push('creator')
      if (task.proposedOwnerId === binding.participantId) roles.push('proposed-owner')
      if (task.reviewPolicy.kind === 'participant' && task.reviewPolicy.reviewerId === binding.participantId) roles.push('reviewer')
      if (task.attemptHistory.some(value => value.participantId === binding.participantId)) roles.push('executor')
    }
    if (task.lease?.participantId === binding.participantId) {
      roles.push('owner')
      add({ ref: { kind: 'team-attempt', teamId: binding.teamId, taskId: task.id,
        attemptId: task.lease.attemptId, revision: task.revision }, owner, category: 'team-attempt', state: task.phase,
      certainty: 'recorded', dispositions: ['wait', 'cancel-supported'] })
    }
    for (const relation of roles) add({ ref: { kind: 'team-task', teamId: binding.teamId, taskId: task.id,
      revision: task.revision, relation }, owner, category: 'team-task', state: task.phase,
    certainty: 'recorded', dispositions: relation === 'creator' ? ['wait', 'cancel-supported']
      : relation === 'proposed-owner' ? ['update-supported'] : ['wait', 'handoff-required'] })
  }
  for (const activation of team.activations) {
    if (activation.activation.teamId !== binding.teamId) throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR',
      'Personnel activation has another canonical owner')
    if (activation.activation.participantId !== binding.participantId || activation.quiescedAt !== undefined) continue
    if (activation.sessionId !== binding.sessionId) throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR',
      'Personnel activation has another Session than the original canonical person')
    add({ ref: { kind: 'team-activation', teamId: binding.teamId, activationId: activation.activation.id,
      reservationId: activation.reservationId ?? null }, owner, category: 'team-activation', state: activation.activation.status,
    certainty: 'outcome-unknown', dispositions: ['wait'] })
  }
  const startup = participant.activationReservation
  if (startup !== undefined && startup.releasedAt === undefined
    && !team.activations.some(value => value.reservationId === startup.id)) {
    add({ ref: { kind: 'team-startup', teamId: binding.teamId, participantId: binding.participantId, reservationId: startup.id },
      owner, category: 'team-startup', state: 'unpublished', certainty: 'outcome-unknown', dispositions: ['wait'] })
  }
  for (const allocation of team.workspaceAllocations) {
    if (allocation.teamId !== binding.teamId) throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR', 'Personnel workspace has another canonical owner')
    if (allocation.participantId !== binding.participantId || allocation.lifecycle === 'released') continue
    if (allocation.sessionId !== binding.sessionId) throw new PersonnelObligationError('SIM_PERSONNEL_SELECTOR',
      'Personnel workspace has another original Session')
    add({ ref: { kind: 'team-workspace', teamId: binding.teamId, allocationId: allocation.id, taskId: allocation.taskId,
      attemptId: allocation.attemptId, revision: allocation.revision }, owner, category: 'team-workspace',
    state: allocation.lifecycle, certainty: allocation.lifecycle === 'active' ? 'recorded' : 'outcome-unknown', dispositions: ['wait'] })
  }
  for (const source of sources.channels) {
    for (const message of source.deliveries) add({ ref: { kind: 'channel-delivery', channelId: source.channel.manifest.id,
      envelopeId: message.envelopeId, recipientId: message.recipientId, sequence: message.sequence, direction: message.direction },
    owner: { kind: 'channel', channelId: source.channel.manifest.id }, category: 'channel-delivery', state: 'pending',
    certainty: 'recorded', dispositions: ['wait'] })
  }
  const extras = [...extra.values()].sort((a, b) => JSON.stringify(a.ref).localeCompare(JSON.stringify(b.ref)))
  const channels = sources.channels.map(value => ({ channelId: value.channel.manifest.id, cursor: value.channel.cursor }))
  const hash = `sha256:${createHash('sha256').update(JSON.stringify({ teamId: binding.teamId, participantId: binding.participantId,
    cursor: team.team.cursor, channels, items: extras, complete: sources.complete })).digest('hex')}`
  const coverage = { ...native.coverage, team: sources.complete
    ? { kind: 'observed' as const, teamId: binding.teamId, participantId: binding.participantId, cursor: team.team.cursor, channels, hash }
    : { kind: 'partial' as const, teamId: binding.teamId, participantId: binding.participantId, cursor: team.team.cursor,
      channels, hash, reason: sources.incomplete } }
  return boundPersonnelObligationReport({ ...native, coverage, items: [...retained, ...extras],
    totalCount: native.totalCount - resolvedNative + extras.length, complete: native.overflow === null && sources.complete,
    status: native.overflow !== null ? 'overflow' : sources.complete ? 'covered' : 'partial' }, query)
}
