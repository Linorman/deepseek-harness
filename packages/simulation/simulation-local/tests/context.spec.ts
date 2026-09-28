import { assertBusinessProjection } from '../src/decisions.ts'
import { contextRequest } from './context-fixture.ts'
/** Budget decisions and exact selected content survive both supported journals. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationContextRequestSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'


describe.each(['json', 'sqlite'] as const)('%s context materialization', (backend) => {
  it('reserves all required bytes and selects whole optional sections deterministically across reopen', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('buyer')
      const id = simulationDecisionIdSchema.parse('context')
      const decision = await actor.lease.openDecision(id, h.run.snapshot().revision)
      const request = contextRequest()
      const optional = { kind: 'history' as const, required: false, blocks: [{ type: 'text' as const, text: '短い' }] }
      request.sections.push(
        { kind: 'knowledge', required: false, blocks: [{ type: 'text', text: 'x'.repeat(500) }] }, optional,
      )
      const retained = [...request.sections.slice(0, 5).flatMap(section => section.blocks), ...optional.blocks]
      request.maxBytes = Buffer.byteLength(JSON.stringify(retained))
      const prepared = await actor.lease.prepareContext(id, request)
      expect(prepared).toMatchObject({ status: 'prepared', omitted: ['knowledge'], retainedBytes: request.maxBytes })
      if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
      expect(prepared.view.content.map(section => section.kind)).toEqual(['identity', 'authority', 'input', 'goals', 'commitments', 'history'])
      expect(prepared.view.projections.run).toBe(decision.snapshotRevision)
      const state = h.run.snapshot()
      const corrupt = (context: typeof prepared) => ({ ...state, decisions: { ...state.decisions,
        [id]: { ...decision, context },
      } })
      expect(() => { assertBusinessProjection(corrupt({ ...prepared, retainedBytes: 0 })) }).toThrow(/accounting/)
      expect(() => {
        assertBusinessProjection(corrupt({ ...prepared, view: { ...prepared.view, projections: {
          ...prepared.view.projections, run: 0,
        } } }))
      }).toThrow(/another decision snapshot/)
      const revision = h.run.snapshot().revision
      expect(await actor.lease.prepareContext(id, request)).toEqual(prepared)
      expect(h.run.snapshot().revision).toBe(revision)
      expect(await actor.lease.readPreparedContext(id)).toEqual(prepared)
      await expect(actor.lease.prepareContext(id, { ...request, maxBytes: request.maxBytes + 1 })).rejects.toThrow(/retry changed/)
      await actor.lease.revoke(); await actor.lease.release(); await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      expect(reopened.snapshot().decisions[id]?.context).toEqual(prepared)
      await reopened.close()
    } finally { await h.close() }
  })

  it('durably stalls on required overflow and requires cancellation before explicit recovery', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('buyer')
      const id = simulationDecisionIdSchema.parse('overflow')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      const request = contextRequest(1)
      const overflow = await actor.lease.prepareContext(id, request)
      expect(overflow.status).toBe('overflow')
      expect(() => { assertBusinessProjection({ ...h.run.snapshot(), phase: 'running' }) }).toThrow(/inconsistent accounting/)

      expect(h.run.snapshot()).toMatchObject({ phase: 'stalled', stall: {
        code: 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW', decisionId: id, maxBytes: 1,
      } })
      expect(await actor.lease.prepareContext(id, request)).toEqual(overflow)
      await expect(actor.lease.readPreparedContext(id)).rejects.toThrow(/current prepared context/)
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/must be cancelled/)
      await actor.lease.cancelDecision(id)
      await expect(actor.lease.prepareContext(id, request)).rejects.toThrow(/no longer current/)
      await h.run.setPhase('running', h.run.snapshot().revision)
      const retry = simulationDecisionIdSchema.parse('larger-budget')
      await actor.lease.openDecision(retry, h.run.snapshot().revision)
      expect((await actor.lease.prepareContext(retry, contextRequest())).status).toBe('prepared')
    } finally { await h.close() }
  })

  it('refuses prepared input after its entity revision changes', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('buyer')
      const id = simulationDecisionIdSchema.parse('stale-context')
      await actor.lease.openDecision(id, h.run.snapshot().revision)
      await actor.lease.prepareContext(id, contextRequest())
      const entity = h.run.snapshot().entities[actor.id]
      if (entity === undefined) throw new Error('fixture entity missing')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: actor.id,
        entityRevision: entity.revision, profile: { role: 'changed' } }), h.run.snapshot().revision)
      await expect(actor.lease.readPreparedContext(id)).rejects.toThrow(/current prepared context/)
      await expect(actor.lease.prepareContext(id, contextRequest())).rejects.toThrow(/no longer current/)
    } finally { await h.close() }
  })

  it('rejects omitted authority, unordered sections and foreign or future evidence before appending', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('buyer')
      const id = simulationDecisionIdSchema.parse('invalid-context')
      const decision = await actor.lease.openDecision(id, h.run.snapshot().revision)
      const revision = h.run.snapshot().revision
      const missing = contextRequest(); missing.sections.splice(1, 1)
      await expect(actor.lease.prepareContext(id, missing)).rejects.toThrow(/complete authority/)
      const unordered = contextRequest(); unordered.sections.reverse()
      await expect(actor.lease.prepareContext(id, unordered)).rejects.toThrow(/section order/)
      const future = contextRequest(); future.sources.push({ kind: 'run-event', runId: h.selection.spec.runId, sequence: decision.snapshotRevision + 1 })
      await expect(actor.lease.prepareContext(id, future)).rejects.toThrow(/scoped evidence/)
      expect(h.run.snapshot().revision).toBe(revision)
      await expect(actor.lease.readPreparedContext(id)).rejects.toThrow(/prepared context/)
      await h.run.setPhase('paused', revision)
      await expect(actor.lease.prepareContext(id, contextRequest())).rejects.toThrow(/no longer current/)
    } finally { await h.close() }
  })
})

it('rejects malformed durable candidates and non-integral byte budgets', () => {
  for (const maxBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(simulationContextRequestSchema.safeParse({ ...contextRequest(), maxBytes }).success).toBe(false)
  }
  for (const blocks of [null, [], [null], [{}], [{ type: '' }]]) {
    expect(simulationContextRequestSchema.safeParse({ ...contextRequest(), sections: [{ kind: 'identity', required: true, blocks }] }).success).toBe(false)
  }
})

it('keeps one ingress source reference and refuses unavailable or contradictory input evidence', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('buyer'), other = await h.actor('other')
    const { simulationIngressRequestSchema, simTimeSchema, simulationRunIdSchema } = await import('@clocky/clocky-simulation')
    const { channelIdSchema, envelopeIdSchema } = await import('@clocky/clocky-team')
    const { prepareContext, assertContextProjection } = await import('../src/context.ts')
    const receipt = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'input', entityId: actor.id,
      source: 'operator', text: 'Required input', availableAt: '0' }))
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const decision = await actor.lease.openDecision(simulationDecisionIdSchema.parse('ingress'), h.run.snapshot().revision, receipt.eventId)
    const state = h.run.snapshot(), request = contextRequest()
    request.sources.push({ kind: 'team-envelope', teamId: state.entities[actor.id]!.binding!.teamId,
      channelId: channelIdSchema.parse('channel'), envelopeId: envelopeIdSchema.parse('envelope') },
    { kind: 'run-event', runId: state.spec.runId, sequence: 1 },
    { kind: 'run-event', runId: state.spec.runId, sequence: receipt.sequence })
    const prepared = prepareContext(state, decision, request)
    if (prepared.status !== 'prepared') throw new Error('fixture overflow')
    expect(prepared.view.sources).toEqual(request.sources)
    expect(() => prepareContext(state, { ...decision, entityId: other.id }, request)).toThrow(/not available/)
    const { wakeId: _wake, ...withoutWake } = decision
    expect(() => prepareContext(state, withoutWake, request)).toThrow(/not available/)
    expect(() => prepareContext({ ...state, scheduledEvents: { ...state.scheduledEvents,
      [receipt.eventId]: { ...state.scheduledEvents[receipt.eventId]!, status: 'pending' } } }, decision, request)).toThrow(/not available/)
    expect(() => prepareContext({ ...state, ingresses: { [receipt.request.id]: { ...receipt,
      key: { ...receipt.key, time: simTimeSchema.parse('1') } } } }, decision, request)).toThrow(/not available/)
    expect(() => prepareContext(state, decision, { ...request, sources: [{ kind: 'run-event',
      runId: simulationRunIdSchema.parse('foreign'), sequence: receipt.sequence }] })).toThrow(/scoped evidence/)
    for (const context of [
      { ...prepared, view: { ...prepared.view, sources: [] } },
      { ...prepared, view: { ...prepared.view, content: prepared.view.content.map(section => section.kind === 'input'
        ? { ...section, blocks: [{ type: 'text' as const, text: 'Changed input' }] } : section) } },
    ]) expect(() => { assertContextProjection(state, { ...decision, context }) }).toThrow(/lost its ingress/)
    expect(() => { assertContextProjection({ ...state, ingresses: {} }, { ...decision, context: prepared }) }).toThrow(/lost its ingress/)
  } finally { await h.close() }
})

it('accepts only recorded presentations of the current decision', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('buyer')
    const id = simulationDecisionIdSchema.parse('presentation')
    const decision = await actor.lease.openDecision(id, h.run.snapshot().revision)
    const { prepareContext } = await import('../src/context.ts')
    const candidate = prepareContext(h.run.snapshot(), decision, contextRequest())
    if (candidate.status !== 'prepared') throw new Error('fixture overflow')
    await expect(actor.lease.validateContextPresentation(id, candidate.view)).rejects.toThrow(/not a retained presentation/)
    await actor.lease.prepareContext(id, contextRequest())
    await expect(actor.lease.validateContextPresentation(id, candidate.view)).resolves.toBeUndefined()
    await expect(actor.lease.validateContextPresentation(id, { ...candidate.view,
      content: candidate.view.content.map(section => ({ ...section,
        blocks: [{ type: 'text', text: 'Unrecorded replacement' }] })) })).rejects.toThrow(/not a retained presentation/)
  } finally { await h.close() }
})
