/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@clocky/clocky-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  PANE_DEFAULT, PANE_MAX, PANE_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  workspace: 'team' | 'simulation'
  /** Conversation pane width preference beside a Team page. */
  pane: number
  /** Whether the conversation pane covers the whole center column. */
  paneExpanded: boolean
  /** Shell-wide overlay currently open: the command palette or the shortcut list. */
  overlay: 'none' | 'palette' | 'shortcuts'
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  showWorkspace: (draft: LayoutState, workspace: LayoutState['workspace']) => void
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setPane: (draft: LayoutState, px: number) => void
  togglePaneExpanded: (draft: LayoutState) => void
  restorePane: (draft: LayoutState) => void
  setOverlay: (draft: LayoutState, overlay: LayoutState['overlay']) => void
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @param initialWorkspace - Product selected by the safe initial deep-link state.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(initialWorkspace: LayoutState['workspace'] = 'team'): EngineStoreHandle<LayoutState, LayoutActions> {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false, workspace: initialWorkspace,
      pane: PANE_DEFAULT, paneExpanded: false, overlay: 'none',
    }),
    actions: {
      showWorkspace: (d, workspace: LayoutState['workspace']) => { d.workspace = workspace },
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      setPane: (d, px: number) => { d.pane = clampWidth(px, PANE_MIN, PANE_MAX) },
      togglePaneExpanded: (d) => { d.paneExpanded = !d.paneExpanded },
      // Closing the pane forgets the expansion so the next conversation opens beside the page.
      restorePane: (d) => { d.paneExpanded = false },
      setOverlay: (d, overlay: LayoutState['overlay']) => { d.overlay = overlay },
    },
  })
  return handle
}
