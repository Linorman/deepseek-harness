/** Placement and capacity retain durable reservations and reject unrepresentable frozen limits. */
import { describe, expect, it } from 'vitest'
import { matchesTaskPlacement } from '../src/placement.ts'
import { liveActivationCapacity, liveActivationLimit, taskLiveActivationReservation } from '../src/activation-capacity.ts'
import { taskChildTeamReservation, taskConcurrencyUsage } from '../src/task-execution.ts'
import { projectMemberInspection } from '../src/member-inspection.ts'
import { teamEventOwnerId } from '../src/event-owner.ts'
import type { JsonObject, TeamEvent, TeamTaskSnapshot } from '../src/types.ts'
import { participant, task, teamId } from '../../../team/team-hub/tests/fixtures.ts'
import { childUsageReservation } from '../../../team/team-hub/tests/durable-child-fixtures.ts'

function child(budgets: JsonObject): TeamTaskSnapshot {
  const reserved = childUsageReservation('child', 'task', 1).reserved
  const delegation = reserved.delegation!
  return { ...reserved, delegation: { ...delegation, creation: { ...delegation.creation!, budgets } } }
}

describe('frozen child capacity', () => {
  it.each(['invalid', -1, 1.5, Number.NaN])('refuses an invalid frozen concurrency ceiling %s', (value) => {
    expect(() => taskConcurrencyUsage(child({ maxConcurrency: value }))).toThrow('Child concurrency ceiling is invalid')
  })

  it.each(['invalid', -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])('refuses an invalid descendant reservation %s', (value) => {
    expect(() => taskChildTeamReservation(child({ maxChildTeams: value }))).toThrow('Child Team count ceiling is invalid')
  })

  it('holds unresolved child startup slots and refuses an aggregate outside safe integer capacity', () => {
    expect(taskLiveActivationReservation(child({}))).toBe(0)
    expect(taskLiveActivationReservation(child({ maxLiveActivations: 3 }))).toBe(3)
    expect(liveActivationCapacity([], [], [child({ maxLiveActivations: 3 })])).toBe(3)
    expect(() => liveActivationCapacity([], [], [child({ maxLiveActivations: Number.MAX_SAFE_INTEGER }),
      child({ maxLiveActivations: 1 })])).toThrow('Live Activation capacity is not representable')
  })

  it.each(['invalid', -1, 1.5, Number.NaN])('refuses an invalid child startup ceiling %s', (value) => {
    expect(() => taskLiveActivationReservation(child({ maxLiveActivations: value }))).toThrow('Child live Activation ceiling is invalid')
    expect(() => liveActivationLimit({ maxLiveActivations: value })).toThrow('Live Activation ceiling is invalid')
  })

  it('keeps the tighter deployment and inherited live-epoch ceiling', () => {
    const grant = { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: { maxLiveActivations: 2 } }
    expect(liveActivationLimit({ maxLiveActivations: 3 }, grant)).toBe(2)
    expect(liveActivationLimit({}, grant)).toBe(2)
    expect(liveActivationLimit({})).toBeUndefined()
  })
})

it('uses the actual activated model route rather than a previously admitted descriptor', () => {
  const member = participant({ model: 'provider/old', preset: 'old' })
  expect(matchesTaskPlacement({ models: ['provider/old'] }, member)).toBe(true)
  expect(matchesTaskPlacement({ models: ['provider/old'] }, member, undefined, { provider: 'provider', model: 'new' })).toBe(false)
  expect(matchesTaskPlacement({ models: ['provider/new'] }, member, undefined, { provider: 'provider', model: 'new' })).toBe(true)
  for (const selection of [{}, { provider: 'provider' }, { model: 'new' }]) {
    expect(matchesTaskPlacement({ models: ['provider/old'] }, member, undefined, selection)).toBe(false)
  }
})

it('refuses a metadata wrapper larger than the complete response allowance and a sparse retained capability page', () => {
  const member = participant({ capabilities: [] })
  const request = { teamId, participantId: member.id, afterCursor: -1, limit: 1 }
  expect(projectMemberInspection(member, 1, request, 100)).toEqual({ ok: false, reason: 'metadata' })
  const sparse = { ...member, capabilities: new Array<string>(1) }
  expect(() => projectMemberInspection(sparse, 1, request, 4096)).toThrow('Capability is missing at its retained index')
})

it('attributes workspace observations to their retained Team and rejects an unknown committed event variant', () => {
  const event = { type: 'workspace/observed', observation: { teamId } } as TeamEvent
  expect(teamEventOwnerId(event)).toBe(teamId)
  expect(() => teamEventOwnerId({ type: 'unknown' } as unknown as TeamEvent)).toThrow('Unhandled Team event')
  expect(taskConcurrencyUsage(task())).toBe(0)
})
