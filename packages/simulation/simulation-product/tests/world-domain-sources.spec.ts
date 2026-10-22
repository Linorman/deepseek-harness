/** Case drill-down references name retained Native/Team originals, independently of case prose and Persona grants. */
import { expect, it } from 'vitest'
import { simulationCheckpointIdSchema, simTimeSchema, WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import Products from '../src/index.ts'
import { simulationProductWorldDomainInputSchema } from '../src/world-read-schema.ts'
import { call, registration } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('projects %s original missing-evidence requirements without disclosing rationale', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: '.local/world-completion/u10-actionable' })
  try {
    const pin = WORLD_GENERATE_AND_HIRE_PIN
    await h.propose(h.requester, 'evidence-request-decision', { kind: 'world/request', domain: pin.domain,
      operation: pin.operation, version: pin.version, businessKey: 'private-evidence-business-key', expectedTime: null,
      evidence: [], payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy',
        description: 'Original request requires clarification' } }, { kind: 'goal' })
    const request = Object.values(h.run.snapshot().world!.requests)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(request.notificationOperationId!, Date.now)
    const wake = await h.connection.receiveOperation(request.notificationOperationId!)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.propose(h.director, 'evidence-plan-decision', { kind: 'world/resolve', requestId: request.id,
      supersedes: null, resolution: { kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '10',
        maxAttempts: 2, rationale: 'PRIVATE-MISSING-EVIDENCE-RATIONALE' } }, { kind: 'resolve', requestId: request.id }, wake)
    const before = h.run.snapshot(), original = Object.values(before.world!.evidence.challenges)[0]!
    const registered = { ...registration('domain-evidence'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'domain-evidence-directory', imports: [registered] })
    const value = await h.ctx.simulationProducts.readWorldDomain(simulationProductWorldDomainInputSchema.parse({
      runId: registered.id, kind: 'case-extensions', requestIds: [request.id] }), call())
    if (value.kind !== 'case-extensions' || value.value === undefined) throw new Error('Original case extensions unavailable')
    expect(value.value[0]?.evidence).toEqual({ fields: original.fields.map(field => field.code),
      responders: original.responders.map(id => ({ text: before.entities[id]!.profile['name'], truncated: false })),
      deadline: original.deadline, remainingAttempts: original.maxAttempts, revisions: [] })
    expect(JSON.stringify(value)).not.toContain('PRIVATE-MISSING-EVIDENCE-RATIONALE')
    expect(JSON.stringify(value)).not.toContain('private-evidence-business-key')
    expect(h.run.snapshot()).toEqual(before); expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('projects %s real case Decision/Envelope/Entity/checkpoint references without model calls', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: '.local/world-completion/u05-u06-domain' })
  try {
    const key = 'PRIVATE-DOMAIN-CASE-BUSINESS-KEY'
    const { schemaRef: _schema, implementationRef: _implementation, generation: _generation, ...selector } = WORLD_GENERATE_AND_HIRE_PIN
    await h.propose(h.requester, 'public-request-decision', { kind: 'world/request', ...selector, businessKey: key,
      expectedTime: null, evidence: [], payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy',
        description: 'Original bounded request' } }, { kind: 'goal' })
    const pending = Object.values(h.run.snapshot().world!.requests)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(pending.notificationOperationId!, Date.now)
    const wake = await h.connection.receiveOperation(pending.notificationOperationId!)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.propose(h.director, 'public-planning-decision', { kind: 'world/resolve', requestId: pending.id, supersedes: null,
      resolution: { kind: 'apply', rationale: 'Original finite plan', payload: { templateId: 'finite', templateVersion: '1',
        persona: { name: 'New', skills: [], traits: [], goals: [] } } } }, { kind: 'resolve', requestId: pending.id }, wake)
    const plan = Object.values(h.run.snapshot().world!.plans)[0]!
    const checkpoint = await h.connection.checkpoint({ id: simulationCheckpointIdSchema.parse('domain-case-source'),
      implementationVersion: 'domain-source/1', maxDrainRounds: 4, maxAttempts: 3 })
    if (checkpoint.status !== 'completed') throw new Error('Original checkpoint is incomplete')
    const native = h.run.snapshot(), request = native.world!.requests[plan.requestId]!
    if (request.source.kind !== 'decision' || request.operationId === null) throw new Error('Original actor case lost its Decision source')
    const post = native.operations[request.notificationOperationId!]!, receipt = post.outbox!.receipt!
    const registered = { ...registration('domain-case-source'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'domain-case-source-directory', imports: [registered] })
    const products = h.ctx.simulationProducts
    const input = simulationProductWorldDomainInputSchema.parse({ runId: registered.id, kind: 'case-extensions', requestIds: [request.id] })
    const hidden = await products.readWorldDomain(input, call())
    if (hidden.kind !== 'case-extensions' || hidden.value === undefined) throw new Error('Original case window absent')
    expect(hidden.value[0]!.businessKey).toEqual({ state: 'withheld' })
    expect(JSON.stringify(hidden)).not.toContain(key)
    expect(hidden.value[0]!.sources).toEqual(expect.arrayContaining([
      { kind: 'operation', id: request.operationId }, { kind: 'decision', id: native.operations[request.operationId]!.decisionId },
      { kind: 'entity', id: request.requesterEntityId },
      { kind: 'envelope', id: receipt.envelopeId, teamId: receipt.teamId, channelId: receipt.channelId,
        envelopeId: receipt.envelopeId, envelopeSequence: receipt.sequence, decisionId: post.decisionId },
      { kind: 'checkpoint', id: checkpoint.request.id, label: `Recovery anchor at Native #${checkpoint.manifest.run.cursor}` },
    ]))
    const envelope = await h.ctx.teams.readChannelPage({ channelId: receipt.channelId, afterCursor: receipt.sequence - 1, limit: 1 })
    expect(envelope.records[0]).toMatchObject({ type: 'channel/envelope', envelope: { id: receipt.envelopeId } })
    const personaOnly = products.caseReaderRegistrar()([{ principalId: call().principal.id, runId: registered.id,
      requestIds: [request.id], content: ['persona'] }])
    expect(JSON.stringify(await products.readWorldDomain(input, call()))).not.toContain(key)
    personaOnly()
    const revoke = products.caseReaderRegistrar()([{ principalId: call().principal.id, runId: registered.id,
      requestIds: [request.id], content: ['case'] }])
    try { expect(JSON.stringify(await products.readWorldDomain(input, call()))).toContain(key) }
    finally { revoke() }
    expect(h.run.snapshot()).toEqual(native)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
