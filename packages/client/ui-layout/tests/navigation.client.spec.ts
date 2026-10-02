// @vitest-environment jsdom
/** Cross-workspace viewing preserves exact references and makes browser history observable without a reload. */
import { afterEach, expect, it, vi } from 'vitest'
import { LayoutController } from '../src/client/service.ts'
import { teamInspectionUrl, readWorkspaceSource, restoreWorkspaceFocus, WORKSPACE_NAVIGATION_EVENT } from '../src/client/navigation.ts'
import type { TeamInspectionTarget } from '../src/client/navigation.ts'
afterEach(() => { window.history.replaceState(null, '', '/') })

it('removes unrelated write forms and Simulation selectors from exact read links', () => {
  const original = `${window.location.origin}/?workspace=simulation&simulation=run&simulationSource=3&simulationKnowledge=k&team=old&view=tasks&form=taskUpdate&formTask=old-task&q=old&status=review&theme=dark`
  const targets: TeamInspectionTarget[] = [{ kind: 'team', teamId: 'team' as never },
    { kind: 'task', teamId: 'team' as never, taskId: '任务&=1' as never },
    { kind: 'session', teamId: 'team' as never, sessionId: 'historical' as never, participantId: 'member' as never },
    { kind: 'channel', teamId: 'team' as never, channelId: 'channel' as never }]
  for (const target of targets) {
    const query = new URL(teamInspectionUrl(original, target)).searchParams
    expect(query.get('team')).toBe('team')
    expect(query.get('theme')).toBe('dark')
    for (const key of ['workspace', 'simulation', 'simulationSource', 'simulationKnowledge', 'form', 'formTask', 'q', 'status']) expect(query.has(key)).toBe(false)
    if (target.kind === 'task') expect(query.get('task')).toBe(target.taskId)
    if (target.kind === 'session') { expect(query.get('session')).toBe('historical'); expect(query.get('participant')).toBe('member') }
  }
})

it('pushes a same-document destination, restores product visibility and notifies its route owner', () => {
  window.history.replaceState(null, '', '/?workspace=simulation&simulation=run&simulationSource=2')
  const service = new LayoutController()
  const panels = { showWorkspace: vi.fn(), setSidebar: vi.fn(), setDetails: vi.fn(), toggleSidebar: vi.fn(),
    setNarrow: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }
  service.attachPanels(panels)
  const notify = vi.fn()
  window.addEventListener(WORKSPACE_NAVIGATION_EVENT, notify)
  try {
    const length = window.history.length
    service.navigate(teamInspectionUrl(window.location.href, { kind: 'task', teamId: 'team' as never, taskId: 'task' as never }))
    expect(window.history.length).toBe(length + 1)
    expect(panels.showWorkspace).toHaveBeenLastCalledWith('team')
    expect(notify).toHaveBeenCalledTimes(1)
    service.navigate(window.location.href)
    expect(window.history.length).toBe(length + 1)
    window.history.replaceState(null, '', '/?workspace=simulation&simulation=run&simulationSource=2')
    service.restoreWorkspace()
    expect(panels.showWorkspace).toHaveBeenLastCalledWith('simulation')
    service.showWorkspace('team')
    expect(window.location.search).toBe('')
    expect(() => { service.navigate('https://other.example/?team=one') }).toThrow('current origin')
  } finally { window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, notify) }
})


it('retains one exact source route and rejects external or private history fields', () => {
  const base = `${window.location.origin}/?team=target`
  const source = `${window.location.origin}/?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=e&secret=private#private`
  const clean = readWorkspaceSource({ clockyWorkspaceSource: source, clockyWorkspaceTarget: 'target' }, base)
  expect(clean).toBe(`${window.location.origin}/?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=e`)
  for (const value of [null, {}, { clockyWorkspaceSource: 1 },
    { clockyWorkspaceSource: 'https://other.example/?team=one', clockyWorkspaceTarget: 'target' },
    { clockyWorkspaceSource: `${window.location.origin}/other?team=one`, clockyWorkspaceTarget: 'target' },
    { clockyWorkspaceSource: 'x'.repeat(4097), clockyWorkspaceTarget: 'target' }]) expect(readWorkspaceSource(value, base)).toBeUndefined()
})

it('restores a revalidated source link once and refuses a marker for another source route', () => {
  const source = `${window.location.origin}/?workspace=simulation&simulation=run&simulationObject=entity&simulationModule=entities`
  const target = `${window.location.origin}/?team=target&view=overview`
  const root = document.createElement('section'), anchor = document.createElement('a')
  anchor.href = target; anchor.textContent = 'Team target'; root.append(anchor); document.body.append(root)
  try {
    window.history.replaceState({ clockyReturnDestination: source, clockyReturnFocus: target }, '', source)
    root.hidden = true
    expect(restoreWorkspaceFocus(root)).toBe(false)
    root.hidden = false
    expect(restoreWorkspaceFocus(root)).toBe(true)
    expect(document.activeElement).toBe(anchor)
    expect(restoreWorkspaceFocus(root)).toBe(false)
    window.history.replaceState({ clockyReturnDestination: source, clockyReturnFocus: target }, '', '/?simulation=another')
    expect(restoreWorkspaceFocus(root)).toBe(false)
    expect(readWorkspaceSource({ clockyWorkspaceSource: source, clockyWorkspaceTarget: 'another' }, target)).toBeUndefined()
  } finally { root.remove() }
})
