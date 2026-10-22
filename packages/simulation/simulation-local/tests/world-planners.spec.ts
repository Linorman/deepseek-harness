import { simulationGenerationJobIdSchema, simulationPlannerAssignmentIdSchema } from '@clocky/clocky-simulation'
import { boot } from '@clocky/clocky-app-boot'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
/** Helpers propose; real director Sessions consume and select; the original Native queue commits. */
import { expect, it, vi } from 'vitest'
import { generationPlanInput, simulationGenerationJobSchema, simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

for (const backend of ['json', 'sqlite'] as const) it(`retains helper provenance and marks competing exact read-sets stale on ${backend}`, async () => {
  const temp = resolve('.local/post-mvp-c/planners'); await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`))
  const oldRoot = process.env.SIMULATION_COMPANY_ROOT, oldBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = root; process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('c2-planners', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: root,
    loadedContext: { ctx, serviceFiber: ctx.fiber }, balance: '100', capacity: 3 })
  const helper = simulationEntityIdSchema.parse('domain-helper')
  let serial = 0, selected: string | undefined
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: helper, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    await h.connection.ensureParticipant(helper, { displayName: 'Domain helper', role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'company/scripted' })
    for (const id of ['child-helper', 'grandchild-helper']) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      await h.connection.ensureParticipant(simulationEntityIdSchema.parse(id), { displayName: id, role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'company/scripted' })
    }
    await h.run.setPhase('running', h.run.snapshot().revision)
    const prepare = h.connection.prepareContext.bind(h.connection)
    const input = vi.spyOn(h.connection, 'prepareContext').mockImplementation(async (entityId, id, request) => {
      if (entityId !== h.director || request.world?.kind !== 'resolve') return await prepare(entityId, id, request)
      const original = h.run.snapshot().world!.requests[request.world.requestId]!
      const jobId = simulationGenerationJobIdSchema.parse(`planner-${++serial}`)
      const job = simulationGenerationJobSchema.parse({ id: jobId, assistantEntityId: helper, purpose: 'domain-plan', scope: 'fee-org', audience: [h.director],
        inputs: [{ source: original.id, content: JSON.stringify(original.proposal.payload), audience: [h.director] }], outputSchema: 'domain-plan/1',
        model: { provider: 'company', name: 'scripted', version: '1' }, promptVersion: '1', policyVersion: '1',
        budget: { maxTokens: 100, maxOutputBytes: 32768, maxAttempts: 1 }, deadline: '90',
        planner: { id: `assignment-${serial}`, jobId, requestId: original.id, domain: 'organization', scope: 'fee-org', effects: ['hire-existing'],
          deadline: '90', maxTokens: 300, maxAttempts: 1, maxChildren: 1, maxDepth: 2 } })
      const accepted = await h.run.transitionGeneration({ kind: 'accept', job }, () => {})
      await h.run.transitionGeneration({ kind: 'start', id: jobId, sessionSequence: 0 }, () => {})
      await h.run.transitionGeneration({ kind: 'output', id: jobId, content: JSON.stringify({ requestId: original.id, domain: 'organization', scope: 'fee-org',
        effects: [{ kind: 'hire-existing', payload: original.proposal.payload }], readSet: accepted.planningReads }) }, () => {})
      const validated = await h.run.transitionGeneration({ kind: 'validate', id: jobId }, () => {})
      expect(validated.status).toBe('validated')
      selected = jobId
      return await prepare(entityId, id, { ...request, sections: request.sections.map(section => section.kind !== 'input' ? section : { ...section,
        blocks: [...section.blocks, { type: 'text', text: generationPlanInput(validated) }] }) })
    })
    const modelRequest = h.ctx.simulationTeams.modelRequest.bind(h.ctx.simulationTeams)
    const select = vi.spyOn(h.ctx.simulationTeams, 'modelRequest').mockImplementation(async (agent, request, signal) => {
      if (request.kind === 'stage') request = { ...request, proposals: request.proposals.map((proposal) => {
        if (proposal.action.kind !== 'world/resolve') return proposal
        if (selected === undefined) throw new Error('Director fixture has no selected original helper')
        return { ...proposal, action: { ...proposal.action, generationJobId: simulationGenerationJobIdSchema.parse(selected) } }
      }) }
      return await modelRequest(agent, request, signal)
    })
    const first = await h.plan('first'), second = await h.plan('second')
    expect(first.proposal.generationJobId).toBe('planner-1')
    expect(second.proposal.generationJobId).toBe('planner-2')
    expect(h.run.snapshot().generationJobs?.['planner-1']?.planningReads).toEqual(first.reads)
    const originals = JSON.stringify([first.proposal, second.proposal])
    const parent = h.run.snapshot().generationJobs!['planner-2']!.job
    const child = simulationGenerationJobSchema.parse({ ...parent, id: 'child', assistantEntityId: 'child-helper',
      planner: { ...parent.planner!, id: 'child-assignment', jobId: 'child', parentId: parent.planner!.id, maxDepth: 1, maxTokens: 100 },
      budget: { ...parent.budget, maxTokens: 50 } })
    await expect(h.run.transitionGeneration({ kind: 'accept', job: { ...child, planner: { ...child.planner!, maxTokens: 301 } } }, () => {})).rejects.toThrow(/parent bounds/)
    await expect(h.run.transitionGeneration({ kind: 'accept', job: { ...child, planner: { ...child.planner!, maxDepth: 2 } } }, () => {})).rejects.toThrow(/parent bounds/)
    await h.run.transitionGeneration({ kind: 'accept', job: child }, () => {})
    const grandchild = simulationGenerationJobSchema.parse({ ...child, id: 'grandchild', assistantEntityId: 'grandchild-helper',
      planner: { ...child.planner!, id: 'grandchild-assignment', jobId: 'grandchild', parentId: child.planner!.id, maxDepth: 0, maxTokens: 30 },
      budget: { ...child.budget, maxTokens: 30 } })
    await h.run.transitionGeneration({ kind: 'accept', job: grandchild }, () => {})
    await h.run.transitionGeneration({ kind: 'cancel', id: parent.id, reason: 'parent-cancelled' }, () => {})
    expect(h.run.snapshot().generationJobs?.child?.cancellation).toBeUndefined()
    await expect(h.run.transitionGeneration({ kind: 'start', id: grandchild.id, sessionSequence: 0 }, () => {})).rejects.toThrow(/ancestor/)
    await h.run.transitionGeneration({ kind: 'cancel', id: grandchild.id, reason: 'withdrawn-before-start' }, () => {})
    await expect(h.run.transitionGeneration({ kind: 'accept', job: { ...grandchild, id: simulationGenerationJobIdSchema.parse('another-grandchild'),
      planner: { ...grandchild.planner!, id: simulationPlannerAssignmentIdSchema.parse('another-grandchild-assignment'), jobId: simulationGenerationJobIdSchema.parse('another-grandchild') } } }, () => {})).rejects.toThrow(/ancestor/)

    await expect(h.run.transitionGeneration({ kind: 'start', id: child.id, sessionSequence: 0 }, () => {})).rejects.toThrow(/parent/)
    await expect(h.run.transitionGeneration({ kind: 'accept', job: { ...child, id: simulationGenerationJobIdSchema.parse('another-child'), planner: { ...child.planner!, id: simulationPlannerAssignmentIdSchema.parse('another'), jobId: simulationGenerationJobIdSchema.parse('another-child') } } }, () => {})).rejects.toThrow()
    expect(h.run.snapshot().generationJobs?.child?.status).toBe('accepted')
    await h.reserve(first)
    await expect(h.reserve(second)).rejects.toThrow()
    expect(h.run.snapshot().world!.plans[second.id]?.status).toBe('stale')
    expect(JSON.stringify([h.run.snapshot().world!.plans[first.id]!.proposal,
      h.run.snapshot().world!.plans[second.id]!.proposal])).toBe(originals)
    expect(h.run.snapshot().world!.plans[second.id]?.proposal).toEqual(second.proposal)
    select.mockRestore(); input.mockRestore()
  } finally {
    vi.restoreAllMocks(); await h.close()
    if (oldRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = oldRoot
    if (oldBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = oldBackend
  }
})

it.each(['json', 'sqlite'] as const)('runs independent organization and environment planners through one %s Native committer', async (backend) => {
  const { WORLD_ENVIRONMENT_PIN } = await import('@clocky/clocky-simulation')
  const { EvolutionWorldExecution } = await import('../../simulation-world/src/evolution.ts')
  const { ExistingHireWorldExecution } = await import('../../simulation-world/src/hire-existing.ts')
  const { MockAdapter, textResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org'), targetEntityId = simulationEntityIdSchema.parse('supply')
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/post-mvp-c/two-domains',
    installedPins: [WORLD_ENVIRONMENT_PIN], extraEntities: [{ id: 'supply', entityKind: 'environment' }],
    extraOperationGrants: [{ requesterEntityId: simulationEntityIdSchema.parse('buyer'), domain: 'environment', operation: 'supply-step', version: '1',
      scopeEntityId, targetEntityId, relationId: 'supply-permission' as import('@clocky/clocky-simulation').SimulationRelationId, relation: 'can-supply' }],
    positionRolePermissions: [{ positionEntityId: simulationEntityIdSchema.parse('fee-role'), permissions: [{ domain: 'environment', operation: 'supply-step',
      version: '1', scopeEntityId, targetEntityId, relation: 'can-supply' }] }],
  })
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: targetEntityId, entityRevision: h.run.snapshot().entities[targetEntityId]!.revision,
      profile: { environment: { model: 'supply-fixed/1', generation: 1, inventory: 10, committed: 4, capacity: 20, sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null } } }), h.run.snapshot().revision)
    const helpers = ['organization-helper', 'environment-helper'].map(value => simulationEntityIdSchema.parse(value))
    for (const id of helpers) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
      const binding = await h.connection.ensureParticipant(id, { displayName: id, role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'planner-fixture/test' })
      await h.ctx.sessionPersistence.materializeHeader(h.ctx.sessions.create(binding.sessionId, {
        meta: { teamId: binding.teamId, participantId: binding.participantId } }))
    }
    await h.run.setPhase('running', h.run.snapshot().revision)
    const work = [{ domain: 'organization', operation: 'hire-existing', payload: { personId: h.candidate, organizationEntityId: scopeEntityId, positionEntityId: 'fee-vacancy', description: 'Independent existing hire' } },
      { domain: 'environment', operation: 'supply-step', payload: { scopeEntityId, targetEntityId, demand: 8 } }]
    for (const [index, item] of work.entries()) await h.propose(h.requester, `parallel-request-${index}`, { kind: 'world/request', ...item,
      version: '1', businessKey: `parallel-${index}`, expectedTime: null, evidence: [] }, { kind: 'goal' })
    const requests = work.map((_, index) => Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === `parallel-${index}`)!)
    const jobs = []
    for (const [index, original] of requests.entries()) {
      const job = simulationGenerationJobSchema.parse({ id: `parallel-job-${index}`, assistantEntityId: helpers[index], purpose: 'domain-plan',
        scope: scopeEntityId, audience: [h.director], inputs: [{ source: original.id,
          content: JSON.stringify({ requestId: original.id, domain: original.pin.domain, scope: scopeEntityId,
            effects: [{ kind: original.pin.operation, payload: original.proposal.payload }] }), audience: [h.director] }],
        outputSchema: 'domain-plan/1', model: { provider: 'planner-fixture', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
        deadline: '90', budget: { maxTokens: 20000, maxOutputBytes: 65536, maxAttempts: 1 },
        planner: { id: `parallel-assignment-${index}`, jobId: `parallel-job-${index}`, requestId: original.id, domain: original.pin.domain,
          scope: scopeEntityId, effects: [original.pin.operation], deadline: '90', maxTokens: 20000, maxAttempts: 1, maxDepth: 0, maxChildren: 0 } })
      await h.run.transitionGeneration({ kind: 'accept', job }, () => {})
      jobs.push(job)
    }
    const response = (options: import('@clocky/clocky-llm').GenerateOptions) => {
      const block = options.messages[0]!.content[0]!
      if (block.type !== 'text') throw new Error('Expected isolated planner text')
      const input = JSON.parse(block.text) as { inputs: { content: string }[]; readSet: unknown }
      return textResponse(JSON.stringify({ ...JSON.parse(input.inputs[0]!.content), readSet: input.readSet }))
    }
    const model = new MockAdapter([response, response]); h.ctx.llm.registerAdapter(['planner-fixture'], model)
    const outputs = await Promise.all(jobs.map(job => h.connection.generate(job.id, () => {})))
    expect(outputs.map(value => value.status)).toEqual(['validated', 'validated'])
    expect(new Set(model.requests.map(value => value.sessionId)).size).toBe(2)
    expect(model.requests.every(value => value.tools?.length === 0)).toBe(true)
    const prepare = h.connection.prepareContext.bind(h.connection)
    const selecting = vi.spyOn(h.connection, 'prepareContext').mockImplementation(async (entityId, id, request) => {
      const selected = outputs.find(value => value.job.planner?.requestId === (request.world?.kind === 'resolve' ? request.world.requestId : undefined))
      return await prepare(entityId, id, selected === undefined ? request : { ...request, sections: request.sections.map(section => section.kind !== 'input' ? section
        : { ...section, blocks: [...section.blocks, { type: 'text', text: generationPlanInput(selected) }] }) })
    })
    const plans = [], wakes = []
    for (const request of requests) {
      await h.run.drive({ until: h.run.snapshot().time })
      await h.connection.dispatchOperation(request.notificationOperationId!, () => Date.now())
      wakes.push(await h.connection.receiveOperation(request.notificationOperationId!))
    }
    for (const [index, request] of requests.entries()) {
      const wake = wakes[index]!
      for (let round = 0; round < 8 && h.run.snapshot().wakes[wake]?.status !== 'pending'; round++) {
        for (const pending of Object.values(h.run.snapshot().wakes)) if (pending.status === 'pending' && pending.eventId !== wake)
          await h.propose(pending.entityId, `parallel-prior-${pending.eventId}`, undefined, undefined, pending.eventId)
        await h.run.drive({ until: h.run.snapshot().time })
      }
      await h.propose(h.director, `parallel-resolve-${index}`, { kind: 'world/resolve', requestId: request.id, generationJobId: jobs[index]!.id,
        supersedes: null, resolution: { kind: 'apply', rationale: 'Select original independent helper output', payload: request.proposal.payload } }, { kind: 'resolve', requestId: request.id }, wake)
      plans.push(h.run.snapshot().world!.plans[h.run.snapshot().world!.requests[request.id]!.plans.at(-1)!]!)
    }
    await new EvolutionWorldExecution(h.run, 'supply').execute(plans[1]!)
    expect(await new ExistingHireWorldExecution(h.run).execute(plans[0]!)).toBeUndefined()
    expect(h.run.snapshot().entities[targetEntityId]!.profile.environment).toMatchObject({ inventory: 8, committed: 4 })
    expect(Object.values(h.run.snapshot().relations).some(value => value.subject === h.candidate && value.relation === 'assignment')).toBe(true)
    expect(plans.every(plan => Object.values(h.run.snapshot().world!.results).some(value => value.requestId === plan.requestId && value.outcome.kind === 'committed'))).toBe(true)
    selecting.mockRestore()
  } finally { vi.restoreAllMocks(); await h.close() }
}, 15000)
