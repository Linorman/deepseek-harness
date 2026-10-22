/** Company/laboratory use the same registered external rule through real goals, private Channels and independent restored processes. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationInspectionSelectionSchema, simulationOperationIdSchema,
  simulationDispatchOutcomeSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalWorldExecution, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests as ruleRequests } from './world-external-model.ts'
import { requests as actorRequests } from './world-external-actor-model.ts'

const stage = process.env.WORLD_EXTERNAL_CRASH_STAGE!
const actor = stage.startsWith('actor-'), requests = actor ? actorRequests : ruleRequests
assert.ok(stage)
const pin = actor ? WORLD_EXTERNAL_ACTOR_PIN : WORLD_EXTERNAL_INTERACT_PIN
const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: actor ? 'world-external-actor-scripted' : 'world-external-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const scope = original.world.organizationEntityId, subject = 'external-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, pin],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: pin.version, scopeEntityId: scope, targetEntityId: subject,
    relationId: 'external-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready', profile: { name: 'Shared display name', description: 'A simulated external subject.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact', subjectKinds: ['person'],
    objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }, ...actor ? [{ relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] : []] },
  relations: [...original.relations, { kind: 'relation/create', id: 'external-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-crash', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-crash-${scene}-${stage}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('external-crash-initial'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'external-crash-prefix.json')
try {
  const inputPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'external-crash-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external-crash/${scene}/${stage}`, checkpoint: { id: simulationCheckpointIdSchema.parse('external-crash-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const execution = actor ? new ExternalActorWorldExecution(run, connection, resolved, anchor, new AbortController().signal)
    : new ExternalWorldExecution(run)
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, new AbortController().signal, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: new AbortController().signal,
    }, [execution]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  const requesterId = simulationEntityIdSchema.parse(requester.entityId)
  const normal = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  const stateProof = () => ({ world: run.snapshot().world, entities: run.snapshot().entities, relations: run.snapshot().relations,
    resources: run.snapshot().resources, grants: run.snapshot().grants, commitments: run.snapshot().commitments,
    interactions: run.snapshot().interactions, decisions: run.snapshot().decisions, operations: run.snapshot().operations,
    wakes: run.snapshot().wakes, scheduledEvents: run.snapshot().scheduledEvents, maintenance: run.snapshot().maintenance })
  const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
  const shape = z.object({ kind: z.string(), key: z.string().optional(),
    command: z.object({ kind: z.string(), id: z.string().optional() }).loose().optional(),
    change: z.object({ kind: z.string().optional(), entityId: z.string().optional(), action: z.object({ kind: z.string(),
      domain: z.string().optional() }).loose().optional(), externalEvaluation: z.unknown().optional(),
    id: z.string().optional(), outcome: z.object({ status: z.string().optional() }).loose().optional() }).loose().optional() }).loose()
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { state: ReturnType<typeof stateProof>; entries: unknown[] }
    const current = stateProof(), original = proof.state
    for (const field of ['world', 'relations', 'resources', 'grants', 'commitments', 'interactions', 'decisions',
      'wakes', 'scheduledEvents', 'maintenance'] as const) assert.deepEqual(normal(current[field]), original[field])
    assert.deepEqual(Object.keys(current.entities), Object.keys(original.entities))
    for (const entity of Object.values(current.entities)) {
      const previous = original.entities[entity.id]!
      assert.deepEqual(entity.binding, previous.binding)
      assert.deepEqual(entity.profile, previous.profile)
      assert.equal(entity.readiness, previous.readiness)
      assert.ok(entity.writer === undefined || entity.writer.phase === 'released')
    }
    const notification = stage.endsWith('notification-lost')
    const round = process.env.WORLD_CRASH_RESTORE_ROUND
    const reconciledPath = resolve(root, 'external-crash-reconciled.json')
    if (notification && round === '2') {
      const previous = JSON.parse(await readFile(reconciledPath, 'utf8')) as { operations: unknown }
      assert.deepEqual(normal(current.operations), previous.operations)
    } else assert.deepEqual(normal(current.operations), original.operations)
    if (notification) {
      const entry = proof.entries.map(value => shape.parse(value)).find(value => value.kind === 'run/outbox'
        && value.change?.kind === 'outbox/finished')!
      assert.ok(entry?.change)
      const operationId = simulationOperationIdSchema.parse(entry.change.id)
      const expected = simulationDispatchOutcomeSchema.parse(entry.change.outcome)
      assert.ok(expected.status === 'applied' && 'receipt' in expected)
      await run.setPhase('running', run.snapshot().revision)
      assert.equal((await connection.dispatchOperation(operationId, Date.now)).status, 'settled')
      assert.deepEqual(run.snapshot().operations[operationId]!.outbox!.receipt, expected.receipt)
      await run.setPhase('paused', run.snapshot().revision)
      await writeFile(reconciledPath, JSON.stringify({ operations: run.snapshot().operations }))
    }
    if (stage === 'rule-after') {
      const plan = Object.values(run.snapshot().world!.plans)[0]!, before = run.snapshot().revision
      await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
      assert.equal(run.snapshot().revision, before)
      assert.equal(Object.keys(run.snapshot().world!.external.interactions).length, 1)
    }
    const beforeReconciliation = stateProof()
    if (round === '2' && stage === 'rule-before') {
      const plan = Object.values(run.snapshot().world!.plans)[0]!
      await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
      assert.equal(Object.keys(run.snapshot().world!.external.interactions).length, 1)
      assert.deepEqual(run.snapshot().resources, original.resources)
      const revision = run.snapshot().revision
      await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
      assert.equal(run.snapshot().revision, revision)
    }
    const reservation = Object.values(run.snapshot().world!.external.representatives)[0]
    if (round === '2' && actor && reservation !== undefined) {
      if (reservation.status !== 'committed') await driver.reconcile()
      const completed = run.snapshot().world!.external.representatives[reservation.id]!
      assert.equal(completed.status, 'committed')
      assert.deepEqual(completed.identities, reservation.identities)
      assert.equal(run.snapshot().entities[completed.identities.entityId]!.readiness, 'ready')
      assert.deepEqual(run.snapshot().resources, original.resources)
      const revision = run.snapshot().revision
      await run.commitExternalRepresentative(completed.id)
      assert.equal(run.snapshot().revision, revision)
    }
    assert.equal(requests.length, 0)
    await writeFile(resolve(root, `external-crash-cold-${round}.json`), JSON.stringify({ stage,
      beforeReconciliation, state: stateProof(), modelCalls: requests.length, phase: run.snapshot().phase,
      identityAndDutiesRetained: true }))
    console.log(JSON.stringify({ stage, phase: run.snapshot().phase, modelCalls: requests.length,
      identityAndDutiesRetained: true }))
  } else {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget',
      quantity: '7', controllers: [] }), run.snapshot().revision)
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-money', owner: subject, kind: 'money', unit: 'widget',
      quantity: '999', controllers: [] }), run.snapshot().revision)
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
    const append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const entries = args[1].map(value => shape.parse(value))
      const reservation = Object.values(run.snapshot().world!.external.representatives)[0]
      const accepted = entries.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
        && value.change.action?.kind === 'world/request' && value.change.action.domain === 'external')
      const rule = entries.some(value => value.kind === 'run/world-mutation' && value.change?.externalEvaluation !== undefined)
      const representative = entries.some(value => value.kind === 'run/external-representative'
        && value.change?.kind === (stage.includes('reserve') ? 'external/reserved'
          : stage.includes('preparing') ? 'external/preparing' : 'external/committed'))
      const bound = entries.some(value => value.kind === 'run/writer' && value.change?.kind === 'entity/bound'
        && value.change.entityId === reservation?.identities.entityId)
      const channel = entries.some(value => value.kind === 'run/channel-confirmed'
        && reservation?.identities.channels.some(candidate => candidate.key === value.key))
      const notice = entries.some((value) => {
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.outcome?.status !== 'applied') return false
        const operation = run.snapshot().operations[simulationOperationIdSchema.parse(value.change.id)]
        if (operation?.action.kind !== 'communication/post') return false
        let text: unknown
        try { text = JSON.parse(operation.action.text) }
        catch { return false /* Other real messages carry no original World notification key. */ }
        return z.object(stage.includes('request-notification-lost') ? { requestId: z.string() } : { resultId: z.string() }).safeParse(text).success
      })
      const matches = stage.endsWith('request-accepted-after') && accepted
        || stage.startsWith('rule-') && rule
        || ['actor-reserve-before', 'actor-reserve-after', 'actor-preparing-after', 'actor-commit-before', 'actor-commit-after'].includes(stage)
          && representative
        || stage === 'actor-participant-unconfirmed' && bound || stage === 'actor-channel-unconfirmed' && channel
        || stage.endsWith('notification-lost') && notice
      const hold = async () => {
        const inspected = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
          spec: selection.spec, includeRecords: true }))
        assert.ok(inspected)
        await writeFile(proofPath, JSON.stringify({ stage, state: { ...stateProof(), world: inspected.snapshot.world,
          entities: inspected.snapshot.entities, relations: inspected.snapshot.relations, resources: inspected.snapshot.resources,
          grants: inspected.snapshot.grants, commitments: inspected.snapshot.commitments, interactions: inspected.snapshot.interactions,
          decisions: inspected.snapshot.decisions, operations: inspected.snapshot.operations, wakes: inspected.snapshot.wakes,
          scheduledEvents: inspected.snapshot.scheduledEvents, maintenance: inspected.snapshot.maintenance },
        entries: args[1], modelCalls: requests.length, actualTeam: await ctx.teams.getTeam({ teamId: team.teamId }) }))
        process.send?.({ event: 'external-durable', stage })
        await new Promise<void>((done) => { process.once('message', () => { done() }) })
      }
      if (matches && (stage.endsWith('-before') || stage.endsWith('notification-lost') || stage.includes('unconfirmed'))) await hold()
      const receipt = await append(...args)
      if (matches && stage.endsWith('-after')) await hold()
      return receipt
    }
    await run.setPhase('running', run.snapshot().revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'external-crash-goal', entityId: requesterId, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'first/vendor/widget' })) }), run.snapshot().revision)
    await driver.advance()
    throw new Error('Original external crash barrier was not reached')
  }
} finally { await run.close(); await ctx.fiber.dispose() }
