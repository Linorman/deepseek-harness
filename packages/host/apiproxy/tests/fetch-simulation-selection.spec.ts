/** Schema-valid wire observations still need to match the caller's exact authorized selection. */
import { expect, it } from 'vitest'
import { simulationProductSourceInputSchema, simulationProductSourceInspectionSchema,
  simulationProductRecordsInputSchema, simulationProductRecordsPageSchema } from '@clocky/clocky-simulation-product/schema'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from '@clocky/clocky-simulation-product/world-read-schema'

function responseClient(value: unknown) {
  return new InProcessApiClient({ fetch: async (request, init) => {
    const frame = await new Request(request, init).json() as { rpcId: string }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }),
      { headers: { 'content-type': 'application/json' } })
  } })
}

const domainQuery = simulationProductWorldDomainInputSchema.parse({ runId: 'run', kind: 'identity', key: 'supplier', section: 'facts',
  at: '0', limit: 1, cursor: 'cursor', readVersion: 'policy', expectedRevision: 3 })
const domain = simulationProductWorldDomainResultSchema.parse({ apiVersion: 'clocky.world-read/v1', kind: 'identity', runId: 'run',
  selection: domainQuery, snapshotRevision: 3, readVersion: 'policy', observedAt: 1, status: 'missing',
  coverage: { loaded: 0, total: 0, scope: 'identity/facts', revision: 3, complete: true, at: '0' } })

it.each([{ key: 'other' }, { section: 'record' }, { at: '1' }, { cursor: 'another' }, { limit: 2 }])(
  'refuses an otherwise valid domain response replacing the exact original selector: %j', async (change) => {
    const changed = simulationProductWorldDomainResultSchema.parse({ ...domain, selection: { ...domainQuery, ...change },
      coverage: { ...domain.coverage, ...'at' in change ? { at: change.at } : {} } })
    await expect(responseClient(changed).simulations.readWorldDomain(domainQuery)).rejects.toThrow('does not match its original selection')
  })

it('accepts the exact bounded domain query without treating absent optional undefined fields as new selectors', async () => {
  expect((await responseClient(domain).simulations.readWorldDomain(domainQuery)).result).toMatchObject({ ok: true, value: domain })
  const input = simulationProductWorldDomainInputSchema.parse({ runId: 'run', kind: 'external', at: undefined })
  const output = simulationProductWorldDomainResultSchema.parse({ ...domain, kind: 'external', selection: { runId: 'run', kind: 'external' } })
  expect((await responseClient(output).simulations.readWorldDomain(input)).result.ok).toBe(true)
})

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
