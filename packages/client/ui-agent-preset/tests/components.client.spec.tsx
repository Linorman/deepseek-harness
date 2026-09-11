// @vitest-environment jsdom
/**
 * The General-settings row and session-header label for Agent presets.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@clocky/clocky-client-test-runtime'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelProps } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetRow } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetRowProps } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetSettingsState } from '../src/client/settings-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const ROW_READY: AgentPresetSettingsState = {
  status: 'ready',
  error: null,
  writable: true,
  currentValue: 'standard',
  // `mine` deliberately names itself nothing: the row must fall back to the
  // id for a preset whose author wrote no metadata.
  options: [{ id: 'standard', trust: 'system', name: '标准模式' }, { id: 'mine', trust: 'user' }],
}

function renderRow(state: Partial<AgentPresetSettingsState> = {}) {
  const store = createSnapshotStore<AgentPresetSettingsState>({ ...ROW_READY, ...state })
  const actions = { load: vi.fn(() => Promise.resolve()), select: vi.fn(() => Promise.resolve()) }
  render(<AgentPresetRow {...({
    ...actions,
    useAgentPreset: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetRowProps)} />)
  return actions
}

function renderLabel(
  summary: { blank: boolean; agentPreset?: string } | undefined,
  roster: Partial<AgentPresetSettingsState> = {},
) {
  const store = createSnapshotStore<AgentPresetSettingsState>({
    ...ROW_READY, ...roster,
  })
  const sessions = createSnapshotStore({ byId: summary === undefined ? {} : { s1: summary } })
  const load = vi.fn(() => Promise.resolve())
  const view = render(<AgentPresetLabel {...({
    load,
    sessionId: 's1',
    useSessions: bindSnapshotSelector(sessions),
    useAgentPresets: bindSnapshotSelector(store),
    t: (key: keyof typeof en) => en[key],
  } as unknown as AgentPresetLabelProps)} />)
  return { load, view }
}

describe('the General-settings row', () => {
  it('reads the roster once and shows the current default', async () => {
    const actions = renderRow()

    await waitFor(() => { expect(actions.load).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button').textContent).toContain(en.presetStandardName)
  })

  it('marks a locally authored option as local', () => {
    renderRow()

    fireEvent.click(screen.getByRole('button'))

    // A local preset is exactly as privileged as the plugins it names, so the
    // list says which rows are local rather than presenting all as vetted.
    expect(screen.getByText(`mine · ${en.userTrust}`)).toBeTruthy()
    // The shipped one carries no marker; only local rows are called out.
    expect(screen.getAllByText(en.presetStandardName)).toHaveLength(2)
  })

  it('falls back to the id for a preset that published no name', () => {
    renderRow({
      currentValue: 'mine',
      options: [
        { id: 'standard', trust: 'system', name: '标准模式' },
        { id: 'bare', trust: 'system' },
        { id: 'mine', trust: 'user' },
        { id: 'ours', trust: 'user', name: '团队模式' },
      ],
    })

    // The trigger names the preset; with no metadata the id is all there is.
    expect(screen.getByRole('button').textContent).toContain('mine')

    fireEvent.click(screen.getByRole('button'))

    // A locally authored preset is marked whether or not it named itself.
    expect(screen.getByText(`团队模式 · ${en.userTrust}`)).toBeTruthy()
    expect(screen.getByText(`mine · ${en.userTrust}`)).toBeTruthy()
    // A shipped preset with no metadata is listed by id and carries no mark.
    expect(screen.getByText('bare')).toBeTruthy()
  })

  it('shows the selected id until a stale roster contains it', () => {
    renderRow({ currentValue: 'arriving', options: [] })

    expect(screen.getByRole('button').textContent).toContain('arriving')
  })

  it('writes the picked preset and closes the menu', () => {
    const actions = renderRow()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.click(screen.getByText(`mine · ${en.userTrust}`))

    expect(actions.select).toHaveBeenCalledWith('mine')
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside dismissal', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button'))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('says it is loading before the roster answers', () => {
    renderRow({ status: 'loading', currentValue: '' })

    expect(screen.getByRole('button').textContent).toContain(en.loading)
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })

  it('shows a failure in place of the description', () => {
    renderRow({ error: 'roster unavailable' })

    expect(screen.getByRole('alert').textContent).toBe('roster unavailable')
  })

  it('renders nothing when the deployment composes no presets', () => {
    const { container } = render(<AgentPresetRow {...({
      load: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve()),
      useAgentPreset: bindSnapshotSelector(
        createSnapshotStore<AgentPresetSettingsState>({ ...ROW_READY, status: 'unavailable', options: [] })),
      t: (key: keyof typeof en) => en[key],
    } as unknown as AgentPresetRowProps)} />)

    expect(container.firstChild).toBeNull()
  })

  it('closes and locks the menu when the settings turn read-only', () => {
    const store = createSnapshotStore<AgentPresetSettingsState>(ROW_READY)
    render(<AgentPresetRow {...({
      load: vi.fn(() => Promise.resolve()),
      select: vi.fn(() => Promise.resolve()),
      useAgentPreset: bindSnapshotSelector(store),
      t: (key: keyof typeof en) => en[key],
    } as unknown as AgentPresetRowProps)} />)
    fireEvent.click(screen.getByRole('button'))

    act(() => { store.set({ ...ROW_READY, writable: false }) })

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
  })
})

describe('the session-header label', () => {
  it('names the preset the session runs, and never offers a switch', async () => {
    const { load } = renderLabel({ blank: false, agentPreset: 'standard' })

    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    // A control here would promise a switch the host refuses outright.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByTitle(en.presetStandardDescription).textContent).toBe(en.presetStandardName)
  })

  it('falls back to the id, and to the generic hint, when metadata is absent', () => {
    renderLabel({ blank: true, agentPreset: 'mine' })

    expect(screen.getByTitle(en.headerHint).textContent).toBe('mine')
  })

  it('shows the id until the roster resolves it', () => {
    renderLabel({ blank: false, agentPreset: 'standard' }, { options: [] })

    // The session's own summary is the authority on which preset it runs; the
    // roster only supplies the display name, and its arrival is a later frame.
    expect(screen.getByTitle(en.headerHint).textContent).toBe('standard')
  })

  it('renders nothing, and reads no roster, when the session records no preset', async () => {
    const absent = renderLabel({ blank: true })
    expect(absent.view.container.firstChild).toBeNull()
    cleanup()

    // A session the list has not caught up to is the same answer: a deployment
    // that composes no presets must not pay for a roster read per header.
    const unknown = renderLabel(undefined)
    expect(unknown.view.container.firstChild).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(absent.load).not.toHaveBeenCalled()
    expect(unknown.load).not.toHaveBeenCalled()
  })
})
