import type { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamError, envelopeIdSchema, teamIdSchema, teamSnapshotSchema, teamTaskSnapshotSchema,
  teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  type TeamEvent, type TeamStateSnapshot } from '@clocky/clocky-team'
import { TeamDelegation } from '../src/index.ts'

const consumers: TeamDelegation[] = []
afterEach(async () => { for (const consumer of consumers.splice(0)) await consumer.close() })
const parentId = teamIdSchema.parse('parent-consumer')
const childId = teamIdSchema.parse('child-consumer')
const binding = teamChildRunBindingSchema.parse({ parentTeamId: parentId, parentTaskId: 'parent-task', childTeamId: childId,
  delegationId: 'delegation', parentServiceId: 'parent-service', coordinatorId: 'child-coordinator', channelId: 'consult' })
const grant = { operations: ['register', 'send', 'close'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }
type DiscoveryPage = { readonly items: readonly unknown[]; readonly nextCursor?: number }
function setup(
  admitted: boolean,
  responseOnly = false,
  stalled = false,
  discoveryPage: DiscoveryPage | Promise<DiscoveryPage> = { items: [] },
  initialChildPhase?: TeamStateSnapshot['team']['phase'],
) {
  const result = teamDelegationResultAdmissionSchema.parse({ binding, requestEnvelopeId: 'request', requestSequence: 1,
    responseEnvelopeId: 'response', responseSequence: 2, contentFingerprint: `sha256:${'a'.repeat(64)}`, text: 'Child result', artifacts: [],
    parentTaskRevision: 3, parentCursor: 8, admittedAt: 3 })
  let task = teamTaskSnapshotSchema.parse({ id: 'parent-task', teamId: parentId, revision: 3,
    execution: { kind: 'child-team', templateId: 'fixture', templateVersion: 1, authorityGrant: grant, budget: {} },
    createCommand: { creator: { teamId: parentId, participantId: 'human' }, idempotencyKey: 'create' },
    subject: 'Nested work', description: 'Do work', phase: 'running', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [],
    maxAttempts: 1, attemptCount: 1, attemptHistory: [],
    delegation: { id: 'delegation', phase: admitted ? 'settling' : responseOnly ? 'active' : 'creating', requestedAt: 1, updatedAt: 3, startedAt: 2,
      childTeamId: childId, creation: { delegationId: 'delegation', parentTeamId: parentId, parentTaskId: 'parent-task',
        goal: { objective: 'Do work', budgets: {} }, rules: { workspacePath: '/fixture' }, budgets: {}, authorityGrant: grant },
      ...(admitted ? { childCursor: 9, result } : responseOnly ? { childCursor: 9 } : {}) },
    ...(admitted || responseOnly) ? {} : { cancellation: { requestedRevision: 2, requestedAt: 3, requestedBy: 'human',
      target: { kind: 'delegation', delegationId: 'delegation', childTeamId: childId } } },
  })
  let childPhase: TeamStateSnapshot['team']['phase'] = initialChildPhase ?? (stalled ? 'stalled' : 'active')
  const state = (id: typeof parentId): TeamStateSnapshot => {
    const goal: TeamStateSnapshot['goal'] = { teamId: id, revision: 1, objective: 'Do work', budgets: {},
      phase: id === childId && childPhase === 'completed' ? 'complete' : 'active' }
    return {
      team: { id, goal, depth: id === parentId ? 0 : 1, maxTeamDepth: 1, createdAt: 0, updatedAt: 3,
        cursor: id === parentId ? 8 : 9, phase: id === parentId ? 'active' : childPhase,
        ...(id === childId ? { ...stalled ? { stallReason: { code: 'CHILD_MODEL_UNAVAILABLE', message: 'Child cannot make progress' } } : {},
          childRun: binding, parentTeamId: parentId, parentTaskId: binding.parentTaskId } : {}) },
      goal, tasks: id === parentId ? [task] : [], participants: [], activations: [], channelIds: [], workspaceAllocations: [],
      rules: {}, budgets: {},
    }
  }
  const disposers = Array.from({ length: 5 }, () => vi.fn())
  let index = 0
  const register = vi.fn(() => disposers[index++])
  const teams = {
    registerSystemDelegationProofSource: register, registerSystemChildCreationProofSource: register,
    registerSystemChannelAdmissionProofSource: register, registerSystemEnvelopePostProofSource: register,
    registerSystemChildResultProofSource: register, listTeams: vi.fn(async () => []),
    listTeamsPage: vi.fn(async () => discoveryPage),
    getTeam: vi.fn(async ({ teamId }: { teamId: typeof parentId }) => {
      if (!admitted && !responseOnly && teamId === childId) throw new TeamError('No stream', 'TEAM_NOT_FOUND')
      return state(teamId)
    }),
    readChannelPage: vi.fn(async () => ({ channel: { phase: 'closed' }, records: [
      { type: 'channel/envelope', envelope: { id: result.responseEnvelopeId, kind: 'response', senderId: binding.coordinatorId } },
    ] })),
    admitTaskDelegationResult: vi.fn(async () => { task = { ...task, delegation: { ...task.delegation!, phase: 'settling', result } }; return result }),
    completeChildTeam: vi.fn(async () => { childPhase = 'completed'; return state(childId) }),
    authorizeChildRun: vi.fn(async () => ({ close: vi.fn() })),
    getChannelAdmission: vi.fn(async () => ({ channel: { phase: 'active' },
      invitations: [{ participantId: binding.parentServiceId, status: 'acknowledged' }] })),
    settleTaskDelegation: vi.fn(async () => { task = { ...task, phase: admitted || responseOnly ? 'completed' : 'cancelled' }; return task }),
    stallTaskDelegation: vi.fn(async (input: { reason: { code: string; message: string } }) => {
      if (!stalled) throw new Error('Unexpected stall')
      task = { ...task, delegation: { ...task.delegation!, phase: 'stalled', failure: input.reason } }
      return task
    }),
  }
  const teamRuns = { startChild: vi.fn(), cancelChild: vi.fn(), describeChildTemplate: vi.fn() }
  const eligible = vi.fn()
  const logger = { warn: vi.fn() }
  let teamChanged: (event: TeamEvent) => void = () => {}
  const ctx = { teams, teamRuns, agents: { get: vi.fn() }, teamWorkspaces: { eligible },
    on: vi.fn((event: string, listener: (event: TeamEvent) => void) => {
      if (event === 'team/changed') teamChanged = listener
      return vi.fn()
    }), logger } as unknown as Context
  const consumer = new TeamDelegation(ctx, { maxOperationsPerDrive: 8, channelPageSize: 16, teamPageSize: 1, pulseIntervalMs: 60000 })
  consumers.push(consumer); consumer.start()
  return { consumer, teams, teamRuns, eligible, disposers, logger, emitTeam: (event: TeamEvent) => { teamChanged(event) } }
}

describe('delegation recovery Consumer', () => {
  it.each(['completed', 'failed', 'cancelled', 'stalled'] as const)('retains only unresolved child routes after %s while waking the parent', async (phase) => {
    const { consumer, teams, teamRuns, emitTeam } = setup(false, true)
    teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [
      { type: 'channel/envelope', envelope: { id: envelopeIdSchema.parse('request'), kind: 'request', senderId: binding.parentServiceId } },
    ] })
    teamRuns.startChild.mockResolvedValue(binding)
    await consumer.drive(parentId)
    const routes = consumer as unknown as { parents: ReadonlyMap<unknown, unknown>; channels: ReadonlyMap<unknown, unknown> }
    expect(routes.parents.size).toBe(1)
    expect(routes.channels.size).toBe(1)
    const drive = vi.spyOn(consumer, 'drive').mockResolvedValue(undefined)
    const child = (await teams.getTeam({ teamId: childId })).team
    emitTeam({ type: 'team/changed', team: { ...child, phase,
      ...phase === 'stalled' ? { stallReason: { code: 'WAITING', message: 'Waiting for recovery.' } } : {} } })
    expect(drive).toHaveBeenCalledWith(parentId)
    expect(routes.parents.size).toBe(phase === 'stalled' ? 1 : 0)
    expect(routes.channels.size).toBe(phase === 'stalled' ? 1 : 0)
    await consumer.close()
    emitTeam({ type: 'team/changed', team: child })
    expect(routes.parents.size).toBe(0)
    expect(routes.channels.size).toBe(0)
  })

  it('does not retain terminal child ancestry after cold discovery', async () => {
    const seed = setup(true)
    const child = (await seed.teams.getTeam({ teamId: childId })).team
    const terminal = { ...child, phase: 'completed' as const, goal: { ...child.goal, phase: 'complete' as const } }
    const { consumer } = setup(true, false, false, { items: [terminal] }, 'completed')
    await consumer.drive(childId)
    const routes = consumer as unknown as { parents: ReadonlyMap<unknown, unknown> }
    expect(routes.parents.size).toBe(0)
  })

  it('does not resurrect terminal routes when an earlier discovery page arrives late', async () => {
    const seed = setup(true)
    const active = (await seed.teams.getTeam({ teamId: childId })).team
    const terminal = { ...active, phase: 'completed' as const, goal: { ...active.goal, phase: 'complete' as const } }
    const page = Promise.withResolvers<DiscoveryPage>()
    const { consumer, teams, emitTeam } = setup(true, false, false, page.promise, 'completed')
    emitTeam({ type: 'team/changed', team: terminal })
    await Promise.all([consumer.drive(childId), consumer.drive(parentId)])
    const readCount = teams.getTeam.mock.calls.length
    page.resolve({ items: [active] })
    await new Promise(resolve => setImmediate(resolve))
    expect(teams.getTeam.mock.calls.length).toBeGreaterThan(readCount)
    const routes = consumer as unknown as { parents: ReadonlyMap<unknown, unknown> }
    expect(routes.parents.size).toBe(0)
  })

  it('keeps ancestry retention proportional to live children across a long terminal history', async () => {
    const { consumer, teams, emitTeam } = setup(true)
    const base = (await teams.getTeam({ teamId: childId })).team
    vi.spyOn(consumer, 'drive').mockResolvedValue(undefined)
    const routes = consumer as unknown as { parents: ReadonlyMap<unknown, unknown> }
    for (let index = 0; index < 4096; index++) {
      const id = `child-history-${index}`
      const taskId = `parent-task-${index}`
      const team = teamSnapshotSchema.parse({ ...base, id, parentTaskId: taskId, goal: { ...base.goal, teamId: id },
        childRun: { ...binding, childTeamId: id, parentTaskId: taskId, delegationId: `delegation-${index}`, channelId: `channel-${index}` } })
      emitTeam({ type: 'team/changed', team })
      expect(routes.parents.size).toBe(1)
      emitTeam({ type: 'team/changed', team: { ...team, phase: 'completed', goal: { ...team.goal, phase: 'complete' } } })
      expect(routes.parents.size).toBe(0)
    }
  })

  it.each([true, false])('yields at the operation budget and continues later with coalesced events=%s', async (events) => {
    const { consumer, teams } = setup(true)
    const complete = teams.completeChildTeam.getMockImplementation()!
    let operations = 0
    teams.completeChildTeam.mockImplementation(async () => {
      operations++
      if (events) void consumer.drive(parentId)
      return operations < 24 ? await teams.getTeam({ teamId: childId }) : await complete()
    })
    await consumer.drive(parentId)
    expect(operations).toBe(8)
    expect(teams.settleTaskDelegation).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(teams.settleTaskDelegation).toHaveBeenCalledOnce() })
    expect(operations).toBe(24)
  })

  it('cancels budget-exhausted continuation work when the Consumer closes', async () => {
    const { consumer, teams } = setup(true)
    teams.completeChildTeam.mockImplementation(async () => await teams.getTeam({ teamId: childId }))
    await consumer.drive(parentId)
    expect(teams.completeChildTeam).toHaveBeenCalledTimes(8)
    await consumer.close()
    await new Promise(resolve => setImmediate(resolve))
    expect(teams.completeChildTeam).toHaveBeenCalledTimes(8)
    expect(teams.settleTaskDelegation).not.toHaveBeenCalled()
  })

  it('does not turn a failed coalesced drive into an immediate retry loop', async () => {
    const { consumer, teams } = setup(true)
    const failure = new Error('Team storage unavailable')
    teams.getTeam.mockImplementationOnce(async () => {
      void consumer.drive(parentId)
      throw failure
    })
    await expect(consumer.drive(parentId)).rejects.toBe(failure)
    await new Promise(resolve => setImmediate(resolve))
    expect(teams.getTeam).toHaveBeenCalledOnce()
    await consumer.drive(parentId)
    expect(teams.settleTaskDelegation).toHaveBeenCalledOnce()
  })

  it('uses bounded Team pages for restart discovery instead of the unbounded listing', async () => {
    const { consumer, teams } = setup(true)
    await consumer.drive(parentId)
    expect(teams.listTeams).not.toHaveBeenCalled()
    expect(teams.listTeamsPage).toHaveBeenCalledWith({ afterCursor: -1, limit: 1 })
  })

  it('reports a non-advancing discovery page instead of retaining a looping cursor', async () => {
    const { logger } = setup(true, false, false, { items: [], nextCursor: -1 })
    await vi.waitFor(() => { expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not advance')) })
  })

  it('retains a stalled child reason in its parent without releasing its reservation', async () => {
    const { consumer, teams, teamRuns } = setup(false, true, true)
    await consumer.drive(parentId)
    expect(teams.stallTaskDelegation).toHaveBeenCalledWith(expect.objectContaining({
      reason: { code: 'CHILD_MODEL_UNAVAILABLE', message: 'Child cannot make progress' },
    }))
    expect(teams.settleTaskDelegation).not.toHaveBeenCalled()
    expect(teamRuns.startChild).not.toHaveBeenCalled()
  })

  it('admits a closed consult response after restart before restoring coordinator residency', async () => {
    const { consumer, teams, teamRuns } = setup(false, true)
    await consumer.drive(parentId)
    expect(teams.admitTaskDelegationResult).toHaveBeenCalledTimes(1)
    expect(teams.completeChildTeam).toHaveBeenCalledTimes(1)
    expect(teams.settleTaskDelegation).toHaveBeenCalledTimes(1)
    expect(teamRuns.startChild).not.toHaveBeenCalled()
  })

  it('replays an admitted result to child completion and parent settlement without restarting model work', async () => {
    const { consumer, teams, teamRuns, eligible } = setup(true)
    await consumer.drive(parentId)
    expect(teams.completeChildTeam).toHaveBeenCalledTimes(1)
    expect(teams.settleTaskDelegation).toHaveBeenCalledTimes(1)
    expect(teamRuns.startChild).not.toHaveBeenCalled()
    expect(eligible).not.toHaveBeenCalled()
  })
  it('fails closed on a non-advancing child channel page instead of spinning the recovery drive', async () => {
    const { consumer, teams, teamRuns } = setup(false, true)
    teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [], nextCursor: -1 } as never)
    await expect(consumer.drive(parentId)).resolves.toBeUndefined()
    expect(teams.readChannelPage).toHaveBeenCalledTimes(1)
    expect(teamRuns.startChild).not.toHaveBeenCalled()
  })
  it('settles a missing-stream cancellation without resolving a live parent workspace or creating a child', async () => {
    const { consumer, teams, teamRuns, eligible } = setup(false)
    await consumer.drive(parentId)
    expect(teams.settleTaskDelegation).toHaveBeenCalledTimes(1)
    expect(teamRuns.startChild).not.toHaveBeenCalled()
    expect(teamRuns.cancelChild).not.toHaveBeenCalled()
    expect(eligible).not.toHaveBeenCalled()
  })
  it('removes every runtime authority source when its owning Consumer closes', async () => {
    const { consumer, disposers } = setup(true)
    await consumer.close()
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('awaits rejected source cleanup and still revokes every other authority', async () => {
    const { consumer, disposers } = setup(true)
    const failure = new Error('Source cleanup failed')
    const last = disposers.at(-1)
    if (last === undefined) throw new Error('Fixture requires registered authority sources')
    last.mockImplementationOnce(async () => { throw failure })
    await expect(consumer.close()).rejects.toMatchObject({ errors: [failure] })
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
  })
})
