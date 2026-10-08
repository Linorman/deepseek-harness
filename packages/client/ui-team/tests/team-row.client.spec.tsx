// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectTeamProductSummary } from '@clocky/clocky-team/selection'
import type { TeamStateSnapshot } from '@clocky/clocky-client-connection/client'
import { bindSnapshotSelector, makeTranslate } from '@clocky/clocky-client-test-runtime'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type { TeamId, TeamInboxState, TeamTaskListState } from '@clocky/clocky-client-runtime/client'
import { TeamBrowser, type TeamBrowserProps } from '../src/client/TeamBrowser.tsx'
import { deriveShortTitle, memberStatus, relativeTime, sortTeams, teamStatus } from '../src/client/team-row.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Item = TeamTaskListState['items'][number]

function team(id: string, phase: Item['phase'], objective: string, updatedAt: number): Item {
  const teamId = id as TeamId
  const raw: TeamStateSnapshot['team'] = {
    id: teamId, depth: 0, maxTeamDepth: 4, goal: { teamId, revision: 1, objective, phase: 'active', budgets: {} },
    phase, cursor: 1, createdAt: 1, updatedAt,
  }
  return projectTeamProductSummary(raw, raw.id, 512, {})
}

function render_(items: Item[], extra: Partial<TeamTaskListState> = {}, overrides: Partial<TeamBrowserProps> = {}) {
  const state = createSnapshotStore<TeamTaskListState>({
    items, current: undefined, selected: undefined, phase: 'ready', state: 'idle', error: null, draft: undefined, ...extra,
  })
  const props: TeamBrowserProps = {
    wide: true, expandSidebar: vi.fn(), openTeam: vi.fn(() => Promise.resolve()), archiveTeam: vi.fn(() => Promise.resolve()),
    useTasks: bindSnapshotSelector(state), useSessions: (() => undefined) as never, useWorkspaces: (() => undefined) as never,
    t: makeTranslate(en), ...overrides,
  }
  return render(<TeamBrowser {...props} />)
}

describe('Team row helpers', () => {
  it('rejects unsupported phases and readiness instead of showing a misleading known state', () => {
    expect(teamStatus('quiescing')).toBe('running')
    expect(() => teamStatus('future-phase' as Parameters<typeof teamStatus>[0])).toThrow('unknown Team phase future-phase')
    expect(() => memberStatus('future-readiness' as Parameters<typeof memberStatus>[0])).toThrow('unknown readiness state future-readiness')
    for (const state of ['starting', 'stopping', 'ready', 'not-applicable'] as const) {
      expect(memberStatus(state)).toBe(state === 'starting' || state === 'stopping' ? 'waiting' : 'idle')
    }
  })

  it('keeps missing timestamps and equal identities stable while ordering equally recent ids', () => {
    expect(sortTeams([{ id: 'b' }, { id: 'a' }, { id: 'b' }]).map(item => item.id)).toEqual(['a', 'b', 'b'])
    expect(sortTeams([{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 1 }]).map(item => item.id)).toEqual(['a', 'b'])
  })
  it('derives a short title from the leading clause and caps its length', () => {
    expect(deriveShortTitle('发布准备：整理接口迁移、回归测试与发布说明')).toBe('发布准备')
    expect(deriveShortTitle('Write a file. Then summarize it.')).toBe('Write a file')
    expect(deriveShortTitle('x'.repeat(80))).toHaveLength(40)
    expect(deriveShortTitle('无标点的目标')).toBe('无标点的目标')
    expect(deriveShortTitle('Run the child navigation probe.')).toBe('Run the child navigation probe.')
  })

  it('maps every Team phase onto an agent state', () => {
    expect(teamStatus('active')).toBe('running')
    expect(teamStatus('stalled')).toBe('blocked')
    expect(teamStatus('completed')).toBe('done')
    expect(teamStatus('failed')).toBe('failed')
    expect(teamStatus('cancelled')).toBe('idle')
    expect(teamStatus('provisioning')).toBe('waiting')
  })

  it('buckets elapsed time', () => {
    const now = 10 * 24 * 3_600_000
    expect(relativeTime(now - 20_000, now)).toEqual({ key: 'time.justNow', count: 0 })
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ key: 'time.minutes', count: 5 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ key: 'time.hours', count: 3 })
    expect(relativeTime(now - 2 * 86_400_000, now)).toEqual({ key: 'time.days', count: 2 })
  })

  it('maps member readiness onto agent states, keeping unobserved members idle', () => {
    expect(memberStatus('busy')).toBe('running')
    expect(memberStatus('capacity-wait')).toBe('waiting')
    expect(memberStatus('recovery-required')).toBe('needs-you')
    expect(memberStatus('route-unavailable')).toBe('blocked')
    expect(memberStatus('resident')).toBe('idle')
    expect(memberStatus(undefined)).toBe('idle')
  })

  it('orders by recency with a stable id tie-break', () => {
    const ordered = sortTeams([{ id: 'b', updatedAt: 1 }, { id: 'a', updatedAt: 1 }, { id: 'c', updatedAt: 5 }])
    expect(ordered.map(item => item.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('TeamBrowser rows', () => {
  it('shows a status glyph, short title, and phase with relative time, most recent first', () => {
    const now = Date.now()
    const view = render_([
      team('older', 'completed', 'Archive old docs: move them', now - 2 * 3_600_000),
      team('newer', 'active', 'Release prep: migrate APIs and write notes', now - 5 * 60_000),
    ])
    const rows = view.getAllByRole('listitem')
    expect(rows.map(row => row.getAttribute('data-status'))).toEqual(['running', 'done'])
    const first = within(rows[0]!).getByRole('button', { name: /Release prep/ })
    expect(first.getAttribute('title')).toBe('Release prep: migrate APIs and write notes')
    expect(first.textContent).toContain('In progress')
    expect(first.textContent).toContain('5 min ago')
    expect(first.querySelector('svg[data-status="running"]')).not.toBeNull()
  })

  it('keeps row actions keyboard reachable inside the row', () => {
    const archiveTeam = vi.fn(() => Promise.resolve())
    const view = render_([{ ...team('done', 'completed', 'Done work', Date.now()), readAccess: 'member' }], {}, { archiveTeam })
    const archive = view.getByRole('button', { name: /^Archive Done work/ })
    archive.focus()
    expect(document.activeElement).toBe(archive)
    fireEvent.click(archive)
    expect(archiveTeam).toHaveBeenCalledWith('done')
  })

  it('shows the Inbox with its unread count and names the count for assistive technology', () => {
    const inbox: TeamInboxState = {
      connectionGeneration: 1, items: [{ sequence: 2 }, { sequence: 3 }, { sequence: 1 }] as never, phase: 'ready',
      displayCursor: 1, cursor: 3, nextCursor: undefined, loadingMore: false, acknowledging: false, hasNewer: false, error: null,
    }
    const noop = vi.fn(async () => {})
    const view = render_([], { inbox }, {
      recoverInbox: noop, refreshInbox: noop, loadMoreInbox: noop, watchInbox: noop as never, acknowledgeInbox: noop,
      readAction: noop as never, respondAction: noop as never, openActionContext: noop,
    })
    const button = view.getByRole('button', { name: 'Inbox，2 unread' })
    expect(button.textContent).toContain('2')
  })
})
