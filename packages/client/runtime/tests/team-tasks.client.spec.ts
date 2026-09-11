import { Context } from '@clocky/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId, TeamId, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-client-connection/client'
import type { TeamInboxPage, TeamActionResponseResult } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime, TeamTaskStartError } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

function teamId(value: string): TeamId {
  return value as TeamId
}

function setup(): { ctx: Context; api: FakeApiClient; tasks: TeamTaskRuntime } {
  const ctx = new Context()
  const api = new FakeApiClient()
  return { ctx, api, tasks: new TeamTaskRuntime(ctx, api) }
}

async function getTeamState(api: FakeApiClient, id: TeamId): Promise<TeamStateSnapshot> {
  const response = await api.onTeamGet({ teamId: id })
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

describe('TeamTaskRuntime', () => {
  it('rejects an older open response without replacing the latest selected Team', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const a = await getTeamState(api, teamId('older'))
      const b = await getTeamState(api, teamId('newer'))
      const older = deferred<Awaited<ReturnType<FakeApiClient['onTeamGet']>>>()
      const newer = deferred<Awaited<ReturnType<FakeApiClient['onTeamGet']>>>()
      api.onTeamGet = request => request.teamId === a.team.id ? older.promise : newer.promise
      const first = tasks.open(a.team.id)
      const second = tasks.open(b.team.id)
      newer.resolve(ok(b))
      await second
      older.resolve(ok(a))
      await expect(first).rejects.toMatchObject({ name: 'AbortError' })
      expect(tasks.list.getSnapshot()).toMatchObject({ current: b.team.id, selected: { teamId: b.team.id, state: b } })
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes current detail and keeps offline activations read-only during background refresh', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const initial = await tasks.open(teamId('live'))
      const next: TeamStateSnapshot = {
        ...initial.state,
        team: { ...initial.state.team, cursor: initial.state.team.cursor + 1 },
        goal: { ...initial.state.goal, objective: 'Updated by another client.' },
        activations: initial.state.activations.map(binding => ({ ...binding, activation: { ...binding.activation, status: 'offline' } })),
      }
      api.onTeamGet = () => Promise.resolve(ok(next))
      await tasks.refresh()
      expect(tasks.list.getSnapshot().selected?.state).toEqual(next)
      expect(tasks.teamForCoordinatorSession(initial.coordinatorSessionId)?.state).toEqual(next)
      expect(api.callsOf('team.resume')).toEqual([])
      api.onTeamGet = () => Promise.resolve(ok(initial.state))
      await tasks.refresh()
      expect(tasks.list.getSnapshot().selected?.state).toEqual(next)
    } finally { await ctx.fiber.dispose() }
  })

  it('loads members and tasks through independent bounded collection pages', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collections'))
      const firstMember = state.participants[0]
      const secondMember = state.participants[1]
      if (firstMember === undefined || secondMember === undefined) throw new Error('fixture needs two participants')
      const memberList = vi.spyOn(api.teams, 'memberList')
        .mockResolvedValueOnce(ok({ items: [firstMember], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [secondMember] }))
      const taskList = vi.spyOn(api.teams, 'taskList').mockResolvedValue(ok({ items: [] }))
      const workflowPlanList = vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [], nextCursor: 0 }))
      const artifact = { id: 'paged-artifact', provider: 'local', kind: 'report', uri: 'artifact://paged', visibility: 'team' } as never
      const secondArtifact = { id: 'paged-artifact-2', provider: 'local', kind: 'report', uri: 'artifact://paged-2', visibility: 'team' } as never
      const artifactList = vi.spyOn(api.teams, 'artifactList')
        .mockResolvedValueOnce(ok({ items: [artifact], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [secondArtifact] }))

      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections).toMatchObject({
        teamId: state.team.id,
        members: { items: [firstMember], nextCursor: 0, loading: false, loadingMore: false },
        tasks: { items: [], loading: false, loadingMore: false },
      })
      expect(taskList).toHaveBeenCalledWith({ teamId: state.team.id, afterCursor: -1, limit: 64 }, undefined)
      expect(workflowPlanList).toHaveBeenCalledWith({ teamId: state.team.id, afterCursor: -1, limit: 64 }, undefined)
      expect(artifactList).toHaveBeenCalledWith({ teamId: state.team.id, afterCursor: -1, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact])
      await tasks.readCollections(state.team.id, 'artifacts', true)
      expect(artifactList).toHaveBeenLastCalledWith({ teamId: state.team.id, afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact, secondArtifact])

      await tasks.readCollections(state.team.id, 'members', true)
      expect(memberList).toHaveBeenLastCalledWith({ teamId: state.team.id, afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.members.items).toEqual([firstMember, secondMember])
      memberList.mockRejectedValueOnce(new Error('member page unavailable'))
      await tasks.readCollections(state.team.id, 'members')
      expect(tasks.list.getSnapshot().collections?.members).toMatchObject({
        items: [firstMember, secondMember], loading: false, loadingMore: false, error: 'member page unavailable',
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('does not let a later task page replace an already published artifact page', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collection-order'))
      const taskPage = deferred<Awaited<ReturnType<FakeApiClient['teams']['taskList']>>>()
      const artifact = { id: 'ordered-artifact', provider: 'local', kind: 'report', uri: 'artifact://ordered', visibility: 'team' } as never
      const artifactPage = deferred<Awaited<ReturnType<FakeApiClient['teams']['artifactList']>>>()
      vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [] }))
      const taskList = vi.spyOn(api.teams, 'taskList').mockReturnValue(taskPage.promise)
      const artifactList = vi.spyOn(api.teams, 'artifactList').mockReturnValue(artifactPage.promise)

      const opening = tasks.open(state.team.id)
      await vi.waitFor(() => {
        expect(taskList).toHaveBeenCalledOnce()
        expect(artifactList).toHaveBeenCalledOnce()
      })
      artifactPage.resolve(ok({ items: [artifact] }))
      await vi.waitFor(() => { expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact]) })
      taskPage.resolve(ok({ items: [] }))
      await opening
      expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact])
    } finally { await ctx.fiber.dispose() }
  })

  it('drops a late collection page after the selected Team changes', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const first = await getTeamState(api, teamId('collection-old'))
      const second = await getTeamState(api, teamId('collection-new'))
      await tasks.open(first.team.id)
      const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['memberList']>>>()
      api.teams.memberList = payload => payload.teamId === first.team.id
        ? pending.promise
        : Promise.resolve(ok({ items: second.participants }))
      const late = tasks.readCollections(first.team.id, 'members', false)
      await tasks.open(second.team.id)
      pending.resolve(ok({ items: first.participants }))
      await late
      expect(tasks.list.getSnapshot().current).toBe(second.team.id)
      expect(tasks.list.getSnapshot().collections?.teamId).toBe(second.team.id)
      expect(tasks.list.getSnapshot().collections?.members.items).not.toEqual(first.participants)
    } finally { await ctx.fiber.dispose() }
  })

  it('retains collection rows and marks newer data without accepting a non-advancing cursor', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collection-cursor'))
      const task = { id: 'cursor-task' as never, teamId: state.team.id, revision: 1, subject: 'Cursor task', description: 'Task', phase: 'pending' as const,
        blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] } as never
      const taskList = vi.spyOn(api.teams, 'taskList')
        .mockResolvedValueOnce(ok({ items: [task], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [], nextCursor: 0 }))
      vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: state.participants }))
      vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      await tasks.readCollections(state.team.id, 'tasks', true)
      expect(taskList).toHaveBeenLastCalledWith({ teamId: state.team.id, afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.tasks).toMatchObject({
        items: [task], loading: false, loadingMore: false, error: 'tasks list returned a non-advancing page cursor',
      })

      const next = { ...state, team: { ...state.team, cursor: state.team.cursor + 1 } }
      api.onTeamGet = () => Promise.resolve(ok(next))
      await tasks.refresh()
      expect(tasks.list.getSnapshot().collections).toMatchObject({
        members: { hasNewer: true }, tasks: { hasNewer: true }, workflowPlans: { hasNewer: true }, artifacts: { hasNewer: true },
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes the selected task collection after a durable task-change event', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('task-change-refresh'))
      const stale = { id: 'child-row' as never, teamId: state.team.id, revision: 1, subject: 'Child row', description: 'Child', phase: 'running' as const,
        blockedBy: [], attemptCount: 1, maxAttempts: 1, attemptHistory: [], execution: { kind: 'child-team' as const },
        delegation: { id: 'delegation-row', phase: 'active' as const, requestedAt: 1, updatedAt: 1 } } as unknown as TeamTaskSnapshot
      const current = structuredClone(stale) as TeamTaskSnapshot
      Object.assign(current, { revision: 2, delegation: { ...stale.delegation, childTeamId: 'child-team' as never } })
      let reads = 0
      api.onTeamGet = async () => ok(reads++ === 0 ? { ...state, tasks: [stale] } : { ...state, team: { ...state.team, cursor: state.team.cursor + 1 }, tasks: [current] })
      let taskPages = 0
      api.teams.taskList = async () => ok({ items: [taskPages++ === 0 ? stale : current] })
      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections?.tasks.items[0]).toEqual(stale)
      tasks.handleMuxEnvelope({ type: 'team/changed', event: { type: 'task/changed', task: current, cursor: 1, createdAt: 2 } })
      await vi.waitFor(() => { expect(tasks.list.getSnapshot().collections?.tasks.items[0]?.delegation?.childTeamId).toBe('child-team') })
      expect(tasks.list.getSnapshot().selected?.state.tasks[0]?.revision).toBe(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes a first collection page without dropping loaded continuation rows', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collection-refresh'))
      const first = { id: 'refresh-task-1' as never, teamId: state.team.id, revision: 1, subject: 'First task', description: 'First',
        phase: 'pending' as const, blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] } as unknown as TeamTaskSnapshot
      const second = { id: 'refresh-task-2' as never, teamId: state.team.id, revision: 1, subject: 'Second task', description: 'Second',
        phase: 'pending' as const, blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] } as unknown as TeamTaskSnapshot
      const updatedFirst = { ...first, revision: 2, subject: 'First task updated' }
      vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      const taskList = vi.spyOn(api.teams, 'taskList')
        .mockResolvedValueOnce(ok({ items: [first], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [second] }))
        .mockResolvedValueOnce(ok({ items: [updatedFirst], nextCursor: 0 }))

      await tasks.open(state.team.id)
      await tasks.readCollections(state.team.id, 'tasks', true)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([first, second])
      await tasks.readCollections(state.team.id, 'tasks')
      expect(taskList).toHaveBeenCalledTimes(3)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([updatedFirst, second])
    } finally { await ctx.fiber.dispose() }
  })

  it('retains a newer marker when a workflow-plan read started before the Team cursor advanced', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('workflow-stale-read'))
      vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'taskList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)

      const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['workflowPlanList']>>>()
      const workflowPlans = vi.spyOn(api.teams, 'workflowPlanList').mockReturnValue(pending.promise)
      const read = tasks.readCollections(state.team.id, 'workflowPlans')
      await vi.waitFor(() => { expect(workflowPlans).toHaveBeenCalledOnce() })

      const next = { ...state, team: { ...state.team, cursor: state.team.cursor + 1 } }
      api.onTeamGet = () => Promise.resolve(ok(next))
      await tasks.refresh()
      pending.resolve(ok({ items: [] }))
      await read

      expect(tasks.list.getSnapshot().collections?.workflowPlans.hasNewer).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['members', 'tasks', 'workflowPlans', 'artifacts'] as const)(
    'preserves newer %s data and clears loading after a failed or cancelled page read', async (collection) => {
      const { ctx, api, tasks } = setup()
      try {
        const state = await getTeamState(api, teamId('collection-recovery'))
        await tasks.open(state.team.id)
        const method = { members: 'memberList', tasks: 'taskList', workflowPlans: 'workflowPlanList', artifacts: 'artifactList' } as const
        const readPage = vi.spyOn(api.teams, method[collection])
        for (const cancel of [false, true]) {
          const before = tasks.list.getSnapshot().collections![collection]
          const pending = deferred<never>()
          readPage.mockReturnValueOnce(pending.promise)
          const controller = new AbortController()
          const reading = tasks.readCollections(state.team.id, collection, false, controller.signal)
          const selected = tasks.list.getSnapshot().selected!.state
          api.onTeamGet = () => Promise.resolve(ok({ ...selected, team: { ...selected.team, cursor: selected.team.cursor + 1 } }))
          await tasks.refresh()
          expect(tasks.list.getSnapshot().collections?.[collection].hasNewer).toBe(true)
          if (cancel) controller.abort()
          pending.reject(new Error('page request failed'))
          await reading
          expect(tasks.list.getSnapshot().collections?.[collection]).toMatchObject({
            items: before.items, loading: false, loadingMore: false, hasNewer: true,
            error: cancel ? undefined : 'page request failed',
          })
          readPage.mockResolvedValueOnce(ok({ items: [] }))
          await tasks.readCollections(state.team.id, collection)
          expect(tasks.list.getSnapshot().collections?.[collection]).toMatchObject({ loading: false, loadingMore: false, hasNewer: false })
        }
      } finally { await ctx.fiber.dispose() }
    },
  )

  it('retains a draft created while a list refresh is in flight', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onTeamList']>>>()
      api.onTeamList = () => pending.promise
      const refresh = tasks.refresh()
      tasks.startDraft({ agentPreset: 'cordis' })
      const draft = tasks.list.getSnapshot().draft
      pending.resolve(ok({ items: [] }))
      await refresh
      expect(tasks.list.getSnapshot().draft).toEqual(draft)
    } finally { await ctx.fiber.dispose() }
  })

  it('single-flights list refreshes, retains failures, and refreshes after reconnect', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onTeamList']>>>()
      api.onTeamList = () => pending.promise
      const first = tasks.refresh()
      const second = tasks.refresh()
      expect(tasks.list.getSnapshot().state).toBe('loading')
      pending.resolve(ok({ items: [] }))
      await Promise.all([first, second])
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }])
      expect(tasks.list.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', items: [] })

      api.onTeamList = () => Promise.resolve(err({ code: 'internal', message: 'Team list unavailable', details: {} }))
      await tasks.refresh()
      expect(tasks.list.getSnapshot()).toMatchObject({
        phase: 'ready', state: 'error', error: { message: 'Team list unavailable' },
      })

      api.onTeamList = () => Promise.reject(new Error('connection lost'))
      await tasks.refresh()
      expect(tasks.list.getSnapshot()).toMatchObject({
        phase: 'ready', state: 'error', error: { code: 'internal', message: 'connection lost' },
      })

      api.onTeamList = () => Promise.resolve(ok({ items: [] }))
      tasks.handleConnected()
      await tasks.refresh()
      expect(api.callsOf('team.list')).toHaveLength(4)
      expect(tasks.list.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', error: null })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refreshes selected bounded collections after reconnect without changing selection', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('reconnect-collections'))
      const initialTask = { id: 'reconnect-task-initial' as never, teamId: state.team.id, revision: 1,
        subject: 'Initial', description: 'Initial task', phase: 'pending' as const, blockedBy: [], attemptCount: 0,
        maxAttempts: 1, attemptHistory: [] } as unknown as TeamTaskSnapshot
      const refreshedTask = { ...initialTask, revision: 2, subject: 'Refreshed' }
      vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: state.participants }))
      vi.spyOn(api.teams, 'taskList').mockResolvedValueOnce(ok({ items: [initialTask] }))
        .mockResolvedValue(ok({ items: [refreshedTask] }))
      vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([initialTask])

      tasks.handleDisconnected()
      tasks.handleConnected()
      await vi.waitFor(() => {
        expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([refreshedTask])
      })
      expect(tasks.list.getSnapshot().current).toBe(state.team.id)
    } finally { await ctx.fiber.dispose() }
  })

  it('drops a collection page from the disconnected connection generation', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('reconnect-generation'))
      const firstMember = state.participants[0]
      if (firstMember === undefined) throw new Error('reconnect fixture needs a participant')
      const freshMember = { ...firstMember, displayName: 'Fresh after reconnect' }
      const memberList = vi.spyOn(api.teams, 'memberList').mockResolvedValue(ok({ items: [firstMember] }))
      vi.spyOn(api.teams, 'taskList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'workflowPlanList').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      const stale = deferred<Awaited<ReturnType<FakeApiClient['teams']['memberList']>>>()
      memberList.mockReturnValueOnce(stale.promise).mockResolvedValue(ok({ items: [freshMember] }))
      const oldRead = tasks.readCollections(state.team.id, 'members')
      await vi.waitFor(() => { expect(memberList).toHaveBeenCalledTimes(2) })
      tasks.handleDisconnected()
      tasks.handleConnected()
      await vi.waitFor(() => {
        expect(tasks.list.getSnapshot().collections?.members.items).toEqual([freshMember])
      })
      stale.resolve(ok({ items: [firstMember] }))
      await oldRead
      expect(tasks.list.getSnapshot().collections?.members.items).toEqual([freshMember])
    } finally { await ctx.fiber.dispose() }
  })

  it('loads further Team pages only on request and refreshes the requested page range', async () => {
    const { ctx, api, tasks } = setup()
    try {
      api.onTeamList = payload => Promise.resolve(payload.afterCursor === -1
        ? ok({ items: [], nextCursor: 0 })
        : ok({ items: [] }))
      await tasks.refresh()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }])
      expect(tasks.list.getSnapshot().nextCursor).toBe(0)
      await tasks.loadMore()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }, { afterCursor: 0 }])
      await tasks.refresh()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }, { afterCursor: 0 }, { afterCursor: -1 }, { afterCursor: 0 }])
      expect(tasks.list.getSnapshot()).toMatchObject({ phase: 'ready', state: 'idle', items: [] })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a configured local draft side-effect free until first input starts a Team', async () => {
    const { ctx, api, tasks } = setup()
    try {
      tasks.startDraft({ agentPreset: 'cordis' })
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      if (draft.agentPreset === undefined) throw new Error('Team draft lost its coordinator preset')
      expect(draft).toMatchObject({ phase: 'ready', agentPreset: 'cordis' })
      expect(api.calls).toEqual([])

      const selected = await tasks.start({
        text: '  Start the durable Team task.  ', cwd: '/workspace', agentPreset: draft.agentPreset,
      })
      expect(selected.teamId).toBe('runtime-fk-team')
      expect(selected.coordinatorSessionId).toBe('runtime-fk-team-session-runtime-fk-team')
      expect(tasks.list.getSnapshot()).toMatchObject({ current: selected.teamId, draft: undefined })
      expect(api.callsOf('team.start')).toEqual([{
        objective: 'Start the durable Team task.',
        text: 'Start the durable Team task.',
        idempotencyKey: draft.idempotencyKey,
        cwd: '/workspace',
        agentPreset: 'cordis',
      }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('carries draft project and model choices into the atomic Team start request', async () => {
    const { ctx, api, tasks } = setup()
    try {
      tasks.startDraft({
        cwd: '/workspace/project',
        selection: { provider: 'local', model: 'qwen', reasoningEffort: 'high' },
      })
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      const updatedSelection = { provider: 'local', model: 'qwen', reasoningEffort: 'xhigh' }
      tasks.updateDraft({ selection: updatedSelection })
      await tasks.start({ text: 'Use the selected draft options.' })
      expect(api.callsOf('team.start')).toEqual([{
        objective: 'Use the selected draft options.',
        text: 'Use the selected draft options.',
        idempotencyKey: draft.idempotencyKey,
        cwd: '/workspace/project',
        selection: updatedSelection,
      }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('deletes a lease-free task and updates the selected Team detail projection', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const selected = await tasks.open(teamId('delete-task'))
      const task = {
        id: 'delete-task-item' as never,
        teamId: selected.teamId,
        revision: 3,
        subject: 'Remove this task',
        description: 'A lease-free task.',
        phase: 'pending' as const,
        blockedBy: [],
        attemptCount: 0,
        maxAttempts: 1,
        attemptHistory: [],
      }
      tasks.list.set({
        ...tasks.list.getSnapshot(),
        selected: { ...selected, state: { ...selected.state, tasks: [task] as never } },
      })
      api.onTeamTaskDelete = payload => Promise.resolve(ok({
        ...task,
        revision: payload.expectedRevision + 1,
        phase: 'deleted' as const,
      } as never))
      await expect(tasks.deleteTask(selected.teamId, task.id, task.revision)).resolves.toMatchObject({ phase: 'deleted' })
      expect(api.callsOf('team.task.delete')).toEqual([{
        teamId: selected.teamId, taskId: task.id, expectedRevision: task.revision,
      }])
      expect(tasks.list.getSnapshot().selected?.state.tasks[0]).toMatchObject({ phase: 'deleted', revision: 4 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a running task and updates the selected Team detail projection', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const selected = await tasks.open(teamId('cancel-task'))
      const task = {
        id: 'cancel-task-item' as never,
        teamId: selected.teamId,
        revision: 3,
        subject: 'Stop this task',
        description: 'A running task.',
        phase: 'running' as const,
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [],
        lease: { attemptId: 'cancel-attempt' as never, participantId: 'worker' as never, activationId: 'activation' as never },
      }
      tasks.list.set({
        ...tasks.list.getSnapshot(),
        selected: { ...selected, state: { ...selected.state, tasks: [task] as never } },
      })
      api.onTeamTaskCancel = payload => Promise.resolve(ok({
        ...task,
        revision: payload.expectedRevision + 1,
        phase: 'cancelled' as const,
      } as never))
      await expect(tasks.cancelTask?.(selected.teamId, task.id, task.revision, 'Stop from details')).resolves.toMatchObject({ phase: 'cancelled' })
      expect(api.callsOf('team.task.cancel')).toEqual([{
        teamId: selected.teamId,
        taskId: task.id,
        expectedRevision: task.revision,
        reason: 'Stop from details',
      }])
      expect(tasks.list.getSnapshot().selected?.state.tasks[0]).toMatchObject({ phase: 'cancelled', revision: 4 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('polls after task cancellation until the durable lease-free phase is visible', async () => {
    vi.useFakeTimers()
    const { ctx, api, tasks } = setup()
    try {
      const selected = await tasks.open(teamId('cancel-poll-task'))
      const task = {
        id: 'cancel-poll-item' as never,
        teamId: selected.teamId,
        revision: 3,
        subject: 'Stop and settle this task',
        description: 'A task whose cancellation settles asynchronously.',
        phase: 'running' as const,
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [],
        lease: { attemptId: 'cancel-poll-attempt' as never, participantId: 'worker' as never, activationId: 'activation' as never },
      }
      const stopping = {
        ...task,
        revision: 4,
        cancellation: { requestedRevision: 4 },
      } as never
      const settled = { ...task, revision: 5, phase: 'failed' as const, lease: undefined, cancellation: undefined } as never
      tasks.list.set({ ...tasks.list.getSnapshot(), selected: { ...selected, state: { ...selected.state, tasks: [task] as never } } })
      api.onTeamTaskCancel = () => Promise.resolve(ok(stopping))
      api.onTeamTaskGet = () => Promise.resolve(ok(settled))
      await expect(tasks.cancelTask?.(selected.teamId, task.id, task.revision, 'Stop from details')).resolves.toMatchObject({ phase: 'running', revision: 4 })
      await vi.advanceTimersByTimeAsync(1_000)
      expect(api.callsOf('team.task.get')).toEqual([{ teamId: selected.teamId, taskId: task.id }])
      expect(tasks.list.getSnapshot().selected?.state.tasks[0]).toMatchObject({ phase: 'failed', revision: 5 })
    } finally {
      vi.useRealTimers()
      await ctx.fiber.dispose()
    }
  })

  it('abandons drafts locally and rejects a submission without one', async () => {
    const { ctx, api, tasks } = setup()
    try {
      expect(() => tasks.start({ text: 'No draft.' })).toThrow('start a new task')
      tasks.startDraft()
      expect(tasks.list.getSnapshot().draft).toMatchObject({ phase: 'ready' })
      tasks.abandonDraft()
      expect(tasks.list.getSnapshot().draft).toBeUndefined()
      expect(api.calls).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('retains a failed draft key for an exact retry and rejects changed retry input', async () => {
    const { ctx, api, tasks } = setup()
    try {
      tasks.startDraft()
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      const startSuccess = api.onTeamStart
      api.onTeamStart = () => Promise.resolve(err({ code: 'team-start-conflict', message: 'start conflict', details: {} }))

      await expect(tasks.start({ text: 'Retry this task.' })).rejects.toBeInstanceOf(TeamTaskStartError)
      expect(tasks.list.getSnapshot().draft).toMatchObject({
        idempotencyKey: draft.idempotencyKey,
        phase: 'error',
        fingerprint: JSON.stringify({ text: 'Retry this task.', cwd: undefined, agentPreset: undefined }),
      })
      await expect(tasks.start({ text: 'Different text.' })).rejects.toThrow('begin a new task')

      api.onTeamStart = startSuccess
      await expect(tasks.start({ text: 'Retry this task.' })).resolves.toMatchObject({
        teamId: 'runtime-fk-team',
      })
      expect(api.callsOf('team.start')).toEqual([
        { objective: 'Retry this task.', text: 'Retry this task.', idempotencyKey: draft.idempotencyKey },
        { objective: 'Retry this task.', text: 'Retry this task.', idempotencyKey: draft.idempotencyKey },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('retains a draft after a transport failure and ignores draft changes while it starts', async () => {
    const { ctx, api, tasks } = setup()
    try {
      tasks.startDraft()
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      const startSuccess = api.onTeamStart

      api.onTeamStart = () => Promise.reject(new Error('connection lost'))
      await expect(tasks.start({ text: 'Retry after reconnect.' })).rejects.toMatchObject({
        name: 'TeamTaskStartError',
        message: 'connection lost',
        rpcError: undefined,
      })
      expect(tasks.list.getSnapshot().draft).toMatchObject({
        idempotencyKey: draft.idempotencyKey,
        phase: 'error',
        error: undefined,
        message: 'connection lost',
      })

      const pending = deferred<Awaited<ReturnType<FakeApiClient['onTeamStart']>>>()
      api.onTeamStart = () => pending.promise
      const first = tasks.start({ text: 'Retry after reconnect.' })
      const second = tasks.start({ text: 'Retry after reconnect.' })
      tasks.startDraft()
      tasks.abandonDraft()
      expect(tasks.list.getSnapshot().draft).toMatchObject({
        idempotencyKey: draft.idempotencyKey,
        phase: 'starting',
      })
      pending.resolve(await startSuccess({
        objective: 'Retry after reconnect.',
        text: 'Retry after reconnect.',
        idempotencyKey: draft.idempotencyKey,
      }))
      await expect(Promise.all([first, second])).resolves.toHaveLength(2)
      expect(api.callsOf('team.start')).toHaveLength(2)
      expect(api.callsOf('team.start')).toEqual([
        { objective: 'Retry after reconnect.', text: 'Retry after reconnect.', idempotencyKey: draft.idempotencyKey },
        { objective: 'Retry after reconnect.', text: 'Retry after reconnect.', idempotencyKey: draft.idempotencyKey },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps a retryable draft when a started Team lacks a coordinator transcript', async () => {
    const { ctx, api, tasks } = setup()
    try {
      tasks.startDraft()
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      const state = await getTeamState(api, teamId('runtime-fk-team'))
      api.onTeamStart = () => Promise.resolve(ok({
        state: { ...state, activations: [] },
        envelopeId: 'runtime-fk-team-envelope' as never,
      }))

      await expect(tasks.start({ text: 'Incomplete coordinator state.' })).rejects.toThrow('has no coordinator activation')
      expect(tasks.list.getSnapshot().draft).toMatchObject({
        idempotencyKey: draft.idempotencyKey,
        phase: 'error',
        error: undefined,
        message: "Team 'runtime-fk-team' has no coordinator activation",
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('opens a durable Team and resolves its coordinator transcript', async () => {
    const { ctx, tasks } = setup()
    try {
      const selected = await tasks.open(teamId('runtime-fk-team'))
      expect(selected.teamId).toBe('runtime-fk-team')
      expect(selected.coordinatorSessionId).toBe('runtime-fk-team-session-runtime-fk-team')
      expect(tasks.list.getSnapshot().current).toBe(selected.teamId)
      await tasks.open(teamId('runtime-fk-team'))
      expect(tasks.list.getSnapshot().items).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads the current Team cursor immediately before an actor-free resume request', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const initial = await getTeamState(api, id)
      const current = {
        ...initial,
        team: { ...initial.team, cursor: 17 },
        activations: initial.activations.map(binding => ({
          ...binding,
          activation: { ...binding.activation, status: 'offline' as const },
        })),
      }
      const resumed = {
        ...current,
        team: { ...current.team, cursor: 18 },
        activations: current.activations.map(binding => ({
          ...binding,
          activation: { ...binding.activation, status: 'idle' as const },
        })),
      }
      let didResume = false
      api.onTeamGet = () => Promise.resolve(ok(didResume ? resumed : current))
      api.onTeamResume = () => {
        didResume = true
        return Promise.resolve(ok(resumed))
      }
      await tasks.refresh()
      const before = api.calls.length

      await expect(tasks.resume(id)).resolves.toMatchObject({ teamId: id })
      expect(api.calls.slice(before)).toEqual([
        { method: 'team.get', payload: { teamId: id } },
        { method: 'team.resume', payload: { teamId: id, expectedCursor: 17 } },
        { method: 'team.get', payload: { teamId: id } },
        { method: 'team.member.list', payload: { teamId: id, afterCursor: -1, limit: 64 } },
        { method: 'team.task.list', payload: { teamId: id, afterCursor: -1, limit: 64 } },
        { method: 'team.workflow.plan.list', payload: { teamId: id, afterCursor: -1, limit: 64 } },
        { method: 'team.artifact.list', payload: { teamId: id, afterCursor: -1, limit: 64 } },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('surfaces a fresh-cursor resume conflict without fabricating a retry cursor', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const initial = await getTeamState(api, id)
      const current = {
        ...initial,
        team: { ...initial.team, cursor: 23 },
        activations: initial.activations.map(binding => ({
          ...binding,
          activation: { ...binding.activation, status: 'offline' as const },
        })),
      }
      api.onTeamGet = () => Promise.resolve(ok(current))
      api.onTeamResume = () => Promise.resolve(err({
        code: 'team-cursor-conflict', message: 'Team changed before resume.', details: { teamId: id },
      }))
      await tasks.refresh()

      await expect(tasks.resume(id)).rejects.toMatchObject({
        name: 'TeamTaskStartError',
        rpcError: { code: 'team-cursor-conflict', message: 'Team changed before resume.' },
      })
      expect(api.callsOf('team.resume')).toEqual([{ teamId: id, expectedCursor: 23 }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves ownership for every selected Participant Session', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const state = await getTeamState(api, id)
      const workerId = 'runtime-fk-team-worker' as typeof state.participants[number]['id']
      const workerSession = 'runtime-fk-team-worker-session' as SessionId
      const coordinator = state.participants.find(participant => participant.role === 'coordinator')
      const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator?.id)
      if (coordinator === undefined || coordinatorBinding === undefined) throw new Error('fake Team coordinator missing')
      api.onTeamGet = () => Promise.resolve(ok({
        ...state,
        participants: [...state.participants, {
          ...coordinator, id: workerId, displayName: 'Runtime fake worker', role: 'worker' as const,
        }],
        activations: [...state.activations, {
          ...coordinatorBinding,
          sessionId: workerSession,
          activation: { ...coordinatorBinding.activation, id: 'runtime-fk-team-worker-activation' as never, participantId: workerId },
        }],
      }))
      const selected = await tasks.open(id)
      expect(tasks.teamForSession(selected.coordinatorSessionId)).toBe(id)
      expect(tasks.teamForSession(workerSession)).toBe(id)
      expect(tasks.teamForSession('runtime-fk-team-missing' as SessionId)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('projects Team-bound approval and question requests and removes them on resolution', async () => {
    const { ctx, tasks } = setup()
    try {
      const selected = await tasks.open(teamId('runtime-fk-team'))
      tasks.handleMuxEnvelope({
        rpcId: 'approval-request' as never,
        payload: {
          type: 'approval/requested',
          sessionId: selected.coordinatorSessionId,
          approvalId: 'approval-1' as never,
          toolName: 'bash',
          reason: 'Run the requested command',
          teamId: selected.teamId,
          participantId: 'participant-1' as never,
          taskId: 'task-1' as never,
        },
      })
      tasks.handleMuxEnvelope({
        rpcId: 'question-request',
        payload: {
          type: 'question/requested',
          sessionId: selected.coordinatorSessionId,
          questions: [{ id: 'q1', question: 'Continue?' }],
          teamId: selected.teamId,
        },
      } as never)
      expect(tasks.list.getSnapshot().pendingHumanActions).toMatchObject([
        { kind: 'approval', toolName: 'bash', taskId: 'task-1' },
        { kind: 'question', questionRpcId: 'question-request' },
      ])

      tasks.handleMuxEnvelope({
        rpcId: 'approval-resolved' as never,
        payload: {
          type: 'approval/resolved',
          sessionId: selected.coordinatorSessionId,
          approvalId: 'approval-1' as never,
          outcome: 'allowed-once',
        },
      })
      tasks.handleMuxEnvelope({
        rpcId: 'question-resolved' as never,
        payload: {
          type: 'question/resolved',
          sessionId: selected.coordinatorSessionId,
          questionRpcId: 'question-request' as never,
          outcome: 'answered',
        },
      })
      expect(tasks.list.getSnapshot().pendingHumanActions).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('archives a terminal Team and removes it from the browser list', async () => {
    const { ctx, api, tasks } = setup()
    try {
      await tasks.refresh()
      const id = teamId('runtime-fk-team')
      const archived = await tasks.archive(id)
      expect(archived.team.archivedAt).toBe(3)
      expect(tasks.list.getSnapshot()).toMatchObject({ current: undefined, items: [] })
      expect(api.callsOf('team.archive')).toEqual([{ teamId: id, expectedCursor: 0 }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects Team selections without a coordinator participant or activation', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const state = await getTeamState(api, id)
      api.onTeamGet = () => Promise.resolve(err({ code: 'internal', message: 'Team unavailable', details: {} }))
      await expect(tasks.open(id)).rejects.toMatchObject({
        name: 'TeamTaskStartError',
        rpcError: { message: 'Team unavailable' },
      })

      api.onTeamGet = () => Promise.resolve(ok({
        ...state,
        participants: state.participants.filter(participant => participant.role !== 'coordinator'),
      }))
      await expect(tasks.open(id)).rejects.toThrow('has no coordinator participant')

      api.onTeamGet = () => Promise.resolve(ok({ ...state, activations: [] }))
      await expect(tasks.open(id)).rejects.toThrow('has no coordinator activation')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads bounded Team audit and channel projections through the API owner', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const audit = { teamId: id, items: [{ teamId: id, stream: 'team' as const, cursor: 0, type: 'team/created', createdAt: 1, facts: {} }] }
      api.onTeamAuditRead = () => Promise.resolve(ok(audit))
      api.onTeamChannelRead = payload => Promise.resolve(ok({ channel: { manifest: { id: payload.channelId, teamId: id,
        adapter: { type: 'direct', version: 4 }, participants: [], limits: {} }, phase: 'closed', cursor: 0 }, records: [] }))
      await expect(tasks.readAudit(id, { afterCursor: 3, limit: 4 })).resolves.toEqual(audit)
      await expect(tasks.readChannel('runtime-channel' as never, 7)).resolves.toMatchObject({ records: [] })
      expect(api.callsOf('team.audit.read')).toEqual([{ teamId: id, afterCursor: 3, limit: 4 }])
      expect(api.callsOf('team.channel.read')).toEqual([{ channelId: 'runtime-channel', afterCursor: 7 }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads a visible artifact through the Host API owner', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-artifact-team')
      const artifact = {
        artifact: { id: 'local:report', provider: 'local', kind: 'report' as const, uri: 'artifact-local://local/report', visibility: 'team' as const },
        bytes: 4,
        data: 'dGVzdA==',
      }
      api.onTeamArtifactRead = () => Promise.resolve(ok(artifact))
      await expect(tasks.readArtifact(id, 'local:report')).resolves.toEqual(artifact)
      expect(api.callsOf('team.artifact.read')).toEqual([{ teamId: id, artifactId: 'local:report' }])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})


describe('Team management reconciliation', () => {
  it('refreshes authoritative state after a rejected write while retaining the typed Host error', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const selection = await tasks.open(teamId('management'))
      const next = { ...selection.state, team: { ...selection.state.team, cursor: selection.state.team.cursor + 1 } }
      api.onTeamGet = async () => ok(next)
      const conflict = { code: 'team-cursor-conflict' as const, message: 'Team cursor changed', details: {} }
      api.onTeamMemberActivate = async () => err(conflict)
      await expect(tasks.manage(selection.teamId, {
        operation: 'memberActivate', input: { participantId: 'worker' as never, expectedCursor: selection.state.team.cursor },
      })).rejects.toMatchObject({ rpcError: conflict })
      expect(tasks.list.getSnapshot().selected?.state.team.cursor).toBe(next.team.cursor)
      expect(api.callsOf('team.member.activate')).toEqual([{
        teamId: selection.teamId, participantId: 'worker', expectedCursor: selection.state.team.cursor,
      }])
    } finally { await ctx.fiber.dispose() }
  })

  it('does not send a channel mutation outside the selected Team', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const selection = await tasks.open(teamId('channel-owner'))
      await expect(tasks.manage(selection.teamId, {
        operation: 'channelClose', input: { channelId: 'another-team-channel' as never, expectedCursor: 1 },
      })).rejects.toThrow('is not in selected Team')
      expect(api.callsOf('team.channel.close')).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })
})


function inboxMessage(sequence: number, team = 'inbox-team'): TeamInboxPage['items'][number] {
  return { kind: 'message', sequence, principalId: 'principal', recipientId: 'human', teamId: team,
    channelId: 'channel', envelopeId: `envelope-${sequence}`, envelope: {}, text: `Message ${sequence}`,
  } as unknown as TeamInboxPage['items'][number]
}

describe('Principal inbox runtime', () => {
  it('pages the unfiltered global prefix and acknowledges its last loaded item, not the tail cursor', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const first: TeamInboxPage = { items: [inboxMessage(0, 'team-a'), inboxMessage(1, 'team-b')], displayCursor: -1, cursor: 10, nextCursor: 1 }
      const second: TeamInboxPage = { items: [inboxMessage(2, 'team-a')], displayCursor: -1, cursor: 10 }
      const read = vi.spyOn(api.teams, 'inboxRead').mockResolvedValueOnce(ok(first)).mockResolvedValueOnce(ok(second))
      const acknowledge = vi.spyOn(api.teams, 'inboxAcknowledge').mockResolvedValue(ok({ displayCursor: 2 }))
      await tasks.refreshInbox()
      expect(read).toHaveBeenCalledWith({}, undefined)
      expect(tasks.list.getSnapshot().inbox?.items).toHaveLength(2)
      await tasks.loadMoreInbox()
      expect(read).toHaveBeenLastCalledWith({ afterCursor: 1 }, undefined)
      await tasks.acknowledgeInbox()
      expect(acknowledge).toHaveBeenCalledWith({ throughCursor: 2 }, undefined)
      expect(tasks.list.getSnapshot().inbox?.displayCursor).toBe(2)
      vi.spyOn(api.teams, 'inboxWatch').mockResolvedValue(ok({ items: [], displayCursor: 1, cursor: 10 }))
      await tasks.watchInbox(new AbortController().signal)
      expect(tasks.list.getSnapshot().inbox?.displayCursor).toBe(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('announces newer deliveries and appends them only after an explicit request', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const read = vi.spyOn(api.teams, 'inboxRead').mockResolvedValueOnce(ok({ items: [inboxMessage(0)], displayCursor: -1, cursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [inboxMessage(1)], displayCursor: -1, cursor: 1 }))
      vi.spyOn(api.teams, 'inboxWatch').mockResolvedValue(ok({ items: [inboxMessage(1)], displayCursor: -1, cursor: 1 }))
      await tasks.refreshInbox()
      await tasks.watchInbox(new AbortController().signal)
      expect(tasks.list.getSnapshot().inbox).toMatchObject({ hasNewer: true, cursor: 0 })
      expect(tasks.list.getSnapshot().inbox?.items).toHaveLength(1)
      await tasks.loadMoreInbox()
      expect(read).toHaveBeenLastCalledWith({ afterCursor: 0 }, undefined)
      expect(tasks.list.getSnapshot().inbox).toMatchObject({ hasNewer: false, cursor: 1 })
      expect(tasks.list.getSnapshot().inbox?.items).toHaveLength(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not restore a previous connection inbox from a late display acknowledgement', async () => {
    const { ctx, api, tasks } = setup()
    try {
      vi.spyOn(api.teams, 'inboxRead').mockResolvedValue(ok({ items: [inboxMessage(7)], displayCursor: -1, cursor: 7 }))
      const pending = deferred<Awaited<ReturnType<typeof api.teams.inboxAcknowledge>>>()
      vi.spyOn(api.teams, 'inboxAcknowledge').mockReturnValue(pending.promise)
      await tasks.refreshInbox()
      const acknowledging = tasks.acknowledgeInbox()
      tasks.handleConnected()
      pending.resolve(ok({ displayCursor: 7 }))
      await acknowledging
      await tasks.refresh()
      expect(tasks.list.getSnapshot().inbox).toMatchObject({ items: [], displayCursor: -1, acknowledging: false })
    } finally { await ctx.fiber.dispose() }
  })

  it('reconciles a historical pending action with its current accepted revision', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('inbox-current'))
      const original: TeamActionResponseResult['action'] = { id: 'approval' as TeamActionResponseResult['action']['id'],
        teamId: state.team.id, kind: 'approval', phase: 'pending', updatedAt: 1,
        createdAt: 1, sessionId: state.activations[0]!.sessionId, participantId: state.participants[0]!.id,
        sourceId: 'source' as TeamActionResponseResult['action']['sourceId'], details: { toolName: 'bash' },
      }
      const current: TeamActionResponseResult['action'] = { ...original, phase: 'resolved', updatedAt: 2 }
      vi.spyOn(api.teams, 'inboxRead').mockResolvedValue(ok({ items: [{ kind: 'action', sequence: 0,
        principalId: 'principal' as TeamInboxPage['items'][number]['principalId'],
        recipientId: 'human' as TeamInboxPage['items'][number]['recipientId'], teamId: state.team.id, action: original, text: 'approval' }], displayCursor: -1, cursor: 0 }))
      api.onTeamGet = async () => ok({ ...state, humanActions: [current] })
      await tasks.refreshInbox()
      await expect(tasks.readAction(state.team.id, original.id)).resolves.toEqual(current)
      const entry = tasks.list.getSnapshot().inbox?.items[0]
      expect(entry?.kind === 'action' ? entry.action.phase : undefined).toBe('resolved')
    } finally { await ctx.fiber.dispose() }
  })

  it('inspects an offline action Team without starting a replacement activation', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('offline-context'))
      const offline = { ...state, activations: state.activations.map(binding => ({ ...binding, activation: { ...binding.activation, status: 'offline' as const } })) }
      api.onTeamGet = async () => ok(offline)
      await tasks.inspect(state.team.id)
      expect(tasks.list.getSnapshot().current).toBe(state.team.id)
      expect(api.callsOf('team.resume')).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })
})
