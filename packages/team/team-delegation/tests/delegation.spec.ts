import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamError, activationBindingSnapshotSchema, envelopeIdSchema, participantSnapshotSchema,
  teamIdSchema, teamSnapshotSchema, teamTaskSnapshotSchema,
  teamChildRunBindingSchema, teamDelegationResultAdmissionSchema,
  type TeamEvent, type TeamStateSnapshot, type TeamSystemDelegationProof,
  type TeamSystemDelegationProofSource } from '@clocky/clocky-team'
import { TeamDelegation, apply as applyDelegation } from '../src/index.ts'

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
  limits: { readonly maxOperationsPerDrive?: number } = {},
) {
  const result = teamDelegationResultAdmissionSchema.parse({ binding, requestEnvelopeId: 'request', requestSequence: 1,
    responseEnvelopeId: 'response', responseSequence: 2, contentFingerprint: `sha256:${'a'.repeat(64)}`, text: 'Child result', artifacts: [],
    parentTaskRevision: 3, parentCursor: 8, admittedAt: 3 })
  let task = teamTaskSnapshotSchema.parse({
    createdAt: 1, id: 'parent-task', teamId: parentId, revision: 3,
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
  let childExists = admitted || responseOnly
  let childRun: TeamStateSnapshot['team']['childRun'] = binding
  let parentPhase: TeamStateSnapshot['team']['phase'] = 'active'
  let parentParticipants: TeamStateSnapshot['participants'] = []
  let parentActivations: TeamStateSnapshot['activations'] = []
  const state = (id: typeof parentId): TeamStateSnapshot => {
    const goal: TeamStateSnapshot['goal'] = { teamId: id, revision: 1, objective: 'Do work', budgets: {},
      phase: id === childId && childPhase === 'completed' ? 'complete' : 'active' }
    return {
      team: { id, goal, depth: id === parentId ? 0 : 1, maxTeamDepth: 1, createdAt: 0, updatedAt: 3,
        cursor: id === parentId ? 8 : 9, phase: id === parentId ? parentPhase : childPhase,
        ...(id === childId ? { ...stalled ? { stallReason: { code: 'CHILD_MODEL_UNAVAILABLE', message: 'Child cannot make progress' } } : {},
          ...childRun === undefined ? {} : { childRun }, parentTeamId: parentId, parentTaskId: binding.parentTaskId } : {}) },
      goal, tasks: id === parentId ? [task] : [], participants: id === parentId ? parentParticipants : [],
      activations: id === parentId ? parentActivations : [], channelIds: [], workspaceAllocations: [],
      rules: {}, budgets: {},
    }
  }
  const disposers = Array.from({ length: 5 }, () => vi.fn())
  const sources: unknown[] = []
  let index = 0
  const register = vi.fn((source: unknown) => { sources.push(source); return disposers[index++] })
  const teams = {
    registerSystemDelegationProofSource: register, registerSystemChildCreationProofSource: register,
    registerSystemChannelAdmissionProofSource: register, registerSystemEnvelopePostProofSource: register,
    registerSystemChildResultProofSource: register, listTeams: vi.fn(async () => []),
    listTeamsPage: vi.fn(async () => discoveryPage),
    getTeam: vi.fn(async ({ teamId }: { teamId: typeof parentId }) => {
      if (!childExists && teamId === childId) throw new TeamError('No stream', 'TEAM_NOT_FOUND')
      return state(teamId)
    }),
    beginTaskDelegation: vi.fn(async (_request: unknown) => task),
    createTeam: vi.fn(async () => { childExists = true; return state(childId) }),
    bindTaskDelegation: vi.fn(async () => task),
    postChannelEnvelope: vi.fn(async (_request: { actor: object }) => ({ id: 'child-request' })),
    readChannelPage: vi.fn(async () => ({ channel: { phase: 'closed' }, records: [
      { type: 'channel/envelope', envelope: { id: result.responseEnvelopeId, kind: 'response', senderId: binding.coordinatorId } },
    ] })),
    admitTaskDelegationResult: vi.fn(async () => { task = { ...task, delegation: { ...task.delegation!, phase: 'settling', result } }; return result }),
    completeChildTeam: vi.fn(async () => { childPhase = 'completed'; return state(childId) }),
    authorizeChildRun: vi.fn(async () => ({ close: vi.fn() })),
    getChannelAdmission: vi.fn(async () => ({ channel: { phase: 'active', cursor: 1 },
      invitations: [{ participantId: binding.parentServiceId, status: 'acknowledged', revision: 1,
        manifestFingerprint: `sha256:${'a'.repeat(64)}` }] })),
    acknowledgeChannelInvitation: vi.fn(async () => ({ channel: { phase: 'active', cursor: 1 },
      invitations: [{ participantId: binding.parentServiceId, status: 'acknowledged', revision: 1,
        manifestFingerprint: `sha256:${'a'.repeat(64)}` }] })),
    settleTaskDelegation: vi.fn(async () => { task = { ...task, phase: admitted || responseOnly ? 'completed' : 'cancelled' }; return task }),
    stallTaskDelegation: vi.fn(async (input: { reason: { code: string; message: string } }) => {
      if (!stalled) throw new Error('Unexpected stall')
      task = { ...task, delegation: { ...task.delegation!, phase: 'stalled', failure: input.reason } }
      return task
    }),
  }
  const teamRuns = { startChild: vi.fn(), cancelChild: vi.fn(), describeChildTemplate: vi.fn(() => ({})) }
  const eligible = vi.fn()
  const logger = { warn: vi.fn() }
  const agents = { get: vi.fn() }
  let teamChanged: (event: TeamEvent) => void = () => {}
  let channelChanged: (event: { readonly channelId: typeof binding.channelId }) => void = () => {}
  const ctx = { teams, teamRuns, agents, teamWorkspaces: { eligible },
    on: vi.fn((event: string, listener: (event: TeamEvent) => void) => {
      if (event === 'team/changed') teamChanged = listener
      if (event === 'channel/changed') channelChanged = listener as unknown as typeof channelChanged
      return vi.fn()
    }), logger } as unknown as Context
  const consumer = new TeamDelegation(ctx, { maxOperationsPerDrive: limits.maxOperationsPerDrive ?? 8,
    channelPageSize: 16, teamPageSize: 1, pulseIntervalMs: 60000 })
  consumers.push(consumer); consumer.start()
  return { consumer, teams, teamRuns, eligible, agents, disposers, sources, logger,
    state, setTask(value: TeamStateSnapshot['tasks'][number]) { task = value },
    setChildPhase(value: TeamStateSnapshot['team']['phase']) { childPhase = value },
    setChildExists(value: boolean) { childExists = value },
    setChildRun(value: TeamStateSnapshot['team']['childRun']) { childRun = value },
    setParentPhase(value: TeamStateSnapshot['team']['phase']) { parentPhase = value },
    setParentParticipants(value: TeamStateSnapshot['participants']) { parentParticipants = value },
    setParentActivations(value: TeamStateSnapshot['activations']) { parentActivations = value },
    emitTeam: (event: TeamEvent) => { teamChanged(event) },
    emitChannel: (channelId: typeof binding.channelId) => { channelChanged({ channelId }) } }
}

function pendingCoordinatorFixture() {
  const f = setup(true, false, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
  const selected = f.state(parentId).tasks[0]
  if (selected?.delegation === undefined) throw new Error('fixture has no parent delegation')
  f.setTask({ ...selected, phase: 'pending', cancellation: undefined,
    delegation: { id: selected.delegation.id, phase: 'requested', requestedAt: 1, updatedAt: 1 } })
  const coordinator = participantSnapshotSchema.parse({ id: 'coordinator', teamId: parentId,
    kind: 'local-agent', displayName: 'Coordinator', role: 'coordinator', capabilities: [], phase: 'active' })
  const activation = activationBindingSnapshotSchema.parse({ activation: { id: 'coordinator-activation',
    teamId: parentId, participantId: coordinator.id, status: 'idle' }, sessionId: 'coordinator-session', provider: 'in-process' })
  f.setParentParticipants([coordinator])
  f.setParentActivations([activation])
  f.agents.get.mockReturnValue({ session: { header: { cwd: process.cwd() } } })
  f.eligible.mockResolvedValue(true)
  return { f, selected, coordinator, activation }
}

describe('delegation recovery Consumer', () => {
  it('mounts and disposes the optional driver and releases registration after a startup error', async () => {
    const fixture = setup(true)
    const config = { maxOperationsPerDrive: 1, channelPageSize: 16, teamPageSize: 1, pulseIntervalMs: 60000 }
    const context = () => {
      const ctx = new Context()
      ctx.provide('teams', fixture.teams as never)
      ctx.provide('teamRuns', fixture.teamRuns as never)
      ctx.provide('agents', fixture.agents as never)
      ctx.provide('teamWorkspaces', { eligible: fixture.eligible } as never)
      return ctx
    }
    const mounted = context()
    applyDelegation(mounted, config)
    await mounted.fiber.dispose()

    const recovering = context()
    const failure = new Error('delegation proof registration failed')
    fixture.teams.registerSystemDelegationProofSource.mockImplementationOnce(() => { throw failure })
    expect(() => { applyDelegation(recovering, config) }).toThrow(failure)
    expect(() => { applyDelegation(recovering, config) }).not.toThrow()
    await recovering.fiber.dispose()
  })

  it('wakes a parent for task, activation, and channel changes while suppressing events after close', async () => {
    const f = setup(true)
    const task = f.state(parentId).tasks[0]
    if (task === undefined) throw new Error('fixture has no parent task')
    const activation = activationBindingSnapshotSchema.parse({ activation: { id: 'coordinator-activation',
      teamId: parentId, participantId: 'coordinator', status: 'idle' }, sessionId: 'coordinator-session', provider: 'in-process' })
    const drive = vi.spyOn(f.consumer, 'drive').mockResolvedValue(undefined)
    f.emitTeam({ type: 'task/changed', task, cursor: 1, createdAt: 1 })
    f.emitTeam({ type: 'activation/changed', binding: activation, cursor: 2, createdAt: 2 })
    const routes = f.consumer as unknown as { readonly channels: Map<typeof binding.channelId, typeof parentId> }
    routes.channels.set(binding.channelId, parentId)
    f.emitChannel(binding.channelId)
    expect(drive).toHaveBeenCalledTimes(3)
    expect(drive).toHaveBeenCalledWith(parentId)
    await f.consumer.close()
    f.emitTeam({ type: 'task/changed', task, cursor: 3, createdAt: 3 })
    f.emitChannel(binding.channelId)
    expect(drive).toHaveBeenCalledTimes(3)
  })

  it('keeps every registered runtime authority source empty for a forged proof', async () => {
    const f = setup(true)
    const creation = f.sources[1] as { resolveChildCreationProof(proof: object): unknown } | undefined
    const invitation = f.sources[2] as { resolveChannelAdmissionProof(proof: object): unknown } | undefined
    const envelope = f.sources[3] as { resolveEnvelopePostProof(proof: object): unknown } | undefined
    const result = f.sources[4] as { resolveChildResultProof(proof: object): unknown } | undefined
    if (creation === undefined || invitation === undefined || envelope === undefined || result === undefined) {
      throw new Error('delegation sources were not registered')
    }
    expect(creation.resolveChildCreationProof({})).toBeUndefined()
    expect(invitation.resolveChannelAdmissionProof({})).toBeUndefined()
    expect(envelope.resolveEnvelopePostProof({})).toBeUndefined()
    expect(result.resolveChildResultProof({})).toBeUndefined()
  })

  it('starts a bounded discovery pulse from its timer and refuses a drive after closing', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const f = setup(true)
    try {
      await new Promise(resolve => setImmediate(resolve))
      const before = f.teams.listTeamsPage.mock.calls.length
      const tick = intervals.mock.calls.find(([, delay]) => delay === 60000)?.[0]
      if (tick === undefined) throw new Error('delegation discovery timer was not installed')
      tick()
      await vi.waitFor(() => { expect(f.teams.listTeamsPage.mock.calls.length).toBeGreaterThan(before) })
      await f.consumer.close()
      const reads = f.teams.getTeam.mock.calls.length
      await expect(f.consumer.drive(parentId)).resolves.toBeUndefined()
      expect(f.teams.getTeam).toHaveBeenCalledTimes(reads)
    } finally { intervals.mockRestore() }
  })

  it('restarts an expired discovery cursor without reporting a storage failure', async () => {
    const expired = new TeamError('Team list cursor expired', 'TEAM_DISCOVERY_CURSOR_EXPIRED')
    const f = setup(true, false, false, Promise.reject(expired))
    await vi.waitFor(() => { expect(f.teams.listTeamsPage).toHaveBeenCalledOnce() })
    await new Promise(resolve => setImmediate(resolve))
    const state = f.consumer as unknown as { readonly teamCursor: number }
    expect(state.teamCursor).toBe(-1)
    expect(f.logger.warn).not.toHaveBeenCalled()
  })

  it('ignores a late discovery page once closing begins', async () => {
    const page = Promise.withResolvers<DiscoveryPage>()
    const f = setup(true, false, false, page.promise)
    const internal = f.consumer as unknown as { discover(): void }
    internal.discover()
    expect(f.teams.listTeamsPage).toHaveBeenCalledOnce()
    const closing = f.consumer.close()
    page.resolve({ items: [f.state(childId).team] })
    await closing
    internal.discover()
    expect(f.teams.getTeam).not.toHaveBeenCalled()
    expect(f.teams.listTeamsPage).toHaveBeenCalledOnce()
  })

  it('awaits and reports a rejected in-flight drive during Consumer disposal', async () => {
    const f = setup(true)
    const current = Promise.withResolvers<TeamStateSnapshot>()
    f.teams.getTeam.mockReturnValueOnce(current.promise)
    const running = f.consumer.drive(parentId)
    await vi.waitFor(() => { expect(f.teams.getTeam).toHaveBeenCalledOnce() })
    const closing = f.consumer.close()
    await vi.waitFor(() => { expect(f.disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true) })
    const failure = new Error('Team state read failed while closing')
    current.reject(failure)
    await expect(running).rejects.toBe(failure)
    await expect(closing).rejects.toMatchObject({ errors: [failure] })
  })

  it('replaces a scheduled continuation with an explicit drive for the same parent', async () => {
    const f = setup(true, false, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.completeChildTeam.mockImplementation(async () => await f.teams.getTeam({ teamId: childId }))
    await f.consumer.drive(parentId)
    const internal = f.consumer as unknown as { readonly scheduledDrives: ReadonlyMap<unknown, unknown> }
    expect(internal.scheduledDrives.size).toBe(1)
    await f.consumer.drive(parentId)
    expect(f.teams.completeChildTeam).toHaveBeenCalledTimes(2)
    await f.consumer.close()
  })

  it('reports independent child and parent drive failures from one durable child event', async () => {
    const f = setup(true)
    const child = f.state(childId).team
    f.teams.getTeam.mockRejectedValueOnce(new Error('child read unavailable'))
      .mockRejectedValueOnce(new Error('parent read unavailable'))
    f.emitTeam({ type: 'team/changed', team: child })
    await vi.waitFor(() => { expect(f.logger.warn).toHaveBeenCalledTimes(2) })
    expect(f.logger.warn.mock.calls.map(([message]) => String(message)).join('\n'))
      .toMatch(/child read unavailable|parent read unavailable/)
  })

  it('begins a pending child reservation only with a live coordinator and controlled shared workspace', async () => {
    const f = setup(true, false, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    const selected = f.state(parentId).tasks[0]
    if (selected === undefined || selected.delegation === undefined) throw new Error('fixture has no parent delegation')
    f.setTask({ ...selected, phase: 'pending', cancellation: undefined,
      delegation: { id: selected.delegation.id, phase: 'requested', requestedAt: 1, updatedAt: 1 } })
    const coordinator = participantSnapshotSchema.parse({ id: 'coordinator', teamId: parentId,
      kind: 'local-agent', displayName: 'Coordinator', role: 'coordinator', capabilities: [], phase: 'active' })
    const activation = activationBindingSnapshotSchema.parse({ activation: { id: 'coordinator-activation',
      teamId: parentId, participantId: coordinator.id, status: 'idle' }, sessionId: 'coordinator-session', provider: 'in-process' })
    f.setParentParticipants([coordinator])
    f.setParentActivations([activation])
    f.agents.get.mockReturnValue({ session: { header: { cwd: process.cwd() } } })
    f.eligible.mockResolvedValue(true)
    const source = f.sources[0] as TeamSystemDelegationProofSource | undefined
    if (source === undefined) throw new Error('delegation proof source was not registered')
    await expect(source.resolveChildWorkspace({} as TeamSystemDelegationProof))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    let acceptedProof: TeamSystemDelegationProof | undefined
    f.teams.beginTaskDelegation.mockImplementationOnce(async (request) => {
      const actor = (request as { actor: TeamSystemDelegationProof }).actor
      acceptedProof = actor
      expect(source.resolveDelegationProof(actor)).toMatchObject({ kind: 'delegation-begin' })
      expect(() => JSON.stringify(actor)).toThrow('runtime-only')
      expect(await source.resolveChildWorkspace(actor)).toBe(process.cwd())
      return selected
    })
    await f.consumer.drive(parentId)
    if (acceptedProof === undefined) throw new Error('delegation proof was not issued')
    expect(source.resolveDelegationProof(acceptedProof)).toBeUndefined()
    expect(f.teamRuns.describeChildTemplate).toHaveBeenCalledWith('fixture', 1)
    expect(f.teams.beginTaskDelegation.mock.calls[0]?.[0]).toMatchObject({
      teamId: parentId, taskId: selected.id,
      child: { goal: { objective: 'Do work', budgets: {} }, budgets: {}, rules: { workspacePath: process.cwd() } },
    })
    expect(f.eligible).toHaveBeenCalledTimes(2)
  })

  it.each(['no coordinator', 'inactive coordinator', 'missing Agent', 'ineligible workspace',
    'missing Session cwd', 'invalid Session cwd', 'missing parent task'] as const)(
    'refuses child creation with %s', async (mode) => {
      const { f, selected, coordinator } = pendingCoordinatorFixture()
      if (mode === 'no coordinator') f.setParentParticipants([])
      if (mode === 'inactive coordinator') f.setParentParticipants([{ ...coordinator, phase: 'left' }])
      if (mode === 'missing Agent') f.agents.get.mockReturnValue(undefined)
      if (mode === 'ineligible workspace') f.eligible.mockResolvedValue(false)
      if (mode === 'missing Session cwd') f.agents.get.mockReturnValue({ session: { header: {} } })
      if (mode === 'invalid Session cwd') f.agents.get.mockReturnValue({ session: { header: { cwd: '/missing-delegation-workspace' } } })
      if (mode === 'missing parent task') {
        const state = f.state(parentId)
        f.teams.getTeam.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, tasks: [] })
      }
      f.teams.stallTaskDelegation.mockResolvedValue(selected)
      await f.consumer.drive(parentId)
      expect(f.teams.beginTaskDelegation).not.toHaveBeenCalled()
      expect(f.teams.stallTaskDelegation).toHaveBeenCalledOnce()
      const expected = mode === 'missing parent task' ? 'TEAM_TASK_NOT_FOUND'
        : mode === 'invalid Session cwd' ? 'TEAM_DELEGATION_FAILED' : 'TEAM_DELEGATION_WORKSPACE_UNAVAILABLE'
      expect(f.teams.stallTaskDelegation.mock.calls[0]?.[0].reason.code).toBe(expected)
    },
  )

  it('materializes a reserved child Team after a missing journal is recovered', async () => {
    const f = setup(false, false, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    const task = f.state(parentId).tasks[0]
    if (task === undefined) throw new Error('fixture has no parent task')
    f.setTask({ ...task, cancellation: undefined })
    await f.consumer.drive(parentId)
    expect(f.teams.createTeam).toHaveBeenCalledWith(expect.objectContaining({
      parentTeamId: parentId, parentTaskId: task.id, delegationId: task.delegation?.id,
    }))
    expect(f.teams.settleTaskDelegation).not.toHaveBeenCalled()
    expect((await f.teams.getTeam({ teamId: childId })).team.id).toBe(childId)
  })

  it('rebinds a recovered child before starting its directed consult', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    const task = f.state(parentId).tasks[0]
    if (task?.delegation === undefined) throw new Error('fixture has no parent delegation')
    f.setTask({ ...task, delegation: { ...task.delegation, phase: 'creating', childCursor: undefined } })
    await f.consumer.drive(parentId)
    expect(f.teams.bindTaskDelegation).toHaveBeenCalledWith(expect.objectContaining({
      teamId: parentId, taskId: task.id, childTeamId: childId,
    }))
    expect(f.teamRuns.startChild).not.toHaveBeenCalled()
  })

  it('starts one child consult and posts its reserved objective only when no request exists', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [] })
    f.teamRuns.startChild.mockResolvedValue(binding)
    const authorization = { close: vi.fn() }
    f.teams.authorizeChildRun.mockResolvedValue(authorization)
    f.teams.postChannelEnvelope.mockImplementationOnce(async (request: { actor: object }) => {
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      return { id: 'request' }
    })
    await f.consumer.drive(parentId)
    expect(f.teamRuns.startChild).toHaveBeenCalledWith(expect.objectContaining({ childTeamId: childId }))
    expect(authorization.close).toHaveBeenCalledOnce()
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      draft: { channelId: binding.channelId, audience: [binding.coordinatorId], kind: 'request',
        payload: { text: 'Do work' }, delivery: 'turn' },
    }))
    const routes = f.consumer as unknown as { readonly channels: ReadonlyMap<unknown, unknown> }
    expect(routes.channels.get(binding.channelId)).toBe(parentId)
  })

  it('acknowledges a pending parent-service invitation before asking the child for a result', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [] })
    f.teamRuns.startChild.mockResolvedValue(binding)
    f.teams.getChannelAdmission.mockResolvedValueOnce({ channel: { phase: 'pending', cursor: 1 }, invitations: [{
      participantId: binding.parentServiceId, status: 'pending', revision: 1,
      manifestFingerprint: `sha256:${'a'.repeat(64)}`,
    }] })
    await f.consumer.drive(parentId)
    expect(f.teams.acknowledgeChannelInvitation).toHaveBeenCalledWith(expect.objectContaining({
      channelId: binding.channelId, revision: 1,
    }))
    expect(f.teams.postChannelEnvelope).toHaveBeenCalledOnce()
  })

  it.each([false, true])('closes exact child cancellation authority and retains a stalled result=%s', async (stalledChild) => {
    const f = setup(false, true, stalledChild, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    const task = f.state(parentId).tasks[0]
    if (task === undefined) throw new Error('fixture has no parent task')
    f.setTask(teamTaskSnapshotSchema.parse({ ...task, cancellation: { requestedRevision: 2, requestedAt: 3,
      requestedBy: 'human', target: { kind: 'delegation', delegationId: 'delegation', childTeamId: childId } } }))
    const authorization = { close: vi.fn() }
    f.teams.authorizeChildRun.mockResolvedValue(authorization)
    f.teamRuns.cancelChild.mockResolvedValue(f.state(childId))
    await f.consumer.drive(parentId)
    expect(f.teamRuns.cancelChild).toHaveBeenCalledWith(expect.objectContaining({ childTeamId: childId }))
    expect(authorization.close).toHaveBeenCalledOnce()
    expect(f.teams.stallTaskDelegation).toHaveBeenCalledTimes(stalledChild ? 1 : 0)
  })

  it.each(['retained reason', 'missing reason', 'terminal parent'] as const)(
    'contains child completion stalled with %s', async (mode) => {
      const f = setup(true, false, mode === 'retained reason', { items: [] }, undefined, { maxOperationsPerDrive: 1 })
      const selected = f.state(parentId).tasks[0]
      if (selected === undefined) throw new Error('fixture has no parent task')
      const child = f.state(childId)
      const stalledChild = { ...child, team: { ...child.team, phase: 'stalled' as const,
        ...mode === 'missing reason' ? { stallReason: undefined } : { stallReason: { code: 'CHILD_STALLED', message: 'Blocked' } } } }
      if (mode === 'terminal parent') {
        f.teams.completeChildTeam.mockImplementationOnce(async () => {
          f.setTask({ ...selected, phase: 'completed' })
          return stalledChild
        })
      } else f.teams.completeChildTeam.mockResolvedValueOnce(stalledChild)
      f.teams.stallTaskDelegation.mockResolvedValue(selected)
      await f.consumer.drive(parentId)
      expect(f.teams.completeChildTeam).toHaveBeenCalledOnce()
      expect(f.teams.stallTaskDelegation).toHaveBeenCalledTimes(mode === 'terminal parent' ? 0 : 1)
      if (mode === 'missing reason') {
        expect(f.teams.stallTaskDelegation.mock.calls[0]?.[0].reason.code).toBe('TEAM_DELEGATION_INVALID')
      }
    },
  )

  it('pauses new child work when the parent Team has left its active phase', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.setParentPhase('quiescing')
    await f.consumer.drive(parentId)
    expect(f.teamRuns.startChild).not.toHaveBeenCalled()
    expect(f.teams.bindTaskDelegation).not.toHaveBeenCalled()
  })

  it('does not post a second child objective after the durable consult request is visible', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [{ type: 'channel/envelope',
      envelope: { id: envelopeIdSchema.parse('request'), kind: 'request', senderId: binding.parentServiceId } }] })
    f.teamRuns.startChild.mockResolvedValue(binding)
    await f.consumer.drive(parentId)
    expect(f.teamRuns.startChild).toHaveBeenCalledOnce()
    expect(f.teams.postChannelEnvelope).not.toHaveBeenCalled()
  })

  it('waits for pending channel activation after accepting the parent-service invitation', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [] })
    f.teamRuns.startChild.mockResolvedValue(binding)
    f.teams.getChannelAdmission.mockResolvedValueOnce({ channel: { phase: 'pending', cursor: 1 }, invitations: [{
      participantId: binding.parentServiceId, status: 'pending', revision: 1,
      manifestFingerprint: `sha256:${'a'.repeat(64)}`,
    }] })
    f.teams.acknowledgeChannelInvitation.mockResolvedValueOnce({ channel: { phase: 'pending', cursor: 2 }, invitations: [{
      participantId: binding.parentServiceId, status: 'acknowledged', revision: 2,
      manifestFingerprint: `sha256:${'a'.repeat(64)}`,
    }] })
    await f.consumer.drive(parentId)
    expect(f.teams.acknowledgeChannelInvitation).toHaveBeenCalledOnce()
    expect(f.teams.postChannelEnvelope).not.toHaveBeenCalled()
  })

  it.each(['missing invitation', 'closed channel', 'missing objective'] as const)(
    'stalls a recoverable parent task after %s prevents child consultation', async (failure) => {
      const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
      f.teams.readChannelPage.mockResolvedValue({ channel: { phase: 'active' }, records: [] })
      f.teamRuns.startChild.mockResolvedValue(binding)
      if (failure === 'missing invitation') f.teams.getChannelAdmission.mockResolvedValueOnce({
        channel: { phase: 'active', cursor: 1 }, invitations: [],
      })
      if (failure === 'closed channel') f.teams.getChannelAdmission.mockResolvedValueOnce({
        channel: { phase: 'closed', cursor: 1 }, invitations: [{ participantId: binding.parentServiceId,
          status: 'acknowledged', revision: 1, manifestFingerprint: `sha256:${'a'.repeat(64)}` }],
      })
      if (failure === 'missing objective') {
        const task = f.state(parentId).tasks[0]
        if (task?.delegation === undefined) throw new Error('fixture has no delegation')
        f.setTask({ ...task, delegation: { ...task.delegation, creation: undefined } })
      }
      const selected = f.state(parentId).tasks[0]
      if (selected === undefined) throw new Error('fixture has no parent task')
      f.teams.stallTaskDelegation.mockResolvedValue(selected)
      await f.consumer.drive(parentId)
      expect(f.teams.stallTaskDelegation).toHaveBeenCalledOnce()
      expect(f.teams.stallTaskDelegation.mock.calls[0]?.[0].reason.code)
        .toBe(failure === 'closed channel' ? 'TEAM_DELEGATION_CHANNEL_UNAVAILABLE' : 'TEAM_DELEGATION_INVALID')
    },
  )

  it.each(['TEAM_CURSOR_CONFLICT', 'TEAM_CHANNEL_CURSOR_CONFLICT', 'TEAM_TASK_STALE_REVISION', 'TEAM_DELEGATION_BUSY'] as const)(
    'leaves a %s retry to the next durable Team cursor instead of stalling', async (code) => {
      const { f } = pendingCoordinatorFixture()
      f.teams.beginTaskDelegation.mockRejectedValueOnce(new TeamError('retry current Team state', code))
      await f.consumer.drive(parentId)
      expect(f.teams.stallTaskDelegation).not.toHaveBeenCalled()
    },
  )

  it.each(['late cancellation', 'terminal task', 'missing task'] as const)(
    'rechecks %s before compensating a failed child read', async (mode) => {
      const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
      const selected = f.state(parentId).tasks[0]
      if (selected === undefined) throw new Error('fixture has no parent task')
      let parentReads = 0
      f.teams.getTeam.mockImplementation(async ({ teamId }: { teamId: typeof parentId }) => {
        if (teamId === childId) {
          if (mode === 'late cancellation') f.setTask(teamTaskSnapshotSchema.parse({ ...selected, cancellation: {
            requestedRevision: 2, requestedAt: 3, requestedBy: 'human',
            target: { kind: 'delegation', delegationId: 'delegation', childTeamId: childId },
          } }))
          if (mode === 'terminal task') f.setTask({ ...selected, phase: 'completed' })
          throw new Error('child Team storage unavailable')
        }
        parentReads += 1
        const state = f.state(parentId)
        return mode === 'missing task' && parentReads > 1 ? { ...state, tasks: [] } : state
      })
      await f.consumer.drive(parentId)
      expect(f.teams.stallTaskDelegation).not.toHaveBeenCalled()
    },
  )

  it('does not reserve an unbound or dependency-blocked child task', async () => {
    const { f } = pendingCoordinatorFixture()
    const selected = f.state(parentId).tasks[0]
    if (selected === undefined) throw new Error('fixture has no parent task')
    f.setTask({ ...selected, delegation: undefined })
    await f.consumer.drive(parentId)
    expect(f.teams.beginTaskDelegation).not.toHaveBeenCalled()

    const dependency = teamTaskSnapshotSchema.parse({ ...selected, id: 'prior-task', phase: 'pending', attemptCount: 0,
      execution: { kind: 'participant' }, delegation: undefined })
    f.setTask({ ...selected, blockedBy: [dependency.id] })
    f.teams.getTeam.mockImplementation(async ({ teamId }: { teamId: typeof parentId }) => {
      const state = f.state(teamId)
      return teamId === parentId ? { ...state, tasks: [...state.tasks, dependency] } : state
    })
    await f.consumer.drive(parentId)
    expect(f.teams.beginTaskDelegation).not.toHaveBeenCalled()
    f.teams.getTeam.mockImplementation(async ({ teamId }: { teamId: typeof parentId }) => {
      const state = f.state(teamId)
      return teamId === parentId ? { ...state, tasks: [...state.tasks, { ...dependency, phase: 'completed' }] } : state
    })
    await f.consumer.drive(parentId)
    expect(f.teams.beginTaskDelegation).toHaveBeenCalledOnce()
  })

  it.each(['persisted cursor', 'missing creation'] as const)(
    'stalls a reservation whose child stream vanished after %s', async (reason) => {
      const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
      const selected = f.state(parentId).tasks[0]
      if (selected?.delegation === undefined) throw new Error('fixture has no parent delegation')
      f.setTask({ ...selected, cancellation: undefined, delegation: {
        ...selected.delegation, childCursor: reason === 'persisted cursor' ? 9 : undefined,
        creation: reason === 'missing creation' ? undefined : selected.delegation.creation,
      } })
      f.setChildExists(false)
      f.teams.stallTaskDelegation.mockResolvedValue(selected)
      await f.consumer.drive(parentId)
      expect(f.teams.stallTaskDelegation.mock.calls[0]?.[0].reason.code).toBe('TEAM_DELEGATION_CHILD_MISSING')
      expect(f.teams.createTeam).not.toHaveBeenCalled()
    },
  )

  it('reads past non-envelope records and later pages to admit the first child response', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.teams.readChannelPage.mockResolvedValueOnce({ channel: { phase: 'active' }, records: [
      { type: 'channel/opened' }, { type: 'channel/envelope', envelope: {
        id: envelopeIdSchema.parse('request'), kind: 'request', senderId: binding.parentServiceId,
      } },
    ], nextCursor: 7 } as never).mockResolvedValueOnce({ channel: { phase: 'closed' }, records: [
      { type: 'channel/envelope', envelope: {
        id: envelopeIdSchema.parse('response'), kind: 'response', senderId: binding.coordinatorId,
      } },
    ] })
    await f.consumer.drive(parentId)
    expect(f.teams.readChannelPage).toHaveBeenNthCalledWith(2, {
      channelId: binding.channelId, afterCursor: 7, limit: 16,
    })
    expect(f.teams.admitTaskDelegationResult).toHaveBeenCalledOnce()
  })

  it('stalls an orphaned child response when its parent task disappears during admission', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    let parentReads = 0
    f.teams.getTeam.mockImplementation(async ({ teamId }: { teamId: typeof parentId }) => {
      const state = f.state(teamId)
      if (teamId === parentId && ++parentReads === 2) return { ...state, tasks: [] }
      return state
    })
    const selected = f.state(parentId).tasks[0]
    if (selected === undefined) throw new Error('fixture has no parent task')
    f.teams.stallTaskDelegation.mockResolvedValue(selected)
    await f.consumer.drive(parentId)
    expect(f.teams.admitTaskDelegationResult).not.toHaveBeenCalled()
    expect(f.teams.stallTaskDelegation.mock.calls[0]?.[0].reason.code).toBe('TEAM_DELEGATION_INVALID')
  })

  it('admits a consult response returned immediately by a newly started child', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.setChildRun(undefined)
    f.teamRuns.startChild.mockResolvedValue(binding)
    await f.consumer.drive(parentId)
    expect(f.teamRuns.startChild).toHaveBeenCalledOnce()
    expect(f.teams.admitTaskDelegationResult).toHaveBeenCalledOnce()
    expect(f.teams.postChannelEnvelope).not.toHaveBeenCalled()
  })

  it('does not post a child objective when disposal begins during the consult read', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    f.setChildRun(undefined)
    f.teamRuns.startChild.mockResolvedValue(binding)
    const page = Promise.withResolvers<{ channel: { phase: 'active' }; records: [] }>()
    f.teams.readChannelPage.mockReturnValueOnce(page.promise)
    const running = f.consumer.drive(parentId)
    await vi.waitFor(() => { expect(f.teams.readChannelPage).toHaveBeenCalledOnce() })
    const closing = f.consumer.close()
    page.resolve({ channel: { phase: 'active' }, records: [] })
    await Promise.all([running, closing])
    expect(f.teams.postChannelEnvelope).not.toHaveBeenCalled()
  })

  it('ignores unrelated Team events and drops terminal child channel routes without a run', async () => {
    const f = setup(true)
    const drive = vi.spyOn(f.consumer, 'drive').mockResolvedValue(undefined)
    const state = f.state(parentId)
    f.emitTeam({ type: 'goal/changed', goal: state.goal, cursor: 1, createdAt: 1 })
    expect(drive).not.toHaveBeenCalled()
    const child = f.state(childId).team
    f.setChildRun(undefined)
    f.emitTeam({ type: 'team/changed', team: { ...child, phase: 'completed', childRun: undefined,
      goal: { ...child.goal, phase: 'complete' } } })
    expect(drive).toHaveBeenCalledWith(parentId)
  })

  it('can dispose a Consumer before it starts observing Teams', async () => {
    const consumer = new TeamDelegation({} as Context, {
      maxOperationsPerDrive: 1, channelPageSize: 1, teamPageSize: 1, pulseIntervalMs: 60000,
    })
    await expect(consumer.close()).resolves.toBeUndefined()
  })

  it('abandons a pending child reservation when the Consumer closes during workspace resolution', async () => {
    const { f } = pendingCoordinatorFixture()
    const eligibility = Promise.withResolvers<boolean>()
    f.eligible.mockReturnValueOnce(eligibility.promise)
    const running = f.consumer.drive(parentId)
    await vi.waitFor(() => { expect(f.eligible).toHaveBeenCalledOnce() })
    const closing = f.consumer.close()
    eligibility.resolve(true)
    await Promise.all([running, closing])
    expect(f.teams.beginTaskDelegation).not.toHaveBeenCalled()
    expect(f.teams.stallTaskDelegation).not.toHaveBeenCalled()
  })

  it('treats a closing-time actor rejection as a cancelled drive', async () => {
    const { f } = pendingCoordinatorFixture()
    const reservation = Promise.withResolvers<ReturnType<typeof f.state>['tasks'][number]>()
    f.teams.beginTaskDelegation.mockReturnValueOnce(reservation.promise)
    const running = f.consumer.drive(parentId)
    await vi.waitFor(() => { expect(f.teams.beginTaskDelegation).toHaveBeenCalledOnce() })
    const closing = f.consumer.close()
    reservation.reject(new TeamError('proof revoked', 'TEAM_ACTOR_PROOF_INVALID'))
    await Promise.all([running, closing])
    expect(f.teams.stallTaskDelegation).not.toHaveBeenCalled()
  })

  it('suppresses new event work and expected error logging while disposal awaits a failed read', async () => {
    const f = setup(true)
    const pending = Promise.withResolvers<TeamStateSnapshot>()
    f.teams.getTeam.mockReturnValueOnce(pending.promise)
    const task = f.state(parentId).tasks[0]
    if (task === undefined) throw new Error('fixture has no parent task')
    const routes = f.consumer as unknown as { readonly channels: Map<typeof binding.channelId, typeof parentId> }
    routes.channels.set(binding.channelId, parentId)
    f.emitTeam({ type: 'task/changed', task, cursor: 1, createdAt: 1 })
    await vi.waitFor(() => { expect(f.teams.getTeam).toHaveBeenCalledOnce() })
    const closing = f.consumer.close()
    await vi.waitFor(() => { expect(f.disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true) })
    const reads = f.teams.getTeam.mock.calls.length
    f.emitChannel(binding.channelId)
    expect(f.teams.getTeam).toHaveBeenCalledTimes(reads)
    const failure = new Error('Team read failed during disposal')
    pending.reject(failure)
    await expect(closing).rejects.toMatchObject({ errors: [failure] })
    expect(f.logger.warn).not.toHaveBeenCalled()
  })

  it('fails closed when a task loses its delegation during failed child read recovery', async () => {
    const f = setup(false, true, false, { items: [] }, undefined, { maxOperationsPerDrive: 1 })
    let parentReads = 0
    f.teams.getTeam.mockImplementation(async ({ teamId }: { teamId: typeof parentId }) => {
      if (teamId === childId) throw new Error('child stream unavailable')
      const state = f.state(parentId)
      if (++parentReads === 1) return state
      return { ...state, tasks: state.tasks.map(task => ({ ...task, delegation: undefined })) }
    })
    await expect(f.consumer.drive(parentId)).rejects.toMatchObject({ code: 'TEAM_DELEGATION_INVALID' })
    expect(f.teams.stallTaskDelegation).not.toHaveBeenCalled()
  })

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
