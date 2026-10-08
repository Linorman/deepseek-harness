/** Schema-valid wire observations still need to match the caller's exact authorized selection. */
import { expect, it } from 'vitest'
import { simulationProductSourceInputSchema, simulationProductSourceInspectionSchema,
  simulationProductRecordsInputSchema, simulationProductRecordsPageSchema } from '@clocky/clocky-simulation-product/schema'
import { InProcessApiClient } from '../src/fetch/client.ts'

function responseClient(value: unknown) {
  return new InProcessApiClient({ fetch: async (request, init) => {
    const frame = await new Request(request, init).json() as { rpcId: string }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }),
      { headers: { 'content-type': 'application/json' } })
  } })
}

const source = simulationProductSourceInspectionSchema.parse({ runId: 'run', decisionId: 'decision', sourceIndex: 0,
  snapshotRevision: 2, readVersion: 'policy', observedAt: 1, status: 'found',
  source: { kind: 'team-envelope', teamId: 'team', channelId: 'channel', envelopeId: 'envelope' },
  envelope: { sequence: 3, kind: { text: 'message', truncated: false }, createdAt: 1 },
  items: [{ block: 0, body: { status: 'withheld' } }] })
const sourceInput = simulationProductSourceInputSchema.parse({ runId: source.runId, decisionId: source.decisionId, sourceIndex: 0,
  expectedRevision: 2, envelopeSequence: 3, limit: 1 })

it.each([
  ['run', { runId: 'other' }], ['decision', { decisionId: 'other' }], ['source position', { sourceIndex: 1 }],
  ['snapshot revision', { snapshotRevision: 3 }],
  ['envelope sequence', { envelope: { ...source.envelope, sequence: 4 } }],
  ['page limit', { items: [...source.items, ...source.items] }],
] as const)('refuses a schema-valid source response substituting its %s', async (_name, change) => {
  const changed = simulationProductSourceInspectionSchema.parse({ ...source, ...change })
  await expect(responseClient(changed).simulations.inspectSource(sourceInput)).rejects.toThrow('does not match its selection')
})

it('accepts exact source selection, optional lookup selectors and a missing envelope without inventing disclosure', async () => {
  expect((await responseClient(source).simulations.inspectSource(sourceInput)).result).toMatchObject({ ok: true, value: source })
  const lookup = { runId: source.runId, decisionId: source.decisionId, sourceIndex: 0 }
  expect((await responseClient(source).simulations.inspectSource(lookup)).result.ok).toBe(true)
  const missing = simulationProductSourceInspectionSchema.parse({ ...lookup, status: 'missing', items: [], observedAt: 1,
    readVersion: 'policy', snapshotRevision: 2 })
  expect((await responseClient(missing).simulations.inspectSource(sourceInput)).result).toMatchObject({ ok: true, value: { status: 'missing' } })
})

const records = simulationProductRecordsPageSchema.parse({ runId: 'run', mode: 'metadata', snapshotRevision: 2,
  observedAt: 1, readVersion: 'policy', bodyAccess: 'withheld', totalRecords: 1,
  selection: { kind: 'decision/accepted', sequence: 3 },
  items: [{ sequence: 3, kind: { text: 'decision/accepted', truncated: false }, body: { status: 'withheld' } }] })
const recordsInput = simulationProductRecordsInputSchema.parse({ runId: records.runId, mode: 'metadata',
  kind: 'decision/accepted', sequence: 3, expectedRevision: 2, limit: 1 })

it.each([
  ['run', { runId: 'other' }], ['mode', { mode: 'original' }],
  ['selected kind', { selection: { ...records.selection, kind: 'decision/rejected' } }],
  ['selected sequence', { selection: { ...records.selection, sequence: 4 } }],
  ['snapshot revision', { snapshotRevision: 3 }],
  ['row sequence', { items: [{ ...records.items[0], sequence: 4 }] }],
  ['page limit', { items: [...records.items, ...records.items] }],
] as const)('refuses a schema-valid journal page substituting its %s', async (_name, change) => {
  const changed = simulationProductRecordsPageSchema.parse({ ...records, ...change })
  await expect(responseClient(changed).simulations.records(recordsInput)).rejects.toThrow('does not match its query or page')
})

it('accepts exact journal rows and an unfiltered empty page', async () => {
  expect((await responseClient(records).simulations.records(recordsInput)).result).toMatchObject({ ok: true, value: records })
  const page = simulationProductRecordsPageSchema.parse({ ...records, selection: {}, items: [] })
  expect((await responseClient(page).simulations.records({ runId: records.runId, mode: 'metadata' })).result.ok).toBe(true)
})
