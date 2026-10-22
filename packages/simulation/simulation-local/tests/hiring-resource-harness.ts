/** Real Native/Team/Agent/Session owner boundary; calls use the production three-tool capability without model inference. */
import type { createContext } from '../../simulation-team/tests/harness.ts'
import * as Direct from '@clocky/clocky-team-channel-direct'
import * as Tools from '@clocky/clocky-tool-simulation'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import Loader from '@clocky/cordis-plugin-loader'
import Include from '@clocky/cordis-plugin-include'
import Presets from '@clocky/clocky-agent-presets'
import * as Role from '@clocky/clocky-tool-simulation/role'
import { resolve } from 'node:path'
import { contextRequest } from './context-fixture.ts'
import { decisionInput } from '../../simulation-team/src/input.ts'
import { simulationChangeSchema, simulationWorldDefinitionSchema, simulationResourceSpecSchema,
  simulationRunSelectionSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationEntityIdSchema,
  simTimeSchema, simulationChannelSpecSchema,
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, simulationWorldHireReserveRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationContextRequest, SimulationWorldPlan, SimulationWorldDefinition, SimulationWorldDomainPin } from '@clocky/clocky-simulation'

export async function hiringResourceHarness(backend: 'json' | 'sqlite', mode: 'generate-and-hire' | 'hire-existing',
  options: {
    loadedContext?: { ctx: Awaited<ReturnType<typeof createContext>>['ctx']; serviceFiber: Awaited<ReturnType<typeof createContext>>['ctx']['fiber'] }
    residentLimit?: number
    decisionLimit?: number
    eventLimit?: number
    entityLimit?: number
    microstepLimit?: number
    extraOperationGrants?: SimulationWorldDefinition['operationGrants']
    candidateEligibility?: boolean
    candidateAssignment?: string
    additionalDormantCwd?: string
    additionalPositions?: readonly { entityId: string; capacity: number }[]
    planAttempts?: number
    evidenceRoot?: string
    extraEntities?: readonly { id: string; entityKind: 'organization' | 'position' | 'environment' | 'person-state' | 'object' }[]
    positionRolePermissions?: SimulationWorldDefinition['positionRolePermissions']
    installedPins?: readonly SimulationWorldDomainPin[]
    externalAdjudicationPolicy?: SimulationWorldDefinition['externalAdjudicationPolicy']
    dualHiring?: boolean
    births?: number
    expansions?: number
    actorRequests?: number
    requestHistory?: number
    secondRequester?: boolean
    balance?: string
    quantity?: string
    period?: string
    history?: number
    capacity?: number
    requestBytes?: number
    contextBytes?: number
    knowledgeBytes?: number
    operationLimit?: number
    messageLimit?: number
    description?: string
    planBytes?: number
    grants?: string[]
  } = {}) {
  const evidenceRoot = options.evidenceRoot ?? '.local/world-completion/c40-hire-resource-integration'
  const temp = resolve(evidenceRoot, 'tmp')
  await mkdir(temp, { recursive: true }); const root = await mkdtemp(resolve(temp, 'hiring-owner-'))
  const { ctx, serviceFiber } = options.loadedContext ?? await (await import('../../simulation-team/tests/harness.ts')).createContext(root, backend)
  if (options.loadedContext === undefined) { await ctx.plugin(Direct); await ctx.plugin(Tools); await ctx.plugin(Loader) }
  ctx.baseUrl = pathToFileURL(root).href + '/'
  ctx.loader.builtins.include = Include; ctx.loader.builtins['company-role'] = Role
  const presets = resolve(root, 'presets')
  await mkdir(resolve(presets, 'simulation'), { recursive: true })
  await writeFile(resolve(presets, 'simulation/agent.cordis.yml'), '[{"name":"cordis:company-role"}]\n')
  if (options.loadedContext === undefined) await ctx.plugin(Presets, { default: 'simulation', includeUserRoot: false, roots: [{ path: presets, trust: 'system' }] })
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'fee-owner', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: options.microstepLimit ?? 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
    maxEntities: options.entityLimit ?? 16, maxResidentActors: options.residentLimit ?? 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
    maxDecisionsPerInterval: options.decisionLimit ?? 100, maxMessagesPerInterval: options.messageLimit ?? 100,
    maxPendingEvents: options.eventLimit ?? 100, maxPendingInteractions: 100,
    maxKnowledgeBytes: options.knowledgeBytes ?? 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
    maxDecisionsPerWindow: 2, maxOperationsPerDecision: options.operationLimit ?? 16, maxResourceReservationHistory: options.history ?? 128,
    maxResourceQuantity: '10000', relationRules: ['assignment', 'can-hire', 'eligible-for-hire',
      ...options.installedPins?.some(pin => pin.operation === 'hiring-market') ? ['can-market'] : []].map(relation => ({ relation,
      subjectKinds: ['person'], objectKinds: relation === 'eligible-for-hire' ? ['organization'] : ['position'],
      scopeKinds: ['organization'], acyclic: false })),
    ...options.positionRolePermissions === undefined ? {} : { relationRules: [
      ...['assignment', 'can-hire', 'eligible-for-hire',
        ...options.installedPins?.some(pin => pin.operation === 'hiring-market') ? ['can-market'] : []].map(relation => ({ relation, subjectKinds: ['person'],
        objectKinds: relation === 'eligible-for-hire' ? ['organization'] : ['position'], scopeKinds: ['organization'], acyclic: false })),
      ...options.positionRolePermissions.flatMap(rule => rule.permissions)
        .filter(permission => !['assignment', 'can-hire', 'eligible-for-hire'].includes(permission.relation))
        .map(permission => ({ relation: permission.relation,
          subjectKinds: ['person'], objectKinds: ['organization', 'position', 'environment', 'person-state', 'object'], scopeKinds: ['organization'], acyclic: false })),
    ] } } })
  const run = await ctx.simulations.open(selection), lifetime = new AbortController()
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Validate original hiring funds', budgets: {} },
    budgets: {}, limits: ctx.teams.getCreationLimits() }, 'simulation/company-product')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company-product')
  const requests: GenerateOptions[] = []
  class NoInference extends LlmAdapter {
    async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(request)
      throw new Error('Native owner test cannot invoke inference')
    }
  }
  const adapter = new NoInference()
  const removeModel = ctx.llm.registerAdapter(['company'], adapter)
  const h = { ctx, serviceFiber, root, run, connection, selection, lifetime, requests, adapter,
    start: async () => { await run.setPhase('running', run.snapshot().revision) },
    close: async () => { await connection.close(); await run.close(); removeModel(); await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true }) } }
  const requester = simulationEntityIdSchema.parse('buyer'), director = simulationEntityIdSchema.parse('supplier')
  try {
    for (const id of [requester, director]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent',
        readiness: 'ready', profile: { name: id } }), h.run.snapshot().revision)
      await h.connection.ensureParticipant(id, { displayName: id, role: 'member', capabilities: [], provider: 'in-process',
        preset: 'simulation', model: 'company/scripted' })
    }
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'fee-requester-director', members: [
      { entityId: requester, role: 'member' }, { entityId: director, role: 'director' }], limits: {} }))
    for (const [id, kind] of [['fee-org', 'organization'], ['fee-role', 'position'], ['fee-vacancy', 'position']])
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: kind,
        cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'fee-candidate', entityKind: 'person', cognition: 'agent',
      readiness: 'ready', profile: { name: 'Original candidate', memory: 'ORIGINAL-CANDIDATE-CANARY' } }), h.run.snapshot().revision)
    const member = { displayName: 'Original candidate', role: 'member', capabilities: [], provider: 'in-process',
      preset: 'simulation', model: 'company/scripted' }
    const candidate = simulationEntityIdSchema.parse('fee-candidate')
    await h.connection.ensureParticipant(candidate, member)
    await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'fee-candidate-director',
      members: [{ entityId: candidate, role: 'member' },
        { entityId: director, role: 'director' }], limits: {} }))
    if (options.additionalDormantCwd !== undefined) {
      const id = simulationEntityIdSchema.parse('cwd-person')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      const binding = await h.connection.ensureParticipant(id, member)
      const session = h.ctx.sessions.create(binding.sessionId, { meta: { cwd: options.additionalDormantCwd,
        teamId: binding.teamId, participantId: binding.participantId } })
      await h.ctx.sessionPersistence.materializeHeader(session)
    }
    for (const entity of options.extraEntities ?? []) await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create',
      ...entity, cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    for (const [id, subject, relation, object] of [['fee-employment', requester, 'assignment', 'fee-role'],
      ['fee-permission', requester, 'can-hire', 'fee-vacancy'],
      ...options.candidateAssignment === undefined ? [['fee-eligibility', candidate, 'eligible-for-hire', 'fee-org']]
        : [['management-assignment', candidate, 'assignment', options.candidateAssignment],
          ...options.candidateEligibility ? [['fee-eligibility', candidate, 'eligible-for-hire', 'fee-org']] : []]])
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id, subject, relation, object,
        scope: 'fee-org', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
    const secondRequester = options.secondRequester ? simulationEntityIdSchema.parse('fee-requester-two') : undefined
    if (secondRequester !== undefined) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: secondRequester, entityKind: 'person',
        cognition: 'agent', readiness: 'ready', profile: { name: 'Independent requester' } }), h.run.snapshot().revision)
      await h.connection.ensureParticipant(secondRequester, { ...member, displayName: 'Independent requester' })
      await h.connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'fee-second-director',
        members: [{ entityId: secondRequester, role: 'member' }, { entityId: director, role: 'director' }], limits: {} }))
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'fee-role-two', entityKind: 'position',
        cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      for (const [id, relation, object] of [['fee-employment-two', 'assignment', 'fee-role-two'],
        ['fee-permission-two', 'can-hire', 'fee-vacancy']]) await h.run.change(simulationChangeSchema.parse({
        kind: 'relation/create', id, subject: secondRequester, relation, object, scope: 'fee-org', validFrom: '0', validUntil: null,
      }), h.run.snapshot().revision)
    }
    for (const [id, quantity, owner, controllers] of [['fee-cash', options.balance ?? '10', requester, [requester, ...secondRequester === undefined ? [] : [secondRequester]]],
      ['fee-payee', '0', director, [director]]] as const)
      await h.run.createResource(simulationResourceSpecSchema.parse({ id, owner, kind: 'money', unit: 'credit',
        quantity, controllers }), h.run.snapshot().revision)
    for (const grant of new Map((options.extraOperationGrants ?? []).map(value => [value.relationId, value])).values())
      await h.run.change(simulationChangeSchema.parse({
        kind: 'relation/create', id: grant.relationId, subject: grant.requesterEntityId, relation: grant.relation,
        object: grant.targetEntityId, scope: grant.scopeEntityId, validFrom: '0', validUntil: null,
      }), h.run.snapshot().revision)
    const hiringModes = options.dualHiring ? ['generate-and-hire', 'hire-existing'] as const : [mode]
    const hiringPins = hiringModes.map(value => value === 'generate-and-hire' ? WORLD_GENERATE_AND_HIRE_PIN : WORLD_HIRE_EXISTING_PIN)
    const hiringSelectors = hiringPins.map(
      ({ schemaRef: _schema, implementationRef: _implementation, generation: _generation, ...value }) => value)
    await h.run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: options.positionRolePermissions ?? [],
      ...options.externalAdjudicationPolicy === undefined ? {} : { externalAdjudicationPolicy: options.externalAdjudicationPolicy },
      directorEntityId: director,
      organizationEntityId: 'fee-org', operations: [...hiringPins, ...options.installedPins ?? []],
      operationGrants: hiringSelectors.flatMap(selector => [{ requesterEntityId: requester, ...selector,
        scopeEntityId: 'fee-org', targetEntityId: 'fee-vacancy', relationId: 'fee-permission', relation: 'can-hire' },
      ...secondRequester === undefined ? [] : [{ requesterEntityId: secondRequester, ...selector, scopeEntityId: 'fee-org',
        targetEntityId: 'fee-vacancy', relationId: 'fee-permission-two', relation: 'can-hire' }]]).concat(options.candidateEligibility ? [{
        requesterEntityId: candidate, domain: 'organization', operation: 'hire-existing', version: '1', scopeEntityId: 'fee-org',
        targetEntityId: 'fee-org', relationId: 'fee-eligibility', relation: 'eligible-for-hire' }] : []).concat(options.extraOperationGrants ?? []),
      authorizations: options.dualHiring || mode === 'generate-and-hire' ? [{ requesterEntityId: requester,
        positionEntityId: 'fee-vacancy', relationId: 'fee-permission' }] : [],
      positions: [...options.additionalPositions ?? [], ...secondRequester === undefined ? [] : [{ entityId: 'fee-role-two', capacity: 1 }], { entityId: 'fee-role', capacity: 1 }, { entityId: 'fee-vacancy', capacity: options.capacity ?? 1 }],
      templates: [{ id: 'finite', version: '1', names: ['New'], skills: [], traits: [], goals: [], description: 'Finite new colleague' }],
      policyVersion: '1', limits: { maxRequests: options.requestHistory ?? 16,
        maxBirthsPerInterval: options.births ?? options.requestHistory ?? 16,
        maxExternalExpansionsPerInterval: options.expansions ?? options.requestHistory ?? 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: options.actorRequests ?? 16, maxEvidenceAttemptsPerRequest: 3,
        maxPlansPerRequest: options.planAttempts ?? 3,
        maxBytesPerRequest: options.requestBytes ?? 65536,
        maxBytesPerPlan: options.planBytes ?? 65536 },
      hiringFees: hiringModes.map(operation => ({ id: options.dualHiring ? `charge:${operation}` : 'original-charge', version: '1', policyRef: 'clocky.organization.hiring-fee/1', operation,
        positionEntityId: 'fee-vacancy', from: 'fee-cash', to: 'fee-payee', unit: 'credit', quantity: options.quantity ?? '6',
        grants: options.grants ?? [], reservationPeriod: options.period ?? '5' })) }), h.run.snapshot().revision)
    await h.start()
    for (const actor of [requester, director]) await h.connection.ensureResident(actor, { activation: { provider: 'in-process',
      seed: { kind: 'fresh' }, agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } },
      signal: h.lifetime.signal }, evict: [] })
    const propose = async (actorId: typeof requester, id: string, action: unknown,
      world?: SimulationContextRequest['world'], wakeId?: import('@clocky/clocky-simulation').SimulationEventId) => {
      const decisionId = simulationDecisionIdSchema.parse(id)
      try { await h.connection.openDecision(actorId, decisionId, wakeId) }
      catch (error) {
        await writeFile(resolve(evidenceRoot,
          `open-failure-${backend}-${mode}-${Date.now()}.json`), JSON.stringify({ id, actorId, wakeId,
          error: String(error), state: run.snapshot() }, null, 2))
        throw error
      }
      const context = await h.connection.prepareContext(actorId, decisionId, { ...contextRequest(options.contextBytes),
        ...world === undefined ? {} : { world } })
      if (context.status !== 'prepared') {
        await writeFile(resolve(evidenceRoot, `context-failure-${backend}-${id.replaceAll('/', '-')}.json`),
          JSON.stringify({ context, decisionId, revision: run.snapshot().revision }, null, 2) + '\n')
        throw new Error('Original hiring context was not prepared')
      }
      const agent = h.ctx.agents.get(h.run.snapshot().entities[actorId]!.binding!.sessionId)
      if (agent === undefined) throw new Error('Original hiring Agent is missing')
      agent.session.append('simulation/context-view', context.view, { surfaceOp: 'append' })
      // Consume the actual canonical delivery already in this Agent's inbox, without inventing an envelope or receipt.
      for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep]) {
        if (message.id === decisionInput(context.view).id) continue
        agent.inbox.remove(message.id)
        agent.session.append('user/message', message, { surfaceOp: 'append' })
      }
      agent.session.append('user/message', decisionInput(context.view), { surfaceOp: 'append' })
      if (!await h.ctx.sessions.flush(agent.session)) throw new Error('Original hiring Session did not flush')
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'observe' }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'stage',
        proposals: action === undefined ? [] : [simulationProposalSchema.parse({ after: [], action })] }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(agent, { kind: 'submit' }, h.lifetime.signal)
      const decision = h.run.snapshot().decisions[decisionId]!
      if (decision.status !== 'accepted') throw new Error('Original hiring proposal was not accepted')
      if (action === undefined) {
        if (decision.operationIds.length !== 0) throw new Error('An empty original wake generated unexpected effects')
        return undefined
      }
      if (decision.operationIds.length < 1) throw new Error('Original hiring operation is absent')
      return await h.run.executeOperation(decision.operationIds[0]!)
    }
    const plan = async (key = 'original-case', selectedMode = mode,
      resolution?: import('@clocky/clocky-simulation').SimulationWorldResolution):
    Promise<Extract<SimulationWorldPlan, { readonly operationId: import('@clocky/clocky-simulation').SimulationOperationId }>> => {
      const selectedPin = selectedMode === 'generate-and-hire' ? WORLD_GENERATE_AND_HIRE_PIN : WORLD_HIRE_EXISTING_PIN
      const { schemaRef: _schema, implementationRef: _implementation, generation: _generation, ...selector } = selectedPin
      await propose(requester, `${key}/request`, { kind: 'world/request', ...selector, businessKey: key, expectedTime: null, evidence: [],
        payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy', description: options.description ?? 'An original explicitly funded hire',
          ...selectedMode === 'hire-existing' ? { personId: candidate } : {} } }, { kind: 'goal' })
      const request = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === key)!
      if (request.notificationOperationId === null) throw new Error('Ordinary hiring needs its real private Channel')
      await h.run.drive({ until: simTimeSchema.parse(h.run.snapshot().time) })
      await h.connection.dispatchOperation(request.notificationOperationId, () => Date.now())
      const wake = await h.connection.receiveOperation(request.notificationOperationId)
      for (let round = 0; round < 8 && h.run.snapshot().wakes[wake]?.status !== 'pending'; round += 1) {
        // Explicitly consume an earlier original wake with no effects; this does not claim delivery of a business reply.
        for (const pending of Object.values(h.run.snapshot().wakes)) if (pending.status === 'pending' && pending.eventId !== wake)
          await propose(pending.entityId, `prior-wake:${pending.eventId}`, undefined, undefined, pending.eventId)
        await h.run.drive({ until: simTimeSchema.parse(h.run.snapshot().time) })
      }
      if (h.run.snapshot().wakes[wake]?.status !== 'pending') throw new Error('Original director wake was not consumed by its real scheduler')
      await propose(director, `${key}/resolve`, { kind: 'world/resolve', requestId: request.id, supersedes: null,
        resolution: resolution ?? { kind: 'apply', rationale: 'The original finite financial and personnel selection',
          payload: selectedMode === 'hire-existing' ? request.proposal.payload : { templateId: 'finite', templateVersion: '1',
            persona: { name: 'New', skills: [], traits: [], goals: [] } } } }, { kind: 'resolve', requestId: request.id }, wake)
      const selected = h.run.snapshot().world!.plans[h.run.snapshot().world!.requests[request.id]!.plans.at(-1)!]!
      if (selected.operationId === null) throw new Error('Role harness cannot select an authenticated user plan')
      return selected
    }
    const generatedRequest = (selected: SimulationWorldPlan) => simulationWorldHireReserveRequestSchema.parse({ planId: selected.id,
      maintenance: { id: `fee-maintenance:${selected.id}`, owner: 'simulation/company-product' },
      member: { displayName: 'New', role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation',
        model: 'company/scripted', modelVersion: '1' } })
    const reserve = async (selected: SimulationWorldPlan) => mode === 'hire-existing'
      ? await h.run.reserveExistingHireResources(selected.id) : await h.run.reserveWorldHire(generatedRequest(selected))
    const prepareGenerated = async (selected: SimulationWorldPlan) => {
      const original = await h.run.reserveWorldHire(generatedRequest(selected))
      await h.connection.quiesceForMaintenance(original.request.maintenance, 4, 3, h.lifetime.signal)
      const prepared = await h.run.prepareWorldHire(original.id)
      const { modelVersion: _version, ...member } = prepared.request.member
      await h.connection.ensureParticipant(prepared.identities.entityId, member)
      for (const channel of prepared.identities.channels) await h.connection.ensureChannel(simulationChannelSpecSchema.parse({
        key: channel.key, members: [{ entityId: prepared.identities.entityId, role: 'member' },
          { entityId: channel.purpose === 'director' ? director : requester, role: channel.purpose }], limits: {} }))
      return prepared
    }
    return { ...h, requester, director, candidate, secondRequester, mode, propose, plan, reserve, generatedRequest, prepareGenerated }
  } catch (error) {
    await writeFile(resolve(root, 'setup-failed.json'), JSON.stringify({ error: String(error), state: run.snapshot() }, null, 2))
    try { await h.close() } catch (cleanupError) { throw new AggregateError([error, cleanupError],
      'Hiring owner setup and cleanup failed') }
    throw error
  }
}
