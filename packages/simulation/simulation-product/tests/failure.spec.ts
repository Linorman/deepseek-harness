/** Public diagnostics retain typed routing facts and exclude arbitrary provider diagnostics. */
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { LlmError, ProviderRequestId } from '@clocky/clocky-llm'
import { StorageError } from '@clocky/clocky-storage'
import { simulationProductFailure, simulationProductReadFailure } from '../src/failure.ts'
import { simulationProductFailureSchema } from '../src/control-schema.ts'

const source = { ownerId: randomUUID(), batchId: randomUUID(), revision: 12 }
const secret = 'token=private-token /private/storage/path private payload insufficient balance'
it.each([
  [new LlmError(secret, 'UNKNOWN', { status: 402 }), 'payment-required', 'account-action'],
  [new LlmError(secret, 'INSUFFICIENT_BALANCE'), 'insufficient-balance', 'account-action'],
  [new LlmError(secret, 'QUOTA'), 'unknown', 'unknown'],
  [new LlmError(secret, 'UNKNOWN', { status: 429 }), 'rate-limited', 'explicit-resume'],
  [new LlmError(secret, 'NETWORK'), 'network', 'explicit-resume'],
  [new LlmError(secret, 'TIMEOUT'), 'network', 'explicit-resume'],
  [new LlmError(secret, 'UNKNOWN', { status: 503 }), 'provider-unavailable', 'explicit-resume'],
  [new LlmError(secret, 'CONTEXT_WINDOW_EXCEEDED'), 'context-limit', 'repair-required'],
  [new LlmError(secret, 'NO_ADAPTER'), 'protocol-unavailable', 'repair-required'],
  [new LlmError(secret, 'UNKNOWN'), 'unknown', 'unknown'],
  [new Error(secret), 'unknown', 'unknown'],
  [{ code: 'QUOTA', status: 402 }, 'unknown', 'unknown'],
  [new StorageError('read-limit', secret), 'history-limit', 'repair-required'],
  [new StorageError('version-mismatch', secret), 'protocol-unavailable', 'repair-required'],
  [new StorageError('malformed-medium', secret), 'integrity', 'repair-required'],
  [new StorageError('closed', secret), 'storage', 'repair-required'],
])('maps only typed facts (%s)', (error, category, retryDisposition) => {
  const value = simulationProductFailure(error, source)
  expect(value).toMatchObject({ ...source, category, retryDisposition })
  expect(simulationProductFailureSchema.parse(value)).toEqual(value)
  expect(JSON.stringify(value)).not.toMatch(/private|token=|payload/)
  expect(value.failureId).not.toBe(simulationProductFailure(error, source).failureId)
})

it('bounds retry advice and rejects raw diagnostic keys in the wire schema', () => {
  const value = simulationProductFailure(new LlmError(secret, 'RATE_LIMIT', {
    providerRetryAfterMs: 1e20, requestId: ProviderRequestId('private-request'), status: 429,
  }), source)
  expect(value.providerRetryAfterMs).toBe(86400000)
  expect(simulationProductFailureSchema.safeParse({ ...value, message: secret }).success).toBe(false)
  expect(simulationProductFailureSchema.safeParse({ ...value, requestId: 'private-request' }).success).toBe(false)
})

it.each([
  ['read-limit', 'history-limit'], ['version-mismatch', 'unsupported-version'],
  ['malformed-medium', 'corrupt-history'], ['compacted', 'corrupt-history'],
  ['closed', 'owner-unavailable'], ['writer-locked', 'owner-unavailable'], ['invalid-value', 'unavailable'],
] as const)('keeps history read failure %s distinct', (code, expected) => {
  expect(simulationProductReadFailure(new StorageError(code, secret))).toBe(expected)
  expect(simulationProductReadFailure(new Error(code))).toBe('unavailable')
})
