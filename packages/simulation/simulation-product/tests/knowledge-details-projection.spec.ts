/** Knowledge projection exposes retained provenance only after visibility and body checks. */
import { expect, it, vi } from 'vitest'
import { knowledgeDetail } from '../src/knowledge-details.ts'

const visibility = vi.hoisted(() => ({ allowed: true }))
vi.mock('@clocky/clocky-simulation', async importOriginal => ({ ...await importOriginal<typeof import('@clocky/clocky-simulation')>(),
  knowledgeVisible: () => visibility.allowed,
  selectKnowledge: (state: { knowledge?: Record<string, unknown[]> }, query: { ids: string[] }) =>
    state.knowledge?.[query.ids[0]!] ?? [],
}))

const label = (value: string) => ({ text: value, truncated: false })
const page = ((rows: unknown[], wrap: (value: unknown) => unknown) => wrap({ total: rows.length, items: rows })) as never
const input = { collection: 'decisions', id: 'decision', section: 'knowledge', reference: { id: 'note', revision: 1 } }
const value = (source: unknown) => ({ id: 'note', revision: 1, owner: 'buyer', statement: 'a🙂',
  observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, sequence: 1, readers: ['supplier'], source })
const state = (source: unknown) => ({ time: '0', revision: 4, entities: { buyer: { phase: 'active' } },
  decisions: { decision: { entityId: 'buyer', time: '0', snapshotRevision: 3,
    context: { status: 'prepared', knowledge: [{ id: 'note', revision: 1 }] } } },
  knowledge: { note: [value(source)] }, operations: {} })
const policy = (allowed = true, sources = true) => ({ allowed, sources, maxPartBytes: 4, readVersion: 'policy' as never })
const project = (world: ReturnType<typeof state>, request = input, access = policy()) =>
  knowledgeDetail(request as never, world as never, label, page, access)

it('selects only frozen visible versions and keeps denied or inactive bodies empty', () => {
  const world = state({ kind: 'belief', profileRevision: 2, policyVersion: 'v1' })
  expect(project({ ...world, entities: {} } as never)).toBeUndefined()
  expect(project({ ...world, decisions: {} } as never)).toBeUndefined()
  expect(project(world, { ...input, reference: { id: 'note', revision: 2 } })).toBeUndefined()
  expect(project(world, input, policy(false))).toMatchObject({ bodyAccess: 'withheld', knowledge: { total: 0 } })
  expect(project({ ...world, entities: { buyer: { phase: 'inactive' } } }, input)).toMatchObject({ knowledge: { total: 0 } })
  visibility.allowed = false
  expect(project(world)).toMatchObject({ knowledge: { total: 0 } })
  visibility.allowed = true
  expect(project({ ...world, knowledge: { note: [] } })).toMatchObject({ knowledge: { total: 0 } })
  expect(project({ ...world, decisions: { decision: { ...world.decisions.decision,
    context: { status: 'prepared' } } } } as never, { ...input, reference: undefined } as never))
    .toMatchObject({ knowledge: { total: 0 } })
  expect(project(world, { ...input, reference: undefined } as never)).toMatchObject({ knowledge: { total: 2 } })
  const current = project(world, { collection: 'entities', id: 'buyer', section: 'knowledge' } as never)
  expect(current).toMatchObject({ collection: 'entities', entityId: 'buyer', knowledge: { total: 2 } })
  expect(project({ ...world, knowledge: undefined } as never,
    { collection: 'entities', id: 'buyer', section: 'knowledge' } as never)).toMatchObject({ knowledge: { total: 0 } })
})

it('renders each source kind and binds report bodies to the original delivered operation', () => {
  const origins = [
    { kind: 'observation', worldRevision: 3, visibilityPolicy: 'public' },
    { kind: 'belief', profileRevision: 2, policyVersion: 'v1', confidence: 0.5 },
    { kind: 'inference', decisionId: 'decision', confidence: 0.75, premises: [{ id: 'source', revision: 1 }] },
    { kind: 'summary', cursor: 4, policy: { id: 'compress', version: '1' }, premises: [{ id: 'source', revision: 1 }] },
  ]
  for (const origin of origins) {
    const result = project(state(origin))
    expect(result?.knowledge.items).toHaveLength(2)
    expect(result?.knowledge.items[0]).toMatchObject({ body: { status: 'text', text: 'a', part: 0, parts: 2 },
      source: { kind: origin.kind } })
    expect(result?.knowledge.items[1]).toMatchObject({ body: { status: 'text', text: '🙂', part: 1, parts: 2 } })
    expect(result?.knowledge.items[0]?.premises).toEqual('premises' in origin ? origin.premises : [])
  }
  expect(project(state({ kind: 'belief', profileRevision: 2, policyVersion: 'v1' }))?.knowledge.items[0]?.source)
    .toEqual({ kind: 'belief', profileRevision: 2, policyVersion: label('v1') })
  expect(project(state({ kind: 'inference', decisionId: 'decision' }))?.knowledge.items[0]?.source)
    .toEqual({ kind: 'inference', decisionId: 'decision' })
  const report = { kind: 'report', operationId: 'report' }
  const world = { ...state(report), operations: { report: { action: { kind: 'communication/post',
    recipient: 'buyer', text: 'a🙂' }, delivery: { receipt: {} } } } }
  expect(project(world)?.knowledge.items[0]?.source).toMatchObject({ kind: 'report', body: { status: 'text', text: 'a' } })
  expect(project(world, input, policy(true, false))?.knowledge.items[0]?.source).toMatchObject({ body: { status: 'withheld' } })
  expect(project({ ...world, operations: { report: { ...world.operations.report,
    action: { ...world.operations.report.action, text: 'changed' } } } })?.knowledge.items[0]?.source)
    .toMatchObject({ body: { status: 'unsupported' } })
  const readerReport = { ...world, knowledge: { note: [{ ...world.knowledge.note[0]!, owner: 'supplier', readers: ['buyer'] }] },
    operations: { report: { ...world.operations.report, action: { ...world.operations.report.action, recipient: 'supplier' } } } }
  expect(project(readerReport)?.knowledge.items[0]?.source).toMatchObject({ body: { status: 'text' } })
  expect(() => project(state({ kind: 'unknown' }))).toThrow('Unhandled knowledge origin')
})
