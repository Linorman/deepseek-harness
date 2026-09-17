/** Workspace links round-trip view state without storing drafts or replacing unrelated URL settings. */
import { expect, it } from 'vitest'
import { readWorkspaceRoute, workspaceRouteIdentity, workspaceRouteUrl } from '../src/client/workspace-navigation.ts'

it('round-trips opaque identifiers and Unicode search while preserving unrelated parameters', () => {
  const route = readWorkspaceRoute('http://localhost/?team=team-1&view=tasks&task=task-2&session=session-3&participant=worker-4&q=%E6%8E%A5%E5%8F%A3&status=review')!
  const url = workspaceRouteUrl('http://localhost/?theme=dark&team=older&view=overview', route)
  expect(new URL(url).searchParams.get('theme')).toBe('dark')
  expect(readWorkspaceRoute(url)).toEqual(route)
  expect(route.search).toBe('接口')
  expect(route.participantId).toBe('worker-4')
  expect(url).not.toContain('draft')
})

it('rejects unknown views and filters rather than restoring an unrelated screen', () => {
  expect(() => readWorkspaceRoute('http://localhost/?team=one&view=unknown')).toThrow('not available')
  expect(() => readWorkspaceRoute('http://localhost/?team=one&status=unknown')).toThrow('not available')
  expect(() => readWorkspaceRoute('http://localhost/?team=')).toThrow('identifier')
  expect(readWorkspaceRoute('http://localhost/?theme=dark')).toBeUndefined()
})

it('keeps filter editing within one history identity and removes only owned parameters for a new draft', () => {
  const route = readWorkspaceRoute('http://localhost/?team=one&view=tasks&task=two')!
  expect(workspaceRouteIdentity({ ...route, search: 'revised', phase: 'review' })).toBe(workspaceRouteIdentity(route))
  expect(workspaceRouteIdentity({ ...route, sessionId: 'session' as never })).not.toBe(workspaceRouteIdentity(route))
  expect(workspaceRouteUrl('http://localhost/?team=one&view=tasks&q=test&theme=dark', undefined)).toBe('http://localhost/?theme=dark')
})

it('preserves a selected workflow in its own navigation identity', () => {
  const route = readWorkspaceRoute('http://localhost/?team=team&view=workflows&plan=workflow')!
  expect(route.planId).toBe('workflow')
  expect(readWorkspaceRoute(workspaceRouteUrl('http://localhost/?theme=dark', route))).toEqual(route)
  expect(workspaceRouteIdentity({ ...route, planId: 'different' as never })).not.toBe(workspaceRouteIdentity(route))
})
