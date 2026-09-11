import type { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamError, teamIdSchema, teamTaskSnapshotSchema, teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  type TeamStateSnapshot } from '@clocky/clocky-team'
import { TeamDelegation } from '../src/index.ts'

const consumers: TeamDelegation[] = []
afterEach(async () => { for (const consumer of consumers.splice(0)) await consumer.close() })
const parentId = teamIdSchema.parse('parent-consumer')
const childId = teamIdSchema.parse('child-consumer')
const binding = teamChildRunBindingSchema.parse({ parentTeamId: parentId, parentTaskId: 'parent-task', childTeamId: childId,
  delegationId: 'delegation', parentServiceId: 'parent-service', coordinatorId: 'child-coordinator', channelId: 'consult' })
const grant = { operations: ['register', 'send', 'close'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }
function setup(
  admitted: boolean,
  responseOnly = false,
  stalled = false,
  discoveryPage: { readonly items: readonly unknown[]; readonly nextCursor?: number } = { items: [] },
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
  let childPhase: TeamStateSnapshot['team']['phase'] = stalled ? 'stalled' : 'active'
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
  const ctx = { teams, teamRuns, agents: { get: vi.fn() }, teamWorkspaces: { eligible },
    on: vi.fn(() => vi.fn()), logger } as unknown as Context
  const consumer = new TeamDelegation(ctx, { maxOperationsPerDrive: 8, channelPageSize: 16, teamPageSize: 1, pulseIntervalMs: 60000 })
  consumers.push(consumer); consumer.start()
  return { consumer, teams, teamRuns, eligible, disposers, logger }
}

describe('delegation recovery Consumer', () => {
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
