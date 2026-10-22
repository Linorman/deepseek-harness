/** Actual external request/evaluation/publication/recipient append barriers; recovery never generates new model input. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_INTERACT_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationInspectionSelectionSchema, simulationDispatchOutcomeSchema,
  simulationOperationIdSchema, simulationExternalInteractionSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationOperation, SimulationScheduledEvent, NativeWorldDomain,
  SimulationWorldDomainPin } from '@clocky/clocky-simulation'
import { channelReceiptRecordSchema as targetReceiptSchema } from '@clocky/clocky-team'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-fault-model.ts'

const scene = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const stage = z.string().min(1).parse(process.env.WORLD_EXTERNAL_FAULT_STAGE)
const recovering = process.env.WORLD_EXTERNAL_FAULT_RECOVER === 'true'
const round = process.env.WORLD_EXTERNAL_FAULT_ROUND ?? '0'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), evidence = resolve(process.env.WORLD_EXTERNAL_FAULT_EVIDENCE!)
const inputPath = resolve(root, 'fault-input.json'), proofPath = resolve(root, 'fault-barrier.json')
const prefixPath = resolve(root, 'fault-reconciled-prefix.json')
const ctx = await boot('world-external-fault', process.argv[2]!)
let modelCalls = 0
ctx.on('llm/stream', (_request, next) => { modelCalls++; return next() })
const errors: string[] = []
ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
try {
  let resolved: ResolvedWorldScenario
  if (recovering) resolved = JSON.parse(await readFile(inputPath, 'utf8')) as ResolvedWorldScenario
  else {
    const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
      resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
    const installed = catalog()
    installed.runtimeProfiles[0]!.model = { provider: 'world-external-fault-scripted', name: 'scripted', version: '1', available: true }
    const compiled = await compileWorldScenario(definition, installed)
    assert.ok(compiled.ok)
    const original = compiled.resolved
    const requester = original.actors.find(value => value.role === 'member'
      && original.relations.some(relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
    const scope = original.world.organizationEntityId, subject = 'external-fault-supplier'
    const world = simulationWorldDefinitionSchema.parse({ ...original.world,
      operations: [...original.world.operations, WORLD_EXTERNAL_INTERACT_PIN], operationGrants: [...original.world.operationGrants,
        { requesterEntityId: requester.entityId, domain: 'external', operation: 'interact', version: '1',
          scopeEntityId: scope, targetEntityId: subject, relationId: 'fault-external-permission', relation: 'can-interact' }] })
    resolved = { ...original, world, initialEvents: [],
      entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none',
        readiness: 'ready', profile: { name: 'Original simulated supplier',
          description: 'The original simulated external supplier.' } }],
      native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact',
        subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
      relations: [...original.relations, { kind: 'relation/create', id: 'fault-external-permission', subject: requester.entityId,
        relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
    const { definitionHash: _hash, ...body } = resolved
    resolved = { ...resolved, definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` }
    await writeFile(inputPath, JSON.stringify(resolved))
  }
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
    spec: { runId: `external-fault-${scene}-${stage}`, ...resolved.native } })
  const checkpointId = simulationCheckpointIdSchema.parse('external-fault-initial')
  const restored = recovering ? await ctx.simulationTeams.restore(selection,
    { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
  const run = restored?.run ?? await ctx.simulations.open(selection)
  try {
    const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
      ownerName: `external-fault/${scene}/${stage}`, checkpoint: { id: checkpointId, maxDrainRounds: 4, maxAttempts: 3 } })
    const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
    assert.equal(typeof ownerName, 'string')
    if (typeof ownerName !== 'string') throw new Error('Fault fixture lost its original canonical owner')
    const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
    const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
    const driver = new SimulationWorldDriver(run, connection, resolved, anchor, new AbortController().signal, ctx,
      ctx.simulationWorldExecutions.handlers({
        run: run,
        connection: connection,
        resolved: resolved,
        anchor: anchor,
        lifetime: new AbortController().signal,
      }, [new ExternalWorldExecution(run)]))
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(modelCalls, 0)
    const durableProof = (state: SimulationSnapshot) => ({ world: state.world, resources: state.resources,
      entities: Object.fromEntries(Object.values(state.entities).map(value => [value.id, {
        id: value.id, kind: value.kind, cognition: value.cognition, binding: value.binding ?? null,
        profile: value.profile, readiness: value.readiness, phase: value.phase,
      }])), relations: state.relations,
      safeWakes: Object.fromEntries(Object.entries(state.scheduledEvents).filter(([id]) => id.startsWith('simulation-world-result:'))),
    })
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
    const journal = async () => {
      const entries: unknown[] = []
      let after = -1
      while (after < stream.tailSequence) {
        const page = await stream.read(after, 128)
        assert.ok(page.length)
        entries.push(...page)
        after = page.at(-1)!.sequence
      }
      return entries
    }
    const channels = async () => {
      const state = await ctx.teams.getTeam({ teamId: team.teamId })
      return await Promise.all(state.channelIds.map(async channelId => ({ channelId,
        admission: await ctx.teams.getChannelAdmission({ channelId }),
        records: (await ctx.teams.readChannel({ channelId, afterCursor: -1 })).records })))
    }
    if (recovering) {
      const proof = z.object({ stage: z.string(), durable: z.json(), entries: z.array(z.unknown()), channels: z.array(z.unknown()) })
        .loose().parse(JSON.parse(await readFile(proofPath, 'utf8')))
      assert.equal(proof.stage, stage)
      assert.equal(run.snapshot().phase, 'paused')
      assert.deepEqual(durableProof(run.snapshot()), proof.durable)
      const actualBefore = await journal()
      const prefixEntries = z.array(z.object({ sequence: z.number(), value: z.unknown() })).parse(proof['journal'])
      assert.deepEqual(actualBefore.slice(0, prefixEntries.length), prefixEntries)
      const originals = run.snapshot().world!, evaluation = Object.values(originals.external.interactions)[0]
      if (stage.startsWith('request-') || stage === 'evaluation-append-before') {
        assert.equal(evaluation, undefined)
        assert.equal(Object.keys(originals.results).length, 0)
      } else if (stage === 'evaluation-append-after' || stage.startsWith('result-')) {
        assert.ok(evaluation)
        assert.deepEqual(evaluation.result.availability, { status: 'known', quantity: '7', unit: 'widget' })
      }
      const phases: string[] = ['restored:paused']
      let reconciled: unknown = null
      const entry = proof.entries.find((value) => {
        const record = z.object({ kind: z.string(), change: z.object({ kind: z.string() }).loose().optional() }).loose().parse(value)
        return record.kind === 'run/outbox' && (record.change?.kind === 'outbox/finished'
          || record.change?.kind === 'outbox/delivery-receipted')
      })
      if (stage.includes('receipt-')) {
        assert.ok(entry)
        const record = z.object({ change: z.object({ kind: z.string(), id: simulationOperationIdSchema }).loose() }).loose().parse(entry)
        if (record.change.kind === 'outbox/finished') {
          const outcome = simulationDispatchOutcomeSchema.parse(record.change['outcome'])
          assert.ok(outcome.status === 'applied' && 'receipt' in outcome)
          const operation = run.snapshot().operations[record.change.id]!
          if (stage.endsWith('-before') && operation.outbox?.receipt === undefined) {
            await run.setPhase('running', run.snapshot().revision); phases.push('exact-dispatch:running')
            assert.equal((await connection.dispatchOperation(record.change.id, Date.now)).status, 'settled')
            await run.setPhase('paused', run.snapshot().revision); phases.push('exact-dispatch:paused')
          }
          assert.deepEqual(run.snapshot().operations[record.change.id]?.outbox?.receipt, outcome.receipt)
          reconciled = outcome.receipt
        } else {
          const receipt = targetReceiptSchema.parse(record.change['receipt'])
          if (stage.endsWith('-before')) await run.confirmDelivery(record.change.id, receipt, run.snapshot().revision)
          assert.deepEqual(run.snapshot().operations[record.change.id]?.delivery?.receipt, receipt)
          reconciled = receipt
        }
      }
      assert.deepEqual(durableProof(run.snapshot()), proof.durable)
      assert.equal(modelCalls, 0)
      assert.equal(requests.length, 0)
      const actualChannels = await channels()
      assert.deepEqual(actualChannels, proof.channels)
      const currentOperations = run.snapshot().operations
      if (round === '1') await writeFile(prefixPath, JSON.stringify(currentOperations))
      else assert.deepEqual(currentOperations, JSON.parse(await readFile(prefixPath, 'utf8')))
      let completion: unknown = null
      if (stage === 'evaluation-append-before' && round === '2') {
        const before = run.snapshot(), world = before.world!
        const plans = Object.values(world.plans)
        assert.equal(plans.length, 1)
        const plan = plans[0]!, originalRequest = world.requests[plan.requestId]!
        assert.equal(plan.status, 'accepted')
        assert.equal(Object.keys(world.external.interactions).length, 0)
        assert.equal(Object.keys(world.mutations).length, 0)
        // This test-only probe counts actual original domain reductions; it does not replace the rule or supply an outcome.
        const runtime = Reflect.get(run, 'worldRuntime') as { original(pin: SimulationWorldDomainPin): NativeWorldDomain }
        const module = runtime.original(plan.pin), reduce = module.reduceMutation.bind(module)
        let reductions = 0
        module.reduceMutation = (...input) => { reductions++; return reduce(...input) }
        try {
          const result = await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
          assert.equal(run.snapshot().phase, 'paused')
          assert.equal(result.outcome.kind, 'committed')
          const committed = run.snapshot(), actual = Object.values(committed.world!.external.interactions)
          assert.equal(actual.length, 1)
          const evaluation = simulationExternalInteractionSchema.parse(actual[0])
          assert.equal(evaluation.requestId, originalRequest.id)
          assert.equal(evaluation.planId, plan.id)
          assert.deepEqual(evaluation.input, originalRequest.proposal.payload)
          assert.deepEqual(evaluation.result.availability, { status: 'known', quantity: '7', unit: 'widget' })
          assert.deepEqual(committed.world!.external.identities, world.external.identities)
          assert.deepEqual(committed.world!.plans, world.plans)
          assert.deepEqual(committed.resources, before.resources)
          assert.equal(Object.keys(committed.world!.mutations).length, 1)
          assert.equal(Object.keys(committed.world!.results).length, 1)
          const wakes: SimulationScheduledEvent[] = Object.values(committed.scheduledEvents)
            .filter(value => value.id === `simulation-world-result:${result.id}`)
          assert.equal(wakes.length, 1)
          assert.equal(wakes[0]!.status, 'pending')
          assert.ok(reductions > 0)
          const count = reductions, revision = committed.revision, tail = stream.tailSequence
          const repeated = await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
          assert.deepEqual(repeated, result)
          assert.equal(reductions, count)
          assert.equal(run.snapshot().revision, revision)
          assert.equal(stream.tailSequence, tail)
          assert.deepEqual(run.snapshot(), committed)
          completion = { originalAcceptedPlan: plan, originalRequest, before: durableProof(before), after: durableProof(committed),
            actualEvaluation: evaluation, mutation: Object.values(committed.world!.mutations)[0], result, safeWake: wakes[0],
            reductionsAtFirstCommit: count, reductionsAfterExactRetry: reductions, revision, tail,
            firstActualRecordCreatedDuringCold2: true, exactRetry: true }
        } finally { module.reduceMutation = reduce }
      }
      assert.equal(modelCalls, 0)
      assert.equal(requests.length, 0)
      await writeFile(resolve(evidence, `${process.env.CLOCKY_EXAMPLE_MODE ?? 'src'}-${scene}-${process.env.SIMULATION_COMPANY_BACKEND}-${stage}-cold-${round}.json`),
        JSON.stringify({ stage, scene, round, phases, reconciled, state: durableProof(run.snapshot()), operations: currentOperations,
          journal: await journal(), channels: actualChannels, modelCalls, inferenceCalls: requests.length,
          ...completion === null ? {} : { completion } }, null, 2) + '\n')
      console.log(JSON.stringify({ stage, scene, phase: run.snapshot().phase, modelCalls, originalPrefix: true,
        recordedEvaluation: completion !== null || evaluation !== undefined, actualReceipt: reconciled !== null,
        resourcesUnchanged: true }))
    } else {
      const supplier = simulationEntityIdSchema.parse('external-fault-supplier')
      for (const [id, kind, quantity] of [['supplier-stock', 'inventory', '7'], ['supplier-money', 'money', '999']] as const) {
        await run.createResource(simulationResourceSpecSchema.parse({ id, owner: supplier, kind, unit: 'widget', quantity, controllers: [] }),
          run.snapshot().revision)
      }
      const initialResources = run.snapshot().resources
      const append = stream.append.bind(stream)
      let captured = false
      const shape = z.object({ kind: z.string(), change: z.object({ kind: z.string().optional(), id: z.string().optional(),
        action: z.object({ kind: z.string(), domain: z.string().optional() }).loose().optional(),
        externalEvaluation: z.unknown().optional(), outcome: z.object({ status: z.string().optional() }).loose().optional(),
      }).loose().optional() }).loose()
      const messageKind = (operation: SimulationOperation | undefined) => {
        if (operation?.action.kind !== 'communication/post') return undefined
        const request = Object.values(run.snapshot().world!.requests).find(value => value.notificationOperationId === operation.id)
        if (request !== undefined) return 'request'
        let body: unknown
        try { body = JSON.parse(operation.action.text) }
        catch { return undefined /* Ordinary text is not a structured original result notification. */ }
        return z.object({ resultId: z.string() }).safeParse(body).success ? 'result' : undefined
      }
      stream.append = async (...args) => {
        const records = args[1].map(value => shape.parse(value))
        const request = records.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
          && value.change.action?.kind === 'world/request' && value.change.action.domain === 'external')
        const evaluation = records.some(value => value.kind === 'run/world-mutation' && value.change?.externalEvaluation !== undefined)
        const message = records.find(value => value.kind === 'run/outbox'
          && (value.change?.kind === 'outbox/finished' && value.change.outcome?.status === 'applied'
            || value.change?.kind === 'outbox/delivery-receipted'))
        const messageId = message?.change?.id
        const originalMessage = messageId === undefined ? undefined
          : run.snapshot().operations[simulationOperationIdSchema.parse(messageId)]
        const category = messageKind(originalMessage)
        const prefix = request ? 'request-append' : evaluation ? 'evaluation-append'
          : message?.change?.kind === 'outbox/finished' ? `${category}-post-receipt`
            : message?.change?.kind === 'outbox/delivery-receipted' ? `${category}-recipient-receipt` : undefined
        const before = run.snapshot()
        const hold = async () => {
          if (captured || prefix === undefined || stage !== `${prefix}-before` && stage !== `${prefix}-after`) return
          captured = true
          const inspection = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({
            provider: selection.provider,
            spec: selection.spec, includeRecords: true }))
          assert.ok(inspection)
          const durable = durableProof(inspection.snapshot), actualJournal = await journal(), actualChannels = await channels()
          assert.deepEqual(inspection.snapshot.resources, initialResources)
          const retained = Object.values(inspection.snapshot.world!.external.interactions)
          if (stage === 'evaluation-append-before') assert.equal(retained.length, 0)
          if (stage === 'evaluation-append-after') {
            assert.equal(retained.length, 1)
            const committed = records.find(value => value.change?.externalEvaluation !== undefined)!
            assert.deepEqual(retained[0], simulationExternalInteractionSchema.parse(committed.change!.externalEvaluation))
          }
          for (const result of Object.values(inspection.snapshot.world!.results)) {
            const resultWakes: SimulationScheduledEvent[] = Object.values(inspection.snapshot.scheduledEvents)
              .filter(value => value.id === `simulation-world-result:${result.id}`)
            assert.equal(resultWakes.length, 1)
            assert.equal(resultWakes[0]!.action.kind, 'wake')
          }
          await writeFile(proofPath, JSON.stringify({ stage, scene, durable, before: durableProof(before),
            entries: args[1], journal: actualJournal, channels: actualChannels, modelCalls, inferenceCalls: requests.length }, null, 2) + '\n')
          process.send?.('durable')
          await new Promise<void>((done) => { process.once('message', () => { done() }) })
        }
        if (stage.endsWith('-before')) await hold()
        const receipt = await append(...args)
        if (stage.endsWith('-after')) await hold()
        return receipt
      }
      const requester = resolved.actors.find(value => value.role === 'member'
        && resolved.relations.some(relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'fault-original-goal', entityId: requester.entityId, time: '1',
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'fault-request/vendor/widget' })) }),
      run.snapshot().revision)
      await run.setPhase('running', run.snapshot().revision)
      await driver.advance()
      throw new Error(`Actual external ${stage} barrier was not reached: ${JSON.stringify(errors)}`)
    }
  } finally { await run.close() }
} finally { await ctx.fiber.dispose() }
