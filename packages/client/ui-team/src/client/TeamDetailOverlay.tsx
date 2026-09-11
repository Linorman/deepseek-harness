/** Frame-wide Team detail popover shown above the transcript. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCloseOutline16, IconRefreshOutline16 } from '@clocky/clocky-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import type {} from '@clocky/clocky-client-ui-layout/client'
import type { TeamId } from '@clocky/clocky-client-runtime/client'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TeamBrowserInjected } from './TeamBrowser.tsx'
import { TeamPage } from './TeamPage.tsx'
import css from './TeamBrowser.module.css'

type TeamDetailControls = Pick<
  TeamBrowserInjected,
  'respondAction' | 'openActionContext' | 'manageTeam' | 'cancelTask' | 'cancelTeam' | 'deleteTask' | 'openTeam' | 'openParticipantSession' | 'readArtifact' | 'readCollections' | 'readAudit' | 'readChannel' | 'acknowledgeChannel' | 'closeChannelView' | 'readChannels' | 'readChannelAttachment' | 'readChannelCatalog' | 'resumeTeam'
>

const DEFAULT_PANEL_WIDTH = 360
const DEFAULT_PANEL_HEIGHT = 520
const MIN_PANEL_WIDTH = 280
const MIN_PANEL_HEIGHT = 260
const MAX_PANEL_WIDTH = 680
const MAX_PANEL_HEIGHT = 720

interface PanelSize {
  readonly width: number
  readonly height: number
}

function panelLimits(): { readonly minWidth: number; readonly maxWidth: number; readonly minHeight: number; readonly maxHeight: number } {
  const viewportWidth = typeof window === 'undefined' ? DEFAULT_PANEL_WIDTH : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? DEFAULT_PANEL_HEIGHT : window.innerHeight
  const maxWidth = Math.min(MAX_PANEL_WIDTH, Math.max(240, viewportWidth - 24))
  const maxHeight = Math.min(MAX_PANEL_HEIGHT, Math.max(220, viewportHeight - 32))
  return {
    minWidth: Math.min(MIN_PANEL_WIDTH, maxWidth),
    maxWidth,
    minHeight: Math.min(MIN_PANEL_HEIGHT, maxHeight),
    maxHeight,
  }
}

function clampPanelSize(width: number, height: number): PanelSize {
  const limits = panelLimits()
  return {
    width: Math.round(Math.min(limits.maxWidth, Math.max(limits.minWidth, width))),
    height: Math.round(Math.min(limits.maxHeight, Math.max(limits.minHeight, height))),
  }
}

function defaultPanelSize(): PanelSize {
  return clampPanelSize(DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_HEIGHT)
}

/** Props composed from the frame's standard Team snapshot hook and owner callbacks. */
export type TeamDetailOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'team.channel.message'>
  & PropsLocale<'team'>
  & TeamDetailControls

/** Render a dismissible Environment-style Team detail trigger and panel. */
export function TeamDetailOverlay({
  useTeamTasks,
  renderSlot,
  t,
  cancelTask,
  cancelTeam,
  openTeam,
  deleteTask,
  openParticipantSession,
  readArtifact,
  readCollections,
  readAudit,
  readChannel,
  acknowledgeChannel,
  closeChannelView,
  readChannels,
  readChannelAttachment,
  readChannelCatalog,
  manageTeam,
  respondAction,
  openActionContext,
  resumeTeam,
}: TeamDetailOverlayProps) {
  const state = useTeamTasks?.(snapshot => snapshot)
  const selected = state === undefined || state.selected?.teamId !== state.current ? undefined : state.selected
  const teamId = selected?.teamId
  const [open, setOpen] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>()
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const lastTeamId = useRef<TeamId | undefined>()
  const resizeCleanup = useRef<(() => void) | undefined>()
  const [panelSize, setPanelSize] = useState<PanelSize>(defaultPanelSize)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (teamId === undefined) {
      lastTeamId.current = undefined
      setOpen(false)
      setActionError(undefined)
      return
    }
    if (lastTeamId.current !== teamId) {
      lastTeamId.current = teamId
      setActionError(undefined)
    }
  }, [teamId])

  const dismiss = useCallback((next: boolean): void => {
    setOpen(next)
    if (!next) triggerRef.current?.focus()
  }, [])

  const resetSize = useCallback((): void => {
    setPanelSize(defaultPanelSize())
  }, [])

  const stopResizing = useCallback((): void => {
    resizeCleanup.current?.()
    resizeCleanup.current = undefined
    setResizing(false)
  }, [])

  useEffect(() => {
    if (!open) stopResizing()
  }, [open, stopResizing])

  useEffect(() => {
    const onResize = (): void => {
      setPanelSize(current => clampPanelSize(current.width, current.height))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      stopResizing()
    }
  }, [stopResizing])

  const beginResize = (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const panel = panelRef.current
    if (panel === null) return
    stopResizing()
    const bounds = panel.getBoundingClientRect()
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: bounds.width > 0 ? bounds.width : panelSize.width,
      height: bounds.height > 0 ? bounds.height : panelSize.height,
    }
    const onMove = (move: PointerEvent): void => {
      setPanelSize(clampPanelSize(start.width + start.x - move.clientX, start.height + move.clientY - start.y))
    }
    const onEnd = (): void => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onEnd)
      document.removeEventListener('pointercancel', onEnd)
      resizeCleanup.current = undefined
      setResizing(false)
    }
    resizeCleanup.current = onEnd
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onEnd)
    document.addEventListener('pointercancel', onEnd)
    setResizing(true)
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const step = event.shiftKey ? 32 : 16
    let width = panelSize.width
    let height = panelSize.height
    if (event.key === 'ArrowLeft') width += step
    else if (event.key === 'ArrowRight') width -= step
    else if (event.key === 'ArrowUp') height -= step
    else if (event.key === 'ArrowDown') height += step
    else if (event.key === 'Home') {
      resetSize()
      event.preventDefault()
      return
    } else return
    setPanelSize(clampPanelSize(width, height))
    event.preventDefault()
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  if (selected === undefined || teamId === undefined) return null

  const workers = selected.state.participants.filter(participant => participant.role === 'worker' || /^worker-/u.test(participant.role))
  const activeTasks = selected.state.tasks.filter(task => ['pending', 'assigned', 'running', 'review'].includes(task.phase)).length
  const summary = `${workers.length} ${t(workers.length === 1 ? 'detail.worker.one' : 'detail.worker.other')} · ${activeTasks} ${t(activeTasks === 1 ? 'detail.activeTask.one' : 'detail.activeTask.other')}`
  const close = (): void => {
    dismiss(false)
  }
  const actionFailure = (error: unknown): void => {
    setActionError(error instanceof Error ? error.message : String(error))
  }
  const cancel = cancelTeam === undefined ? undefined : async (): Promise<void> => {
    setActionError(undefined)
    try { await cancelTeam(teamId) } catch (error: unknown) { actionFailure(error) }
  }
  const resume = resumeTeam === undefined ? undefined : async (): Promise<void> => {
    setActionError(undefined)
    try { await resumeTeam(teamId) } catch (error: unknown) { actionFailure(error) }
  }

  return (
    <div
      className={`${css.floatingRoot}${resizing ? ` ${css.floatingResizing}` : ''}`}
      style={{ width: `${panelSize.width}px` }}
      data-team-detail-overlay-root
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.floatingTrigger}
        aria-controls="clocky-team-detail-overlay"
        aria-expanded={open}
        aria-label={open ? t('detail.floating.close') : t('detail.floating.open')}
        data-team-detail-trigger
        title={selected.state.goal.objective}
        onClick={() => { setActionError(undefined); setOpen(current => !current) }}
      >
        <span className={css.floatingTriggerTitle}>{t('detail.floating')}</span>
        <span className={css.floatingTriggerMeta}>{summary}</span>
      </button>
      {open && (
        <section
          ref={panelRef}
          id="clocky-team-detail-overlay"
          className={css.floatingPanel}
          style={{ height: `${panelSize.height}px` }}
          aria-label={t('detail.title')}
          data-team-detail-panel
        >
          <div className={css.floatingPanelHeader}>
            <span>{t('detail.floating')}</span>
            <span className={css.floatingHeaderActions}>
              <button type="button" className={css.floatingReset} aria-label={t('detail.floating.reset')} title={t('detail.floating.reset')} onClick={resetSize}>
                <IconRefreshOutline16 size={14} />
              </button>
              <button type="button" className={css.floatingClose} aria-label={t('detail.floating.close')} title={t('detail.floating.close')} onClick={close}>
                <IconCloseOutline16 size={14} />
              </button>
            </span>
          </div>
          {actionError !== undefined && <p className={css.floatingError} role="alert">{actionError}</p>}
          <TeamPage
            key={teamId}
            state={selected.state}
            {...state?.collections?.teamId !== teamId ? {} : { collections: state.collections }}
            renderSlot={renderSlot}
            translate={t}
            {...openParticipantSession === undefined ? {} : {
              openParticipantSession: async (participantId) => {
                try { await openParticipantSession(teamId, participantId) } catch (error: unknown) { actionFailure(error) }
              },
            }}
            openTeam={async (childTeamId) => {
              dismiss(false)
              await openTeam(childTeamId)
            }}
            {...readCollections === undefined ? {} : {
              readCollections: async (collection, more) => { await readCollections(teamId, collection, more) },
            }}
            {...readAudit === undefined ? {} : {
              readAudit: async (options, signal) => await readAudit(teamId, options, signal),
            }}
            {...readChannel === undefined ? {} : { readChannel }}
            {...state?.channel === undefined ? {} : { channelState: state.channel }}
            {...state?.channels === undefined ? {} : { channelListState: state.channels }}
            {...readChannels === undefined ? {} : { readChannels }}
            {...readChannelAttachment === undefined ? {} : { readChannelAttachment }}
            {...readChannelCatalog === undefined ? {} : { readChannelCatalog }}
            {...state?.channelCatalog === undefined ? {} : { channelCatalog: state.channelCatalog }}
            {...acknowledgeChannel === undefined ? {} : { acknowledgeChannel }}
            {...closeChannelView === undefined ? {} : { closeChannelView }}
            {...respondAction === undefined ? {} : { respondAction: async (input, signal) => {
              const { teamId: _inputTeamId, ...answer } = input
              return await respondAction(teamId, answer, signal)
            } }}
            {...openActionContext === undefined ? {} : { openActionContext }}
            {...manageTeam === undefined ? {} : { manage: async (command, signal) =>{  await manageTeam(teamId, command, signal) } }}
            {...readArtifact === undefined ? {} : {
              readArtifact: async (artifactId, signal) => await readArtifact(teamId, artifactId, signal),
            }}
            {...deleteTask === undefined ? {} : {
              deleteTask: async (taskId, expectedRevision, signal) => {
                await deleteTask(teamId, taskId, expectedRevision, signal)
              },
            }}
            {...cancelTask === undefined ? {} : {
              cancelTask: async (taskId, expectedRevision, reason, signal) => {
                await cancelTask(teamId, taskId, expectedRevision, reason, signal)
              },
            }}
            pendingActions={(state?.pendingHumanActions ?? []).filter(action => action.teamId === teamId)}
            {...cancel === undefined ? {} : { onCancel: cancel }}
            {...resume === undefined ? {} : { onResume: resume }}
          />
          <div
            className={css.floatingResize}
            role="separator"
            aria-orientation="horizontal"
            tabIndex={0}
            aria-label={t('detail.floating.resize')}
            title={t('detail.floating.resize')}
            data-team-detail-resize
            onPointerDown={beginResize}
            onKeyDown={resizeWithKeyboard}
            onDoubleClick={resetSize}
          >
            <span aria-hidden="true" />
          </div>
        </section>
      )}
    </div>
  )
}
