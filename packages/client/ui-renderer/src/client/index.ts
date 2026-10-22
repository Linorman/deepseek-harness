/**
 * Browser UI renderer. It installs the slot renderer after its Cordis
 * dependencies activate and exposes the mount operation used by the web boot
 * kernel after the complete client roster settles.
 */
import { createElement, useLayoutEffect, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import type { Context } from '@clocky/cordis'
import type { SnapshotSelectorHook } from '@clocky/clocky-client-ui-slots'
import { createSlotRenderer } from './scoped-slots.tsx'
import { buildRenderApp } from './app.tsx'

/** Selector hook over a session's conversation snapshot. */
export type UseSession<Snap extends object = object> = SnapshotSelectorHook<Snap>

export type {
  ChainRenderOpts, HostObservable, RenderOpts, SessionProvideInfo, SnapshotSelectorHook,
  SlotRenderer, SlotRendererHost, StoreInstanceLike,
} from '@clocky/clocky-client-ui-slots'
export type { SessionProviderProps } from './session-provider.tsx'

/** Mount operation exposed to the framework-free boot kernel. */
export interface UiRendererService {
  /** @returns whether a root registration exists; initial boot must reject a composition without one. */
  hasRootRegistration(): boolean
  /**
   * Own the application mount while root registrations appear and disappear, including provider reload gaps.
   * @param container - Application mount point.
   * @returns idempotent disposer that stops observation and unmounts the current React root.
   */
  mount: (container: HTMLElement) => () => void
}

declare module '@clocky/cordis' {
  interface Context {
    /** Mount face provided after the UI renderer activates. */
    uiRenderer: UiRendererService
  }
}

/** Services required before application assembly. */
export const inject = ['slots', 'sessions']

interface BootSnapshot {
  className: string
  html: string
}

/** Hydrate the kernel-owned loading DOM before replacing it with the application. */
function BootHandoff(props: { app: () => ReactNode; boot: BootSnapshot }): ReactNode {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => { setReady(true) }, [])
  if (ready) return props.app()
  return createElement('div', {
    className: props.boot.className,
    'data-clocky-boot': '',
    dangerouslySetInnerHTML: { __html: props.boot.html },
  })
}

/** Mount React while preserving the framework-free boot DOM through hydration. */
function mountApp(container: HTMLElement, app: () => ReactNode): Root {
  const boot = container.querySelector<HTMLElement>(':scope > [data-clocky-boot]')
  if (boot !== null) {
    return hydrateRoot(container, createElement(BootHandoff, {
      app,
      boot: { className: boot.className, html: boot.innerHTML },
    }))
  }
  const root = createRoot(container)
  flushSync(() => { root.render(app()) })
  return root
}

/**
 * Install the slot renderer and provide the application mount face.
 * @param ctx - Plugin context.
 */
export function apply(ctx: Context): void {
  ctx.slots.install(createSlotRenderer())
  const slots = ctx.slots
  ctx.reflect.provide('uiRenderer', {
    hasRootRegistration: () => slots.entries('root').length > 0,
    mount: (container: HTMLElement): (() => void) => {
      let root: Root | undefined
      let closed = false
      const app = buildRenderApp({ ctx })
      const update = (): void => {
        if (closed) return
        if (slots.entries('root').length === 0) {
          const retired = root
          root = undefined
          retired?.unmount()
        } else if (root === undefined) root = mountApp(container, app)
      }
      const unsubscribe = slots.subscribe('root', update)
      try { update() }
      catch (error) { unsubscribe(); throw error }
      return () => {
        if (closed) return
        closed = true
        unsubscribe()
        const retired = root
        root = undefined
        retired?.unmount()
      }
    },
  })
}
