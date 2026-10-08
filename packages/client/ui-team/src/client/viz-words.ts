/** Localized phrase builders shared by every Team visualization. */
import type { DescribeWords, ListWords } from '@clocky/clocky-client-ui-viz'
import type { TeamKey } from './locales.ts'

/**
 * Build the summary and list words from Team copy.
 * @param t - Team copy.
 * @returns words for `describeVisualization` and `VizListView`.
 */
export function vizWords(t: (key: TeamKey, vars?: Record<string, unknown>) => string): { describe: DescribeWords; list: ListWords } {
  const loaded = (count: number, total: number | undefined) =>
    total === undefined ? t('viz.loadedOnly', { loaded: count }) : t('viz.loaded', { loaded: count, total })
  return {
    describe: {
      loaded,
      state: (count, state) => t('viz.stateCount', { count, state }),
      ghosts: count => t('viz.ghosts', { count }),
      stale: count => t('viz.staleCount', { count }),
    },
    list: { loaded, ghost: t('viz.ghost'), stale: t('viz.stale') },
  }
}
