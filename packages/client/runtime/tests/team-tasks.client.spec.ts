import { Context } from '@clocky/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { MuxFrame, SessionId, TeamId, TeamStateSnapshot, TeamTaskSnapshot } from '@clocky/clocky-client-connection/client'
import type { TeamInboxPage, TeamActionResponseResult, TeamTaskListState } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime, TeamTaskStartError } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok, selectionView, memberSummary } from './fake-api.client.ts'

function teamId(value: string): TeamId {
  return value as TeamId
}

function coordinatorOwner(selection: Awaited<ReturnType<TeamTaskRuntime['inspect']>>) {
  const coordinator = selection.state.coordinator
  if (coordinator.kind !== 'bound') throw new Error('Fixture coordinator unavailable')
  return { teamId: selection.teamId, participantId: coordinator.binding.activation.participantId }
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

/** Minimal summary data for tests that vary task paging independently from full-state reads. */
function summary(task: TeamTaskSnapshot) {
  return { id: task.id, teamId: task.teamId, revision: task.revision, phase: task.phase,
    subject: { text: task.subject, truncated: false }, executionKind: task.execution?.kind ?? 'participant',
    childTeamId: task.delegation?.childTeamId, priority: task.priority ?? 0,
    attemptCount: task.attemptCount, maxAttempts: task.maxAttempts, dependencyCount: task.blockedBy.length,
    reviewCount: task.reviewHistory?.length ?? 0, hasLease: task.lease !== undefined,
    cancellationRequested: task.cancellation !== undefined }
}
function summaryPage(state: TeamStateSnapshot, page: { items: readonly TeamTaskSnapshot[]; nextCursor?: number }) {
  return { kind: 'tasks' as const, teamId: state.team.id, teamCursor: state.team.cursor,
    total: page.nextCursor === undefined ? page.items.length : page.nextCursor + 2,
    scanned: page.items.length, items: page.items.map(summary), ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor } }
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
      expect(tasks.list.getSnapshot()).toMatchObject({ current: b.team.id, selected: { teamId: b.team.id, state: selectionView(b) } })
    } finally { await ctx.fiber.dispose() }
  })

  it('opens and refreshes selection without any complete Team read', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const completeRead = vi.spyOn(api.teams, 'get').mockRejectedValue(new Error('Complete Team reads are forbidden'))
      const id = teamId('runtime-fk-team')
      await tasks.inspect(id)
      await tasks.refresh()
      const selected = tasks.list.getSnapshot().selected!.state
      expect(selected.metadata?.kind).toBe('available')
      for (const field of ['tasks', 'participants', 'activations', 'channelIds', 'humanActions', 'workspaceAllocations']) {
        expect(selected).not.toHaveProperty(field)
      }
      expect(completeRead).not.toHaveBeenCalled()
      expect(api.callsOf('team.selection').length).toBeGreaterThanOrEqual(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps lightweight selection when scalar metadata is too large without a full-state fallback', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('large-metadata')
      const full = await getTeamState(api, id)
      api.onTeamGet = async () => ok({ ...full, budgets: { description: 'x'.repeat(20000) } })
      const completeRead = vi.spyOn(api.teams, 'get').mockRejectedValue(new Error('Full-state fallback is forbidden'))
      const selected = await tasks.inspect(id)
      expect(selected.state.metadata).toEqual({ kind: 'unavailable', reason: 'too-large' })
      expect(selected.state.goal.objective.text).toBe(full.goal.objective)
      expect(completeRead).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes current detail and keeps offline activations read-only during background refresh', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const original = await getTeamState(api, teamId('live'))
      const initial = await tasks.open(teamId('live'))
      const next: TeamStateSnapshot = {
        ...original,
        team: { ...original.team, cursor: original.team.cursor + 1 },
        goal: { ...original.goal, objective: 'Updated by another client.' },
        activations: original.activations.map(binding => ({ ...binding, activation: { ...binding.activation, status: 'offline' } })),
      }
      api.onTeamGet = () => Promise.resolve(ok(next))
      await tasks.refresh()
      expect(tasks.list.getSnapshot().selected?.state).toEqual(selectionView(next))
      expect(await tasks.resolveCoordinatorSession(initial.coordinatorSessionId, coordinatorOwner(initial))).toEqual({
        teamId: initial.teamId, coordinatorSessionId: initial.coordinatorSessionId,
      })
      expect(tasks.list.getSnapshot().selected?.state).toEqual(selectionView(next))
      expect(api.callsOf('team.resume')).toEqual([])
      api.onTeamGet = () => Promise.resolve(ok(original))
      await tasks.refresh()
      expect(tasks.list.getSnapshot().selected?.state).toEqual(selectionView(next))
    } finally { await ctx.fiber.dispose() }
  })

  it('opens member summaries without calling the complete member-list endpoint', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('bounded-members')
      const full = await getTeamState(api, id)
      api.onTeamGet = async () => ok(full)
      const complete = vi.spyOn(api.teams, 'memberList').mockRejectedValue(new Error('Full member reads are forbidden'))
      await tasks.inspect(id)
      expect(complete).not.toHaveBeenCalled()
      expect(api.callsOf('team.browse')).toContainEqual({ teamId: id, kind: 'members', afterCursor: -1, limit: 64 })
      const members = tasks.list.getSnapshot().collections!.members.items
      expect(members).toEqual(full.participants.map(memberSummary))
      for (const member of members) {
        expect(member).not.toHaveProperty('stats')
        expect(member).not.toHaveProperty('capabilities')
        expect(member).not.toHaveProperty('authorityGrant')
      }
    } finally { await ctx.fiber.dispose() }
  })

  it('loads members and tasks through independent bounded collection pages', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collections'))
      const firstMember = state.participants[0]
      const secondMember = state.participants[1]
      if (firstMember === undefined || secondMember === undefined) throw new Error('fixture needs two participants')
      const memberList = vi.spyOn(api, 'onMemberBrowsePage')
        .mockResolvedValueOnce(ok({ items: [firstMember], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [secondMember] }))
      const taskList = vi.spyOn(api, 'onTaskBrowsePage').mockResolvedValue(ok(summaryPage(state, { items: [] })))
      const workflowPlanList = vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [], nextCursor: 0 }))
      const artifact = { id: 'paged-artifact', provider: 'local', kind: 'report', uri: 'artifact://paged', visibility: 'team' } as never
      const secondArtifact = { id: 'paged-artifact-2', provider: 'local', kind: 'report', uri: 'artifact://paged-2', visibility: 'team' } as never
      const artifactList = vi.spyOn(api.teams, 'artifactList')
        .mockResolvedValueOnce(ok({ items: [artifact], nextCursor: 0 }))
        .mockResolvedValueOnce(ok({ items: [secondArtifact] }))

      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections).toMatchObject({
        teamId: state.team.id,
        members: { items: [memberSummary(firstMember)], nextCursor: 0, loading: false, loadingMore: false },
        tasks: { items: [], loading: false, loadingMore: false },
      })
      expect(taskList).toHaveBeenCalledWith({ teamId: state.team.id, kind: 'tasks', afterCursor: -1, limit: 64 }, undefined)
      expect(workflowPlanList).toHaveBeenCalledWith({ teamId: state.team.id, afterCursor: -1, limit: 64 }, undefined)
      expect(artifactList).toHaveBeenCalledWith({ teamId: state.team.id, afterCursor: -1, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact])
      await tasks.readCollections(state.team.id, 'artifacts', 'next')
      expect(artifactList).toHaveBeenLastCalledWith({ teamId: state.team.id, afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([secondArtifact])

      await tasks.readCollections(state.team.id, 'members', 'next')
      expect(memberList).toHaveBeenLastCalledWith({ teamId: state.team.id, afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.members.items).toEqual([memberSummary(secondMember)])
      memberList.mockRejectedValueOnce(new Error('member page unavailable'))
      await tasks.readCollections(state.team.id, 'members')
      expect(tasks.list.getSnapshot().collections?.members).toMatchObject({
        items: [memberSummary(secondMember)], loading: false, loadingMore: false, error: 'member page unavailable',
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps one member window across repeated next pages and retains it after oversized or cancelled reads', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('member-window'))
      const template = state.participants[0]!
      let start = -1
      const memberList = vi.spyOn(api, 'onMemberBrowsePage').mockImplementation(async ({ afterCursor = -1, limit = 64 }) => {
        start = afterCursor
        return ok({ items: Array.from({ length: limit }, (_, index) => ({ ...template,
          id: `window-member-${afterCursor + index + 1}` as typeof template.id })), nextCursor: afterCursor + limit })
      })
      vi.spyOn(api, 'onTaskBrowsePage').mockResolvedValue(ok(summaryPage(state, { items: [] })))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      for (let page = 0; page < 40; page++) {
        await tasks.readCollections(state.team.id, 'members', 'next')
        const window = tasks.list.getSnapshot().collections!.members
        expect(window.items).toHaveLength(64)
        expect(window.startCursor).toBe(start)
        expect(window.items[0]!.id).toBe(`window-member-${start + 1}`)
      }
      const retained = tasks.list.getSnapshot().collections!.members
      memberList.mockResolvedValueOnce(ok({ items: Array.from({ length: 65 }, (_, index) => ({ ...template, id: `oversized-${index}` as typeof template.id })) }))
      await tasks.readCollections(state.team.id, 'members', 'next')
      expect(tasks.list.getSnapshot().collections!.members).toMatchObject({ items: retained.items,
        startCursor: retained.startCursor, nextCursor: retained.nextCursor })
      expect(tasks.list.getSnapshot().collections!.members.error).toContain('row limit')
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onMemberBrowsePage']>>>()
      memberList.mockReturnValueOnce(pending.promise)
      const controller = new AbortController()
      const read = tasks.readCollections(state.team.id, 'members', 'first', controller.signal)
      controller.abort()
      pending.resolve(ok({ items: [] }))
      await read
      expect(tasks.list.getSnapshot().collections!.members).toMatchObject({ items: retained.items,
        startCursor: retained.startCursor, loading: false, loadingMore: false, error: undefined })
      await tasks.readCollections(state.team.id, 'members', 'first')
      expect(tasks.list.getSnapshot().collections!.members.startCursor).toBe(-1)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not let a later task page replace an already published artifact page', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collection-order'))
      const taskPage = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
      const artifact = { id: 'ordered-artifact', provider: 'local', kind: 'report', uri: 'artifact://ordered', visibility: 'team' } as never
      const artifactPage = deferred<Awaited<ReturnType<FakeApiClient['teams']['artifactList']>>>()
      vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      const taskList = vi.spyOn(api, 'onTaskBrowsePage').mockReturnValue(taskPage.promise)
      const artifactList = vi.spyOn(api.teams, 'artifactList').mockReturnValue(artifactPage.promise)

      const opening = tasks.open(state.team.id)
      await vi.waitFor(() => {
        expect(taskList).toHaveBeenCalledOnce()
        expect(artifactList).toHaveBeenCalledOnce()
      })
      artifactPage.resolve(ok({ items: [artifact] }))
      await vi.waitFor(() => { expect(tasks.list.getSnapshot().collections?.artifacts.items).toEqual([artifact]) })
      taskPage.resolve(ok(summaryPage(state, { items: [] })))
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
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onMemberBrowsePage']>>>()
      api.onMemberBrowsePage = payload => payload.teamId === first.team.id
        ? pending.promise
        : Promise.resolve(ok({ items: second.participants }))
      const late = tasks.readCollections(first.team.id, 'members', 'refresh')
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
      const taskList = vi.spyOn(api, 'onTaskBrowsePage')
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [task], nextCursor: 0 })))
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [], nextCursor: 0 })))
      vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: state.participants }))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      await tasks.readCollections(state.team.id, 'tasks', 'next')
      expect(taskList).toHaveBeenLastCalledWith({ teamId: state.team.id, kind: 'tasks', afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.tasks).toMatchObject({
        items: [summary(task)], loading: false, loadingMore: false, error: 'tasks list returned a non-advancing page cursor',
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
      const current = structuredClone(stale)
      Object.assign(current, { revision: 2, delegation: { ...stale.delegation, childTeamId: 'child-team' as never } })
      let reads = 0
      api.onTeamGet = async () => ok(reads++ === 0 ? { ...state,
        tasks: [stale] } : { ...state,
        team: { ...state.team,
          cursor: state.team.cursor + 1 },
        tasks: [current] })
      let taskPages = 0
      api.onTaskBrowsePage = async () => ok(summaryPage(state, { items: [taskPages++ === 0 ? stale : current] }))
      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections?.tasks.items[0]).toEqual(summary(stale))
      tasks.handleMuxEnvelope({ type: 'team/changed', event: { type: 'task/changed', task: current, cursor: 1, createdAt: 2 } })
      await vi.waitFor(() => { expect(tasks.list.getSnapshot().collections?.tasks.items[0]?.childTeamId).toBe('child-team') })
      expect(tasks.list.getSnapshot().collections?.tasks.items[0]?.revision).toBe(2)
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes the current window and explicitly returns to the first page', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('collection-refresh'))
      const first = { id: 'refresh-task-1' as never, teamId: state.team.id, revision: 1, subject: 'First task', description: 'First',
        phase: 'pending' as const, blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] } as unknown as TeamTaskSnapshot
      const second = { id: 'refresh-task-2' as never, teamId: state.team.id, revision: 1, subject: 'Second task', description: 'Second',
        phase: 'pending' as const, blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] } as unknown as TeamTaskSnapshot
      const updatedFirst = { ...first, revision: 2, subject: 'First task updated' }
      const updatedSecond = { ...second, revision: 2, subject: 'Second task updated' }
      vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      const taskList = vi.spyOn(api, 'onTaskBrowsePage')
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [first], nextCursor: 0 })))
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [second] })))
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [updatedSecond] })))
        .mockResolvedValueOnce(ok(summaryPage(state, { items: [updatedFirst], nextCursor: 0 })))

      await tasks.open(state.team.id)
      await tasks.readCollections(state.team.id, 'tasks', 'next')
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([summary(second)])
      await tasks.readCollections(state.team.id, 'tasks')
      expect(taskList).toHaveBeenCalledTimes(3)
      expect(taskList).toHaveBeenLastCalledWith({ teamId: state.team.id, kind: 'tasks', afterCursor: 0, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([summary(updatedSecond)])
      await tasks.readCollections(state.team.id, 'tasks', 'first')
      expect(taskList).toHaveBeenLastCalledWith({ teamId: state.team.id, kind: 'tasks', afterCursor: -1, limit: 64 }, undefined)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([summary(updatedFirst)])
    } finally { await ctx.fiber.dispose() }
  })

  it('retains a newer marker when a workflow-plan read started before the Team cursor advanced', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('workflow-stale-read'))
      vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api, 'onTaskBrowsePage').mockResolvedValue(ok(summaryPage(state, { items: [] })))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)

      const pending = deferred<Awaited<ReturnType<FakeApiClient['onWorkflowBrowsePage']>>>()
      const workflowPlans = vi.spyOn(api, 'onWorkflowBrowsePage').mockReturnValue(pending.promise)
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
        const method = { members: 'memberList', tasks: 'browse', workflowPlans: 'workflowPlanList', artifacts: 'artifactList' } as const
        const readPage = collection === 'members' ? vi.spyOn(api, 'onMemberBrowsePage')
          : collection === 'tasks' ? vi.spyOn(api, 'onTaskBrowsePage')
            : collection === 'workflowPlans' ? vi.spyOn(api, 'onWorkflowBrowsePage') : vi.spyOn(api.teams, method[collection])
        for (const cancel of [false, true]) {
          const before = tasks.list.getSnapshot().collections![collection]
          const pending = deferred<never>()
          readPage.mockReturnValueOnce(pending.promise)
          const controller = new AbortController()
          const reading = tasks.readCollections(state.team.id, collection, 'refresh', controller.signal)
          const selected = tasks.list.getSnapshot().selected!.state
          api.onTeamGet = () => Promise.resolve(ok({ ...state, team: { ...state.team, cursor: selected.team.cursor + 1 } }))
          await tasks.refresh()
          expect(tasks.list.getSnapshot().collections?.[collection].hasNewer).toBe(true)
          if (cancel) controller.abort()
          pending.reject(new Error('page request failed'))
          await reading
          expect(tasks.list.getSnapshot().collections?.[collection]).toMatchObject({
            items: before.items, loading: false, loadingMore: false, hasNewer: true,
            error: cancel ? undefined : 'page request failed',
          })
          readPage.mockResolvedValueOnce(ok({ kind: 'tasks' as const, teamId: state.team.id, teamCursor: state.team.cursor,
            total: 0, scanned: 0, items: [] }))
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
      pending.resolve(ok({ items: [], scanned: 0 }))
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
      pending.resolve(ok({ items: [], scanned: 0 }))
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

      api.onTeamList = () => Promise.resolve(ok({ items: [], scanned: 0 }))
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
      vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: state.participants }))
      vi.spyOn(api, 'onTaskBrowsePage').mockResolvedValueOnce(ok(summaryPage(state, { items: [initialTask] })))
        .mockResolvedValue(ok(summaryPage(state, { items: [refreshedTask] })))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([summary(initialTask)])

      tasks.handleDisconnected()
      tasks.handleConnected()
      await vi.waitFor(() => {
        expect(tasks.list.getSnapshot().collections?.tasks.items).toEqual([summary(refreshedTask)])
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
      const memberList = vi.spyOn(api, 'onMemberBrowsePage').mockResolvedValue(ok({ items: [firstMember] }))
      vi.spyOn(api, 'onTaskBrowsePage').mockResolvedValue(ok(summaryPage(state, { items: [] })))
      vi.spyOn(api, 'onWorkflowBrowsePage').mockResolvedValue(ok({ items: [] }))
      vi.spyOn(api.teams, 'artifactList').mockResolvedValue(ok({ items: [] }))
      await tasks.open(state.team.id)
      const stale = deferred<Awaited<ReturnType<FakeApiClient['onMemberBrowsePage']>>>()
      memberList.mockReturnValueOnce(stale.promise).mockResolvedValue(ok({ items: [freshMember] }))
      const oldRead = tasks.readCollections(state.team.id, 'members')
      await vi.waitFor(() => { expect(memberList).toHaveBeenCalledTimes(2) })
      tasks.handleDisconnected()
      tasks.handleConnected()
      await vi.waitFor(() => {
        expect(tasks.list.getSnapshot().collections?.members.items).toEqual([memberSummary(freshMember)])
      })
      stale.resolve(ok({ items: [firstMember] }))
      await oldRead
      expect(tasks.list.getSnapshot().collections?.members.items).toEqual([memberSummary(freshMember)])
    } finally { await ctx.fiber.dispose() }
  })

  it('retains one Team window through repeated paging and preserves it when returning to the beginning fails', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const base = await getTeamState(api, teamId('selected-team'))
      await tasks.inspect(base.team.id)
      api.onTeamList = async (input) => {
        const index = input.afterCursor === -1 ? 0 : Number(String(input.afterCursor).split(':')[1])
        const id = teamId(`page-team-${index}`)
        return ok({ items: [{ ...base.team, id, goal: { ...base.goal, teamId: id } }], scanned: 1, nextCursor: `page:${index + 1}` as NonNullable<TeamTaskListState['nextCursor']> })
      }
      await tasks.refresh()
      for (let index = 1; index <= 32; index++) {
        await tasks.loadMore()
        expect(tasks.list.getSnapshot().items.map(item => item.id)).toEqual([`page-team-${index}`])
      }
      const previous = tasks.list.getSnapshot()
      const read = api.onTeamList
      api.onTeamList = async () => err({ code: 'internal', message: 'first page unavailable', details: {} })
      await tasks.refresh(true)
      expect(tasks.list.getSnapshot()).toMatchObject({ items: previous.items, startCursor: previous.startCursor })
      api.onTeamList = read
      await tasks.refresh(true)
      expect(tasks.list.getSnapshot().items.map(item => item.id)).toEqual(['page-team-0'])
      expect(tasks.list.getSnapshot().startCursor).toBe(-1)
      expect(tasks.list.getSnapshot().selected?.teamId).toBe(base.team.id)
    } finally { await ctx.fiber.dispose() }
  })

  it('loads further Team pages only on request and refreshes the requested page range', async () => {
    const { ctx, api, tasks } = setup()
    try {
      api.onTeamList = payload => Promise.resolve(payload.afterCursor === -1
        ? ok({ items: [], scanned: 1, nextCursor: 'next' as never })
        : ok({ items: [], scanned: 0 }))
      await tasks.refresh()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }])
      expect(tasks.list.getSnapshot().nextCursor).toBe('next')
      await tasks.loadMore()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }, { afterCursor: 'next' }])
      await tasks.refresh()
      expect(api.callsOf('team.list')).toEqual([{ afterCursor: -1 }, { afterCursor: 'next' }, { afterCursor: 'next' }])
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
      api.onTeamTaskDelete = payload => Promise.resolve(ok({
        ...task,
        revision: payload.expectedRevision + 1,
        phase: 'deleted' as const,
      } as never))
      await expect(tasks.deleteTask(selected.teamId, task.id, task.revision)).resolves.toMatchObject({ phase: 'deleted' })
      expect(api.callsOf('team.task.delete')).toEqual([{
        teamId: selected.teamId, taskId: task.id, expectedRevision: task.revision,
      }])
      expect(tasks.list.getSnapshot().collections?.tasks.hasNewer).toBe(true)
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
      expect(tasks.list.getSnapshot().collections?.tasks.hasNewer).toBe(true)
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
      let current: typeof task = task
      vi.spyOn(api.teams, 'taskInspect').mockImplementation(async () => {
        const { attemptHistory: _history, ...record } = current
        return ok({ section: 'record', teamId: selected.teamId, taskId: task.id, teamCursor: 1,
          revision: current.revision, task: record, history: { attempts: 0, reviews: 0 } } as never)
      })
      await tasks.readTaskDetail(selected.teamId, task.id)
      api.onTeamTaskCancel = () => { current = stopping; return Promise.resolve(ok(stopping)) }
      api.onTeamTaskGet = () => Promise.reject(new Error('Cancellation inspection must not read full task history'))
      await expect(tasks.cancelTask?.(selected.teamId, task.id, task.revision, 'Stop from details')).resolves.toMatchObject({ phase: 'running', revision: 4 })
      current = settled
      await vi.advanceTimersByTimeAsync(1_000)
      expect(api.callsOf('team.task.get')).toEqual([])
      expect(tasks.list.getSnapshot().taskDetail?.record.value?.task).toMatchObject({ phase: 'failed', revision: 5 })
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
      api.onTeamGet = async () => ok({ ...(await getTeamState(new FakeApiClient(), teamId('runtime-fk-team'))), activations: [] })
      tasks.startDraft()
      const draft = tasks.list.getSnapshot().draft
      if (draft === undefined) throw new Error('Team draft was not created')
      const state = await getTeamState(api, teamId('runtime-fk-team'))
      api.onTeamStart = () => Promise.resolve(ok({
        state: { ...state, activations: [] },
        envelopeId: 'runtime-fk-team-envelope' as never,
      }))

      await expect(tasks.start({ text: 'Incomplete coordinator state.' })).rejects.toThrow('coordinator is unavailable: missing-binding')
      expect(tasks.list.getSnapshot().draft).toMatchObject({
        idempotencyKey: draft.idempotencyKey,
        phase: 'error',
        error: undefined,
        message: "Team 'runtime-fk-team' coordinator is unavailable: missing-binding",
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('opens a durable Team and resolves its coordinator transcript', async () => {
    const { ctx, tasks } = setup()
    try {
      await tasks.refresh()
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
        { method: 'team.selection', payload: { teamId: id } },
        { method: 'team.resume', payload: { teamId: id, expectedCursor: 17 } },
        { method: 'team.selection', payload: { teamId: id, includeMetadata: true } },
        { method: 'team.browse', payload: { teamId: id, kind: 'members', afterCursor: -1, limit: 64 } },
        { method: 'team.browse', payload: { teamId: id, kind: 'tasks', afterCursor: -1, limit: 64 } },
        { method: 'team.browse', payload: { teamId: id, kind: 'workflowPlans', afterCursor: -1, limit: 64 } },
        { method: 'team.artifact.list', payload: { teamId: id, afterCursor: -1, limit: 64 } },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['selection', 'resume'] as const)('does not redirect a new draft when the %s response arrives late', async (stage) => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('runtime-fk-team')
      const state = await getTeamState(api, id)
      await tasks.refresh()
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onTeamGet']>>>()
      if (stage === 'selection') api.onTeamGet = () => pending.promise
      else api.onTeamResume = () => pending.promise
      const operation = tasks.resume(id)
      const rejected = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
      if (stage === 'resume') await vi.waitFor(() => { expect(api.callsOf('team.resume')).toHaveLength(1) })
      tasks.startDraft()
      pending.resolve(ok(state))
      await rejected
      expect(tasks.list.getSnapshot().draft).toBeDefined()
      expect(tasks.list.getSnapshot().selected).toBeUndefined()
      if (stage === 'selection') expect(api.callsOf('team.resume')).toEqual([])
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

  it('keeps historical Session routing while retaining only the visible Team projection', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const first = await tasks.open(teamId('history-first'))
      const firstSession = first.coordinatorSessionId
      const second = await tasks.open(teamId('history-second'))
      expect(tasks.list.getSnapshot().selected).toBe(second)
      expect(await tasks.resolveCoordinatorSession(firstSession, coordinatorOwner(first)))
        .toEqual({ teamId: first.teamId, coordinatorSessionId: firstSession })
      expect(await tasks.resolveCoordinatorSession(firstSession, coordinatorOwner(first))).not.toHaveProperty('state')
      expect((await tasks.resolveCoordinatorSession(
        firstSession, coordinatorOwner(first),
      ))?.teamId).toBe(first.teamId)
      await tasks.postInput(first.teamId, [{ type: 'text', text: 'Continue the earlier Team' }])
      expect(api.callsOf('team.postInput')).toEqual([{ teamId: first.teamId,
        content: [{ type: 'text', text: 'Continue the earlier Team' }], text: 'Continue the earlier Team', delivery: 'turn' }])
      tasks.startDraft()
      expect(tasks.list.getSnapshot()).toMatchObject({ selected: undefined, collections: undefined })
      expect((await tasks.resolveCoordinatorSession(
        firstSession, coordinatorOwner(first),
      ))?.teamId).toBe(first.teamId)
    } finally { await ctx.fiber.dispose() }
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
      expect((await tasks.resolveCoordinatorSession(selected.coordinatorSessionId, coordinatorOwner(selected)))?.teamId).toBe(id)
      expect(await tasks.resolveCoordinatorSession(workerSession, { teamId: id, participantId: workerId })).toBeUndefined()
      await tasks.participantSession(id, workerId)
      expect(await tasks.resolveCoordinatorSession(workerSession, { teamId: id, participantId: workerId })).toBeUndefined()
      expect(await tasks.resolveCoordinatorSession('runtime-fk-team-missing' as SessionId, coordinatorOwner(selected))).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads member detail without Team selection and rejects mismatched member, cursor and oversized pages', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('member-inspect'))
      const member = state.participants[0]!
      const value = { record: { id: member.id, teamId: member.teamId, kind: member.kind, phase: member.phase,
        displayName: member.displayName, role: member.role }, teamCursor: 3, startCursor: -1, total: 1, scanned: 1, items: ['read'] }
      const read = vi.spyOn(api.teams, 'memberInspect').mockResolvedValue(ok(value))
      const full = vi.spyOn(api.teams, 'get').mockRejectedValue(new Error('Full Team read forbidden'))
      const input = { teamId: member.teamId, participantId: member.id, limit: 1 }
      await expect(tasks.inspectMember(input)).resolves.toEqual(value)
      expect(tasks.list.getSnapshot().selected).toBeUndefined()
      expect(full).not.toHaveBeenCalled()
      for (const changed of [{ ...value, record: { ...value.record, id: 'foreign' as typeof member.id } },
        { ...value, startCursor: 1 }, { ...value, items: ['read', 'write'] }]) {
        read.mockResolvedValue(ok(changed))
        await expect(tasks.inspectMember(input)).rejects.toThrow(/another selection|requested page/)
      }
      read.mockResolvedValue(ok(value))
      await expect(tasks.inspectMember({ ...input, expectedTeamCursor: 2 })).rejects.toThrow(/another selection/)
    } finally { await ctx.fiber.dispose() }
  })

  it('marks incoming requests as newer without retaining their bodies or replacing the visible inbox page', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const read = vi.spyOn(api.teams, 'inboxRead').mockResolvedValue(ok({ items: [inboxMessage(0)], displayCursor: -1, cursor: 0 }))
      await tasks.refreshInbox()
      const before = tasks.list.getSnapshot().inbox.items
      for (let index = 0; index < 1000; index++) {
        tasks.handleMuxEnvelope({ rpcId: `question-${index}` as never, payload: {
          type: 'question/requested', sessionId: 'session' as SessionId, teamId: teamId('many-actions'),
          questions: [{ id: 'question', question: `Question ${index}` }],
        } })
      }
      expect(tasks.list.getSnapshot().inbox.items).toBe(before)
      expect(tasks.list.getSnapshot().inbox.hasNewer).toBe(true)
      expect(tasks.list.getSnapshot().pendingHumanActions).toEqual([])
      expect(read).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
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
      await expect(tasks.open(id)).rejects.toThrow('coordinator is unavailable: missing-participant')

      api.onTeamGet = () => Promise.resolve(ok({ ...state, activations: [] }))
      await expect(tasks.open(id)).rejects.toThrow('coordinator is unavailable: missing-binding')
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
      const original = await getTeamState(api, selection.teamId)
      const next = { ...original, team: { ...original.team, cursor: selection.state.team.cursor + 1 } }
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

  it('revalidates historical channel ownership without retaining a route cache', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const first = await tasks.open(teamId('known-channel-team'))
      const channelId = (await getTeamState(api, first.teamId)).channelIds[0]!
      const admission = await api.onTeamChannelAdmission({ teamId: first.teamId, channelId })
      if (!admission.result.ok) throw new Error('Fake channel admission failed')
      await tasks.readChannel(channelId)
      const close = vi.spyOn(api.teams, 'channelClose').mockResolvedValue(ok({ ...admission.result.value.channel, phase: 'closed' }))
      await tasks.open(teamId('another-visible-team'))
      await tasks.manage(first.teamId, { operation: 'channelClose', input: { channelId, expectedCursor: 0 } })
      expect(close).toHaveBeenCalledOnce()
      expect(api.callsOf('team.channel.admission')).toEqual([{ teamId: first.teamId, channelId }, { teamId: first.teamId, channelId }])
    } finally { await ctx.fiber.dispose() }
  })

  it('checks channel ownership at the Host without requiring a cached Team projection', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('uncached-channel-team')
      const channelId = 'uncached-channel' as never
      const admission = await api.onTeamChannelAdmission({ teamId: id, channelId })
      if (!admission.result.ok) throw new Error('Fake channel admission failed')
      const close = vi.spyOn(api.teams, 'channelClose').mockResolvedValue(ok({ ...admission.result.value.channel, phase: 'closed' }))
      api.onTeamGet = async () => { throw new Error('Full Team read is forbidden') }
      await tasks.manage(id, { operation: 'channelClose', input: { channelId, expectedCursor: 0 } })
      expect(api.callsOf('team.channel.admission')).toEqual([{ teamId: id, channelId }])
      expect(close).toHaveBeenCalledOnce()
      expect(tasks.list.getSnapshot().selected).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it('does not send a channel mutation outside the selected Team', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const selection = await tasks.open(teamId('channel-owner'))
      const admit = api.onTeamChannelAdmission
      api.onTeamChannelAdmission = async payload => await admit({ ...payload, teamId: teamId('foreign-team') })
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
  it('derives action previews from one page and applies only current revisions to its retained actions', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('action-windows'))
      const makeAction = (index: number): TeamActionResponseResult['action'] => ({
        id: `action-${index}` as TeamActionResponseResult['action']['id'], teamId: state.team.id,
        kind: 'question', phase: 'pending', createdAt: 1, updatedAt: 1,
        sessionId: state.activations[0]!.sessionId, participantId: state.participants[0]!.id,
        sourceId: `source-${index}` as TeamActionResponseResult['action']['sourceId'],
        details: { questions: [{ id: 'question', question: `Question ${index}` }] },
      })
      vi.spyOn(api.teams, 'inboxRead').mockImplementation(async (input) => {
        const index = (input.afterCursor ?? -1) + 1
        const action = makeAction(index)
        return ok({ items: [{ ...inboxMessage(index), kind: 'action', teamId: state.team.id, action }],
          displayCursor: -1, cursor: index, nextCursor: index })
      })
      await tasks.refreshInbox()
      for (let index = 1; index <= 40; index++) {
        await tasks.loadMoreInbox()
        expect(tasks.list.getSnapshot().pendingHumanActions).toMatchObject([{ requestId: `source-${index}` }])
        expect(tasks.list.getSnapshot().pendingHumanActions).toHaveLength(1)
      }
      const current = makeAction(40)
      const changed = (action: typeof current) => { tasks.handleMuxEnvelope({ type: 'team/changed', event: {
        type: 'human-action/changed', action,
      } } as MuxFrame) }
      changed({ ...current, phase: 'resolved', updatedAt: 2 })
      expect(tasks.list.getSnapshot().pendingHumanActions).toEqual([])
      changed(current)
      expect(tasks.list.getSnapshot().pendingHumanActions).toEqual([])
      changed(makeAction(100))
      expect(tasks.list.getSnapshot().inbox.items).toHaveLength(1)
      expect(tasks.list.getSnapshot().inbox.hasNewer).toBe(true)
      expect(tasks.list.getSnapshot().pendingHumanActions).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('preserves the inbox on compaction and recovers retained history only on explicit request', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const retained: TeamInboxPage = { items: [inboxMessage(8)], displayCursor: 7, cursor: 8 }
      const read = vi.spyOn(api.teams, 'inboxRead').mockResolvedValueOnce(ok({ items: [inboxMessage(0)], displayCursor: -1, cursor: 0 }))
        .mockResolvedValueOnce(err({ code: 'team-inbox-compacted', message: 'Compacted', details: { firstCursor: 8 } }))
        .mockResolvedValueOnce(ok(retained))
      await expect(tasks.recoverInbox()).rejects.toThrow('requires a retained history cursor')
      await tasks.refreshInbox()
      await tasks.refreshInbox(true)
      expect(tasks.list.getSnapshot().inbox.items.map(item => item.sequence)).toEqual([0])
      expect(read).toHaveBeenCalledTimes(2)
      await tasks.recoverInbox()
      expect(read).toHaveBeenLastCalledWith({ afterCursor: 7 }, undefined)
      expect(tasks.list.getSnapshot().inbox.items).toEqual(retained.items)
      expect(tasks.list.getSnapshot().inbox.error).toBeNull()
      vi.spyOn(api.teams, 'inboxWatch').mockResolvedValue(err({ code: 'team-inbox-compacted', message: 'Compacted again', details: { firstCursor: 12 } }))
      await expect(tasks.watchInbox(new AbortController().signal)).rejects.toThrow('Compacted again')
      expect(tasks.list.getSnapshot().inbox.error?.code).toBe('team-inbox-compacted')
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps one inbox window across repeated continuations', async () => {
    const { ctx, api, tasks } = setup()
    try {
      vi.spyOn(api.teams, 'inboxRead').mockImplementation(async (input) => {
        const index = (input.afterCursor ?? -1) + 1
        return ok({ items: [inboxMessage(index)], displayCursor: -1, cursor: index, nextCursor: index })
      })
      await tasks.refreshInbox()
      for (let index = 1; index <= 32; index++) {
        await tasks.loadMoreInbox()
        expect(tasks.list.getSnapshot().inbox.items.map(item => item.sequence)).toEqual([index])
      }
      await tasks.refreshInbox(true)
      expect(tasks.list.getSnapshot().inbox.items.map(item => item.sequence)).toEqual([0])
    } finally { await ctx.fiber.dispose() }
  })

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

  it('announces newer deliveries and replaces the window only after an explicit request', async () => {
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
      expect(tasks.list.getSnapshot().inbox?.items).toHaveLength(1)
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
      expect(tasks.list.getSnapshot().inbox).toMatchObject({ displayCursor: -1, acknowledging: false })
      expect(tasks.list.getSnapshot().inbox.items.map(item => item.sequence)).toEqual([7])
    } finally { await ctx.fiber.dispose() }
  })

  it('opens a historical task owner by point read without loading activation history', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const id = teamId('history-team')
      const owner = 'original-worker' as never
      api.onTeamMemberSession = async request => ok({ activation: { id: 'retained-epoch' as never, teamId: id,
        participantId: request.participantId, status: 'offline' }, sessionId: 'original-session' as never, provider: 'local' })
      const before = api.calls.length
      expect(await tasks.participantSession(id, owner)).toBe('original-session')
      expect(api.calls.slice(before)).toEqual([{ method: 'team.member.session', payload: { teamId: id, participantId: owner } }])
      expect(tasks.list.getSnapshot().selected).toBeUndefined()
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
      vi.spyOn(api.teams, 'actionRead').mockResolvedValue(ok(current))
      const completeRead = vi.spyOn(api.teams, 'get').mockRejectedValue(new Error('Full read forbidden'))
      await tasks.refreshInbox()
      await expect(tasks.readAction(state.team.id, original.id)).resolves.toEqual(current)
      expect(completeRead).not.toHaveBeenCalled()
      const entry = tasks.list.getSnapshot().inbox?.items[0]
      expect(entry?.kind === 'action' ? entry.action.phase : undefined).toBe('resolved')
    } finally { await ctx.fiber.dispose() }
  })

  it('resolves a member without selecting or resuming a Team, and rejects a foreign binding or aborted read', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('member-point-read'))
      const binding = state.activations[0]!
      const memberId = binding.activation.participantId
      api.onTeamGet = async () => { throw new Error('Full Team read is forbidden') }
      api.onTeamMemberSession = async () => ok(binding)
      expect(await tasks.participantSession(state.team.id, memberId)).toBe(binding.sessionId)
      expect(tasks.list.getSnapshot().selected).toBeUndefined()
      expect(api.callsOf('team.get')).toEqual([])
      expect(api.callsOf('team.resume')).toEqual([])
      api.onTeamMemberSession = async () => ok({ ...binding, activation: { ...binding.activation, teamId: teamId('foreign') } })
      await expect(tasks.participantSession(state.team.id, memberId)).rejects.toThrow(/different Team or participant/)
      const pending = deferred<Awaited<ReturnType<FakeApiClient['onTeamMemberSession']>>>()
      api.onTeamMemberSession = () => pending.promise
      const controller = new AbortController()
      const read = tasks.participantSession(state.team.id, memberId, controller.signal)
      controller.abort()
      pending.resolve(ok(binding))
      await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    } finally { await ctx.fiber.dispose() }
  })

  it('uses the newest coordinator epoch for inspection and avoids resuming an older offline binding', async () => {
    const { ctx, api, tasks } = setup()
    try {
      const state = await getTeamState(api, teamId('replaced-coordinator'))
      const coordinator = state.participants.find(member => member.role === 'coordinator')!
      const previous = state.activations.find(binding => binding.activation.participantId === coordinator.id)!
      const replacement = { ...previous, activation: { ...previous.activation, id: 'new-epoch' as typeof previous.activation.id, status: 'idle' as const }, sessionId: 'new-session' as SessionId }
      const current = { ...state, activations: [...state.activations.map(binding => ({ ...binding, activation: { ...binding.activation, status: 'offline' as const } })), replacement] }
      api.onTeamGet = async () => ok(current)
      expect((await tasks.inspect(state.team.id)).coordinatorSessionId).toBe(replacement.sessionId)
      expect(await tasks.participantSession(state.team.id, coordinator.id)).toBe(replacement.sessionId)
      expect((await tasks.open(state.team.id)).coordinatorSessionId).toBe(replacement.sessionId)
      expect(api.callsOf('team.resume')).toEqual([])
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
