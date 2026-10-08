/** Historical request receipts bind failure categories to their original command family. */
import { expect, it } from 'vitest'
import { simulationProductRequestReceiptSchema } from '../src/administration-schema.ts'

it('accepts only the retry-operation failure category for a failed retry receipt', () => {
  const receipt = { commandId: 'retry', runId: 'run', kind: 'retry-operation', acceptedAt: 1, status: 'failed' }
  expect(simulationProductRequestReceiptSchema.safeParse({ ...receipt, failure: 'retry-operation-failed' }).success).toBe(true)
  expect(simulationProductRequestReceiptSchema.safeParse({ ...receipt, failure: 'cancel-task-failed' }).success).toBe(false)
})
