/** Agent swimlanes: one lane per loaded participant. */
import { useMemo } from 'react'
import { describeVisualization, LaneView, layoutLanes } from '@clocky/clocky-client-ui-viz'
import type { VizItem } from '@clocky/clocky-client-ui-viz'
import type { TeamKey } from './locales.ts'
import { vizWords } from './viz-words.ts'
import css from './TeamViz.module.css'

const WIDTH = 360

/**
 * Render the lanes. Attempt intervals need the execution timeline read, so
 * until it lands each lane carries one marker at "now" with the member's
 * current execution state, and no bar, speedup, or throughput is drawn.
 * @param props - Loaded member items (ghosts excluded) and copy.
 * @returns the lane chart and a note about the pending read.
 */
export function AgentLanes({ members, count, onSelect, t }: {
  members: readonly VizItem[]
  count: { loaded: number; total: number }
  onSelect?: ((id: string) => void) | undefined
  t: (key: TeamKey, vars?: Record<string, unknown>) => string
}) {
  const layout = useMemo(() => layoutLanes({
    lanes: members.map(member => ({ id: member.id })),
    items: members.map(member => ({ id: `now:${member.id}`, lane: member.id, start: WIDTH - 16 })),
    position: (value: number) => value, rowHeight: 28,
  }), [members])
  return <div className={css.panelBody}>
    <p className={css.note}>{t('viz.lanes.pending')}</p>
    <LaneView label={t('viz.lanes.title')} width={WIDTH} layout={layout}
      description={describeVisualization(t('viz.lanes.title'), members, count, vizWords(t).describe)}
      lanes={members.map(member => ({ id: member.id, label: member.label, detail: member.detail, stale: member.stale }))}
      items={members.map(member => ({ id: `now:${member.id}`, label: member.label, state: member.state,
        stateLabel: member.stateLabel, caption: member.stateLabel, marker: member.state === 'running' ? 'filled' : member.state === 'idle' ? 'hollow' : 'half' }))}
      cursor={{ x: WIDTH - 16, label: t('viz.now') }}
      onSelect={(id) => { onSelect?.(id.slice('now:'.length)) }} />
  </div>
}
