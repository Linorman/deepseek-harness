/** Cross-layer engine references with metadata previews, live row marks for World lists. */
import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import { HoverCard } from '@clocky/clocky-client-ui-primitives'
import { useLiveChanges } from '@clocky/clocky-client-ui-viz'
import type { EngineRef } from './world-domain.ts'
import { shortId } from './WorldFacts.tsx'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/**
 * Exact identity text for an engine reference.
 * @param ref - Typed engine reference.
 * @returns object id, or `#sequence` for a record.
 */
export function refText(ref: EngineRef): string {
  return ref.kind === 'record' ? `#${String(ref.sequence)}` : ref.id
}

/**
 * Link to an exact engine object. Hovering for 400ms previews only bounded metadata already in the
 * reference (kind, identity, label); no body is read. Keyboard users get the same summary as a description.
 * @param props.value - Typed reference.
 * @param props.open - Navigate with history; absent renders a disabled link.
 * @param props.children - Visible link text; defaults to the exact identity.
 * @returns hover-previewed link button.
 */
export function EngineRefLink({ value, open, children, t }: {
  value: EngineRef
  open?: ((ref: EngineRef) => void) | undefined
  children?: ReactNode
  t: WorldT
}) {
  const id = useId()
  const summary = [t(`world.ref.kind.${value.kind}`), refText(value), ...value.label === undefined ? [] : [value.label]].join(' · ')
  const card = <dl className={css.refCard}>
    <div><dt>{t('world.ref.kind')}</dt><dd>{t(`world.ref.kind.${value.kind}`)}</dd></div>
    <div><dt>{t('world.ref.identity')}</dt><dd><code>{refText(value)}</code></dd></div>
    {value.label !== undefined && <div><dt>{t('world.ref.label')}</dt><dd>{value.label}</dd></div>}
  </dl>
  return <HoverCard openDelayMs={400} copyText={refText(value)} copyLabel={t('world.ref.copy')} copiedLabel={t('world.copied')}
    content={card} anchor={<><button type="button" className={css.refLink} disabled={open === undefined} aria-describedby={id}
      data-ref-kind={value.kind} onClick={() => { open?.(value) }}>
      {children ?? <code title={refText(value)}>{shortId(refText(value))}</code>} ↗</button>
    <span id={id} className={css.srOnly}>{summary}</span></>} />
}

/**
 * Original metadata provenance links; destination owners independently authorize their contents.
 * @param props - References retained in the same bounded source projection.
 * @returns exact engine destinations without inspecting any source body on hover.
 */
export function SourceLinks({ sources, open, t }: {
  sources: readonly EngineRef[]
  open?: ((ref: EngineRef) => void) | undefined
  t: WorldT
}) {
  return sources.length === 0 ? null : <section aria-label={t('world.cases.section.source')}>
    <h4>{t('world.cases.section.source')}</h4><ul className={css.sourceLinks}>
      {sources.map((ref, index) => <li key={index}><EngineRefLink value={ref} open={open} t={t} /></li>)}
    </ul></section>
}

/**
 * Rows whose observed facts changed live under the same owner identity; first loads and reloads mark nothing.
 * @param identity - Owner identity (run and lens).
 * @param rows - Current rows.
 * @param key - Stable row identity.
 * @returns changed ids and a polite summary for screen readers.
 */
export function useLiveRows<T>(identity: string, rows: readonly T[] | undefined, key: (row: T) => string, t: WorldT):
{ changed: ReadonlySet<string>; announcement: string } {
  const entries = useMemo(() => new Map((rows ?? []).map(row => [key(row), JSON.stringify(row)])), [rows])
  const changed = useLiveChanges(identity, entries)
  return { changed, announcement: changed.size === 0 ? '' : t('world.live.changed', { count: changed.size }) }
}
