/**
 * Accessible summaries and the list-view contract. Every visualization has
 * an equivalent list that names the same items, and a one-sentence summary
 * that states how much of the data is loaded.
 */

/** Domain states a mark can carry; each maps to one status role. */
export type VizState = 'running' | 'waiting' | 'needs-you' | 'blocked' | 'done' | 'failed' | 'idle'

/** One item shared by a visualization and its list view. */
export interface VizItem {
  readonly id: string
  readonly label: string
  readonly state: VizState
  /** Localized state word shown in the list and announced with the mark. */
  readonly stateLabel: string
  /** Secondary text such as role, owner, or current activity. */
  readonly detail?: string | undefined
  /** Referenced but not loaded: drawn as a ghost, listed as a reference. */
  readonly ghost?: boolean | undefined
  /** Observation older than its owner's cursor: desaturated with a stale label. */
  readonly stale?: boolean | undefined
}

/** Loaded versus total counts; `total` is undefined when the owner does not report one. */
export interface LoadedCount {
  readonly loaded: number
  readonly total?: number | undefined
}

/** Localized words the summary builder needs. */
export interface DescribeWords {
  /** e.g. `(loaded, total) => 已加载 ${loaded}/${total}`. */
  readonly loaded: (loaded: number, total: number | undefined) => string
  /** e.g. `(count, label) => ${count} ${label}`. */
  readonly state: (count: number, stateLabel: string) => string
  /** Words for ghost and stale counts. */
  readonly ghosts: (count: number) => string
  readonly stale: (count: number) => string
}

/**
 * One-sentence summary for a visualization's accessible description.
 * @param title - Visualization name.
 * @param items - Items drawn by the visualization.
 * @param count - Loaded versus total counts from the owner.
 * @param words - Localized phrase builders.
 * @returns the title, loaded count, per-state counts in first-seen order, and ghost/stale counts.
 */
export function describeVisualization(title: string, items: readonly VizItem[], count: LoadedCount, words: DescribeWords): string {
  const states = new Map<string, { label: string; count: number }>()
  let ghosts = 0
  let stale = 0
  for (const item of items) {
    if (item.ghost === true) { ghosts++; continue }
    if (item.stale === true) stale++
    const entry = states.get(item.state)
    if (entry === undefined) states.set(item.state, { label: item.stateLabel, count: 1 })
    else entry.count++
  }
  const parts = [title, words.loaded(count.loaded, count.total),
    ...[...states.values()].map(entry => words.state(entry.count, entry.label))]
  if (ghosts > 0) parts.push(words.ghosts(ghosts))
  if (stale > 0) parts.push(words.stale(stale))
  return parts.join(' · ')
}
