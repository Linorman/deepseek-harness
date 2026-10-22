/** Durable topology records cannot confirm another reservation or bypass actor ownership. */
import { expect, it } from 'vitest'
import { simulationChangeSchema, simulationChannelSpecSchema, simulationEntityIdSchema,
  simulationEntityBindingSchema, simulationParticipantSpecSchema, simulationWakeRequestSchema, simulationDecisionIdSchema, simTimeSchema,
} from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { channelIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { foldEntry } from '../src/journal.ts'
import { createBusinessHarness } from './business-harness.ts'

function fold(state: SimulationSnapshot, record: Record<string, unknown>) {
  return foldEntry(state, { sequence: state.revision + 1,
    value: { ...record, runId: state.spec.runId, expectedRevision: state.revision } }, state.spec, 'sqlite')
}

it('rejects missing, foreign and repeated topology confirmations before appending', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const initial = h.run.snapshot()
    const creation = { goal: { objective: 'Create Team', budgets: {} }, budgets: {},
      rules: { simulationRunId: initial.spec.runId, activationLifecycleOwner: 'simulation/owner' } }
    const confirmation = { kind: 'run/team-confirmed', teamId: 'company' }
    expect(() => fold(initial, confirmation)).toThrow(/no matching reservation/)
    for (const owner of ['', ' owner ', 1]) {
      expect(() => fold(initial, { kind: 'run/team-reserved', teamId: 'company',
        creation: { ...creation, rules: { ...creation.rules, activationLifecycleOwner: owner } } })).toThrow(/not admissible/)
    }
    const reserved = await h.run.reserveTeam(creation, initial.revision)
    const team = reserved.teamReservation!.teamId
    await expect(h.run.confirmTeam(teamIdSchema.parse('foreign'), reserved.revision)).rejects.toThrow(/no matching reservation/)
    await h.run.confirmTeam(team, reserved.revision)
    expect(await h.run.confirmTeam(team, 0)).toEqual(h.run.snapshot())
    expect(() => fold(h.run.snapshot(), { ...confirmation, teamId: team })).toThrow(/no matching reservation/)
    const member = async (name: string, bind: boolean) => {
      const id = simulationEntityIdSchema.parse(name)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }),
        h.run.snapshot().revision)
      if (bind) await h.run.bindEntity(id, simulationEntityBindingSchema.parse({ teamId: team, participantId: name, sessionId: name }),
        h.run.snapshot().revision)
      return id
    }
    const a = await member('a', true), b = await member('b', true), unbound = await member('unbound', false)
    const spec = simulationChannelSpecSchema.parse({ key: 'channel', members: [{ entityId: a, role: 'a' }, { entityId: b, role: 'b' }], limits: {} })
    const before = h.run.snapshot()
    const record = { kind: 'run/channel-reserved', channelId: 'channel-id', spec }
    for (const entityId of ['missing', unbound]) {
      expect(() => fold(before, { ...record, spec: { ...spec, members: [{ entityId, role: 'a' }, spec.members[1]] } }))
        .toThrow(/active bound members/)
    }
    await expect(h.run.confirmChannel(spec.key, channelIdSchema.parse('channel-id'), before.revision)).rejects.toThrow(/no matching reservation/)
    const channel = await h.run.reserveChannel(spec, before.revision)
    const id = channel.channelReservations![spec.key]!.channelId
    await expect(h.run.confirmChannel(spec.key, channelIdSchema.parse('foreign'), channel.revision)).rejects.toThrow(/no matching reservation/)
    await h.run.confirmChannel(spec.key, id, channel.revision)
    await expect(h.run.confirmChannel(spec.key, channelIdSchema.parse('foreign'), h.run.snapshot().revision)).rejects.toThrow(/no matching reservation/)
    const participant = simulationParticipantSpecSchema.parse({ displayName: 'Unbound', role: 'observer', capabilities: [],
      provider: 'local', preset: 'actor', model: 'model' })
    expect(() => fold(h.run.snapshot(), { kind: 'run/participant-reserved', entityId: 'missing', participant,
      binding: { teamId: team, participantId: 'missing', sessionId: 'missing' } })).toThrow(/not admissible/)
  } finally { await h.close() }
})

it('refuses writer revocation records that lost the claimed wake', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('actor')
    const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'Work' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await actor.lease.openDecision(simulationDecisionIdSchema.parse('decision'), h.run.snapshot().revision, wake.id)
    const before = h.run.snapshot()
    expect(() => fold({ ...before, wakes: {} }, { kind: 'run/writer',
      change: { kind: 'writer/revoked', entityId: actor.id, epoch: actor.lease.epoch } })).toThrow(/lost its scheduled wake/)
    expect(h.run.snapshot()).toEqual(before)
  } finally { await h.close() }
})
