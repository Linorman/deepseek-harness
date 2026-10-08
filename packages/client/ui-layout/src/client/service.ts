/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@clocky/clocky-client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import { readWorkspaceSource, workspaceNavigationSource, SIMULATION_ROUTE_KEYS, WORKSPACE_NAVIGATION_EVENT } from './navigation.ts'
import { CommandRegistry, type CommandProvider, type ShortcutSpec } from './commands.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Navigate within this application without reloading retained drafts.
   * @param href - Same-origin workspace URL; references grant no authority.
   */
  navigate(href: string): void
  /** Select a product workspace without changing either domain's durable execution. @param workspace - Product domain to display. */
  showWorkspace(workspace: 'team' | 'simulation'): void
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /**
   * Register a keyboard shortcut with the shell's single listener.
   * @param spec - chord, label, group, and action.
   * @returns a disposer.
   * @throws ShortcutConflictError when another owner holds the chord.
   */
  registerShortcut(spec: ShortcutSpec): () => void
  /**
   * Contribute a command-palette section.
   * @param provider - section id, label, and a live item reader.
   * @returns a disposer.
   */
  registerCommands(provider: CommandProvider): () => void
  /** Open the command palette. */
  openCommandPalette(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined
  /** Shortcut and palette registries; the shell installs the one key listener. */
  readonly commands = new CommandRegistry()

  /** @param spec - shortcut to add. @returns its disposer. */
  registerShortcut(spec: ShortcutSpec): () => void {
    return this.commands.registerShortcut(spec)
  }

  /** @param provider - palette section to add. @returns its disposer. */
  registerCommands(provider: CommandProvider): () => void {
    return this.commands.registerProvider(provider)
  }

  /** Open the palette through the root store. */
  openCommandPalette(): void {
    this.#panels?.setOverlay('palette')
  }

  /** Open the shortcut overlay through the root store. */
  showShortcuts(): void {
    this.#panels?.setOverlay('shortcuts')
  }
  /** @param workspace - Product domain to display; selection carries no execution authority. */
  showWorkspace(workspace: 'team' | 'simulation'): void {
    const url = new URL(window.location.href)
    if (workspace === 'simulation') url.searchParams.set('workspace', 'simulation')
    else {
      url.searchParams.delete('workspace')
      for (const key of SIMULATION_ROUTE_KEYS) url.searchParams.delete(key)
    }
    this.navigate(url.href)
  }

  /** @param href - Same-origin workspace URL; destination owners perform authorized reads. */
  navigate(href: string): void {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) throw new Error('Workspace navigation requires the current origin')
    if (url.href !== window.location.href) {
      const current = new URL(window.location.href)
      const crossTarget = url.searchParams.has('team') && url.searchParams.get('workspace') !== 'simulation'
        && (current.searchParams.get('workspace') === 'simulation' || current.searchParams.get('team') !== url.searchParams.get('team'))
      const metadata = crossTarget ? workspaceNavigationSource(current.href, url.href) : {}
      const source = metadata.clockyWorkspaceSource
      const returnSource = readWorkspaceSource(window.history.state, current.href)
      const state: unknown = window.history.state
      const returnFocus = state !== null && typeof state === 'object' && 'clockyWorkspaceFocus' in state
        && typeof state.clockyWorkspaceFocus === 'string' ? state.clockyWorkspaceFocus : current.href
      if (source !== undefined) {
        window.history.replaceState({ ...(returnSource === undefined ? {} : workspaceNavigationSource(returnSource, returnFocus)),
          clockyReturnDestination: source,
          clockyReturnFocus: metadata.clockyWorkspaceFocus }, '', current.href)
      }
      window.history.pushState(returnSource === url.href ? { clockyReturnDestination: returnSource, clockyReturnFocus: returnFocus }
        : metadata, '', url)
    }
    this.restoreWorkspace()
    window.dispatchEvent(new Event(WORKSPACE_NAVIGATION_EVENT))
  }

  /** Restore product visibility after browser Back/Forward without executing a domain operation. */
  restoreWorkspace(): void {
    this.#require().showWorkspace(new URL(window.location.href).searchParams.get('workspace') === 'simulation' ? 'simulation' : 'team')
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
