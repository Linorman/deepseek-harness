// ProcessGroup: a run of process rows (tool calls, context, reasoning-only
// steps) behind one disclosure. The header states how long the work took and
// how many steps it had; while running it names the current step. A failed
// step keeps the group open so the failure is never hidden.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { StatusGlyph, IconChevronRightOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import { summarizeGroup, type GroupSummary } from './process-groups.ts'
import css from './ChatView.module.css'

/** Re-render a running group's elapsed time at most four times per second. */
const TICK_MS = 250

/**
 * Render one process group.
 * @param props.keys - node keys in the group.
 * @param props.defaultOpen - initial disclosure (the latest group starts open).
 * @param props.renderNode - render one node seat by key.
 * @returns the group disclosure.
 */
export function ProcessGroup({ keys, defaultOpen, useSession, renderNode, t }: {
  keys: readonly string[]
  defaultOpen: boolean
  useSession: ChatViewSlotProps['useSession']
  renderNode: (key: string) => ReactNode
  t: ChatViewSlotProps['t']
}) {
  // A string selector keeps the subscription stable between unrelated updates.
  const signature = useSession((snapshot) => {
    const nodes = keys.map(key => snapshot.chat.nodes.get(key)).filter(node => node !== undefined)
    return JSON.stringify(summarizeGroup(nodes))
  })
  const summary = useMemo(() => JSON.parse(signature) as GroupSummary, [signature])
  const [choice, setChoice] = useState<boolean | undefined>()
  const open = summary.failed || (choice ?? defaultOpen)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!summary.running) return
    const timer = setInterval(() => { setNow(Date.now()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [summary.running])
  const elapsed = summary.startTime === undefined
    ? undefined
    : (summary.running ? now : summary.endTime ?? summary.startTime) - summary.startTime
  const duration = elapsed === undefined ? undefined : formatRunDuration(elapsed, t)
  const label = summary.running
    ? summary.currentTool === undefined ? t('process.thinking') : t('process.runningTool', { tool: summary.currentTool })
    : duration === undefined ? t('process.steps', { steps: summary.steps }) : t('process.worked', { duration, steps: summary.steps })
  return (
    <div
      className={css.processGroup} data-process-group
      data-running={summary.running || undefined} data-failed={summary.failed || undefined}
    >
      <button
        type="button"
        className={css.processHeader}
        aria-expanded={open}
        disabled={summary.failed}
        onClick={() => { setChoice(!open) }}
      >
        <IconChevronRightOutline14 size={14} className={css.processChevron} />
        <StatusGlyph status={summary.failed ? 'failed' : summary.running ? 'running' : 'done'} />
        <span className={css.processLabel} key={summary.running ? label : 'settled'}>{label}</span>
        {summary.running && duration !== undefined && <span className={css.processElapsed}>{duration}</span>}
      </button>
      {open && <div className={css.processBody}>{keys.map(renderNode)}</div>}
    </div>
  )
}
