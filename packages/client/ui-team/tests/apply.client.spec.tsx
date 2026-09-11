// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import type { ChannelId, SessionId, TeamArtifactReadResult, TeamAuditList, TeamId, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { SlotTestRuntime } from '@clocky/clocky-client-test-runtime'
import { apply as applySidebar, inject as sidebarInject } from '@clocky/clocky-client-ui-sidebar/client'
import type { TeamBrowserInjected } from '../src/client/TeamBrowser.tsx'
import { apply, inject } from '../src/client/index.ts'

const coordinator = 'team-coordinator' as SessionId

describe('ui-team apply', () => {
  it('registers into the sidebar Team seat and opens the resolved coordinator transcript', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('layout', { toggleSidebar: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    locale.setLocale('en')
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare({
      'sidebar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    }, ({ renderSlot }) => createElement('div', null,
      renderSlot('sidebar', { collapsed: false, width: 300 }), renderSlot('shell.overlay', {})))
    await runtime.mount({ inject: [...sidebarInject], apply: applySidebar })
    await runtime.sessions.add({ id: coordinator, summary: { displayTitle: 'Coordinator' } }, { current: false })
    const selection = {
      teamId: 'team-1' as TeamTaskSelection['teamId'],
      state: {} as TeamTaskSelection['state'],
      coordinatorSessionId: coordinator,
    } satisfies TeamTaskSelection
    runtime.teamTasks.stub('open', vi.fn(async () => selection))
    runtime.teamTasks.list.set({
      ...runtime.teamTasks.list.getSnapshot(),
      items: [{
        id: selection.teamId,
        depth: 0,
        maxTeamDepth: 4,
        goal: { teamId: selection.teamId, revision: 1, objective: 'Open this Team', phase: 'active', budgets: {} },
        phase: 'active',
        cursor: 1,
        createdAt: 1,
        updatedAt: 1,
      }],
    })
    const feature = await runtime.mount({ inject: [...inject], apply })
    expect(runtime.slots.entries('sidebar.teamTasks')).toHaveLength(1)
    expect(runtime.slots.entries('shell.overlay')).toHaveLength(1)
    const view = runtime.renderRoot()
    fireEvent.click(view.getByText('Open this Team'))
    await waitFor(() => {
      expect(runtime.teamTasks.calls).toContainEqual({ method: 'open', args: [selection.teamId, undefined] })
      expect(runtime.sessions.calls).toContainEqual({ method: 'refresh', args: [] })
      expect(runtime.sessions.calls).toContainEqual({ method: 'open', args: [coordinator] })
    })
    await feature.dispose()
    expect(runtime.slots.entries('sidebar.teamTasks')).toHaveLength(0)
    expect(runtime.slots.entries('shell.overlay')).toHaveLength(0)
    await runtime.dispose()
  })

  it('forwards optional Team detail operations and fails closed when a reader is unavailable', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('layout', { toggleSidebar: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    locale.setLocale('en')
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare({
      'sidebar': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    }, ({ renderSlot }) => createElement('div', null,
      renderSlot('sidebar', { collapsed: false, width: 300 }), renderSlot('shell.overlay', {})))
    await runtime.mount({ inject: [...sidebarInject], apply: applySidebar })
    await runtime.sessions.add({ id: coordinator, summary: { displayTitle: 'Coordinator' } }, { current: false })

    const teamId = 'team-forwarding' as TeamId
    const participantId = 'participant-forwarding' as never
    const channelId = 'channel-forwarding' as ChannelId
    const selection = {
      teamId,
      state: {} as TeamTaskSelection['state'],
      coordinatorSessionId: coordinator,
    } satisfies TeamTaskSelection
    const watchStop = vi.fn()
    const teamTasks = runtime.teamTasks as unknown as {
      watch?: (intervalMs?: number) => () => void
      participantSession: ((id: TeamId, participant: never, signal?: AbortSignal) => Promise<SessionId>) | undefined
      readAudit: ((id: TeamId, options?: Record<string, unknown>, signal?: AbortSignal) => Promise<TeamAuditList>) | undefined
      readChannel: ((id: ChannelId, afterCursor?: number, signal?: AbortSignal) => Promise<unknown>) | undefined
      readArtifact: ((id: TeamId, artifactId: string, signal?: AbortSignal) => Promise<TeamArtifactReadResult>) | undefined
    }
    teamTasks.watch = vi.fn(() => watchStop)
    teamTasks.participantSession = vi.fn(async () => coordinator)
    teamTasks.readAudit = vi.fn(async (): Promise<TeamAuditList> => ({ teamId, items: [] }))
    teamTasks.readChannel = vi.fn(async () => ({ records: [] }))
    teamTasks.readArtifact = vi.fn(async (): Promise<TeamArtifactReadResult> => ({
      artifact: { id: 'artifact-forwarding', provider: 'local', kind: 'report', uri: 'artifact://forwarding', visibility: 'team' },
      bytes: 0,
      data: '',
    }))
    runtime.teamTasks.stub('open', vi.fn(async () => selection))
    runtime.teamTasks.stub('archive', vi.fn(async () => selection.state))
    runtime.teamTasks.stub('cancel', vi.fn(async (): Promise<'cancelled'> => 'cancelled'))
    runtime.teamTasks.stub('resume', vi.fn(async () => selection))

    const feature = await runtime.mount({ inject: [...inject], apply })
    const entry = runtime.slots.entries('sidebar.teamTasks')[0]
    if (entry?.inject === undefined) throw new Error('ui-team did not publish its business face')
    const injected = entry.inject() as unknown as TeamBrowserInjected
    const signal = new AbortController().signal

    await injected.openTeam(teamId)
    await injected.archiveTeam(teamId)
    await injected.cancelTeam?.(teamId)
    await injected.resumeTeam?.(teamId)
    await injected.openParticipantSession?.(teamId, participantId)
    await injected.readAudit?.(teamId, { limit: 2 }, signal)
    await injected.readChannel?.(channelId, 3, signal)
    await injected.readArtifact?.(teamId, 'artifact-forwarding', signal)
    expect(teamTasks.watch).toHaveBeenCalledOnce()
    expect(watchStop).not.toHaveBeenCalled()

    teamTasks.participantSession = undefined
    teamTasks.readAudit = undefined
    teamTasks.readChannel = undefined
    teamTasks.readArtifact = undefined
    await expect(injected.openParticipantSession?.(teamId, participantId)).rejects.toThrow('has no Session descendant')
    await expect(injected.readAudit?.(teamId)).resolves.toEqual({ teamId, items: [] })
    await expect(injected.readChannel?.(channelId)).rejects.toThrow('cannot be read')
    await expect(injected.readArtifact?.(teamId, 'missing')).rejects.toThrow('cannot be read')

    await feature.dispose()
    expect(watchStop).toHaveBeenCalledOnce()
    await runtime.dispose()
  })
})
