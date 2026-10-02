import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '@clocky/clocky-client-ui-primitives'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal: an opener inside
 * a transformed or filtered ancestor would otherwise trap the fixed backdrop
 * in that ancestor's box instead of covering the viewport. A native modal
 * layer keeps the preview above a Session dialog and contains keyboard focus.
 *
 * @param props.src - the original image URL.
 * @param props.alt - the image's alt text.
 * @param props.labels - dialog and close-control strings.
 * @param props.onClose - dismiss callback owned by the opener.
 * @returns the modal preview dialog.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    closeRef.current?.focus()
    return () => {
      dialog.close()
      if (restoreRef.current?.isConnected) restoreRef.current.focus()
    }
  }, [])

  return createPortal(
    <dialog ref={dialogRef}
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
    >
      <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
      <img className={css.image} src={src} alt={alt} />
      <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </dialog>,
    document.body,
  )
}
