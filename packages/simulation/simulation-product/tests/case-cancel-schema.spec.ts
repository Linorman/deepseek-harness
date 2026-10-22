/** Refuse authority injection and mismatched original World cancellation receipts at durable/wire boundaries. */
import { expect, it } from 'vitest'
import { simulationProductWorldCaseCancelInputSchema } from '../src/case-cancel-schema.ts'
import { simulationProductRequestReceiptSchema, simulationProductRequestResultSchema } from '../src/administration-schema.ts'

const input = { runId: 'world', commandId: 'cancel', requestId: 'case', previewRevision: 3, previewHash: `sha256:${'a'.repeat(64)}` }
const request = { kind: 'cancel-world-case', runId: input.runId, commandId: input.commandId, acceptedAt: 1, status: 'accepted' }

it.each(['actor', 'principalId', 'planId', 'entityId', 'maintenance', 'expectedRevision'])(
  'refuses browser authority or replacement selection in %s', (key) => {
    expect(simulationProductWorldCaseCancelInputSchema.safeParse({ ...input, [key]: 'injected' }).success).toBe(false)
  })

it('refuses untrimmed command identities and missing original cases', () => {
  expect(simulationProductWorldCaseCancelInputSchema.safeParse({ ...input, commandId: ' cancel ' }).success).toBe(false)
  expect(simulationProductWorldCaseCancelInputSchema.safeParse({ ...input, requestId: '' }).success).toBe(false)
})

it('binds queried cancellation semantics to the exact original command and operation kind', () => {
  const receipt = request
  expect(simulationProductRequestResultSchema.parse({ status: 'found', request: receipt, worldCancellation: input }))
    .toMatchObject({ request: { kind: 'cancel-world-case' }, worldCancellation: input })
  for (const worldCancellation of [undefined, { ...input, commandId: 'another' }, { ...input, runId: 'another' }]) {
    expect(simulationProductRequestResultSchema.safeParse({ status: 'found', request: receipt, worldCancellation }).success).toBe(false)
  }
  expect(simulationProductRequestResultSchema.safeParse({ status: 'found', request: { ...receipt, kind: 'prepare' },
    worldCancellation: input }).success).toBe(false)
  expect(simulationProductRequestReceiptSchema.safeParse({ ...receipt, status: 'failed', failure: 'cancel-task-failed' }).success).toBe(false)
  expect(simulationProductRequestReceiptSchema.parse({ ...receipt, status: 'failed', failure: 'cancel-world-case-failed' }))
    .toMatchObject({ failure: 'cancel-world-case-failed' })
})

it('requires the complete fixed Native quote and rejects missing, malformed or substituted dependencies', async () => {
  const { simulationProductWorldCaseCancelPreviewSchema } = await import('../src/case-cancel-schema.ts')
  const { simulationProductWorldCaseCancelCapabilitySchema } = await import('../src/case-schema.ts')
  const preview = { snapshotRevision: 3, previewHash: input.previewHash, impact: { requestStatus: 'open', planIds: ['plan'],
    hiringReservationIds: [], personnelReservationIds: [], representativeReservationIds: [], unconfirmedExecutionPlanIds: ['plan'] } }
  expect(simulationProductWorldCaseCancelCapabilitySchema.parse({ allowed: true, reason: 'ready', preview })).toMatchObject({ preview })
  for (const patch of [{ previewRevision: undefined }, { previewHash: undefined }, { previewHash: 'opaque' }, { previewRevision: true },
    { previewRevision: -1 }, { previewRevision: Number.MAX_SAFE_INTEGER + 1 }])
    expect(simulationProductWorldCaseCancelInputSchema.safeParse({ ...input, ...patch }).success).toBe(false)
  for (const patch of [{ planIds: ['plan', 'plan'] }, { unconfirmedExecutionPlanIds: ['another-case-plan'] },
    { hiringReservationIds: ['original', 'original'] }, { personnelReservationIds: undefined }, { privateBody: 'forged' }])
    expect(simulationProductWorldCaseCancelPreviewSchema.safeParse({ ...preview,
      impact: { ...preview.impact, ...patch } }).success).toBe(false)
  for (const value of [{ allowed: true, reason: 'ready' }, { allowed: false, reason: 'stale', preview },
    { allowed: true, reason: 'ready', preview: null }])
    expect(simulationProductWorldCaseCancelCapabilitySchema.safeParse(value).success).toBe(false)
})
