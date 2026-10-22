// @vitest-environment jsdom
/** Untrusted deep links cannot lend one collection another collection's selectors. */
import { expect, it } from 'vitest'
import { collectionInput, normalize, objectInput } from '../src/client/selection.ts'
import type { Route } from '../src/client/store.ts'

it('builds every bounded collection with only its own accepted metadata filters', () => {
  expect(collectionInput({ runId: 'run', module: 'entities', search: '', status: 'active', cognition: 'none' }, 2))
    .toMatchObject({ collection: 'entities', phase: 'active', cognition: 'none', limit: 2 })
  expect(collectionInput({ runId: 'run', module: 'decisions', search: '', status: 'accepted', entityId: 'entity' }, 2))
    .toMatchObject({ collection: 'decisions', status: 'accepted', entityId: 'entity' })
  expect(collectionInput({ runId: 'run', module: 'checkpoints', search: '', status: 'failed' }, 2))
    .toMatchObject({ collection: 'checkpoints', status: 'failed' })
})

it('selects identity, execution, references and knowledge independently of the current page', () => {
  const base = { runId: 'run', search: '', objectId: 'exact' }
  expect(objectInput({ ...base, module: 'entities' }, 3)).toMatchObject({ collection: 'entities', section: 'identity' })
  expect(objectInput({ ...base, module: 'entities', section: 'knowledge' }, 3)).toMatchObject({ section: 'knowledge', limit: 3 })
  expect(objectInput({ ...base, module: 'decisions' }, 3)).toMatchObject({ section: 'execution' })
  expect(objectInput({ ...base, module: 'decisions', section: 'knowledge' }, 3)).not.toHaveProperty('reference')
  expect(objectInput({ ...base, module: 'decisions', section: 'knowledge', knowledgeId: 'knowledge', knowledgeRevision: 2 }, 3))
    .toHaveProperty('reference', { id: 'knowledge', revision: 2 })
  expect(objectInput({ ...base, module: 'decisions', section: 'knowledge', knowledgeId: 'knowledge' }, 3)).not.toHaveProperty('reference')
  expect(objectInput({ ...base, module: 'operations' }, 3)).toMatchObject({ section: 'execution' })
  expect(objectInput({ ...base, module: 'checkpoints' }, 3)).toMatchObject({ section: 'references', limit: 3 })
})

it('rejects unsupported public collection variants rather than borrowing an existing query', () => {
  const wrong = { runId: 'run', module: 'overview', search: '', objectId: 'object' }
  expect(() => collectionInput(wrong as Parameters<typeof collectionInput>[0], 1)).toThrow('Unhandled Simulation collection: overview')
  expect(() => objectInput(wrong as Parameters<typeof objectInput>[0], 1)).toThrow('Unhandled Simulation collection: overview')
})

it('normalizes bounded record, cognition and decision-knowledge selectors from untrusted URLs', () => {
  expect(normalize({ module: 'records', search: '', recordKind: '' }).recordKind).toBeUndefined()
  expect(normalize({ module: 'records', search: '', recordKind: 'x'.repeat(129) }).recordKind).toBeUndefined()
  expect(normalize({ module: 'entities', search: '', cognition: 'agent' }).cognition).toBe('agent')
  const base: Route = { module: 'decisions', search: '', objectId: 'decision', section: 'knowledge', knowledgeId: 'knowledge' }
  expect(normalize({ ...base, knowledgeRevision: 1 })).toMatchObject({ knowledgeId: 'knowledge', knowledgeRevision: 1, section: 'knowledge' })
  for (const knowledgeRevision of [undefined, 0, -1, 1.5]) {
    expect(normalize({ ...base, knowledgeRevision })).toMatchObject({ knowledgeId: undefined, knowledgeRevision: undefined })
  }
  expect(normalize({ ...base, knowledgeId: undefined, knowledgeRevision: 1 }).knowledgeRevision).toBeUndefined()
  expect(normalize({ module: 'entities', search: '', objectId: 'entity', section: 'knowledge' }).section).toBe('knowledge')
  expect(normalize({ ...base, section: undefined }).section).toBeUndefined()
})

it('retains the supported institution impact route only for an original governance object', () => {
  expect(normalize({ module: 'governance', search: '', objectId: 'proposal', worldSection: 'impact' }).worldSection).toBe('impact')
  expect(normalize({ module: 'governance', search: '', worldSection: 'impact' }).worldSection).toBeUndefined()
  expect(normalize({ module: 'organization', search: '', objectId: 'position', worldSection: 'impact' }).worldSection).toBeUndefined()
})
