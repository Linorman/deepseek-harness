/** Persisted request metadata restores discovery after authentication replaces memory-only original commands. */
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationReadState, SimulationProductRequestsInput, SimulationProductRequestsPage,
  SimulationProductRunId, SimulationProductRequestReceipt, SimulationCommand, SimulationCommandKey,
  SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * Discover original durable requests without recovering private input from browser storage.
 * @param props - Exact run, bounded authorized metadata, runtime-owned originals and explicit lookup/retry callbacks.
 * @returns current request window; only a user-triggered same-original retry can resume Host work.
 */
export function PersistentRequests({ runId, ready, value, connected, authorizationVersion, pageSize,
  read, refreshRun, commands, retain, submit, query, t, date, renderOriginal, originals = [] }: {
  renderOriginal: (record: SimulationCommandState, history: boolean) => ReactNode
  originals?: readonly SimulationCommandState[]
  runId: SimulationProductRunId
  ready: boolean
  value: SimulationReadState<SimulationProductRequestsPage>
  connected: boolean
  authorizationVersion: number
  pageSize: number
  read: (input: SimulationProductRequestsInput) => Promise<void>
  refreshRun: () => Promise<void>
  commands: Readonly<Record<string, SimulationCommandState>>
  retain: (command: SimulationCommand, version: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  t: (key: Key) => string
  date: (value: number) => string
}) {
  const current = useRef(ready)
  current.current = ready
  const active = () => current.current
  useEffect(() => () => { current.current = false }, [])
  const page = value.value?.runId === runId ? value.value : undefined
  const listed = new Set(page?.items.map(item => simulationCommandKey({ kind: 'retry-request', input: { runId, commandId: item.commandId } })))
  const additional = originals.filter(record => !listed.has(simulationCommandKey(record.command)))
  const [error, setError] = useState<string>()
  const refresh = () => read({ runId, limit: pageSize })
  const settle = async (receipt: SimulationProductRequestReceipt, retry: boolean) => {
    const command: SimulationCommand = { kind: 'retry-request', input: { runId, commandId: receipt.commandId } }
    const key = simulationCommandKey(command)
    try {
      // Warm originals retain their full captured payload; cold discovery keeps only an exact Host-owned selector.
      retain(command, authorizationVersion)
      const result = await (retry ? submit(key) : query(key))
      if (active()) {
        await refresh()
        if (retry && active() && result?.receipt !== undefined) await refreshRun()
      }
    } catch { if (current.current) setError(t('commandCapacity')) }
  }
  return <section className={css.review} aria-label={t('requests.title')}>
    <h2>{t('requests.title')}{page === undefined ? '' : ` · ${page.total}`}</h2>
    <p>{t('requests.notice')}</p>
    <Button disabled={!connected || value.loading} onClick={() => { void refresh() }}>{t('requests.refresh')}</Button>
    {value.loading && <p role="status">{t('loading')}</p>}
    {value.stale && <p role="status" className={css.stalePill}>{t('stale')}</p>}
    {value.error !== undefined && <p role="alert">{t(value.error)}</p>}
    {error !== undefined && <p role="alert">{error}</p>}
    {page?.items.length === 0 && !value.loading && <p>{t('requests.empty')}</p>}
    <ul className={css.requestList}>{page?.items.map((receipt) => {
      const key = simulationCommandKey({ kind: 'retry-request', input: { runId, commandId: receipt.commandId } })
      const record = commands[key]
      return <li key={receipt.commandId} data-simulation-request={receipt.commandId}>
        <time className={css.muted} dateTime={new Date(receipt.acceptedAt).toISOString()}>{date(receipt.acceptedAt)}</time>
        {record === undefined && <><p>{t(`command.${receipt.kind}`)} · {t(`receipt.${receipt.status}`)} </p>
          <code>{receipt.commandId}</code>
          {receipt.checkpointId !== undefined && <p>{t('checkpointId')}: <code>{receipt.checkpointId}</code></p>}
          <div className={css.actions}>
            <Button disabled={!connected} onClick={() => { void settle(receipt, false) }}>{t('requests.query')}</Button>
            {receipt.status === 'accepted' && <Button variant="secondary" disabled={!connected || value.loading || value.stale
            || value.error !== undefined} onClick={() => { void settle(receipt, true) }}>{t('requests.retry')}</Button>}
          </div>
        </>}
        {record !== undefined && renderOriginal(record, true)}
      </li>
    })}</ul>
    {additional.length > 0 && <section aria-label={t('requests.local')}>
      <h3>{t('requests.local')} · {additional.length}</h3><p>{t('requests.localNotice')}</p>
      <ul className={css.requestList}>{additional.map(record => <li key={simulationCommandKey(record.command)}>
        {renderOriginal(record, true)}
      </li>)}</ul>
    </section>}
    {page?.nextCursor !== undefined && <Button disabled={!connected || value.loading || value.stale || value.error !== undefined}
      onClick={() => { void read({ runId, limit: pageSize, cursor: page.nextCursor, expectedRevision: page.snapshotRevision }) }}>{t('next')}</Button>}
  </section>
}
