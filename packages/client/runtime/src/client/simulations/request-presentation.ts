/** Request-journal facts explain retained receipts without replacing their original payload or result. */
import type { SimulationProductRequestsPage } from '@clocky/clocky-simulation-product/types'
import type { SimulationCommandState } from './administration.ts'
import type { SimulationReadState } from './service.ts'

/** One bounded metadata observation, compared only within its run's request journal. */
export interface SimulationRequestObservation {
  readonly runId: SimulationProductRequestsPage['runId']
  readonly status: 'accepted' | 'completed' | 'failed'
  readonly journalRevision: number
  readonly comparison: 'consistent' | 'receipt-older' | 'metadata-older' | 'metadata-only' | 'conflict'
  readonly stale: boolean
}

/**
 * Derive presentation facts while retaining off-page observations and independently queried receipts.
 * @param record - Retained original command with its independently observed result.
 * @param read - Current authorized journal page; denial retires its metadata observations.
 * @returns bounded request facts, or undefined for other identity families or withdrawn metadata.
 */
export function observeRequest(record: SimulationCommandState,
  read: SimulationReadState<SimulationProductRequestsPage>): SimulationRequestObservation | undefined {
  if (record.command.kind === 'manage' || record.command.kind === 'ingress' || read.error === 'forbidden') return
  const input = record.command.input
  const receipt = record.receipt?.kind === 'request' ? record.receipt.value : undefined
  const page = read.value
  const item = page?.items.find(value => value.commandId === input.commandId
    && (record.command.kind === 'create' ? receipt === undefined || receipt.runId === value.runId : 'runId' in input && input.runId === value.runId))
  const previous = record.requestObservation
  const usePage = item !== undefined && page !== undefined && (previous === undefined
    || previous.runId === item.runId && page.snapshotRevision >= previous.journalRevision)
  const fact = usePage ? { runId: item.runId, status: item.status, journalRevision: page.snapshotRevision } : previous
  if (fact === undefined) return
  const comparison = receipt === undefined ? 'metadata-only' : receipt.status === fact.status ? 'consistent'
    : receipt.status === 'accepted' ? 'receipt-older' : fact.status === 'accepted' ? 'metadata-older' : 'conflict'
  return { runId: fact.runId, status: fact.status, journalRevision: fact.journalRevision, comparison,
    stale: !usePage || read.stale || read.error !== undefined }
}
