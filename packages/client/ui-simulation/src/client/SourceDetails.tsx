/** A frozen source is independent of the current context page and requires current Team body permission. */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import { simulationSourceScope } from '@clocky/clocky-client-runtime/client'
import type { SimulationRuntimeState, SimulationProductSourceInput } from '@clocky/clocky-client-runtime/client'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'
import { restoreWorkspaceFocus } from '@clocky/clocky-client-ui-layout/client'
import { TeamReference } from './TeamReference.tsx'

/**
 * @param props - Safe source route, runtime snapshots and bounded read callbacks.
 * @returns explicit source lookup/permission states and inert original text; viewing never delivers or acknowledges messages.
 */
export function SourceDetails({ view, data, pageSize, watch, read, refresh, navigate, t, date, navigateApplication }: {
  view: Route & { runId: string; objectId: string; sourceIndex: number }
  data: SimulationRuntimeState
  pageSize: number
  watch: (input: SimulationProductSourceInput) => () => void
  read: (input: SimulationProductSourceInput) => Promise<void>
  refresh: () => Promise<void>
  navigate: (route: Route) => void
  t: (key: Key) => string
  date: (value: number) => string
  navigateApplication?: ((href: string) => void) | undefined
}) {
  const root = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [view.runId, view.objectId, view.sourceIndex])
  const input: SimulationProductSourceInput = { runId: view.runId as SimulationProductSourceInput['runId'],
    decisionId: view.objectId as SimulationProductSourceInput['decisionId'], sourceIndex: view.sourceIndex, limit: pageSize }
  useEffect(() => watch(input), [view.runId, view.objectId, view.sourceIndex, pageSize, data.generation, watch])
  const state = data.source.scope === simulationSourceScope(input) ? data.source : undefined
  const value = state?.value
  useLayoutEffect(() => {
    if (root.current !== null && state !== undefined && !state.loading
      && (value !== undefined && value.status !== 'searching' || state.error !== undefined)) {
      restoreWorkspaceFocus(root.current)
    }
  }, [value, state?.loading, state?.error])
  const blocked = !data.connected || state?.loading === true
  return <section ref={root} className={css.detail} aria-label={t('sourceTitle')}>
    <Button onClick={(event) => {
      const root = event.currentTarget.closest('[data-simulation-workspace-page]')
      const inspector = event.currentTarget.closest('aside')
      navigate({ ...view, sourceIndex: undefined })
      window.requestAnimationFrame(() => {
        if (!root?.isConnected) return
        const reference = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-source-index]')).find(button =>
          button.dataset.sourceDecision === view.objectId && button.dataset.sourceIndex === String(view.sourceIndex))
        ;(reference ?? inspector?.querySelector<HTMLButtonElement>('button'))?.focus()
      })
    }}>{t('sourceBack')}</Button>
    <h2 ref={heading} tabIndex={-1}>{t('sourceTitle')}</h2><p className={css.notice}>{t('sourceNotice')}</p>
    <div aria-live="polite">{state?.error !== undefined ? <p role="alert">{t(state.error)}</p>
      : state?.stale ? <p>{t('stale')}</p> : state?.loading && value === undefined ? <p>{t('loading')}</p> : null}</div>
    <Button disabled={blocked} onClick={() => { void refresh() }}>{t('refreshDetail')}</Button>
    {value?.source !== undefined && <dl>
      <div><dt>{t('teamReference')}</dt><dd><TeamReference target={{ kind: 'team', teamId: value.source.teamId }}
        id={value.source.teamId} navigateApplication={navigateApplication} t={t} /></dd></div>
      <div><dt>{t('reference.channel')}</dt><dd><TeamReference target={{ kind: 'channel', teamId: value.source.teamId, channelId: value.source.channelId }}
        id={value.source.channelId} navigateApplication={navigateApplication} t={t} /></dd></div>
      <div><dt>{t('envelopeReference')}</dt><dd><code>{value.source.envelopeId}</code></dd></div>
    </dl>}
    {value?.status === 'withheld' && <p>{t('sourceWithheld')}</p>}
    {value?.status === 'missing' && <p>{t('sourceMissing')}</p>}
    {value?.status === 'unavailable' && <p>{t('sourceUnavailable')}</p>}
    {value?.status === 'searching' && <p>{t('sourceSearching')}</p>}
    {value?.envelope !== undefined && <dl>
      <div><dt>{t('recordSequence')}</dt><dd>{value.envelope.sequence}</dd></div>
      <div><dt>{t('kind')}</dt><dd>{value.envelope.kind.text}</dd></div>
      <div><dt>{t('sourceAcceptedAt')}</dt><dd>{date(value.envelope.createdAt)}</dd></div>
    </dl>}
    {value?.items.map(item => <div key={`${item.block}:${item.body.status === 'text' ? item.body.part : item.body.status}`}>
      {item.body.status === 'text' ? <><p>{t('contextPart')}: {item.body.part + 1} / {item.body.parts}</p>
        <pre className={css.contextText}>{item.body.text}</pre></> : <p>{t(item.body.status === 'withheld' ? 'sourceWithheld' : 'contextBodyUnsupported')}</p>}
    </div>)}
    {value?.nextCursor !== undefined && <Button disabled={blocked || state?.stale || state?.error !== undefined}
      onClick={() => { void read({ ...input, cursor: value.nextCursor,
        envelopeSequence: value.envelope?.sequence }) }}>{t(value.status === 'searching' ? 'sourceContinue' : 'next')}</Button>}
  </section>
}
