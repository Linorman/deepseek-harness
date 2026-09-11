/** Explicit source-range selection for a durable channel-wide summary. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal } from '@clocky/clocky-client-ui-primitives'
import type { ChannelReadPageResult, TeamManagementCommand, TeamChannelCatalog } from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'

/** Summarize only a displayed contiguous range without broadening subset visibility. */
export function ChannelSummaryDialog({ page, capabilities, readCatalog, translate: t, manage, onClose }: {
  readonly page: ChannelReadPageResult
  readonly capabilities: TeamChannelCatalog['summary'] | undefined
  readonly readCatalog?: (() => Promise<void>) | undefined
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  readonly manage: (command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>
  readonly onClose: () => void
}) {
  const id = useId()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [rangeInvalid, setRangeInvalid] = useState(false)
  const request = useRef<AbortController | undefined>()
  const retry = useRef<{ from: number; to: number; key: Extract<TeamManagementCommand, { operation: 'channelSummarize' }>['input']['idempotencyKey'] } | undefined>()
  useEffect(() => () => { request.current?.abort() }, [])
  const rows = page.records.map(record => ({ record, cursor: record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence }))
  const minimum = rows[0]?.cursor
  const maximum = rows.at(-1)?.cursor
  const failRange = (message: string): void => {
    setRangeInvalid(true)
    setError(message)
    document.getElementById(`${id}-from`)?.focus()
  }
  const submit = async (): Promise<void> => {
    if (request.current !== undefined) return
    setError(undefined)
    setRangeInvalid(false)
    if (capabilities === undefined || page.channel.manifest.viewPolicy === undefined
      || !capabilities.allowedPolicies.includes(page.channel.manifest.viewPolicy.type)) { setError(t('channel.summaryUnavailable')); return }
    const start = Number(from)
    const end = Number(to)
    const selected = rows.filter(row => row.cursor >= start && row.cursor <= end)
    if (!from.trim() || !to.trim() || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || minimum === undefined || maximum === undefined || start < minimum || end > maximum || start > end
      || selected.length !== end - start + 1 || selected.some((row, index) => row.cursor !== start + index)) {
      failRange(t('channel.summaryRangeInvalid')); return
    }
    const messages = selected.flatMap(row => row.record.type === 'channel/envelope' ? [row.record.envelope] : [])
    if (messages.length === 0) { failRange(t('channel.summaryMessagesRequired')); return }
    if (selected.length > capabilities.maxHistorySpan || messages.length > capabilities.maxSourceEnvelopes
      || new TextEncoder().encode(JSON.stringify(messages)).byteLength > capabilities.maxSourceBytes) {
      failRange(t('channel.summaryLimit')); return
    }
    if (messages.some(message => message.audience !== null && page.channel.manifest.participants.some(participant =>
      participant.id !== message.senderId && !message.audience!.includes(participant.id)))) {
      failRange(t('channel.summarySubset')); return
    }
    if (retry.current === undefined || retry.current.from !== start || retry.current.to !== end) {
      retry.current = { from: start, to: end, key: crypto.randomUUID() as NonNullable<typeof retry.current>['key'] }
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      await manage({ operation: 'channelSummarize', input: { channelId: page.channel.manifest.id, expectedCursor: page.channel.cursor,
        coveredSequenceRange: { from: start, to: end }, idempotencyKey: retry.current.key } }, controller.signal)
      if (!controller.signal.aborted) onClose()
    } catch (cause: unknown) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (request.current === controller) { request.current = undefined; setBusy(false) } }
  }
  const close = () => { if (!busy) onClose() }
  return <Modal open onClose={close} title={t('channel.summarize')} closeLabel={t('cancel')} footer={<div className={css.actions}>
    <Button disabled={busy} onClick={close}>{t('cancel')}</Button>
    <Button type="submit" form={`${id}-form`} disabled={busy}>{t('channel.summarize')}</Button>
  </div>}>
    <form id={`${id}-form`} noValidate className={css.managementForm} onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <p>{t('channel.summaryHelp')}</p>
      {readCatalog !== undefined && <button type="button" disabled={busy} onClick={() => { void readCatalog() }}>{t('channel.refreshCatalog')}</button>}
      {capabilities !== undefined && <p>{t('channel.summaryBounds', { messages: capabilities.maxSourceEnvelopes,
        span: capabilities.maxHistorySpan, bytes: capabilities.maxSourceBytes, output: capabilities.maxSummaryBytes })}</p>}
      <p>{t('channel.sourceRange', { from: minimum ?? '—', to: maximum ?? '—' })}</p>
      <label htmlFor={`${id}-from`}>{t('channel.summaryFrom')}</label>
      <Input id={`${id}-from`} type="number" step={1} min={minimum} max={maximum} value={from} disabled={busy}
        aria-invalid={rangeInvalid} aria-describedby={rangeInvalid ? `${id}-error` : undefined} onChange={(event) => { setFrom(event.target.value) }} />
      <label htmlFor={`${id}-to`}>{t('channel.summaryTo')}</label>
      <Input id={`${id}-to`} type="number" step={1} min={minimum} max={maximum} value={to} disabled={busy}
        aria-invalid={rangeInvalid} aria-describedby={rangeInvalid ? `${id}-error` : undefined} onChange={(event) => { setTo(event.target.value) }} />
      {error !== undefined && <p id={`${id}-error`} role="alert" className={css.error}>{error}</p>}
      {busy && <p role="status" className={css.muted}>{t('manage.pending')}</p>}
    </form>
  </Modal>
}
