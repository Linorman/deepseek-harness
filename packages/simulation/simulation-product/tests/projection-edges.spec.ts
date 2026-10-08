/** Frozen read projections preserve original ordering and refuse malformed retained records. */
import { expect, it } from 'vitest'
import { contextRows, frozenContext, textParts } from '../src/context-details.ts'
import { recordRows } from '../src/records.ts'
import { simulationProductObjectInputSchema, simulationProductObjectInspectionSchema } from '../src/collections-schema.ts'

const label = (value: string) => ({ text: value, truncated: false })

it('projects prepared context provenance with withheld and unsupported bodies', () => {
  const context = { status: 'prepared', requiredSections: ['input'], knowledge: [{ id: 'knowledge', revision: 2 }],
    view: { time: '1', slot: '2', entityId: 'buyer', epoch: 3, projections: { run: 4 },
      versions: { rules: 'rules', policy: 'policy', persona: 'persona', model: 'model' },
      content: [{ kind: 'input', blocks: [{ type: 'text', text: 'A🙂B' }, { type: 'image', data: 'private' }] },
        { kind: 'history', blocks: [{ type: 'text', text: '' }] }],
      sources: [{ kind: 'run-event', sequence: 7 },
        { kind: 'team-envelope', teamId: 'team', channelId: 'channel', envelopeId: 'envelope' }] } } as never
  expect(contextRows(undefined, label, true, 4)).toEqual([])
  expect(contextRows({ status: 'pending' } as never, label, true, 4)).toEqual([])
  const hidden = contextRows(context, label, false, 4)
  expect(hidden.filter(row => row.kind === 'section')).toHaveLength(3)
  expect(hidden[0]).toMatchObject({ required: true, body: { status: 'withheld' } })
  expect(JSON.stringify(hidden)).not.toContain('private')
  const visible = contextRows(context, label, true, 4)
  expect(visible.slice(0, 3)).toMatchObject([
    { body: { status: 'text', text: 'A', part: 0, parts: 3 } },
    { body: { status: 'text', text: '🙂', part: 1, parts: 3 } },
    { body: { status: 'text', text: 'B', part: 2, parts: 3 } },
  ])
  expect(visible[3]).toMatchObject({ body: { status: 'unsupported' } })
  expect(visible[4]).toMatchObject({ required: false, body: { status: 'text', text: '' } })
  expect(visible.slice(5)).toMatchObject([
    { kind: 'knowledge', id: 'knowledge', revision: 2 },
    { kind: 'run-event', sequence: 7 },
    { kind: 'team-envelope', sourceIndex: 1, envelopeId: 'envelope' },
  ])
  expect(frozenContext(context, label)).toMatchObject({ time: '1', slot: '2', entityId: 'buyer', epoch: 3,
    versions: { rules: label('rules'), policy: label('policy'), persona: label('persona'), model: label('model') } })
  const withoutKnowledge = { status: 'prepared', requiredSections: [], view: { content: [], sources: [] } } as never
  expect(contextRows(withoutKnowledge, label, false, 4)).toEqual([])
  expect([...textParts('🙂a', 4)]).toEqual(['🙂', 'a'])
})

it('filters original records before rendering and refuses malformed retained journal entries', () => {
  const values = [
    { sequence: 0, value: { kind: 'run/created', change: { kind: 'entity/create' }, secret: '🙂' } },
    { sequence: 1, value: { kind: 'run/changed', command: { kind: 'resource/transfer' } } },
    { sequence: 2, value: { kind: 'run/changed', change: [] } },
  ]
  const records = values as never
  const filtered = recordRows({ mode: 'original', sequence: 1, kind: 'run/changed' } as never, records, label, true, 4)
  expect(filtered.totalRecords).toBe(1)
  const filteredItems = [...filtered.items]
  expect(filteredItems.length).toBeGreaterThan(1)
  expect(filteredItems.every(row => row.sequence === 1)).toBe(true)
  const withheld = recordRows({ mode: 'original' } as never, records, label, false, 4)
  expect([...withheld.items]).toMatchObject([
    { sequence: 0, kind: label('run/created'), action: label('entity/create'), body: { status: 'withheld' } },
    { sequence: 1, kind: label('run/changed'), action: label('resource/transfer'), body: { status: 'withheld' } },
    { sequence: 2, kind: label('run/changed'), body: { status: 'withheld' } },
  ])
  const metadata = recordRows({ mode: 'metadata' } as never, records, label, true, 4)
  expect([...metadata.items].every(row => row.body.status === 'withheld')).toBe(true)
  const original = recordRows({ mode: 'original', sequence: 0 } as never, records, label, true, 4)
  const parts = [...original.items]
  expect(parts.every(row => row.body.status === 'text' && Buffer.byteLength(row.body.text) <= 4)).toBe(true)
  expect(parts.map(row => row.body.status === 'text' ? row.body.text : '').join('')).toBe(JSON.stringify(values[0]?.value))
  expect(recordRows({ mode: 'metadata', kind: 'absent' } as never, records, label, true, 4).totalRecords).toBe(0)
  const malformed = recordRows({ mode: 'metadata' } as never, [{ sequence: 0, value: [] }] as never, label, true, 4)
  expect(() => [...malformed.items]).toThrow('Validated Simulation journal has no record kind')
})

it('binds a knowledge inspection to its exact requested reference', () => {
  const selection = simulationProductObjectInputSchema.parse({ runId: 'run', collection: 'decisions', id: 'decision',
    section: 'knowledge', reference: { id: 'note', revision: 2 } })
  expect(selection).toMatchObject({ reference: { id: 'note', revision: 2 } })
  const selector = { collection: 'decisions', id: 'decision', section: 'knowledge', reference: { id: 'note', revision: 2 } }
  const observation = { runId: 'run', snapshotRevision: 3, observedAt: 4, status: 'found', selection: selector,
    value: { collection: 'decisions', section: 'knowledge', id: 'decision', readVersion: 'policy', bodyAccess: 'withheld',
      entityId: 'buyer', time: '0', cutoffRevision: 3, selected: { id: 'note', revision: 2 },
      knowledge: { total: 0, items: [] } } }
  expect(simulationProductObjectInspectionSchema.safeParse(observation).success).toBe(true)
  expect(simulationProductObjectInspectionSchema.safeParse({ ...observation,
    value: { ...observation.value, selected: { id: 'other', revision: 2 } } }).success).toBe(false)
  expect(simulationProductObjectInspectionSchema.safeParse({ ...observation,
    selection: { ...selector, reference: undefined }, value: { ...observation.value, selected: undefined } }).success).toBe(true)
  const entity = { ...observation, selection: { collection: 'entities', id: 'buyer', section: 'knowledge' },
    value: { ...observation.value, collection: 'entities', id: 'buyer', selected: undefined } }
  expect(simulationProductObjectInspectionSchema.safeParse(entity).success).toBe(true)
  expect(simulationProductObjectInspectionSchema.safeParse({ ...entity, value: { ...entity.value,
    selected: { id: 'note', revision: 2 } } }).success).toBe(false)
})

it('accepts a prepared frozen envelope reference and rejects items without preparation', () => {
  const context = { runId: 'run', snapshotRevision: 3, observedAt: 4, status: 'found',
    selection: { collection: 'decisions', id: 'decision', section: 'context' },
    value: { collection: 'decisions', id: 'decision', section: 'context', readVersion: 'policy',
      accounting: { status: 'prepared', retainedBytes: 4, maxBytes: 100, knowledgeCount: 0, sourceCount: 1,
        sectionCount: 0, content: 'withheld' }, bodyAccess: 'allowed',
      frozen: { time: '0', slot: '0', entityId: 'buyer', epoch: '1', projections: { run: 3, entity: 2, team: 1 },
        versions: { rules: label('rules'), policy: label('policy'), persona: label('persona'), model: label('model') } },
      items: { total: 1, items: [{ kind: 'team-envelope', sourceIndex: 0, teamId: 'team',
        channelId: 'channel', envelopeId: 'envelope' }] } } }
  expect(simulationProductObjectInspectionSchema.safeParse(context).success).toBe(true)
  expect(simulationProductObjectInspectionSchema.safeParse({ ...context, value: { ...context.value,
    accounting: { status: 'absent' }, frozen: undefined } }).success).toBe(false)
})
