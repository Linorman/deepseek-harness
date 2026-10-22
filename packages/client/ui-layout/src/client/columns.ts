/**
 * Pure concession-chain column solver for the three-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * details, then auto-closing it (derived zero width — preferred width
 * preferences are never rewritten, so widening the window restores them).
 * The sidebar never concedes: its rendered width is always the drag
 * preference (or the collapsed rail), and center absorbs any remaining
 * deficit as the last resort. Inputs are the layout store's plain width
 * preferences (0 = closed); a closed sidebar resolves to the fixed
 * SIDEBAR_COLLAPSED control rail while closed details resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 208
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 224
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Phone-width viewport below which a manually re-expanded sidebar opens as an overlay drawer instead of squeezing the
 * center; between this and SIDEBAR_AUTO_COLLAPSE a re-expanded sidebar still shares the row with a usable center. */
export const SIDEBAR_DRAWER = 600
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const d0 = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)

  // Step 1: everything fits at preferred widths.
  if (s + d0 + CENTER_MIN <= viewport) return { sidebar: s, center: viewport - s - d0, details: d0 }

  // Step 2: shrink details toward its minimum.
  const d1 = d0 === 0 ? 0 : Math.max(DETAILS_MIN, viewport - s - CENTER_MIN)
  if (s + d1 + CENTER_MIN <= viewport) return { sidebar: s, center: CENTER_MIN, details: d1 }

  // Step 3: auto-close details (derived — preferences untouched); center
  // absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), details: 0 }
}

// Conversation pane: while a Team page is open, the Session it inspects sits
// in a right pane inside the center column instead of a modal.
/** Team page floor beside an open conversation pane. */
export const TEAM_MIN = 480
/** Conversation pane drag clamp floor. */
export const PANE_MIN = 380
/** Conversation pane drag clamp ceiling. */
export const PANE_MAX = 880
/** Conversation pane width before any user drag. */
export const PANE_DEFAULT = 480
/** Conversation transcript floor inside the pane when the details column shares it. */
export const CONVERSATION_MIN = 360

/**
 * How the conversation pane presents: `split` beside the Team page,
 * `expanded` across the whole center column by request, or `sheet` over the
 * center column when the Team page and a minimum pane no longer fit.
 */
export type PaneMode = 'split' | 'expanded' | 'sheet'

/** Resolved pane geometry inside the center column. */
export interface PaneColumns {
  mode: PaneMode
  /** Pane width in px (the whole center column unless split). */
  pane: number
  /** Team page width in px; 0 while expanded. */
  team: number
  /** Details column width inside the pane; 0 means closed. */
  details: number
}

/**
 * Fit the details column inside a pane, conceding to the transcript first.
 * @param pane - pane width.
 * @param details - details preference (0 = closed).
 * @returns the details width, or 0 when it cannot fit.
 */
function fitDetails(pane: number, details: number): number {
  if (details === 0) return 0
  const preferred = clampWidth(details, DETAILS_MIN, DETAILS_MAX)
  if (pane - preferred >= CONVERSATION_MIN) return preferred
  const shrunk = pane - CONVERSATION_MIN
  return shrunk >= DETAILS_MIN ? shrunk : 0
}

/**
 * Solve the conversation pane inside the center column. Concession chain:
 * keep the preferred pane while the Team page keeps TEAM_MIN, then shrink the
 * pane toward PANE_MIN, then present the pane as a sheet over the page. Like
 * {@link computeColumns}, the output depends only on its inputs, so widening
 * the window restores the split.
 * @param center - center column width in px.
 * @param pane - pane width preference in px.
 * @param details - details preference in px (0 = closed).
 * @param expanded - the pane was expanded to the full center column.
 * @returns the resolved pane geometry.
 */
export function computePane(center: number, pane: number, details: number, expanded: boolean): PaneColumns {
  if (expanded) return { mode: 'expanded', pane: center, team: 0, details: fitDetails(center, details) }
  const preferred = clampWidth(pane, PANE_MIN, PANE_MAX)
  if (center - preferred >= TEAM_MIN) {
    return { mode: 'split', pane: preferred, team: center - preferred, details: fitDetails(preferred, details) }
  }
  const shrunk = center - TEAM_MIN
  if (shrunk >= PANE_MIN) return { mode: 'split', pane: shrunk, team: TEAM_MIN, details: fitDetails(shrunk, details) }
  return { mode: 'sheet', pane: center, team: center, details: fitDetails(center, details) }
}
