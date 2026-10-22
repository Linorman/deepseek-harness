import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema, simulationIngressRequestSchema, simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

describe.each(['json', 'sqlite'] as const)('%s ordered ingress', (backend) => {
  it('refuses ordinary ingress to a generation helper while accepting the normal actor', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('ordinary')
      const helper = simulationEntityIdSchema.parse('helper')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: helper, entityKind: 'generation-assistant',
        cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      const request = simulationIngressRequestSchema.parse({ id: 'input', entityId: helper,
        source: 'operator', text: 'normal input', availableAt: '0' })
      await expect(h.run.ingest(request)).rejects.toThrow('ingress identity, actor')
      expect(h.run.snapshot().ingresses).toBeUndefined()
      expect((await h.run.ingest({ ...request, entityId: actor.id })).request.entityId).toBe(actor.id)
    } finally { await h.close() }
  })

  it('retains required ingress across context overflow and explicit retry', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const receipt = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'large', entityId: actor.id,
        source: 'operator', text: 'x'.repeat(2000), availableAt: '0' }))
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const first = simulationDecisionIdSchema.parse('small-budget')
      await actor.lease.openDecision(first, h.run.snapshot().revision, receipt.eventId)
      expect((await actor.lease.prepareContext(first, contextRequest(1000))).status).toBe('overflow')
      expect(h.run.snapshot().phase).toBe('stalled')
      await actor.lease.cancelDecision(first)
      await h.run.setPhase('running', h.run.snapshot().revision)
      const second = simulationDecisionIdSchema.parse('large-budget')
      await actor.lease.openDecision(second, h.run.snapshot().revision, receipt.eventId)
      const prepared = await actor.lease.prepareContext(second, contextRequest(10000))
      expect(prepared.status).toBe('prepared')
      expect(JSON.stringify(prepared)).toContain(receipt.request.text)
      expect(h.run.snapshot().nextIngressSlot).toBe('1')
    } finally { await h.close() }
  })
  it('defers inputs beyond a frozen window and admits only the selected receipt', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const other = await h.actor('b')
      const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'frozen', decisions: [
        { id: 'before', entityId: actor.id, context: contextRequest() },
      ] }), h.run.snapshot().revision)
      const view = h.run.snapshot().decisions[simulationDecisionIdSchema.parse('before')]!.context
      const firstRequest = simulationIngressRequestSchema.parse({ id: '10', entityId: actor.id,
        source: 'operator', text: 'first external input', availableAt: '0' })
      const first = await h.run.ingest(firstRequest)
      const second = await h.run.ingest({ ...firstRequest, id: simulationIngressRequestSchema.parse({ ...firstRequest, id: '2' }).id, text: 'second external input' })
      expect([first.ordinal, second.ordinal]).toEqual(['0', '1'])
      expect(first.key.microstep).toBe('1')
      expect(await h.run.ingest(firstRequest)).toEqual(first)
      await expect(h.run.ingest({ ...firstRequest, text: 'changed' })).rejects.toThrow(/changed its payload/)
      expect(h.run.snapshot().decisions[simulationDecisionIdSchema.parse('before')]!.context).toEqual(view)
      await actor.lease.submitDecision(simulationDecisionIdSchema.parse('before'), [])
      await h.run.commitWindow(window.id)
      expect((await h.run.drive({ until: simTimeSchema.parse('0') })).reason).toBe('decision-required')
      const wake = h.run.snapshot().wakes[first.eventId]!
      const foreignId = simulationDecisionIdSchema.parse('foreign')
      await expect(other.lease.openDecision(foreignId, h.run.snapshot().revision, wake.eventId)).rejects.toThrow(/pending scheduled wake/)
      await other.lease.openDecision(foreignId, h.run.snapshot().revision)
      expect(JSON.stringify(await other.lease.prepareContext(foreignId, contextRequest()))).not.toContain('external input')
      await other.lease.cancelDecision(foreignId)
      const id = simulationDecisionIdSchema.parse('consume-first')
      const decision = await actor.lease.openDecision(id, h.run.snapshot().revision, wake.eventId)
      expect(decision.ingressId).toBe(firstRequest.id)
      const prepared = await actor.lease.prepareContext(id, contextRequest())
      expect(JSON.stringify(prepared)).toContain('first external input')
      expect(JSON.stringify(prepared)).not.toContain('second external input')
      if (prepared.status !== 'prepared') throw new Error('Unexpected context overflow')
      expect(prepared.view.sources).toContainEqual({ kind: 'run-event', runId: h.run.snapshot().spec.runId, sequence: first.sequence })
    } finally { await h.close() }
  })

  it('accepts input while paused, clamps late arrival and respects future availability', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      await h.run.drive({ until: simTimeSchema.parse('5') })
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const late = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'late', entityId: actor.id, source: 'operator', text: 'late', availableAt: '1' }))
      const future = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'future', entityId: actor.id, source: 'operator', text: 'future', availableAt: '9' }))
      expect(late.key.time).toBe('5')
      expect(future.key.time).toBe('9')
      expect((await h.run.drive({ until: simTimeSchema.parse('5') })).reason).toBe('paused')
      expect(h.run.snapshot().wakes).toEqual({})
      await h.run.setPhase('running', h.run.snapshot().revision)
      await h.run.drive({ until: simTimeSchema.parse('5') })
      expect(h.run.snapshot().wakes[late.eventId]?.status).toBe('pending')
      expect(h.run.snapshot().wakes[future.eventId]).toBeUndefined()
    } finally { await h.close() }
  })

  it('bounds the complete UTF-8 receipt and rejects unbound input fields', async () => {
    const h = await createBusinessHarness(backend)
    let bytes: number
    try {
      const actor = await h.actor('a')
      const request = simulationIngressRequestSchema.parse({ id: 'size', entityId: actor.id, source: 'operator', text: '中文', availableAt: '0' })
      const receipt = await h.run.ingest(request)
      bytes = Buffer.byteLength(JSON.stringify(receipt), 'utf8')
      expect(() => h.run.ingest({ ...request, actor: {} } as never)).toThrow()
    } finally { await h.close() }
    for (const maxIngressBytes of [bytes, bytes - 1]) {
      const bounded = await createBusinessHarness(backend, { maxIngressBytes })
      try {
        const actor = await bounded.actor('a')
        const work = bounded.run.ingest(simulationIngressRequestSchema.parse({ id: 'size', entityId: actor.id,
          source: 'operator', text: '中文', availableAt: '0' }))
        if (maxIngressBytes === bytes) await expect(work).resolves.toMatchObject({ ordinal: '0' })
        else { await expect(work).rejects.toThrow(/byte budget/); expect(bounded.run.snapshot().ingresses).toBeUndefined() }
      } finally { await bounded.close() }
    }
  })
})
