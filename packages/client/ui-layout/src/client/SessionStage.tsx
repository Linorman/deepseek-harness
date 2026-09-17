/** Stable conversation container shared by the first-input page and Team inspection. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import css from './AppFrame.module.css'

/**
 * Present one stable Session subtree inline or in a modal inspection page.
 * @param props - viewing mode, labels, dismissal callback, and conversation content.
 * @returns a native dialog whose children retain their mounted identity.
 */
export function SessionStage({ inspecting, visible, title, context, backLabel, expandLabel, restoreLabel, close, children }: {
  inspecting: boolean
  visible: boolean
  title: string
  context?: string | undefined
  backLabel: string
  expandLabel: string
  restoreLabel: string
  close: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    const previous = document.activeElement
    if (visible) {
      if (inspecting) dialog.showModal()
      else dialog.open = true
    }
    return () => {
      dialog.close()
      if (inspecting && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [inspecting, visible])
  return <dialog ref={dialogRef} className={css.sessionStage} data-inspecting={inspecting || undefined}
    data-expanded={expanded || undefined} aria-label={title} aria-modal={inspecting && visible ? true : undefined}
    onCancel={(event) => { event.preventDefault(); close() }}>
    {inspecting && <header className={css.sessionStageHeader}>
      <button type="button" onClick={close}>{backLabel}</button>
      <div className={css.sessionContext}><strong>{title}</strong>{context !== undefined && <small title={context}>{context}</small>}</div>
      <button type="button" onClick={() => { setExpanded(value => !value) }}>{expanded ? restoreLabel : expandLabel}</button>
    </header>}
    {children}
  </dialog>
}
