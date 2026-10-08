/** Workspace links round-trip view state without storing drafts or replacing unrelated URL settings. */
import { expect, it } from 'vitest'
import { readWorkspaceRoute, workspaceRouteIdentity, workspaceRouteUrl } from '../src/client/workspace-navigation.ts'

it('preserves an exact channel destination and keeps the empty first-input route distinct', () => {
  const route = readWorkspaceRoute('http://localhost/?team=team&view=channels&channel=channel')!
  expect(readWorkspaceRoute(workspaceRouteUrl('http://localhost/', route))?.channelId).toBe('channel')
  expect(workspaceRouteIdentity(undefined)).toBe('')
})

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

it('restores only the request identity without placing answer input in the URL', () => {
  const route = readWorkspaceRoute('http://localhost/?team=team&view=attention&action=request')!
  expect(route.actionId).toBe('request')
  expect(readWorkspaceRoute(workspaceRouteUrl('http://localhost/', route))).toEqual(route)
  expect(workspaceRouteIdentity({ ...route, actionId: 'other' as never })).not.toBe(workspaceRouteIdentity(route))
  expect(workspaceRouteUrl('http://localhost/?team=team&action=request&theme=dark', undefined)).toBe('http://localhost/?theme=dark')
})

it('round-trips task form identities and rejects incompatible external form targets', () => {
  for (const query of ['form=taskCreate', 'form=taskUpdate&formTask=existing', 'form=taskReview&formTask=review', 'form=taskIntegrate&formTask=source']) {
    const route = readWorkspaceRoute(`http://localhost/?team=team&view=tasks&${query}`)!
    const result = workspaceRouteUrl('http://localhost/?theme=dark', route)
    expect(readWorkspaceRoute(result)).toEqual(route)
    expect(result).not.toContain('description')
    expect(workspaceRouteIdentity({ ...route, taskForm: undefined })).not.toBe(workspaceRouteIdentity(route))
  }
  for (const query of ['form=unknown', 'form=taskCreate&formTask=existing', 'form=taskUpdate', 'form=taskReview&formTask=']) {
    expect(() => readWorkspaceRoute(`http://localhost/?team=team&${query}`)).toThrow()
  }
  expect(workspaceRouteUrl('http://localhost/?team=team&form=taskUpdate&formTask=existing&theme=dark', undefined))
    .toBe('http://localhost/?theme=dark')
})
