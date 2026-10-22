// @vitest-environment jsdom
/** Team registration connects public browser actions and exact workspace routes. */
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import { createSnapshotStore, SlotRegistry } from '@clocky/clocky-client-runtime/client'
import { Context } from '@clocky/cordis'
import type { ChannelId, ITeamTasks, SessionId, TeamActionResponseResult, TeamId, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import { SlotTestRuntime, TestSessions, TestTeamTasks } from '@clocky/clocky-client-test-runtime'
import { CommandRegistry } from '@clocky/clocky-client-ui-layout/src/client/commands.ts'
import type { TeamBrowserInjected } from '../src/client/TeamBrowser.tsx'
import type { TeamWorkspaceProps } from '../src/client/TeamWorkspace.tsx'
import { apply, inject } from '../src/client/index.ts'
import { Config } from '../src/client/workspace-store.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceState, workspaceTask, workspaceTaskDetail } from './workspace-fixtures.client.ts'
import type { WorkspaceRoute } from '../src/client/workspace-navigation.ts'

const mounted: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of mounted.splice(0)) await runtime.dispose()
})

async function mountTeam(beforeMount?: (runtime: SlotTestRuntime) => void) {
  const runtime = await SlotTestRuntime.create()
  mounted.push(runtime)
  const commands = new CommandRegistry()
  const layout = { showWorkspace: vi.fn(), navigate: vi.fn(),
    registerCommands: commands.registerProvider.bind(commands) }
  runtime.provide('connection', { hostDescription: createSnapshotStore(undefined) })
  runtime.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'sidebar.teamTasks': { kind: 'single', scope: 'root' },
    'sidebar.workspaceNavigation': { kind: 'list', scope: 'root' },
    'team.workspace': { kind: 'single', scope: 'root' },
  }, ({ renderSlot }) => createElement('div', null, renderSlot('team.workspace', {})))
  beforeMount?.(runtime)
  await runtime.mount({ inject: [...inject], apply })
  const browserEntry = runtime.slots.entries('sidebar.teamTasks')[0]
  const workspaceEntry = runtime.slots.entries('team.workspace')[0]
  if (browserEntry?.inject === undefined || workspaceEntry?.inject === undefined) throw new Error('Team slots are missing')
  const browser = browserEntry.inject() as unknown as TeamBrowserInjected
  const update = vi.fn()
  const bind = workspaceEntry.inject as unknown as (actions: { update: typeof update }) => TeamWorkspaceProps
  const workspace = bind({ update })
  return { runtime, commands, layout, browser, workspace, update }
}

it('keeps a cancelled picker inert and creates only the selected Workspace before drafting', async () => {
  const { runtime, browser, commands, layout } = await mountTeam()
  expect(await browser.pickDirectory?.()).toBeNull()
  expect(runtime.workspaces.calls.some(call => call.method === 'create')).toBe(false)
  runtime.workspaces.stub('pickDirectory', () => '/project/release')
  expect(await browser.pickDirectory?.()).toBe('/project/release')
  expect(runtime.workspaces.calls).toContainEqual({ method: 'create', args: [{ path: '/project/release' }] })
  browser.startDraft?.({ cwd: '/project/release' })
  browser.updateDraft?.({ cwd: '/project/release' })
  expect(runtime.teamTasks.calls).toContainEqual({ method: 'startDraft', args: [{ cwd: '/project/release' }] })
  expect(runtime.teamTasks.calls).toContainEqual({ method: 'updateDraft', args: [{ cwd: '/project/release' }] })
  expect(runtime.sessions.calls).toContainEqual({ method: 'clear', args: [] })
  const actions = commands.sections().find(section => section.id === 'team.actions')
  actions?.items[0]?.run()
  expect(layout.showWorkspace).toHaveBeenCalledWith('team')
  expect(runtime.teamTasks.calls.filter(call => call.method === 'startDraft')).toHaveLength(2)
})

it('keeps the palette navigation usable when the optional Workspace service is absent', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'sidebar.teamTasks': { kind: 'single', scope: 'root' },
    'sidebar.workspaceNavigation': { kind: 'list', scope: 'root' },
    'team.workspace': { kind: 'single', scope: 'root' },
  } } as never, () => null)
  const stabilize = async (fn: () => void | Promise<void>) => { await act(async () => { await fn() }) }
  const sessions = new TestSessions(stabilize, ctx)
  const teamTasks = new TestTeamTasks(stabilize)
  ctx.provide('sessions', sessions)
  ctx.provide('teamTasks', teamTasks)
  ctx.provide('connection', { hostDescription: createSnapshotStore(undefined) } as never)
  const commands = new CommandRegistry()
  const showWorkspace = vi.fn()
  ctx.provide('layout', { showWorkspace, registerCommands: commands.registerProvider.bind(commands) } as never)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  try {
    await fiber.await()
    const browserEntry = slots.entries('sidebar.teamTasks')[0]
    if (browserEntry?.inject === undefined) throw new Error('Team browser slot is missing')
    const browser = browserEntry.inject() as unknown as TeamBrowserInjected
    expect(browser.pickDirectory).toBeUndefined()
    expect(browser.startDraft).toBeUndefined()
    commands.sections().find(section => section.id === 'team.actions')?.items[0]?.run()
    expect(showWorkspace).toHaveBeenCalledWith('team')
    expect(sessions.calls).toContainEqual({ method: 'clear', args: [] })
    expect(teamTasks.calls.some(call => call.method === 'startDraft')).toBe(false)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
})

it('forwards Team observations with validated UI limits and refreshes only the selected pending preview', async () => {
  const teamId = 'watched-team' as TeamId
  const participantId = 'watched-member' as never
  const taskId = 'watched-task' as never
  const stop = vi.fn()
  const owners = {
    watchIdentities: vi.fn(() => stop), refreshIdentities: vi.fn(async () => {}),
    watchExecutionProfiles: vi.fn(() => stop), refreshExecutionProfiles: vi.fn(async () => {}),
    watchMemberReadiness: vi.fn(() => stop), refreshMemberReadiness: vi.fn(async () => {}),
    watchTaskCapabilities: vi.fn(() => stop), refreshTaskCapabilities: vi.fn(async () => {}),
    watchTaskReferences: vi.fn(() => stop), refreshTaskReferences: vi.fn(async () => {}),
    watchAttention: vi.fn(() => stop), readAttention: vi.fn(async () => {}),
    refreshAttentionPreview: vi.fn(async () => {}), pauseAttention: vi.fn(),
    readTaskQuery: vi.fn(async () => {}), pauseTaskQuery: vi.fn(),
    readDependencies: vi.fn(async () => {}), closeDependencies: vi.fn(),
    readCollections: vi.fn(async () => {}), readTaskDetail: vi.fn(async () => {}), closeTaskDetail: vi.fn(),
    readChannels: vi.fn(async () => {}), readChannelCatalog: vi.fn(async () => {}),
  }
  const { runtime, browser } = await mountTeam((testRuntime) => { Object.assign(testRuntime.teamTasks, owners) })
  const limits = Config.parse({})
  browser.watchIdentities?.(teamId, [participantId])
  expect(owners.watchIdentities).toHaveBeenCalledWith(teamId, [participantId], {
    refreshMs: limits.identityRefreshMs, capacity: limits.identityCacheCapacity,
    batchSize: limits.identityBatchSize,
  })
  await browser.refreshIdentities?.()
  browser.watchExecutionProfiles?.({ teamId, kind: 'local-agent' })
  expect(owners.watchExecutionProfiles).toHaveBeenCalledWith({ teamId, kind: 'local-agent' }, limits.capabilityRefreshMs)
  await browser.refreshExecutionProfiles?.()
  browser.watchMemberReadiness?.({ teamId, participantIds: [participantId] })
  expect(owners.watchMemberReadiness).toHaveBeenCalledWith({ teamId, participantIds: [participantId] }, limits.readinessRefreshMs)
  await browser.refreshMemberReadiness?.()
  const input = { teamId, integration: false, readScopes: [], writeScopes: [] }
  browser.watchTaskCapabilities?.(input)
  expect(owners.watchTaskCapabilities).toHaveBeenCalledWith(input, limits.capabilityRefreshMs)
  await browser.refreshTaskCapabilities?.()
  browser.watchTaskReferences?.(teamId, [taskId])
  expect(owners.watchTaskReferences).toHaveBeenCalledWith(teamId, [taskId], {
    capacity: limits.taskReferenceCapacity, batchSize: limits.taskReferenceBatchSize,
    refreshMs: limits.taskReferenceRefreshMs,
  })
  await browser.refreshTaskReferences?.()
  browser.watchAttention?.(teamId)
  expect(owners.watchAttention).toHaveBeenCalledWith(teamId, {
    limit: limits.attentionPreviewLimit, refreshMs: limits.attentionRefreshMs,
  })
  await browser.readAttention?.(teamId, 'next')
  expect(owners.readAttention).toHaveBeenCalledWith(teamId, limits.attentionPageLimit, 'next')
  await browser.refreshAttentionPreview?.(teamId)
  expect(owners.refreshAttentionPreview).not.toHaveBeenCalled()
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: teamId })
  await browser.refreshAttentionPreview?.(teamId)
  expect(owners.refreshAttentionPreview).toHaveBeenCalledOnce()
  browser.pauseAttention?.()
  await browser.readTaskQuery?.(teamId, { search: 'release' }, 'next')
  browser.pauseTaskQuery?.()
  await browser.readDependencies?.(teamId, { search: 'release' }, 'next')
  browser.closeDependencies?.()
  await browser.readCollections?.(teamId, 'members', 'next')
  await browser.readTaskDetail?.(teamId, taskId, 'attempts', 'next')
  browser.closeTaskDetail?.()
  await browser.readChannels?.(teamId, 'next')
  await browser.readChannelCatalog?.()
  expect(owners.readTaskQuery).toHaveBeenCalledWith(teamId, { search: 'release' }, 'next')
  expect(owners.readCollections).toHaveBeenCalledWith(teamId, 'members', 'next', undefined)
  expect(owners.readTaskDetail).toHaveBeenCalledWith(teamId, taskId, 'attempts', 'next')
  expect(owners.readChannels).toHaveBeenCalledWith(teamId, 'next')
  expect(owners.readChannelCatalog).toHaveBeenCalledOnce()
  expect(owners.pauseAttention).toHaveBeenCalledOnce()
  expect(owners.pauseTaskQuery).toHaveBeenCalledOnce()
  expect(owners.closeDependencies).toHaveBeenCalledOnce()
  expect(owners.closeTaskDetail).toHaveBeenCalledOnce()
  expect(owners.refreshIdentities).toHaveBeenCalledOnce()
  expect(owners.refreshExecutionProfiles).toHaveBeenCalledOnce()
  expect(owners.refreshMemberReadiness).toHaveBeenCalledOnce()
  expect(owners.refreshTaskCapabilities).toHaveBeenCalledOnce()
  expect(owners.refreshTaskReferences).toHaveBeenCalledOnce()
})

it('forwards exact channel, task and inbox actions through the registered Team face', async () => {
  const teamId = workspaceState().team.id
  const task = workspaceTask('Forwarded task')
  const taskId = task.id
  const channelId = 'forwarded-channel' as ChannelId
  const attachmentId = `sha256:${'a'.repeat(64)}` as never
  const memberId = 'forwarded-member' as never
  const action: TeamActionResponseResult['action'] = { id: 'forwarded-action' as never, teamId,
    sessionId: 'forwarded-session' as never, participantId: memberId, sourceId: 'source' as never,
    kind: 'approval', phase: 'pending', createdAt: 1, updatedAt: 2,
    details: { toolName: 'bash', reason: 'Inspect exact action', callId: 'call' } }
  const selection: TeamTaskSelection = { teamId, state: workspaceSelection({ ...workspaceState(), tasks: [task] }) }
  const owners = {
    manage: vi.fn(async () => {}), acknowledgeChannel: vi.fn(async () => {}),
    closeChannelView: vi.fn(), readChannels: vi.fn(async () => {}),
    readChannelAttachment: vi.fn(async () => ({ attachment: { attachmentId,
      mediaType: 'image/png' as const, bytes: 4, width: 1, height: 1 }, data: 'AA==' })),
    readChannelCatalog: vi.fn(async () => {}),
    readTaskDetail: vi.fn(async () => {}), closeTaskDetail: vi.fn(),
    readCollections: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => task), cancelTask: vi.fn(async () => task),
    refreshInbox: vi.fn(async () => {}), recoverInbox: vi.fn(async () => {}),
    loadMoreInbox: vi.fn(async () => {}), watchInbox: vi.fn<NonNullable<ITeamTasks['watchInbox']>>(),
    acknowledgeInbox: vi.fn(async () => {}), readAction: vi.fn(async () => action),
    respondAction: vi.fn<NonNullable<ITeamTasks['respondAction']>>(),
    inspectAction: vi.fn(async () => undefined), closeActionDetail: vi.fn(),
    loadMore: vi.fn(async () => {}), readArtifact: vi.fn(async () => {}), closeArtifactDetail: vi.fn(),
  } satisfies Partial<ITeamTasks>
  const { runtime, browser, workspace, layout, commands, update } = await mountTeam((testRuntime) => {
    Object.assign(testRuntime.teamTasks, owners)
    testRuntime.teamTasks.stub('inspect', vi.fn(async () => selection))
  })
  const signal = new AbortController().signal
  const command = { operation: 'memberActivate' as const, input: { participantId: memberId, expectedCursor: 1 } }
  await browser.manageTeam?.(teamId, command, signal)
  await browser.acknowledgeChannel?.(channelId)
  browser.closeChannelView?.()
  await browser.readChannels?.(teamId, 'next')
  const attachment = { teamId, channelId, envelopeId: 'source-envelope' as never,
    envelopeSequence: 2, attachmentId }
  expect(await browser.readChannelAttachment?.(attachment, signal)).toMatchObject({ data: 'AA==' })
  await browser.readChannelCatalog?.()
  await browser.readTaskDetail?.(teamId, taskId, 'reviews', 'next')
  browser.closeTaskDetail?.()
  await browser.readCollections?.(teamId, 'tasks', 'next', signal)
  await browser.deleteTask?.(teamId, taskId, 3, signal)
  await browser.cancelTask?.(teamId, taskId, 3, 'Stop after review', signal)
  await browser.loadMoreTeams?.()
  await browser.firstTeamPage?.()
  expect(owners.manage).toHaveBeenCalledWith(teamId, command, signal)
  expect(owners.acknowledgeChannel).toHaveBeenCalledWith(channelId)
  expect(owners.readChannelAttachment).toHaveBeenCalledWith(attachment, signal)
  expect(owners.readCollections).toHaveBeenCalledWith(teamId, 'tasks', 'next', signal)
  expect(owners.deleteTask).toHaveBeenCalledWith(teamId, taskId, 3, signal)
  expect(owners.cancelTask).toHaveBeenCalledWith(teamId, taskId, 3, 'Stop after review', signal)
  expect(owners.loadMore).toHaveBeenCalledOnce()
  expect(runtime.teamTasks.calls).toContainEqual({ method: 'refresh', args: [true] })
  expect(browser.refreshInbox).toBeDefined()
  expect(browser.openActionContext).toBeDefined()
  await browser.refreshInbox?.()
  await browser.recoverInbox?.()
  await browser.loadMoreInbox?.()
  await browser.acknowledgeInbox?.()
  await browser.openPendingAction?.(teamId, action.id)
  browser.closeActionDetail?.()
  expect(owners.refreshInbox).toHaveBeenCalledOnce()
  expect(owners.recoverInbox).toHaveBeenCalledOnce()
  expect(owners.loadMoreInbox).toHaveBeenCalledOnce()
  expect(owners.acknowledgeInbox).toHaveBeenCalledOnce()
  expect(owners.inspectAction).toHaveBeenCalledWith(teamId, action.id)
  expect(owners.closeActionDetail).toHaveBeenCalledOnce()
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: teamId, selected: selection })
  await runtime.sessions.add({ id: action.sessionId, summary: { displayTitle: 'Request Session' } }, { current: false })
  await browser.openActionContext?.(action)
  expect(runtime.sessions.list.getSnapshot().current).toBe(action.sessionId)
  expect(runtime.teamTasks.calls.filter(call => call.method === 'inspect')).not.toHaveLength(0)
  workspace.navigateApplication?.('/team')
  expect(layout.navigate).toHaveBeenCalledWith('/team')
  expect(commands.sections().some(section => section.id === 'team.teams')).toBe(true)
  expect(update).not.toHaveBeenCalled()
})

it('revalidates exact task, form and channel routes before publishing workspace navigation', async () => {
  const task = workspaceTask('Restored task')
  const teamId = task.teamId
  const selection: TeamTaskSelection = { teamId,
    state: workspaceSelection({ ...workspaceState(), tasks: [task] }) }
  let detail = workspaceTaskDetail(task)
  const channelId = 'restored-channel' as ChannelId
  const channel = { manifest: { id: channelId, teamId, adapter: { type: 'direct', version: 4 },
    participants: [], limits: {} }, phase: 'active' as const, cursor: 1 }
  const action: TeamActionResponseResult['action'] = { id: 'restored-action' as never, teamId,
    sessionId: 'action-session' as never, participantId: 'worker' as never, sourceId: 'source' as never,
    kind: 'approval', phase: 'pending', createdAt: 1, updatedAt: 2,
    details: { toolName: 'bash', reason: 'Inspect exact action', callId: 'call' } }
  const inspectAction = vi.fn<NonNullable<ITeamTasks['inspectAction']>>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValue({ teamId, teamCursor: 1, action, handling: { kind: 'actionable' } })
  const readTaskDetail = vi.fn<NonNullable<ITeamTasks['readTaskDetail']>>().mockResolvedValue(undefined)
  const readChannel = vi.fn(async () => ({ channel, records: [] }))
  const { runtime, workspace, update } = await mountTeam((testRuntime) => {
    testRuntime.teamTasks.stub('inspect', vi.fn(async () => selection))
    Object.assign(testRuntime.teamTasks, { readTaskDetail: async (...args: Parameters<NonNullable<ITeamTasks['readTaskDetail']>>) => {
      await readTaskDetail(...args)
      testRuntime.teamTasks.list.set({ ...testRuntime.teamTasks.list.getSnapshot(), taskDetail: detail })
    }, readChannel, inspectAction })
  })
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: teamId, selected: selection })
  const route: WorkspaceRoute = { teamId, view: 'tasks', taskId: task.id,
    taskForm: { kind: 'taskUpdate', taskId: task.id }, search: 'Restored', phase: 'review' }
  const signal = new AbortController().signal
  await workspace.restoreNavigation(route, signal)
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, task.id, undefined, undefined)
  expect(update).toHaveBeenCalledWith(teamId, { view: 'tasks', taskForm: route.taskForm,
    actionId: undefined, taskId: task.id, taskSearch: 'Restored', taskPhase: 'review' })
  await workspace.restoreNavigation({ teamId, view: 'channels', channelId, search: '', phase: 'all' }, signal)
  expect(readChannel).toHaveBeenCalledWith(channelId, -1, expect.any(AbortSignal))
  await workspace.restoreNavigation({ teamId, view: 'workflows', planId: 'plan' as never,
    search: '', phase: 'all' }, signal)
  expect(update).toHaveBeenCalledWith(teamId, { view: 'workflows', taskForm: undefined,
    actionId: undefined, workflowPlanId: 'plan' })
  await expect(workspace.restoreNavigation({ teamId, view: 'attention', actionId: 'missing-action' as never,
    search: '', phase: 'all' }, signal)).rejects.toThrow('not available in the selected Team')
  await workspace.restoreNavigation({ teamId, view: 'attention', actionId: action.id,
    search: '', phase: 'all' }, signal)
  expect(inspectAction).toHaveBeenCalledWith(teamId, action.id)
  expect(update).toHaveBeenCalledWith(teamId, { view: 'attention', taskForm: undefined, actionId: action.id })
  detail = workspaceTaskDetail(workspaceTask('Another task'))
  await expect(workspace.restoreNavigation(route, signal)).rejects.toThrow('task form is not available')
  await expect(workspace.restoreNavigation({ ...route, taskForm: undefined }, signal)).rejects.toThrow('task is not available')
  await expect(workspace.restoreNavigation({ teamId, view: 'members', sessionId: 'orphan-session' as never,
    search: '', phase: 'all' }, signal)).rejects.toThrow('member identity is required')
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: 'other-team' as TeamId })
  const callsBefore = update.mock.calls.length
  await workspace.restoreNavigation({ teamId, view: 'overview', search: '', phase: 'all' }, signal)
  expect(update.mock.calls).toHaveLength(callsBefore)
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), selected: undefined })
  await expect(workspace.openCoordinator?.()).resolves.toBeUndefined()
})

it('fails closed for Team, action and route inspection when the optional reader is absent', async () => {
  const teamId = workspaceState().team.id
  const action: TeamActionResponseResult['action'] = { id: 'unread-action' as never, teamId,
    sessionId: 'unread-session' as never, participantId: 'worker' as never, sourceId: 'source' as never,
    kind: 'approval', phase: 'pending', createdAt: 1, updatedAt: 2,
    details: { toolName: 'bash', reason: 'Inspect exact action', callId: 'call' } }
  const { browser, workspace, layout } = await mountTeam((testRuntime) => {
    Object.assign(testRuntime.teamTasks, { inspect: undefined,
      respondAction: vi.fn<NonNullable<ITeamTasks['respondAction']>>() })
  })
  await expect(browser.openTeam(teamId)).rejects.toThrow('Read-only Team inspection is unavailable')
  expect(layout.showWorkspace).toHaveBeenCalledWith('team')
  await expect(workspace.openActionContext?.(action)).rejects.toThrow('Read-only Team inspection is unavailable')
  await expect(workspace.restoreNavigation({ teamId, view: 'overview', search: '', phase: 'all' },
    new AbortController().signal)).rejects.toThrow('Read-only Team inspection is unavailable')
})

it('keeps the latest URL restoration when an earlier exact Team read settles afterward', async () => {
  const teamId = workspaceState().team.id
  const selection: TeamTaskSelection = { teamId, state: workspaceSelection(workspaceState()) }
  const finish: Array<(result: TeamTaskSelection) => void> = []
  const signals: Array<AbortSignal | undefined> = []
  const { runtime, workspace, update } = await mountTeam((testRuntime) => {
    testRuntime.teamTasks.stub('inspect', (id, signal) => {
      expect(id).toBe(teamId)
      signals.push(signal)
      return new Promise<TeamTaskSelection>((resolve) => { finish.push(resolve) })
    })
  })
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: teamId, selected: selection })
  const first = workspace.restoreNavigation({ teamId, view: 'overview', search: '', phase: 'all' },
    new AbortController().signal)
  const second = workspace.restoreNavigation({ teamId, view: 'members', search: '', phase: 'all' },
    new AbortController().signal)
  expect(signals[0]?.aborted).toBe(true)
  expect(signals[1]?.aborted).toBe(false)
  finish[0]?.(selection)
  await first
  expect(update).not.toHaveBeenCalled()
  finish[1]?.(selection)
  await second
  expect(update.mock.calls).toEqual([
    [teamId, { view: 'members', taskForm: undefined, actionId: undefined }],
    [teamId, { channelEnvelope: undefined, channelEnvelopeSequence: undefined }],
  ])
})

it('opens only loaded palette Teams and members, and preserves failures in the command owner', async () => {
  const base = workspaceState()
  const teamId = base.team.id
  const member = { id: 'palette-member' as never, teamId, kind: 'local-agent' as const,
    displayName: 'Palette worker', role: 'worker', capabilities: [], phase: 'active' as const }
  const selection: TeamTaskSelection = { teamId, state: workspaceSelection({ ...base, participants: [member] }) }
  const inspect = vi.fn<NonNullable<ITeamTasks['inspect']>>()
    .mockRejectedValueOnce(new Error('Team inspection refused')).mockResolvedValue(selection)
  const sessionId = 'palette-session' as SessionId
  const { runtime, commands, layout } = await mountTeam((testRuntime) => {
    testRuntime.teamTasks.stub('inspect', inspect)
    Object.assign(testRuntime.teamTasks, { participantSession: vi.fn(async () => sessionId) })
  })
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: teamId, selected: selection,
    items: [{ id: teamId, readAccess: 'member', objectiveTruncated: false, depth: 0,
      maxTeamDepth: 4, goal: { teamId, revision: 1, objective: 'Release work', phase: 'active' },
      phase: 'active', cursor: 1, createdAt: 1, updatedAt: 1,
      workspacePath: '/project/release' }],
    collections: { teamId, members: { ...empty, items: [workspaceMemberSummary(member)] },
      tasks: empty, workflowPlans: empty, artifacts: empty } })
  const teamCommands = commands.sections().find(section => section.id === 'team.teams')
  expect(teamCommands?.items[0]).toMatchObject({ id: teamId, label: 'Release work', hint: 'In progress · release' })
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    items: runtime.teamTasks.list.getSnapshot().items.map(item => ({ ...item, workspacePath: '/' })) })
  expect(commands.sections().find(section => section.id === 'team.teams')?.items[0]?.hint).toBe('In progress · ')
  teamCommands?.items[0]?.run()
  await waitFor(() => { expect(inspect).toHaveBeenCalledOnce() })
  teamCommands?.items[0]?.run()
  await waitFor(() => { expect(inspect).toHaveBeenCalledTimes(2) })
  const memberCommands = commands.sections().find(section => section.id === 'team.members')
  expect(memberCommands?.items[0]).toMatchObject({ id: member.id, label: member.displayName, hint: member.role })
  await runtime.sessions.add({ id: sessionId, summary: { displayTitle: 'Palette Session' } }, { current: false })
  memberCommands?.items[0]?.run()
  await waitFor(() => { expect(runtime.sessions.list.getSnapshot().current).toBe(sessionId) })
  const warning = vi.spyOn(runtime.ctx.logger, 'warn')
  Object.assign(runtime.teamTasks, { participantSession: vi.fn(async () => { throw new Error('Member Session unavailable') }) })
  memberCommands?.items[0]?.run()
  await waitFor(() => { expect(warning).toHaveBeenCalledWith('ui-team: palette member Session open failed', expect.any(Error)) })
  const navigation = runtime.slots.entries('sidebar.workspaceNavigation')[0]
  if (navigation?.inject === undefined) throw new Error('Team navigation slot is missing')
  const control = navigation.inject() as { open: () => void }
  control.open()
  expect(layout.showWorkspace).toHaveBeenCalledWith('team')
})
