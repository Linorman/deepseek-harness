/** Closed public failure mapping; provider messages and opaque diagnostic identifiers stay server-side. */
import { randomUUID } from 'node:crypto'
import { SimulationWorldDomainError } from '@clocky/clocky-simulation'
import { LlmError } from '@clocky/clocky-llm'
import { StorageError, StorageReadLimitError } from '@clocky/clocky-storage'
import type { SimulationProductFailure, SimulationProductReadFailure } from './control-types.ts'

type Classification = Pick<SimulationProductFailure, 'category' | 'retryDisposition' | 'actionCode' | 'providerRetryAfterMs'>

/**
 * Preserve typed provider facts as bounded public advice without authorizing retry or exposing diagnostic text.
 * @param error - Original driver rejection; generic exceptions deliberately remain unknown.
 * @param source - Exact live owner, batch and Native revision where the rejection settled.
 * @returns one correlation identity and closed remedial classification, with no raw exception fields.
 */
export function simulationProductFailure(error: unknown,
  source: Pick<SimulationProductFailure, 'ownerId' | 'batchId' | 'revision'>): SimulationProductFailure {
  return { ...classify(error), ...source, failureId: randomUUID(), occurredAt: Date.now() }
}

function classify(error: unknown): Classification {
  if (error instanceof LlmError) {
    const { code, status, providerRetryAfterMs } = error.failure
    const delay = providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: Math.min(86400000, providerRetryAfterMs) }
    // QUOTA includes multiple account quota causes; it cannot establish an insufficient balance specifically.
    if (code === 'INSUFFICIENT_BALANCE') return { category: 'insufficient-balance', retryDisposition: 'account-action', actionCode: 'check-account' }
    if (status === 402) return { category: 'payment-required', retryDisposition: 'account-action', actionCode: 'check-account' }
    if (status === 429 || code === 'RATE_LIMIT') return { category: 'rate-limited', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly', ...delay }
    if (code === 'NETWORK' || code === 'TIMEOUT') return { category: 'network', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly', ...delay }
    if (status !== undefined && status >= 500) return { category: 'provider-unavailable', retryDisposition: 'explicit-resume', actionCode: 'resume-explicitly', ...delay }
    if (code === 'CONTEXT_WINDOW_EXCEEDED') return { category: 'context-limit', retryDisposition: 'repair-required', actionCode: 'review-context' }
    if (code === 'NO_ADAPTER') return { category: 'protocol-unavailable', retryDisposition: 'repair-required', actionCode: 'repair-protocol' }
  }
  if (error instanceof SimulationWorldDomainError) return { category: 'protocol-unavailable', retryDisposition: 'repair-required', actionCode: 'repair-protocol' }
  if (error instanceof StorageError) {
    if (error.code === 'read-limit') return { category: 'history-limit', retryDisposition: 'repair-required', actionCode: 'raise-read-limit' }
    if (error.code === 'version-mismatch') return { category: 'protocol-unavailable', retryDisposition: 'repair-required', actionCode: 'repair-protocol' }
    if (error.code === 'malformed-medium' || error.code === 'compacted') return { category: 'integrity', retryDisposition: 'repair-required', actionCode: 'inspect-integrity' }
    return { category: 'storage', retryDisposition: 'repair-required', actionCode: 'repair-storage' }
  }
  return { category: 'unknown', retryDisposition: 'unknown', actionCode: 'inspect-failure' }
}

/** Safe typed history classification retained through product wrapping. */
export class SimulationProductReadError extends Error {
  /** Stable public read refusal; safe reason/measurements remain separate from raw source diagnostics. */
  readonly code = 'SIMULATION_PRODUCT_UNAVAILABLE'
  constructor(readonly reason: SimulationProductReadFailure, readonly limit?: import('./control-types.ts').SimulationProductReadLimit) {
    super('Simulation history is unavailable for inspection')
  }
}

/**
 * Map only typed reader errors; ordinary exceptions provide no evidence of corruption, quota or format.
 * @param cause - Original reader error or its safe product wrapper.
 * @returns bounded category for both row isolation and detail diagnostics.
 */
export function simulationProductReadFailure(cause: unknown): SimulationProductReadFailure {
  if (cause instanceof SimulationProductReadError) return cause.reason
  if (cause instanceof SimulationWorldDomainError) {
    if (cause.code === 'SIM_WORLD_SCHEMA') return 'corrupt-history'
    if (['SIM_WORLD_DOMAIN_UNKNOWN', 'SIM_WORLD_OPERATION_UNKNOWN', 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE',
      'SIM_WORLD_VERSION_UNAVAILABLE', 'SIM_WORLD_IMPLEMENTATION_MISMATCH'].includes(cause.code)) return 'unsupported-version'
    return 'unavailable'
  }
  if (cause instanceof StorageError) {
    switch (cause.code) {
      case 'read-limit': return 'history-limit'
      case 'version-mismatch': return 'unsupported-version'
      case 'malformed-medium': case 'compacted': return 'corrupt-history'
      case 'writer-locked': case 'closed': return 'owner-unavailable'
      default: return 'unavailable' // Extensible storage classes must not gain recovery authority through a guessed category.
    }
  }
  return 'unavailable'
}

/**
 * Retain numerical read-limit evidence without the original storage diagnostic.
 * @param cause - Typed reader refusal or its safe Product wrapper.
 * @returns safe measured dimension, or undefined when no exact measurement is available.
 */
export function simulationProductReadLimit(cause: unknown): import('./control-types.ts').SimulationProductReadLimit | undefined {
  if (cause instanceof SimulationProductReadError) return cause.limit
  if (cause instanceof StorageReadLimitError) return { dimension: cause.dimension, actual: cause.actual, limit: cause.limit }
  return undefined
}
