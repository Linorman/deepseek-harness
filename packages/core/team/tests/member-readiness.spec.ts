import { teamMemberReadinessPageSchema } from '../src/schema.ts'
/** Participation, owned epochs and capacity are independent readiness facts. */
import { expect, it } from 'vitest'
import { memberReadiness, type MemberReadinessFacts } from '../src/member-readiness.ts'
import type { TeamMemberExecutionSources } from '../src/types.ts'

function facts(patch: Partial<MemberReadinessFacts> = {}): MemberReadinessFacts {
  const teamId = 'readiness-team' as never
  return { teamId, participant: { id: 'member' as never, teamId, kind: 'local-agent', phase: 'active', displayName: 'Member',
    role: 'custom', capabilities: [] }, unquiesced: false, pendingReservation: false, activeAttempts: 0,
  activationCapacity: true, concurrencyCapacity: true, teamAccepting: true, simulationManaged: false, ...patch }
}
const route: TeamMemberExecutionSources = { route: { kind: 'configured', provider: 'runtime', configuration: 'team-placement-default.routes', reasons: [] } }
function bound(status: NonNullable<MemberReadinessFacts['latest']>['activation']['status'] = 'idle'): MemberReadinessFacts {
  const input = facts()
  return { ...input, unquiesced: true, latest: { activation: { id: 'epoch' as never, teamId: input.teamId,
    participantId: input.participant.id, status }, sessionId: 'session' as never, provider: 'runtime' } }
}
const attached: TeamMemberExecutionSources = { ...route, activation: { state: 'attached', activationId: 'epoch' as never } }

it('does not infer readiness from active membership or a role name', () => {
  expect(memberReadiness(facts(), {})).toMatchObject({ participation: 'active', state: 'route-unavailable', reasons: ['route-unavailable'] })
  expect(memberReadiness(facts(), route)).toMatchObject({ state: 'ready', reasons: [], configuration: 'team-placement-default.routes' })
  const input = facts()
  expect(memberReadiness({ ...input, participant: { ...input.participant, kind: 'remote-agent' } }, route).state).toBe('ready')
  expect(memberReadiness({ ...input, participant: { ...input.participant, phase: 'invited' } }, route).state).toBe('not-applicable')
  expect(memberReadiness({ ...input, participant: { ...input.participant, phase: 'left' } }, route).state).toBe('not-applicable')
  expect(memberReadiness({ ...input, participant: { ...input.participant, kind: 'human' } }, route).reasons).toEqual(['human'])
  expect(memberReadiness({ ...input, participant: { ...input.participant, kind: 'service' } }, route).reasons).toEqual(['service-managed'])
  expect(memberReadiness(facts({ simulationManaged: true }), route).reasons).toEqual(['simulation-managed'])
})

it('keeps route, provider and capacity failures distinguishable, including concurrent blockers', () => {
  expect(memberReadiness(facts({ activationCapacity: false, concurrencyCapacity: false }), {}).reasons)
    .toEqual(['route-unavailable', 'activation-capacity', 'concurrency-capacity'])
  expect(memberReadiness(facts({ activationCapacity: false }), route).state).toBe('capacity-wait')
  expect(memberReadiness(facts({ concurrencyCapacity: false }), route).state).toBe('capacity-wait')
  expect(memberReadiness(facts(), { route: { ...route.route!, reasons: ['pool-capacity'] } }).state).toBe('capacity-wait')
  expect(memberReadiness(facts(), { route: { ...route.route!, reasons: ['provider-unavailable'] } }))
    .toMatchObject({ state: 'route-unavailable', reasons: ['provider-unavailable'] })
  expect(memberReadiness(facts({ teamAccepting: false }), route)).toMatchObject({ state: 'not-applicable', reasons: ['team-inactive'] })
})

it('requires live ownership before calling a durable binding resident or busy', () => {
  expect(memberReadiness(bound(), route)).toMatchObject({ state: 'recovery-required', reasons: ['old-writer'] })
  expect(memberReadiness(bound(), attached).state).toBe('resident')
  expect(memberReadiness(bound('running'), attached).state).toBe('busy')
  expect(memberReadiness({ ...bound(), activeAttempts: 1 }, attached).state).toBe('busy')
  expect(memberReadiness({ ...bound(), concurrencyCapacity: false }, attached).state).toBe('capacity-wait')
  expect(memberReadiness(bound('starting'), attached).state).toBe('starting')
  expect(memberReadiness(bound('stopping'), attached).state).toBe('stopping')
  expect(memberReadiness(bound('offline'), attached).state).toBe('recovery-required')
  expect(memberReadiness(facts(), attached).state).toBe('recovery-required')
  expect(memberReadiness(bound(), { ...attached, activation: { state: 'attached', activationId: 'older' as never } }).state).toBe('recovery-required')
})

it('distinguishes admitted startup and ordinary stopping from an unconfirmed earlier start', () => {
  expect(memberReadiness(facts(), { activation: { state: 'starting' } }).state).toBe('starting')
  expect(memberReadiness(facts(), { activation: { state: 'stopping' } }).state).toBe('stopping')
  expect(memberReadiness(facts(), { activation: { state: 'recovery-required' } }).state).toBe('recovery-required')
  expect(memberReadiness(facts({ pendingReservation: true }), route).state).toBe('recovery-required')
})


it('rejects a descriptor from another Team and treats an inactive Team without live work as not applicable', () => {
  const input = facts()
  expect(() => memberReadiness({ ...input, participant: { ...input.participant, teamId: 'foreign' as never } }, route))
    .toThrow('Member is not in the selected Team')
  expect(memberReadiness(facts({ teamAccepting: false }), {})).toMatchObject({ state: 'not-applicable', reasons: ['team-inactive'] })
})


it('does not hide retained execution or cleanup when a member loses participation', () => {
  const running = bound('running')
  const left = { ...running, participant: { ...running.participant, phase: 'left' as const } }
  expect(memberReadiness(left, attached)).toMatchObject({ participation: 'left', state: 'busy', reasons: ['not-participating'] })
  expect(memberReadiness(left, {})).toMatchObject({ state: 'recovery-required', reasons: ['not-participating', 'old-writer'] })
  const inactive = { ...facts(), participant: { ...facts().participant, phase: 'invited' as const } }
  expect(memberReadiness(inactive, { activation: { state: 'starting' } }).state).toBe('not-applicable')
})


it('rejects wire observations that label a blocked or departed member ready', () => {
  const item = memberReadiness(facts(), route)
  const page = { teamId: facts().teamId, teamCursor: 1, observationId: 'a'.repeat(64), observedAt: 1, items: [item] }
  expect(teamMemberReadinessPageSchema.parse(page)).toMatchObject({ items: [{ state: 'ready' }] })
  for (const patch of [{ participation: 'left' }, { reasons: ['activation-capacity'] }]) {
    expect(teamMemberReadinessPageSchema.safeParse({ ...page, items: [{ ...item, ...patch }] }).success).toBe(false)
  }
})
