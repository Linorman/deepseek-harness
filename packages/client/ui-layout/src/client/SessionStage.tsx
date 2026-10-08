/** Stable conversation container shared by the first-input page and the Team conversation pane. */
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { IconButton, IconCloseOutline16, IconFullscreenOutline16 } from '@clocky/clocky-client-ui-primitives'
import type { PaneMode } from './columns.ts'
import css from './AppFrame.module.css'

/**
 * Present one stable Session subtree inline (no Team selected) or as the
 * conversation pane beside a Team page. The children keep their mounted
 * identity across every presentation, so an unsent draft survives opening,
 * expanding, and closing the pane.
 * @param props.inspecting - a Team page is showing; the stage becomes a pane.
 * @param props.visible - whether the stage shows at all.
 * @param props.mode - pane presentation resolved by the column solver.
 * @param props.close - close the pane and return to the Team page.
 * @param props.toggleExpanded - switch between split and expanded panes.
 * @returns the conversation region.
 */
export function SessionStage({
  inspecting, visible, mode = 'split', title, context, closeLabel, expandLabel, restoreLabel, close, toggleExpanded, children,
}: {
  inspecting: boolean
  visible: boolean
  mode?: PaneMode | undefined
  title: string
  context?: string | undefined
  closeLabel: string
  expandLabel: string
  restoreLabel: string
  close: () => void
  toggleExpanded?: (() => void) | undefined
  children: ReactNode
}) {
  const regionRef = useRef<HTMLElement>(null)
  const pane = inspecting && visible
  // Opening the pane moves focus into it; closing returns focus to whatever
  // opened it, so keyboard users never land on the document body.
  useLayoutEffect(() => {
    if (!pane) return
    const previous = document.activeElement
    regionRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [pane])

  return (
    <section
      ref={regionRef}
      role="region"
      aria-label={title}
      tabIndex={pane ? -1 : undefined}
      hidden={!visible}
      className={css.sessionStage}
      data-conversation-pane={pane ? mode : undefined}
      onKeyDown={(event) => {
        if (!pane || event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
        // Portaled layers (image preview, popovers) bubble through the React
        // tree; their Escape closes only themselves.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        event.preventDefault()
        close()
      }}
    >
      {pane && (
        <header className={css.sessionStageHeader}>
          <div className={css.sessionContext}>
            <strong>{title}</strong>
            {context !== undefined && <small title={context}>{context}</small>}
          </div>
          {mode !== 'sheet' && toggleExpanded !== undefined && (
            <IconButton
              size="sm"
              label={mode === 'expanded' ? restoreLabel : expandLabel}
              aria-pressed={mode === 'expanded'}
              icon={<IconFullscreenOutline16 size={16} />}
              onClick={toggleExpanded}
            />
          )}
          <IconButton size="sm" label={closeLabel} icon={<IconCloseOutline16 size={16} />} onClick={close} />
        </header>
      )}
      {children}
    </section>
  )
}
