/** Five-role procurement through real model/tool turns, scoped channels and atomic money/inventory transactions. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter, freezeMessage, MessageId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationProfileSchema,
  simulationEntityIdSchema, simulationChannelSpecSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationContextRequestSchema,
  simulationTransactionSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationDecision, SimulationProposal } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-procurement', process.argv[2]!)
const recovering = process.env['PROCUREMENT_RECOVER'] === 'true'
const variant = process.env['PROCUREMENT_VARIANT'] ?? 'happy'
assert.ok(['happy', 'finance-reject', 'supplier-late', 'purchasing-sleep', 'duplicate-reply', 'overdue', 'manager-reassigned'].includes(variant), 'Unknown procurement variant')
const cash = variant === 'finance-reject' ? '10' : '100'
const arrival = variant === 'supplier-late' ? 40 : 30
const office = (time: number) => time % 24 < 9 ? Math.floor(time / 24) * 24 + 9
  : time % 24 >= 17 ? (Math.floor(time / 24) + 1) * 24 + 9 : time
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'procurement', tickUnit: 'hour', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 64,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 2, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16,
  maxResourceQuantity: '10000', maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 32, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, maxPendingEvents: 100, maxPendingInteractions: 100,
  relationRules: [{ relation: 'manager', subjectKinds: ['department'], objectKinds: ['person'], acyclic: true }],
} }))
try {
  const roles = ['ceo', 'warehouse', 'purchasing', 'finance', 'supplier'].map(value => simulationEntityIdSchema.parse(value))
  const [ceo, warehouse, purchasing, finance, supplier] = roles as [
    SimulationEntityId, SimulationEntityId, SimulationEntityId, SimulationEntityId, SimulationEntityId,
  ]
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Replenish stock with approved funds', budgets: {} }, budgets: {} }, 'simulation/procurement')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/procurement')
  for (const entityId of roles) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId,
      entityKind: 'person', cognition: 'agent', profile: { role: entityId, privateHistory: `${entityId}-private-history` } }), run.snapshot().revision)
    await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'procurement/scripted' })
  }
  const department = simulationEntityIdSchema.parse('purchasing-department')
  if (!recovering) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: department, entityKind: 'department', cognition: 'none', profile: {} }), run.snapshot().revision)
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'purchasing-manager', relation: 'manager',
      subject: department, object: purchasing, validFrom: '0', validUntil: null }), run.snapshot().revision)
  }
  const manager = () => {
    const found = run.relationsAt(run.snapshot().time).find(relation => relation.subject === department && relation.relation === 'manager')
    assert.ok(found)
    return found.object
  }
  const channels = new Map<string, Awaited<ReturnType<typeof connection.ensureChannel>>>()
  const key = (a: SimulationEntityId, b: SimulationEntityId) => [a, b].sort().join('/')
  for (const [a, b] of [[warehouse, purchasing], [purchasing, supplier], [purchasing, finance], [supplier, warehouse], [purchasing, ceo],
    ...variant === 'manager-reassigned' ? [[warehouse, ceo]] : []]) {
    assert.ok(a && b)
    channels.set(key(a, b), await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: key(a, b),
      members: [{ entityId: a, role: a }, { entityId: b, role: b }], limits: {} })))
  }
  const accounts = [
    ['warehouse-stock', warehouse, 'inventory', '0'], ['supplier-stock', supplier, 'inventory', '10'],
    ['in-transit', purchasing, 'inventory', '0'], ['cash', finance, 'money', cash],
    ['escrow', purchasing, 'money', '0'], ['supplier-cash', supplier, 'money', '0'],
  ] as const
  if (!recovering) for (const [id, owner, kind, quantity] of accounts) await run.createResource(simulationResourceSpecSchema.parse({
    id, owner, kind, unit: kind === 'money' ? 'credit' : 'item', quantity, controllers: [owner],
  }), run.snapshot().revision)
  if (recovering) for (const entityId of roles) {
    const writer = run.snapshot().entities[entityId]?.writer
    if (writer !== undefined && writer.phase !== 'released') await connection.recover(entityId)
  }
  const placement = (entityId: SimulationEntityId) => ({ activation: { provider: 'in-process',
    seed: { kind: run.snapshot().entities[entityId]?.writer?.activationId === undefined ? 'fresh' as const : 'resume' as const },
    agent: { preset: 'simulation', options: { provider: 'procurement', model: 'scripted' } }, signal: new AbortController().signal }, evict: roles })
  let script: { name: string; entityId: SimulationEntityId; proposals: SimulationProposal[]; index: number } | undefined
  let calls = 0
  ctx.llm.registerAdapter(['procurement'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(script)
      assert.equal(options.sessionId, run.snapshot().entities[script.entityId]?.binding?.sessionId)
      const visible = JSON.stringify(options.messages)
      for (const owner of [finance, supplier]) {
        assert.equal(visible.includes(`${owner}-private-history`), script.entityId === owner)
      }
      if (script.entityId === ceo) assert.ok(!visible.includes('financeCash'))
      if (script.name === 'wait-for-quote') assert.ok(!visible.includes('QUOTE_PUBLIC'))
      if (script.name === 'approve-quote') assert.ok(visible.includes('QUOTE_PUBLIC'))
      assert.deepEqual(options.tools?.map(tool => tool.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const index = script.index++
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const callId = CallId(`${script.name}-${index}`)
      const args = JSON.stringify(index === 1 ? { proposals: script.proposals } : {})
      calls += 1
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  await run.setPhase('running', run.snapshot().revision)
  const resource = (name: string) => Object.values(run.snapshot().resources).find(value => value.id === name)!
  const interaction = (name: string) => Object.values(run.snapshot().interactions).find(value => value.id === name)!
  const operations = (decision: SimulationDecision) => decision.operationIds.map(id => run.snapshot().operations[id]!)
  const post = (from: SimulationEntityId, to: SimulationEntityId, text: string, at: number) => ({ kind: 'communication/post',
    recipient: to, channelId: channels.get(key(from, to))!.manifest.id, text, deliverAt: String(at) })
  const advance = async (at: number) => {
    if (BigInt(run.snapshot().time) > BigInt(at)) return
    const result = await connection.driveResident({ until: simTimeSchema.parse(String(at)) }, Date.now, placement)
    assert.ok(result.reason === 'until' || result.reason === 'decision-required', JSON.stringify(result))
  }
  const decide = async (entityId: SimulationEntityId, name: string, facts: unknown, actions: unknown[]) => {
    const id = simulationDecisionIdSchema.parse(name)
    let decision = run.snapshot().decisions[id]
    if (decision === undefined) {
      if (entityId === purchasing) assert.ok(Number(run.snapshot().time) % 24 >= 9 && Number(run.snapshot().time) % 24 < 17)
      assert.equal((await connection.ensureResident(entityId, placement(entityId))).status, 'resident')
      if (entityId === finance || entityId === supplier) {
        const actor = ctx.agents.get(run.snapshot().entities[entityId]!.binding!.sessionId)
        assert.ok(actor)
        const privateId = MessageId(`private-history/${actor.session.id}`)
        const retained = actor.session.events.some(event => event.type === 'user/message' && event.data.id === privateId
          || event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === privateId))
        if (!retained) {
          actor.send(freezeMessage({ id: privateId, role: 'user', content: [{ type: 'text', text: `${entityId}-private-history` }],
            source: { kind: 'plugin', plugin: 'procurement-fixture' } }), 'next-step', false)
          assert.ok(await ctx.sessions.flush(actor.session))
        }
      }
      const wakeId = Object.values(run.snapshot().wakes).find(wake => wake.entityId === entityId && wake.status === 'pending')?.eventId
      script = { name, entityId, index: 0, proposals: actions.map((action, index) => simulationProposalSchema.parse({
        action, after: index === 0 ? [] : [index - 1],
      })) }
      const context = simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0, personaVersion: 'procurement-1', modelVersion: 'scripted-1',
        sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
        sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
          blocks: [{ type: 'text', text: kind === 'identity' ? `Entity ${entityId}` : kind === 'input' ? JSON.stringify(facts)
            : kind === 'commitments' ? JSON.stringify(Object.values(run.snapshot().commitments).filter(value => value.creditor === entityId || value.debtor === entityId))
              : 'Use only the scoped facts and authorized operations to replenish stock.' }] })),
      })
      decision = await connection.executeDecision(entityId, id, context, wakeId)
      assert.equal(script.index, 3)
    }
    assert.equal(decision.status, 'accepted')
    for (const operation of operations(decision)) if (operation.action.kind !== 'communication/post') {
      const result = await run.executeOperation(operation.id)
      assert.equal(result.status, 'applied', JSON.stringify(result))
    }
    return decision
  }
  const report = async (reason: string, evidence: string[], at: number) => {
    const blocked = reason === 'completed' ? [] : [interaction(reason === 'FINANCE_INSUFFICIENT_FUNDS' ? 'funding' : 'restock')]
    const nextUpdateAt = reason === 'completed' ? null : simTimeSchema.parse(String(office(at + 1)))
    if (nextUpdateAt !== null) await run.scheduleWake(simulationWakeRequestSchema.parse({
      id: 'procurement-next-update', entityId: purchasing, time: nextUpdateAt, reason: 'Review unresolved procurement and update the CEO',
    }), run.snapshot().revision)
    const message = JSON.stringify({ changes: { inventory: reason === 'completed' ? 2 : 0, spentFunds: reason === 'completed' ? 20 : 0 },
      blockedBy: blocked.map(item => ({ runId: run.snapshot().spec.runId, interactionId: item.id, revision: item.revision })),
      nextUpdateAt, risks: reason === 'completed' ? arrival > 35 ? ['LATE_DELIVERY'] : [] : [reason],
      decisionsNeeded: reason !== 'completed', evidence })
    await decide(purchasing, 'report', { summary: message }, [post(purchasing, ceo, message, at)])
    await advance(at)
    await decide(ceo, 'review-report', { report: message }, [])
  }

  if (run.snapshot().decisions[simulationDecisionIdSchema.parse('low-stock')] === undefined) {
    assert.ok(BigInt(resource('warehouse-stock').quantity) < 1n)
  }
  await decide(warehouse, 'low-stock', { inventory: resource('warehouse-stock').quantity, reorderBelow: '1', requested: '2' }, [
    { kind: 'interaction/request', id: 'restock', assignee: manager(), description: 'Replenish two items', replyBy: '10', completeBy: '35',
      fulfillment: { kind: 'transfer', from: 'in-transit', to: 'warehouse-stock', quantity: '2' } },
    post(warehouse, manager(), 'RESTOCK two items; purchasing office opens at 9.', 9),
  ])
  await advance(9)
  await decide(purchasing, 'accept-restock', { request: interaction('restock') }, [
    { kind: 'interaction/accept', id: 'restock', expectedRevision: interaction('restock').revision },
    { kind: 'interaction/request', id: 'quote', assignee: supplier, description: 'Quote two items with delivery time', replyBy: '12', completeBy: '18', fulfillment: { kind: 'explicit' } },
    post(purchasing, supplier, 'QUOTE_REQUEST two items with price and delivery time.', 10),
  ])
  await advance(10)
  await decide(supplier, 'quote', { request: interaction('quote'), stockAvailable: resource('supplier-stock').quantity }, [
    { kind: 'interaction/accept', id: 'quote', expectedRevision: interaction('quote').revision },
    post(supplier, purchasing, 'QUOTE_PUBLIC quantity=2 price=20 deliverAt=30', 12),
  ])
  await advance(11)
  if (!recovering) {
    const actor = ctx.agents.get(run.snapshot().entities[purchasing]!.binding!.sessionId)
    assert.ok(!JSON.stringify(actor?.session.events).includes('QUOTE_PUBLIC'))
  }
  await decide(purchasing, 'wait-for-quote', { quoteReceived: false, availableAt: '12' }, [])
  await advance(12)
  const quoteConfirmed = await decide(purchasing, 'approve-quote', { quote: { quantity: 2, price: 20, deliverAt: 30 } }, [
    { kind: 'interaction/confirm', id: 'quote', expectedRevision: interaction('quote').revision },
    { kind: 'interaction/request', id: 'funding', assignee: finance, description: 'Approve twenty credits for quoted stock', replyBy: '14', completeBy: '20',
      fulfillment: { kind: 'transfer', from: 'cash', to: 'escrow', quantity: '20' } },
    post(purchasing, finance, 'FUNDING_REQUEST quantity=2 quotedCost=20.', 13),
  ])
  if (variant === 'duplicate-reply') {
    const quoteBefore = interaction('quote')
    const fundingBefore = interaction('funding')
    await decide(supplier, 'repeat-quote', { quoteAlreadyConfirmed: true }, [
      post(supplier, purchasing, 'QUOTE_PUBLIC quantity=2 price=20 deliverAt=30', 12),
    ])
    await advance(12)
    await decide(purchasing, 'ignore-repeated-quote', { quote: quoteBefore, fundingAlreadyRequested: true }, [])
    assert.deepEqual(interaction('quote'), quoteBefore)
    assert.deepEqual(interaction('funding'), fundingBefore)
    assert.equal(resource('cash').quantity, cash)
  }
  await advance(13)
  if (BigInt(cash) < 20n) {
    const denied = await decide(finance, 'reject-funding', { financeCash: resource('cash').quantity, quotedCost: '20', rule: 'Do not approve uncovered purchases' }, [
      { kind: 'interaction/reject', id: 'funding', expectedRevision: interaction('funding').revision, reason: 'FINANCE_INSUFFICIENT_FUNDS' },
      post(finance, purchasing, 'FINANCE_INSUFFICIENT_FUNDS', 14),
    ])
    await advance(14)
    await decide(purchasing, 'notify-rejection', { reason: 'FINANCE_INSUFFICIENT_FUNDS' }, [
      post(purchasing, warehouse, 'FINANCE_INSUFFICIENT_FUNDS; withdraw this request.', 15),
    ])
    await advance(15)
    const withdrawn = await decide(warehouse, 'cancel-restock', { reason: 'FINANCE_INSUFFICIENT_FUNDS' }, [
      { kind: 'interaction/cancel', id: 'restock', expectedRevision: interaction('restock').revision, reason: 'FINANCE_INSUFFICIENT_FUNDS' },
      post(warehouse, purchasing, 'RESTOCK_CANCELLED', 16),
    ])
    await advance(16)
    await report('FINANCE_INSUFFICIENT_FUNDS', [denied.operationIds[0]!, withdrawn.operationIds[0]!], 17)
    assert.equal(resource('cash').quantity, '10')
    assert.equal(resource('supplier-stock').quantity, '10')
    assert.equal(resource('warehouse-stock').quantity, '0')
  } else {
    await decide(finance, 'accept-funding', { financeCash: resource('cash').quantity, quotedCost: '20' }, [
      { kind: 'interaction/accept', id: 'funding', expectedRevision: interaction('funding').revision },
    ])
    let reserve = simulationTransactionSchema.parse({ commitmentId: interaction('funding').commitmentId,
      reads: ['cash', 'escrow', 'supplier-stock', 'in-transit'].map(name => ({ resourceId: name, revision: resource(name).revision })),
      transfers: [{ from: 'cash', to: 'escrow', quantity: '20' }, { from: 'supplier-stock', to: 'in-transit', quantity: '2' }],
    })
    const financeGrant = await decide(finance, 'grant-funds', { approvedTransaction: reserve }, [
      { kind: 'resource/grant', id: 'funds-approval', grantee: purchasing, resources: ['cash'], transaction: reserve },
      post(finance, purchasing, 'FINANCE_APPROVED funds-approval', 14),
    ])
    const granted = operations(financeGrant)[0]!.action
    assert.equal(granted.kind, 'resource/grant')
    reserve = granted.transaction
    await advance(14)
    await decide(purchasing, 'request-stock-approval', { financeApproval: 'funds-approval', reserve }, [
      post(purchasing, supplier, 'FINANCE_APPROVED; authorize the quoted stock reservation.', 15),
    ])
    await advance(15)
    await decide(supplier, 'grant-stock', { quotedTransaction: reserve, quoteConfirmation: quoteConfirmed.operationIds[0] }, [
      { kind: 'resource/grant', id: 'stock-approval', grantee: purchasing, resources: ['supplier-stock'], transaction: reserve },
      { kind: 'interaction/result', id: 'quote', expectedRevision: interaction('quote').revision, evidence: [quoteConfirmed.operationIds[0]] },
      post(supplier, purchasing, 'STOCK_APPROVED stock-approval', 16),
    ])
    await advance(16)
    const reserved = await decide(purchasing, 'reserve-order', { reserve, approvals: ['funds-approval', 'stock-approval'] }, [
      { kind: 'resource/transfer', transaction: reserve, grants: ['funds-approval', 'stock-approval'] },
    ])
    assert.equal(resource('cash').quantity, '80')
    assert.equal(resource('escrow').quantity, '20')
    assert.equal(resource('supplier-stock').quantity, '8')
    assert.equal(resource('in-transit').quantity, '2')
    if (process.env['PROCUREMENT_CRASH'] === 'reserved') {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
    if (variant === 'manager-reassigned') {
      const replacement = Object.values(run.snapshot().relations).find(value => value.id === 'replacement-manager')
      if (replacement === undefined) {
        const previous = run.relationsAt(simTimeSchema.parse('15')).find(value => value.subject === department && value.relation === 'manager')!
        await run.changeMany([
          simulationChangeSchema.parse({ kind: 'relation/update', id: previous.id, relation: 'manager',
            subject: department, object: purchasing, validFrom: '0', validUntil: '16', relationRevision: previous.revision }),
          simulationChangeSchema.parse({ kind: 'relation/create', id: 'replacement-manager', relation: 'manager',
            subject: department, object: ceo, validFrom: '16', validUntil: null }),
        ], run.snapshot().revision)
      }
      assert.equal(manager(), ceo)
      assert.equal(run.relationsAt(simTimeSchema.parse('15')).find(value => value.subject === department)?.object, purchasing)
      assert.equal(interaction('restock').assignee, purchasing)
      assert.equal(Object.values(run.snapshot().commitments).find(value => value.interactionId === 'restock')?.debtor, purchasing)
      assert.ok(Object.values(run.snapshot().grants).every(value => value.grantee === purchasing))
      if (process.env['PROCUREMENT_CRASH'] === 'reassigned') {
        process.send?.('durable')
        await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
      }
    }
    const delivery = simulationTransactionSchema.parse({ commitmentId: interaction('restock').commitmentId,
      reads: ['escrow', 'supplier-cash', 'in-transit', 'warehouse-stock'].map(name => ({ resourceId: name, revision: resource(name).revision })),
      transfers: [{ from: 'escrow', to: 'supplier-cash', quantity: '20' }, { from: 'in-transit', to: 'warehouse-stock', quantity: '2' }],
    })
    await decide(purchasing, 'authorize-delivery', { reservation: reserved.operationIds[0], delivery }, [
      { kind: 'resource/grant', id: 'delivery-approval', grantee: warehouse, resources: ['escrow', 'in-transit'], transaction: delivery },
      post(purchasing, supplier, 'ORDER_RESERVED; notify warehouse when shipment arrives.', 17),
    ])
    if (variant === 'purchasing-sleep') await connection.hibernate(purchasing)
    await advance(17)
    if (variant === 'overdue') {
      const withheld = await decide(supplier, 'withhold-shipment', { reserved: true, deliveryNotScheduled: true }, [])
      assert.equal(withheld.operationIds.length, 0)
      await advance(36)
      const obligation = Object.values(run.snapshot().commitments).find(value => value.interactionId === 'restock')
      assert.equal(obligation?.phase, 'open')
      assert.equal(obligation?.breachedAt, '35')
      assert.equal(interaction('restock').execution, 'pending')
      assert.equal(interaction('restock').resultOperationId, undefined)
      assert.equal(resource('warehouse-stock').quantity, '0')
      assert.equal(resource('supplier-cash').quantity, '0')
      assert.equal(resource('escrow').quantity, '20')
      assert.equal(resource('in-transit').quantity, '2')
      const authorization = run.snapshot().decisions[simulationDecisionIdSchema.parse('authorize-delivery')]!
      await report('FULFILLMENT_OVERDUE', [reserved.operationIds[0]!, authorization.operationIds[0]!], 37)
    } else {
      await decide(supplier, 'ship', { reserved: true, quotedArrival: 30, actualArrival: arrival }, [
        post(supplier, warehouse, `SHIPMENT quantity=2 delivery-approval arrival=${arrival}`, arrival),
      ])
      await advance(arrival - 1)
      assert.equal(resource('warehouse-stock').quantity, '0')
      assert.equal(resource('supplier-cash').quantity, '0')
      await advance(arrival)
      const delivered = await decide(warehouse, 'receive-shipment', { shipment: '2 items', delivery }, [
        { kind: 'resource/transfer', transaction: delivery, grants: ['delivery-approval'] },
      ])
      await decide(warehouse, 'confirm-receipt', { evidence: delivered.operationIds[0], received: resource('warehouse-stock').quantity }, [
        post(warehouse, purchasing, `RECEIVED quantity=2 evidence=${delivered.operationIds[0]}`, office(arrival)),
      ])
      await advance(office(arrival))
      await decide(purchasing, 'complete-restock', { evidence: delivered.operationIds[0], late: arrival > 35 }, [
        { kind: 'interaction/result', id: 'restock', expectedRevision: interaction('restock').revision, evidence: [delivered.operationIds[0]] },
      ])
      await report('completed', [reserved.operationIds[0]!, delivered.operationIds[0]!], office(arrival) + 1)
      assert.equal(resource('warehouse-stock').quantity, '2')
      assert.equal(resource('supplier-cash').quantity, '20')
      assert.equal(resource('escrow').quantity, '0')
      assert.equal(resource('in-transit').quantity, '0')
    }

  }
  if (variant === 'manager-reassigned') {
    await decide(warehouse, 'route-new-request', { manager: manager(), existingOrderOwner: purchasing }, [
      { kind: 'interaction/request', id: 'routing', assignee: manager(), description: 'Acknowledge future purchasing requests',
        replyBy: '36', completeBy: '38', fulfillment: { kind: 'explicit' } },
      post(warehouse, manager(), 'NEW_MANAGER_REQUEST: acknowledge future purchasing requests.', 35),
    ])
    await advance(35)
    await decide(ceo, 'accept-routing', { department, previousOrderOwner: purchasing }, [
      { kind: 'interaction/accept', id: 'routing', expectedRevision: interaction('routing').revision },
      post(ceo, warehouse, 'ROUTING_ACCEPTED; the prior order remains with its original owner.', 36),
    ])
    await advance(36)
    const confirmation = await decide(warehouse, 'confirm-routing', { newManager: manager() }, [
      { kind: 'interaction/confirm', id: 'routing', expectedRevision: interaction('routing').revision },
      post(warehouse, ceo, 'ROUTING_CONFIRMED', 37),
    ])
    await advance(37)
    await decide(ceo, 'routing-result', { confirmation: confirmation.operationIds[0] }, [
      { kind: 'interaction/result', id: 'routing', expectedRevision: interaction('routing').revision, evidence: [confirmation.operationIds[0]] },
    ])
    assert.equal(interaction('routing').assignee, ceo)
    assert.equal(interaction('routing').execution, 'completed')
  }
  for (const owner of [finance, supplier]) {
    assert.equal((await connection.ensureResident(owner, placement(owner))).status, 'resident')
    const actor = ctx.agents.get(run.snapshot().entities[owner]!.binding!.sessionId)
    assert.ok(actor)
    const privateId = MessageId(`private-history/${actor.session.id}`)
    assert.equal(actor.session.events.filter(event => event.type === 'user/message' && event.data.id === privateId).length, 1)
  }
  const state = run.snapshot()
  assert.ok(Object.values(state.operations).every(operation => operation.result?.status === 'applied'))
  assert.ok(Object.values(state.operations).filter(operation => operation.action.kind === 'communication/post')
    .every(operation => operation.delivery?.receipt !== undefined))
  assert.ok(Object.values(state.grants).every(value => value.phase ===
    (variant === 'overdue' && value.id === 'delivery-approval' ? 'available' : 'consumed')))
  assert.equal(run.population().chargedActors <= 2, true)
  const restock = Object.values(state.commitments).find(value => value.interactionId === 'restock')
  assert.equal(restock?.phase, variant === 'finance-reject' ? 'cancelled' : variant === 'overdue' ? 'open' : 'fulfilled')
  assert.equal(restock?.breachedAt, variant === 'supplier-late' || variant === 'overdue' ? '35' : undefined)
  for (const kind of ['money', 'inventory']) {
    const total = Object.values(state.resources).filter(value => value.kind === kind)
      .reduce((sum, value) => sum + BigInt(value.quantity), 0n)
    assert.equal(total, kind === 'money' ? BigInt(cash) : 10n)
  }
  assert.equal(new Set(Object.values(state.decisions).map(value => value.entityId)).size, 5)
  const reportDecision = state.decisions[simulationDecisionIdSchema.parse('report')]!
  const reportAction = state.operations[reportDecision.operationIds[0]!]!.action
  assert.equal(reportAction.kind, 'communication/post')
  const summary = simulationProfileSchema.parse(JSON.parse(reportAction.text))
  const changes = summary['changes']
  assert.ok(changes !== null && typeof changes === 'object' && !Array.isArray(changes))
  assert.equal(changes['inventory'], Number(resource('warehouse-stock').quantity))
  assert.equal(changes['spentFunds'], Number(resource('supplier-cash').quantity))
  assert.equal(summary['decisionsNeeded'], interaction('funding').reply === 'rejected' || variant === 'overdue')
  const blocker = variant === 'finance-reject' ? interaction('funding') : variant === 'overdue' ? interaction('restock') : undefined
  assert.deepEqual(summary['blockedBy'], blocker === undefined ? [] : [{
    runId: state.spec.runId, interactionId: blocker.id, revision: blocker.revision,
  }])
  const nextUpdate = Object.values(state.scheduledEvents).find(event => event.id === 'procurement-next-update')
  if (blocker === undefined) {
    assert.equal(summary['nextUpdateAt'], null)
    assert.equal(nextUpdate, undefined)
  } else {
    assert.equal(nextUpdate?.status, 'pending')
    assert.deepEqual(nextUpdate?.action, { kind: 'wake', entityId: purchasing, reason: 'Review unresolved procurement and update the CEO' })
    assert.equal(summary['nextUpdateAt'], nextUpdate?.key.time)
    assert.ok(BigInt(nextUpdate.key.time) > BigInt(state.time))
  }
  assert.deepEqual(summary['risks'], variant === 'finance-reject' ? ['FINANCE_INSUFFICIENT_FUNDS']
    : variant === 'overdue' ? ['FULFILLMENT_OVERDUE'] : restock?.breachedAt === undefined ? [] : ['LATE_DELIVERY'])
  assert.ok(Array.isArray(summary['evidence']) && summary['evidence'].length === 2)
  for (const evidence of summary['evidence']) assert.ok(typeof evidence === 'string' && Object.hasOwn(state.operations, evidence))
  console.log(JSON.stringify({ variant, currentPurchasingManager: manager(), report: summary, modelCalls: calls, time: state.time,
    resources: Object.values(state.resources).map(({ id, quantity }) => ({ id, quantity })),
    interactions: Object.values(state.interactions).map(({ id, reply, execution, reason }) => ({
      id, reply, execution, ...reason === undefined ? {} : { reason },
    })),
    commitments: Object.values(state.commitments).map(({ phase, breachedAt }) => ({ phase, breached: breachedAt !== undefined })),
    grants: Object.values(state.grants).map(({ id, phase }) => ({ id, phase })), chargedActors: run.population().chargedActors }))
} finally { await run.close(); await ctx.fiber.dispose() }
