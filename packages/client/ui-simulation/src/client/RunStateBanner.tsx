/** Run-state banner under the header; its sentences come from the same synthesis as the state chip. */
import type { ReactNode } from 'react'
import type { Key } from './locales.ts'
import type { RunState } from './run-state.ts'
import css from './Workspace.module.css'

type Translate = (key: Key, params?: Record<string, string>) => string

/**
 * The line under the run header: what is happening, whether anything still executes, and the next step.
 * @param props.state - Synthesized run state.
 * @param props.next - Optional next-step control rendered after the explanation.
 * @returns banner, or nothing when the state needs no explanation.
 */
export function RunStateBanner({ state, next, t }: { state: RunState; next?: ReactNode; t: Translate }) {
  const lines: Key[] = []
  if (state.freshness === 'stale') lines.push('state.banner.stale')
  if (state.detailLimited === true) lines.push('state.banner.detailLimited')
  if (state.detail !== undefined) lines.push(state.detail)
  if (state.stop !== undefined && state.kind !== 'paused' && state.kind !== 'idle' && state.kind !== 'running') {
    lines.push(`status.stop.${state.stop}`)
  }
  if (lines.length === 0 && (next === undefined || next === null)) return null
  return <div className={css.stateBanner} data-run-state={state.kind} data-freshness={state.freshness} role="status">
    {lines.map(line => <p key={line}>{t(line)}</p>)}
    {state.inFlight !== undefined && (state.kind === 'stopping' || state.kind === 'running' || state.kind === 'idle')
      && <p>{t(state.inFlight ? 'status.workRemaining' : 'status.noWorkRemaining')}</p>}
    {next}
  </div>
}
