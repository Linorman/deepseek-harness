// @vitest-environment jsdom
/** View-only deep links clear dismissed identities and remain independent across registration lifetimes. */
import { expect, it, vi } from 'vitest'
import { createSimulationStore, route, writeRoute, reviewDraftKey, operationRetryDraftKey, taskCancelDraftKey } from '../src/client/store.ts'
import { Config } from '../src/config.ts'
import { collectionInput, objectInput, normalize } from '../src/client/selection.ts'
import type { Route } from '../src/client/store.ts'

it('replaces explicit history state without duplicating an already committed location', () => {
  const replace = vi.spyOn(window.history, 'replaceState')
  const push = vi.spyOn(window.history, 'pushState')
  try {
    const target: Route = { module: 'entities', search: 'History target' }
    writeRoute(target, false)
    expect(replace).toHaveBeenCalledOnce()
    writeRoute(target)
    expect(push).not.toHaveBeenCalled()
    window.history.replaceState(null, '', '?simulationModule=decisions&simulationObject=decision&simulationSection=context&simulationSource=0')
    expect(route().sourceIndex).toBe(0)
    window.history.replaceState(null, '', '?simulationModule=decisions&simulationObject=decision&simulationSection=knowledge&simulationKnowledge=knowledge&simulationKnowledgeRevision=1')
    expect(route().knowledgeRevision).toBe(1)
  } finally { replace.mockRestore(); push.mockRestore() }
})

it('shares bounded retry, cancellation, input and creation capacity without erasing admitted drafts', () => {
  const view = createSimulationStore(4096, 1).create()
  const runId = 'run' as never
  const retry = { runId, operationId: 'operation', expectedAttemptCount: 1, reason: 'Retained retry' }
  view.actions.operationRetry('retry', retry)
  const before = view.getSnapshot()
  expect(() => { view.actions.operationRetry('other', { ...retry, operationId: 'other' }) }).toThrow('capacity')
  expect(() => { view.actions.input(runId, { entityId: 'entity', text: 'Input', availableAt: '0' }) }).toThrow('capacity')
  expect(() => { view.actions.cancel('cancel', { runId, operationId: 'operation', expectedRevision: 1,
    expectedAttemptId: null, reason: 'Cancel' }) }).toThrow('capacity')
  expect(view.getSnapshot()).toBe(before)
  view.actions.operationRetry('retry', undefined)
  view.actions.input(runId, { entityId: 'entity', text: 'Input', availableAt: '0' })
  view.actions.input(runId, undefined)
  const cancel = { runId, operationId: 'operation', expectedRevision: 1, expectedAttemptId: null, reason: 'Cancel' }
  view.actions.cancel('cancel', cancel)
  expect(taskCancelDraftKey(cancel)).toBe('["run","operation"]')
  expect(() => { view.actions.cancel('cancel', { ...cancel, reason: '界'.repeat(2000) }) }).toThrow('capacity')
  view.actions.cancel('cancel', undefined)
  view.actions.review('review', { runId, operationId: 'operation', attemptId: 'attempt', expectedRevision: 1,
    nextPhase: 'completed', reason: 'Review' })
  view.actions.review('review', undefined)
  view.actions.creation({ templateId: 'template', name: 'Name', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '0' })
  view.actions.creation(undefined)
  view.actions.creating(true)
  view.actions.active(true)
  view.actions.maintenance({ runId, kind: 'checkpoint' })
  expect(view.getSnapshot().maintenance).toEqual({ runId, kind: 'checkpoint' })
  view.actions.maintenance(undefined)
  expect(view.getSnapshot()).toMatchObject({ creating: true, active: true, inputDrafts: {},
    reviewDrafts: {}, cancelDrafts: {}, operationRetryDrafts: {} })
})

it('does not retain unrelated draft fields in exact dialog targets or scroll identities', () => {
  const view = createSimulationStore(4096, 4).create()
  const target = { runId: 'run' as never, operationId: 'operation', reason: 'Private' }
  view.actions.operationRetryTarget(target)
  view.actions.cancelTarget(target)
  expect(view.getSnapshot().operationRetryTarget).toEqual({ runId: 'run', operationId: 'operation' })
  expect(view.getSnapshot().cancelTarget).toEqual({ runId: 'run', operationId: 'operation' })
  view.actions.operationRetryTarget(undefined)
  view.actions.cancelTarget(undefined)
  view.actions.reviewTarget(undefined)
  view.actions.object('object')
  view.actions.scroll('directory', 40)
  view.actions.search('Committed')
  expect(view.getSnapshot()).toMatchObject({ operationRetryTarget: undefined, cancelTarget: undefined, objectId: 'object', directoryScroll: 0 })
})

it('refuses complete serialized byte overflows for retry, input and creation atomically', () => {
  const view = createSimulationStore(128, 10).create()
  const before = view.getSnapshot()
  expect(() => { view.actions.operationRetry('retry', { runId: 'run' as never, operationId: 'operation', expectedAttemptCount: 1,
    reason: '界'.repeat(200) }) }).toThrow('capacity')
  expect(() => { view.actions.input('run' as never, { entityId: 'entity', text: '界'.repeat(200), availableAt: '0' }) }).toThrow('capacity')
  expect(() => { view.actions.creation({ templateId: 'template', name: '界'.repeat(200), buyerName: '', supplierName: '', initialStock: '' }) }).toThrow('capacity')
  expect(view.getSnapshot()).toBe(before)
})

it('retains valid record ordinals and clears only changed list scroll identities', () => {
  window.history.replaceState(null, '', '?simulationModule=records&simulationSequence=0')
  expect(route().recordSequence).toBe(0)
  const view = createSimulationStore(4096, 4).create()
  const base: Route = { runId: 'run', module: 'operations', search: 'one', status: 'pending', cognition: undefined,
    entityId: 'entity', decisionId: 'decision' }
  view.actions.restore(base)
  view.actions.scroll('directory', 30)
  view.actions.scroll('collection', 50)
  view.actions.restore(base)
  expect(view.getSnapshot()).toMatchObject({ directoryScroll: 30, collectionScroll: 50 })
  for (const change of [{ entityId: 'other' }, { decisionId: 'other' }]) {
    view.actions.scroll('collection', 50)
    view.actions.restore({ ...base, ...change })
    expect(view.getSnapshot().collectionScroll).toBe(0)
    view.actions.restore(base)
  }
  const entities: Route = { ...base, module: 'entities', status: 'active', cognition: 'none' }
  view.actions.restore(entities)
  view.actions.scroll('collection', 50)
  view.actions.restore({ ...entities, cognition: 'agent' })
  expect(view.getSnapshot().collectionScroll).toBe(0)
  view.actions.restore({ ...base, search: 'two' })
  expect(view.getSnapshot().directoryScroll).toBe(0)
  view.actions.authorization(1)
  view.actions.authorization(1)
  const retry = { runId: 'run' as never, operationId: 'operation', expectedAttemptCount: 1, reason: '界'.repeat(2000) }
  expect(() => { view.actions.operationRetry('large', retry) }).toThrow('capacity')
})

it('retains operation-specific raw reasons across navigation within shared private-input capacity', () => {
  const view = createSimulationStore(1024, 2).create()
  const draft = { runId: 'run' as never, operationId: 'operation', expectedAttemptCount: 1, reason: '保留原授权原因' }
  const key = operationRetryDraftKey(draft)
  view.actions.authorization(1)
  view.actions.operationRetry(key, draft); view.actions.operationRetryTarget(draft)
  expect(view.store.getSnapshot().operationRetryTarget).not.toHaveProperty('reason')
  view.actions.input('other' as never, { entityId: 'entity', availableAt: '0', text: 'retained' })
  expect(() => { view.actions.review('review', { runId: 'run' as never, operationId: 'operation', attemptId: 'attempt', expectedRevision: 1,
    nextPhase: 'completed', reason: 'third input' }) }).toThrow(/capacity/)
  expect(() => { view.actions.operationRetry(key, { ...draft, reason: '😀'.repeat(1024) }) }).toThrow(/capacity/)
  view.actions.module('entities'); view.actions.open('another')
  expect(view.store.getSnapshot().operationRetryDrafts[key]?.reason).toBe(draft.reason)
  expect(window.location.search).not.toContain(draft.reason)
  view.actions.authorization(2)
  expect(view.store.getSnapshot().operationRetryDrafts).toEqual({})
})

it('isolates review input by original attempt and shares complete UTF-8 capacity with other private drafts', () => {
  const view = createSimulationStore(1024, 2).create()
  const first = { runId: 'run' as never, operationId: 'operation', attemptId: 'first', expectedRevision: 2,
    nextPhase: 'pending' as const, reason: '保留原因' }
  const second = { ...first, attemptId: 'second', reason: '另一尝试' }
  view.actions.authorization(1)
  view.actions.review(reviewDraftKey(first), first)
  view.actions.reviewTarget(first)
  expect(view.store.getSnapshot().reviewTarget).not.toHaveProperty('reason')
  view.actions.review(reviewDraftKey(second), second)
  expect(() => { view.actions.input('other' as never, { entityId: 'entity', availableAt: '0', text: 'new' }) }).toThrow(/capacity/)
  expect(() => { view.actions.review(reviewDraftKey(first), { ...first, reason: '😀'.repeat(1024) }) }).toThrow(/capacity/)
  view.actions.module('entities'); view.actions.open('another-run')
  expect(view.store.getSnapshot().reviewDrafts[reviewDraftKey(first)]?.reason).toBe('保留原因')
  expect(window.location.search).not.toContain('保留原因')
  view.actions.authorization(2)
  expect(view.store.getSnapshot().reviewDrafts).toEqual({})
})

it('restores safe URL state and clears a run/object when returning to its directory', () => {
  window.history.replaceState(null, '', '?workspace=simulation&simulation=run&simulationModule=entities&simulationObject=actor')
  const view = createSimulationStore(65536, 16).create()
  expect(view.store.getSnapshot()).toMatchObject({ runId: 'run', module: 'entities', objectId: 'actor' })
  const next = { module: 'overview', search: '' } as const
  writeRoute(next)
  view.actions.restore(next)
  expect(view.store.getSnapshot().runId).toBeUndefined()
  expect(view.store.getSnapshot().objectId).toBeUndefined()
  expect(route()).toMatchObject({ module: 'overview', search: '' })
  view.actions.searchDraft('私有草稿')
  expect(window.location.search).not.toContain('私有草稿')
  expect(createSimulationStore(65536, 16).create().store.getSnapshot().draftSearch).toBe('')
})

it('restores entity relationship and decision context deep links with their own page allowances', () => {
  for (const [module, section] of [['entities', 'relationships'], ['decisions', 'context']] as const) {
    const selected = { runId: 'run', module, search: '', objectId: 'object', section }
    writeRoute(selected)
    expect(route()).toEqual(selected)
    expect(objectInput({ ...selected }, 3)).toEqual({ runId: 'run', collection: module, id: 'object', section, limit: 3 })
  }
  writeRoute({ runId: 'run', module: 'operations', search: '', objectId: 'operation', section: 'context' })
  expect(route().section).toBeUndefined()
})

it('reloads committed metadata filters and attempt sections without carrying them to unrelated modules', () => {
  const next = { runId: 'run', module: 'operations', search: '', status: 'outcome-unknown',
    entityId: 'entity', decisionId: 'decision', objectId: 'operation', section: 'attempts' } as const
  writeRoute(next)
  expect(route()).toEqual(next)
  expect(collectionInput({ ...route(), runId: 'run', module: 'operations' }, 2)).toMatchObject({
    runId: 'run', collection: 'operations', status: 'outcome-unknown', entityId: 'entity', decisionId: 'decision', limit: 2,
  })
  expect(objectInput({ ...route(), runId: 'run', module: 'operations', objectId: 'operation' }, 2)).toEqual({
    runId: 'run', collection: 'operations', id: 'operation', section: 'attempts', limit: 2,
  })
  window.history.replaceState(null, '', '?simulation=run&simulationModule=entities&simulationStatus=accepted&simulationCognition=arbitrary&simulationDecision=decision&simulationSection=attempts')
  expect(route()).toMatchObject({ module: 'entities', status: undefined, cognition: undefined, decisionId: undefined, section: undefined })
  const view = createSimulationStore(65536, 16).create()
  view.actions.restore(next)
  view.actions.scroll('collection', 100)
  view.actions.restore({ ...next, status: 'applied', objectId: undefined })
  expect(view.store.getSnapshot().collectionScroll).toBe(0)
  view.actions.module('entities')
  expect(view.store.getSnapshot()).toMatchObject({ status: undefined, entityId: undefined, decisionId: undefined, section: undefined })
})

it('resolves explicit page allowances and refuses zero/fractional/unknown configuration', () => {
  expect(Config.parse(undefined)).toMatchObject({ pageSize: 32, maxDraftBytes: 65536, maxRetainedCommands: 64 })
  expect(Config.parse({ pageSize: 2 })).toMatchObject({ pageSize: 2 })
  for (const config of [{ pageSize: 0 }, { pageSize: 1.2 }, { arbitraryRoot: '/private' }]) {
    expect(() => Config.parse(config)).toThrow()
  }
})

it('retains only exact nonnegative journal sequence and type filters in record deep links', () => {
  const selected = normalize({ module: 'records', search: '', runId: 'run', recordSequence: 0, recordKind: 'run/change', objectId: 'ignored' })
  expect(selected).toMatchObject({ recordSequence: 0, recordKind: 'run/change', objectId: undefined })
  expect(normalize({ ...selected, recordSequence: Number.MAX_SAFE_INTEGER + 1 }).recordSequence).toBeUndefined()
  expect(normalize({ ...selected, module: 'entities' }).recordKind).toBeUndefined()
  expect(normalize({ ...selected, module: 'entities' }).recordSequence).toBeUndefined()
})

it('keeps source ordinals only under an exact decision context deep link', () => {
  const selected = { runId: 'run', module: 'decisions' as const, objectId: 'decision', section: 'context' as const, search: '', sourceIndex: 0 }
  writeRoute(selected)
  expect(route()).toMatchObject(selected)
  expect(normalize({ ...selected, module: 'entities' }).sourceIndex).toBeUndefined()
  expect(normalize({ ...selected, objectId: undefined }).sourceIndex).toBeUndefined()
  expect(normalize({ ...selected, sourceIndex: Number.MAX_SAFE_INTEGER + 1 }).sourceIndex).toBeUndefined()
  expect(normalize({ ...selected, section: 'knowledge' }).sourceIndex).toBeUndefined()
})

it('round-trips the requests module without carrying object filters or authored input', () => {
  const view = createSimulationStore(4096, 4).create()
  view.actions.authorization(1)
  view.actions.input('run' as never, { entityId: 'buyer', availableAt: '0', text: 'Private message body' })
  writeRoute({ runId: 'run', module: 'requests', search: '', objectId: 'old-entity', status: 'active', recordKind: 'old-kind' })
  const selected = route()
  expect(selected).toMatchObject({ runId: 'run', module: 'requests', objectId: undefined, status: undefined, recordKind: undefined })
  expect(window.location.href).not.toContain('Private')
  expect(window.location.search).toContain('simulationModule=requests')
  view.actions.restore(selected)
  expect(view.store.getSnapshot().inputDrafts.run?.text).toBe('Private message body')
})


it('retains World case sections across history restoration and rejects cross-module section leakage', () => {
  const view = createSimulationStore(4096, 4).create()
  const selected: Route = { runId: 'world', module: 'cases', search: '', objectId: 'original-case', caseSection: 'plans' }
  writeRoute(selected)
  expect(route()).toMatchObject(selected)
  view.actions.restore(route())
  expect(view.getSnapshot().caseSection).toBe('plans')
  view.actions.restore({ ...selected, caseSection: 'notification' })
  expect(view.getSnapshot().caseSection).toBe('notification')
  view.actions.restore({ ...selected, module: 'entities' })
  expect(view.getSnapshot().caseSection).toBeUndefined()
  expect(normalize({ ...selected, caseSection: 'unsupported' as never }).caseSection).toBe('request')
})
