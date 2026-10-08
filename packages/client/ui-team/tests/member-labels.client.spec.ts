/** Coordinator form labels use explicit membership metadata, independent from roster paging. */
import { expect, it } from 'vitest'
import { memberLabels, memberPageLabels, overviewMemberLabels, referencedMemberName, type MemberLabel } from '../src/client/member-labels.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { en } from '../src/client/locales.ts'
import type { TeamIdentityState } from '@clocky/clocky-client-runtime/client'

function selection(phase: 'active' | 'left') {
  const state = workspaceState()
  const id = 'coordinator' as MemberLabel['id']
  return workspaceSelection({ ...state,
    participants: [{ id, teamId: state.team.id, kind: 'local-agent', phase, displayName: 'Coordinator', role: 'coordinator', capabilities: [] }],
    activations: [{ activation: { id: 'epoch' as never, teamId: state.team.id, participantId: id, status: phase === 'left' ? 'offline' : 'idle' },
      sessionId: 'session' as never, provider: 'local' }],
  })
}

it('adds at most one known coordinator and preserves its actual membership phase', () => {
  const page: MemberLabel[] = []
  expect(memberLabels(selection('left'), page)).toEqual([{ id: 'coordinator', kind: 'local-agent', phase: 'left',
    displayName: 'Coordinator', role: 'coordinator' }])
  expect(page).toEqual([])
})

it('keeps the current page when the coordinator is loaded or unavailable', () => {
  const page = memberLabels(selection('active'), [])
  expect(memberLabels(selection('active'), page)).toBe(page)
  expect(memberLabels(workspaceSelection(workspaceState()), page)).toBe(page)
})

it('projects member page labels without retaining execution history', () => {
  const member = workspaceMemberSummary({ id: 'worker' as MemberLabel['id'], teamId: workspaceState().team.id,
    kind: 'local-agent', phase: 'active', role: 'worker', displayName: 'Worker name', capabilities: [] })
  expect(memberPageLabels([member])).toEqual([
    { id: member.id, kind: member.kind, phase: member.phase, role: member.role, displayName: 'Worker name' },
  ])
})

it('prioritizes the independently resolved coordinator in the bounded active overview roster', () => {
  const coordinator = memberLabels(selection('active'), [])[0]!
  const members: MemberLabel[] = ['one', 'two', 'three', 'four', 'five'].map(id => ({
    ...coordinator, id: id as MemberLabel['id'], displayName: id, role: 'worker',
  }))
  members.push({ ...coordinator, id: 'human' as MemberLabel['id'], kind: 'human' },
    { ...coordinator, id: 'left' as MemberLabel['id'], phase: 'left' })
  expect(overviewMemberLabels(selection('active'), members).map(member => member.id)).toEqual(['coordinator', 'one', 'two', 'three'])
})

it('marks an independently resolved truncated member name without losing identity', () => {
  const t = makeTranslate(en)
  const identities: TeamIdentityState = { teamId: 'team' as TeamIdentityState['teamId'],
    forbidden: false, loading: false, disconnected: false,
    items: [{ participantId: 'member' as MemberLabel['id'], state: 'resolved', phase: 'active',
      displayName: { text: 'Member prefix', truncated: true } }] }
  expect(referencedMemberName('member', undefined, identities, t)).toBe('Member prefix…')
})

it('keeps forbidden and unavailable member references distinct from an unassigned task', () => {
  const t = makeTranslate(en)
  const empty: TeamIdentityState = { teamId: 'team' as TeamIdentityState['teamId'],
    items: [], forbidden: false, loading: false, disconnected: false }
  expect(referencedMemberName(undefined, 'Private', empty, t)).toBe(t('detail.task.unassigned'))
  expect(referencedMemberName('member', 'Private', { ...empty, forbidden: true }, t)).toBe(t('identity.unavailable'))
  expect(referencedMemberName('member', 'Private', { ...empty,
    items: [{ participantId: 'member' as MemberLabel['id'], state: 'unavailable' }] }, t)).toBe(t('identity.unavailable'))
  expect(referencedMemberName('member', 'Loaded name', undefined, t)).toBe('Loaded name')
  expect(referencedMemberName('member', undefined, empty, t)).toBe(t('detail.task.assignedId', { id: 'member' }))
  expect(referencedMemberName('member', undefined, { ...empty,
    items: [{ participantId: 'member' as MemberLabel['id'], state: 'resolved', phase: 'left',
      displayName: { text: 'Former member', truncated: false } }] }, t)).toBe(t('identity.left', { name: 'Former member' }))
})
