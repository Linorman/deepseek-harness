import AttachmentLocal from '@clocky/clocky-attachment-local'
import { createUserMessage } from '@clocky/clocky-llm'
/** Real Loader/owner branch isolation and archived causal-query coverage on both persistence media. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationRunSelectionSchema, simulationWorldFactRequestSchema, simulationKnowledgeRequestSchema, simTimeSchema, simulationEntityIdSchema, simulationDecisionIdSchema, simulationChannelKeySchema, simulationResourceSpecSchema, simulationResourceIdSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { createContext } from './harness.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { verifyWorldArchive } from '../src/archive.ts'
import { createWorldExperimentBranch, preflightWorldExperimentBranch, mergeWorldExperimentBranches, worldExperimentBranchSchema } from '../src/experiments.ts'
import { buildWorldCausalIndex, queryWorldCausalIndex, compareWorldExperiments } from '../src/experiment-query.ts'

const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

it.each(['json', 'sqlite'] as const)('creates isolated paused initial-world branches and bounded actual causal references (%s)', async (backend) => {
  const parent = resolve('.tmp/world-post-mvp/d2'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `${backend}-`))
  const previousRoot = process.env.SIMULATION_COMPANY_ROOT, previousBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = join(root, 'source'); process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('world-experiment', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: join(root, 'source'), loadedContext: { ctx, serviceFiber: ctx.fiber } })
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.createResource(simulationResourceSpecSchema.parse({ id: h.requester, owner: h.requester,
      controllers: [h.requester], kind: 'money', unit: 'credit', quantity: '3' }), h.run.snapshot().revision)
    const initialPerson = h.run.snapshot().entities[h.requester]!
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: h.requester, entityRevision: initialPerson.revision,
      profile: { ...initialPerson.profile, persona: { name: h.requester, skills: [], traits: [], goals: [] } } }),
    h.run.snapshot().revision)
    const parentActor = ctx.agents.get(h.run.snapshot().entities[h.requester]!.binding!.sessionId)!
    parentActor.session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: 'PRIVATE-ORIGINAL-SESSION-MEMORY' }] }), { surfaceOp: 'append' })
    parentActor.session.append('todo/write', { todos: [{ content: 'RUNTIME-INTERNAL-ONLY-CANARY', status: 'pending' }] })
    await ctx.sessions.flush(parentActor.session)
    await h.run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: h.requester, version: '1', subject: h.requester,
      scope: 'fee-org', effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' }, supersedes: null,
      schemaRef: 'clocky.world-fact/text/1', payload: { body: h.requester },
      sources: [{ kind: 'run-event', runId: h.selection.spec.runId, sequence: h.run.snapshot().world!.sequence }] }))
    const collection = await h.connection.collectCheckpointCandidate(8, 3)
    const body = await collection.exportArchive(limits); collection.release()
    const before = h.run.snapshot(), originalBytes = JSON.stringify(body)
    expect(originalBytes).toContain('RUNTIME-INTERNAL-ONLY-CANARY')
    const forgedBody = structuredClone(body)
    Object.assign(forgedBody.snapshot!, { resources: {} })
    const forgedId = randomUUID()
    await expect(createWorldExperimentBranch(ctx, forgedBody, worldExperimentBranchSchema.parse({ commandId: forgedId,
      memoryPolicy: 'public-facts', variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(forgedBody),
      selection: { ...h.selection, spec: { ...h.selection.spec, runId: `forged-${forgedId}` } } }), limits, () => {}))
      .rejects.toThrow(/owner-validated immutable Native prefix/)
    const branches = []
    for (const memoryPolicy of ['public-facts', 'authorized-memory'] as const) {
      const commandId = randomUUID()
      const selection = simulationRunSelectionSchema.parse({ ...h.selection,
        spec: { ...h.selection.spec, runId: `experiment-${commandId}` } })
      const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy, sourceHash: hash(body), selection,
        variables: { memoryPolicy } })
      await preflightWorldExperimentBranch(ctx, body, input, limits, () => {})
      expect(await ctx.simulations.inspect({ provider: selection.provider, spec: selection.spec })).toBeUndefined()
      let authorizations = 0
      await expect(createWorldExperimentBranch(ctx, body, input, limits, () => {
        if (++authorizations === 12) throw new Error('Injected exit after original identity allocation')
      })).rejects.toThrow(/Injected exit/)
      const branch = await createWorldExperimentBranch(ctx, body, input, limits, () => {})
      branches.push(branch)
      expect(branch.run.snapshot()).toMatchObject({ phase: 'paused', experiment: { sourceHash: hash(body), realEffects: false } })
      const target = branch.run.snapshot()
      expect(target.experiment!.version).toBe(2)
      expect(target.entities[simulationEntityIdSchema.parse(branch.lineage[h.requester])]!.profile)
        .toMatchObject({ name: h.requester, persona: { name: h.requester } })
      const independentResource = target.resources[simulationResourceIdSchema.parse(h.requester)]!
      expect(independentResource.id).toBe(h.requester)
      expect(independentResource.owner).toBe(branch.lineage[h.requester])
      expect(independentResource.controllers).toEqual([branch.lineage[h.requester]])
      const textFact = Object.values(target.world!.facts).flat().find(fact => String(fact.factId) === String(h.requester))!
      expect(textFact).toMatchObject({ factId: h.requester, payload: { body: h.requester }, subject: branch.lineage[h.requester] })
      expect(target.teamReservation!.teamId).not.toBe(before.teamReservation!.teamId)
      for (const entity of Object.values(before.entities).filter(entity => entity.binding !== undefined)) {
        const fresh = target.entities[branch.lineage[entity.id] as keyof typeof target.entities]!
        expect(fresh.binding!.sessionId).not.toBe(entity.binding!.sessionId)
        expect(fresh.binding!.participantId).not.toBe(entity.binding!.participantId)
        const session = await ctx.sessionPersistence.readFrom(fresh.binding!.sessionId, 0)
        expect(JSON.stringify(session.events)).toContain('experiment/initial-memory')
        expect(JSON.stringify(session.events)).toContain(memoryPolicy)
      }
      await branch.run.setPhase('running', branch.run.snapshot().revision)
      const firstActor = simulationEntityIdSchema.parse(branch.lineage[h.requester])
      expect(await branch.connection.ensureResident(firstActor, { activation: { provider: 'in-process', seed: { kind: 'resume' },
        agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [] }))
        .toMatchObject({ status: 'resident' })
      expect(branch.run.snapshot().entities[firstActor]!.writer!.activationId)
        .not.toBe(before.entities[h.requester]!.writer!.activationId)
      expect(branch.run.snapshot().entities[firstActor]!.writer!.coordinatorId)
        .not.toBe(before.entities[h.requester]!.writer!.coordinatorId)
      const priorCalls = h.requests.length
      await expect(branch.connection.executeDecision(firstActor, simulationDecisionIdSchema.parse(`memory-probe/${commandId}`),
        contextRequest())).rejects.toThrow(/without submitting|inference/)
      expect(h.requests).toHaveLength(priorCalls + 1)
      expect(JSON.stringify(h.requests.at(-1)!.messages)).toContain('experiment/initial-memory')
      expect(JSON.stringify(h.requests.at(-1)!.messages)).toContain(memoryPolicy)
      expect(JSON.stringify(h.requests.at(-1))).not.toContain('RUNTIME-INTERNAL-ONLY-CANARY')
      if (memoryPolicy === 'authorized-memory')
        expect(JSON.stringify(h.requests.at(-1)!.messages)).toContain('PRIVATE-ORIGINAL-SESSION-MEMORY')
      else expect(JSON.stringify(h.requests.at(-1)!.messages)).not.toContain('PRIVATE-ORIGINAL-SESSION-MEMORY')
      await expect(branch.run.bindEntity(firstActor, before.entities[h.requester]!.binding!, branch.run.snapshot().revision))
        .rejects.toThrow()
      await expect(branch.connection.ensureChannel({ key: simulationChannelKeySchema.parse('forged-parent-peer'),
        members: [{ entityId: firstActor, role: 'member' }, { entityId: h.director, role: 'director' }], limits: {} })).rejects.toThrow()
      await branch.run.setPhase('paused', branch.run.snapshot().revision)
      await expect(branch.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'foreign-write',
        subject: h.requester, relation: 'assignment', object: 'fee-role', scope: 'fee-org', validFrom: '0', validUntil: null }),
      branch.run.snapshot().revision)).rejects.toThrow()
      const captured = await branch.connection.collectCheckpointCandidate(8, 3)
      const archive = await captured.exportArchive(limits); captured.release()
      const legacyPrefix = structuredClone(archive.native)
      const legacyInit = legacyPrefix.entries.find(entry => (entry.value as { kind?: string }).kind === 'run/branch-init')!
      Object.assign((legacyInit.value as { request: object }).request, { version: 1 })
      await expect(Promise.resolve().then(() => ctx.simulations.validateArchivePrefix(selection.provider,
        { version: legacyPrefix.version, spec: selection.spec, entries: legacyPrefix.entries }))).rejects.toThrow()
      expect((archive.native.entries[1]!.value as { request: { version: number } }).request.version).toBe(2)
      expect(archive.provenance).toHaveLength(1)
      expect(archive.provenance![0]).toEqual(body)
      const count = (value: typeof body) => value.native.entries.length + value.owners.reduce((sum, owner) => sum + owner.entries.length, 0)
        + value.sessions.reduce((sum, session) => sum + session.events.length, 0)
      expect(() => verifyWorldArchive(JSON.stringify(archive), { ...limits,
        maxEntries: count(archive) + count(body) - 1 })).toThrow(/entry bounds/)
      const missingProvenance = structuredClone(archive); delete missingProvenance.provenance
      expect(() => verifyWorldArchive(JSON.stringify(missingProvenance), limits)).toThrow(/provenance/)
      const corruptProvenance = structuredClone(archive)
      Object.assign(corruptProvenance.provenance![0]!, { snapshot: { ...before, revision: before.revision + 1 } })
      expect(() => verifyWorldArchive(JSON.stringify(corruptProvenance), limits)).toThrow()
      await branch.connection.close(); await branch.run.close()
      branches[branches.length - 1] = { ...branch, archive }
      const retry = await createWorldExperimentBranch(ctx, body, input, limits, () => {})
      expect(retry.run.snapshot().teamReservation!.teamId).toBe(target.teamReservation!.teamId)
      for (const entity of Object.values(target.entities).filter(entity => entity.binding !== undefined))
        expect(retry.run.snapshot().entities[entity.id]!.binding).toEqual(entity.binding)
      await retry.connection.close(); await retry.run.close()
      const reopened = await ctx.simulations.open({ ...selection, mode: 'open' })
      expect(reopened.snapshot().experiment).toEqual(target.experiment)
      await reopened.close()
    }
    expect(h.run.snapshot()).toEqual(before)
    expect(JSON.stringify(body)).toBe(originalBytes)
    const left = (branches[0] as typeof branches[number] & { archive: typeof body }).archive
    const right = (branches[1] as typeof branches[number] & { archive: typeof body }).archive
    const comparison = compareWorldExperiments(left, right, limits, () => {})
    expect(comparison).toMatchObject({ causalConclusion: 'not-established', quality: { status: 'unknown' }, cost: { status: 'unknown' } })
    expect(comparison.differences.find(section => section.category === 'resources')!.equal).toBe(true)
    expect(() => mergeWorldExperimentBranches()).toThrow(/unsupported/)
    expect(() => compareWorldExperiments(body, right, limits, () => {})).toThrow(/same recorded parent cut/)
    expect(() => compareWorldExperiments(left, right, limits, () => { throw new Error('revoked') })).toThrow(/revoked/)
    // A runtime fact and private belief make this a genuine dynamic cut, beyond the original scenario genesis.
    await h.start()
    await h.run.drive({ until: simTimeSchema.parse('5') })
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'runtime-fact', version: '1', subject: h.requester,
      scope: 'fee-org', effectiveFrom: '5', effectiveUntil: null, availableAt: '5', audience: { kind: 'public' },
      supersedes: null, schemaRef: 'clocky.world-fact/text/1', payload: { body: 'Recorded runtime observation' },
      sources: [{ kind: 'run-event', runId: h.selection.spec.runId, sequence: before.world!.sequence }] }))
    await h.run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'runtime-belief', owner: h.requester, expectedRevision: 0,
      statement: 'PRIVATE-BRANCH-BELIEF', source: { kind: 'belief', profileRevision: before.entities[h.requester]!.profileRevision,
        policyVersion: '1' }, observedAt: '5', availableAt: '5', validFrom: '5', validUntil: null, readers: [h.requester] }))
    const dynamicCollection = await h.connection.collectCheckpointCandidate(8, 3)
    const dynamic = await dynamicCollection.exportArchive(limits); dynamicCollection.release()
    const dynamicId = randomUUID()
    const dynamicInput = worldExperimentBranchSchema.parse({ commandId: dynamicId, memoryPolicy: 'authorized-memory',
      variables: { memoryPolicy: 'authorized-memory' }, sourceHash: hash(dynamic), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: `dynamic-${dynamicId}` } } })
    const dynamicBranch = await createWorldExperimentBranch(ctx, dynamic, dynamicInput, limits, () => {})
    expect(dynamicBranch.run.snapshot().experiment!.seedPolicy).toBe('settled-world-cut')
    expect(dynamicBranch.run.snapshot().time).toBe('5')
    const seededFact = Object.values(dynamicBranch.run.snapshot().world!.facts)[0]![0]!
    expect(seededFact.source.references).toEqual([{ kind: 'run-event', runId: dynamicInput.selection.spec.runId, sequence: 1 }])
    expect(JSON.stringify(dynamicBranch.run.snapshot().knowledge)).toContain('PRIVATE-BRANCH-BELIEF')
    expect(Object.keys(dynamicBranch.run.snapshot().decisions)).toHaveLength(0)
    expect(Object.keys(dynamicBranch.run.snapshot().operations)).toHaveLength(0)
    // The branch is writable through its own ordinary Native business authority.
    await dynamicBranch.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'branch-only-object',
      entityKind: 'object', cognition: 'none', readiness: 'ready', profile: {} }), dynamicBranch.run.snapshot().revision)
    expect(h.run.snapshot().entities).not.toHaveProperty('branch-only-object')
    await dynamicBranch.connection.close(); await dynamicBranch.run.close()
    const publicId = randomUUID()
    const publicInput = worldExperimentBranchSchema.parse({ ...dynamicInput, commandId: publicId, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, selection: { ...dynamicInput.selection,
        spec: { ...dynamicInput.selection.spec, runId: `dynamic-public-${publicId}` } } })
    const publicBranch = await createWorldExperimentBranch(ctx, dynamic, publicInput, limits, () => {})
    expect(JSON.stringify(publicBranch.run.snapshot().knowledge ?? {})).not.toContain('PRIVATE-BRANCH-BELIEF')
    const publicBindings = Object.values(publicBranch.run.snapshot().entities).flatMap(entity => entity.binding ?? [])
    for (const binding of publicBindings) {
      const stored = await ctx.sessionPersistence.readFrom(binding.sessionId, 0)
      expect(JSON.stringify(stored.events)).not.toContain('PRIVATE-BRANCH-BELIEF')
    }
    await publicBranch.connection.close(); await publicBranch.run.close()
    await h.start()
    for (const actor of [h.requester, h.director]) await h.connection.ensureResident(actor, { activation: { provider: 'in-process',
      seed: { kind: 'resume' }, agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } },
      signal: h.lifetime.signal }, evict: [] })
    await h.plan()
    const history = await h.connection.collectCheckpointCandidate(8, 3)
    const current = await history.exportArchive(limits); history.release()
    const index = buildWorldCausalIndex(current, limits)
    expect(buildWorldCausalIndex(current, limits)).toEqual(index)
    const forged = structuredClone(current)
    Object.assign(forged.snapshot!, { decisions: {}, operations: { forged: { id: 'FAKE', decisionId: 'FAKE', result: { sequence: 0 } } } })
    expect(buildWorldCausalIndex(forged, limits)).toEqual(index)
    const operation = index.nodes.find(node => node.kind === 'operation')!
    expect(operation).toBeDefined()
    for (const plan of Object.values(h.run.snapshot().world!.plans))
      expect(index.nodes.some(node => node.key === `plan:${plan.id}` && node.sequence === plan.sequence)).toBe(true)
    const query = { root: operation.key, maxDepth: 3, maxNodes: 100, maxBytes: 65536 }
    expect(queryWorldCausalIndex(current, query, limits, () => true).edges.length).toBeGreaterThan(0)
    const denied = queryWorldCausalIndex(current, query, limits, () => false)
    expect(denied).toEqual(queryWorldCausalIndex(current, { ...query, root: 'missing' }, limits, () => false))
    expect(queryWorldCausalIndex(current, { ...query, maxDepth: 0 }, limits, () => true).nodes).toHaveLength(1)
    expect(queryWorldCausalIndex(current, { ...query, maxNodes: 1 }, limits, () => true).nodes).toHaveLength(1)
    expect(() => queryWorldCausalIndex(current, { ...query, maxBytes: 1 }, limits, () => true)).toThrow(/byte bound/)
    expect(() => queryWorldCausalIndex(current, { ...query, maxDepth: 33 }, limits, () => true)).toThrow()
    const pendingInput = worldExperimentBranchSchema.parse({ commandId: randomUUID(), memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(current), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: 'reject-runtime-history' } } })
    await expect(preflightWorldExperimentBranch(ctx, current, pendingInput, limits, () => {}))
      .rejects.toThrow(/unresolved effects|pending simulated/)
    expect(await ctx.simulations.inspect({ provider: pendingInput.selection.provider, spec: pendingInput.selection.spec })).toBeUndefined()
    await expect(createWorldExperimentBranch(ctx, current, pendingInput, limits, () => {}))
      .rejects.toThrow(/unresolved effects|pending simulated/)
    const oldCutId = randomUUID()
    const oldCutBranch = await createWorldExperimentBranch(ctx, body, worldExperimentBranchSchema.parse({
      commandId: oldCutId, memoryPolicy: 'public-facts', variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(body),
      selection: { ...h.selection, spec: { ...h.selection.spec, runId: `old-cut-${oldCutId}` } } }), limits, () => {})
    expect(oldCutBranch.run.snapshot().time).toBe('0')
    await oldCutBranch.connection.close(); await oldCutBranch.run.close()
    const offline = await createContext(join(root, 'new-host-empty-storage'), backend)
    await offline.ctx.plugin(Direct)
    try {
      expect(await offline.ctx.simulations.inspect({ provider: h.selection.provider, spec: h.selection.spec })).toBeUndefined()
      const offlineId = randomUUID()
      const offlineBranch = await createWorldExperimentBranch(offline.ctx, body, worldExperimentBranchSchema.parse({
        commandId: offlineId, memoryPolicy: 'authorized-memory', variables: { memoryPolicy: 'authorized-memory' }, sourceHash: hash(body),
        selection: { ...h.selection, spec: { ...h.selection.spec, runId: `offline-cut-${offlineId}` } } }), limits, () => {})
      expect(offlineBranch.run.snapshot().phase).toBe('paused')
      expect(offlineBranch.run.snapshot().teamReservation!.teamId).not.toBe(before.teamReservation!.teamId)
      await offlineBranch.connection.close(); await offlineBranch.run.close()
    } finally { await offline.ctx.fiber.dispose() }
    const fence = h.run.bindFederationTime('branch-refusal-probe', () => ({ ownerId: 'branch-refusal-probe',
      runId: h.selection.spec.runId, generation: 0, sourceSequence: 0, limit: h.run.snapshot().time,
      blockedPeers: [], sourceHash: '0'.repeat(64) }))
    await fence.sync()
    const federatedCut = await h.connection.collectCheckpointCandidate(8, 3)
    const federated = await federatedCut.exportArchive(limits); federatedCut.release()
    const federatedId = randomUUID()
    await expect(preflightWorldExperimentBranch(ctx, federated, worldExperimentBranchSchema.parse({ commandId: federatedId,
      memoryPolicy: 'public-facts', variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(federated),
      selection: { ...h.selection, spec: { ...h.selection.spec, runId: `federated-${federatedId}` } } }), limits, () => {}))
      .rejects.toThrow(/Federated branch sources/)
    fence.dispose()
    expect(h.requests).toHaveLength(2)
  } finally {
    await h.close()
    if (previousRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = previousRoot
    if (previousBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = previousBackend
  }
})

it.each(['json', 'sqlite'] as const)('rejects inherited media before creating a %s branch while public-facts can omit it', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-post-mvp/d2/media' })
  try {
    await h.ctx.plugin(AttachmentLocal, { clockyHome: join(h.root, 'attachments') })
    const image = await h.ctx.attachments.saveImage({ mediaType: 'image/png',
      data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64') })
    const binding = h.run.snapshot().entities[h.requester]!.binding!
    const actor = h.ctx.agents.get(binding.sessionId)!
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'image', attachment: image }] }), { surfaceOp: 'append' })
    await h.ctx.sessions.flush(actor.session)
    const cut = await h.connection.collectCheckpointCandidate(8, 3)
    const body = await cut.exportArchive(limits); cut.release()
    const commandId = randomUUID()
    const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy: 'authorized-memory',
      variables: { memoryPolicy: 'authorized-memory' }, sourceHash: hash(body), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: `media-${commandId}` } } })
    await expect(preflightWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/textual/)
    expect(await h.ctx.simulations.inspect({ provider: input.selection.provider, spec: input.selection.spec })).toBeUndefined()
    const publicInput = worldExperimentBranchSchema.parse({ ...input, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' } })
    await preflightWorldExperimentBranch(h.ctx, body, publicInput, limits, () => {})
    const branch = await createWorldExperimentBranch(h.ctx, body, publicInput, limits, () => {})
    try {
      for (const entity of Object.values(branch.run.snapshot().entities)) {
        if (entity.binding === undefined) continue
        const stored = await h.ctx.sessionPersistence.readFrom(entity.binding.sessionId, 0)
        expect(JSON.stringify(stored.events)).not.toContain(image.attachmentId)
      }
    } finally { await branch.connection.close(); await branch.run.close() }
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('refuses a %s declared Entity reference with no source owner before initialization', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-post-mvp/d2/unknown-owner',
    extraEntities: [{ id: 'orphan-person-state', entityKind: 'person-state' }] })
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: 'orphan-person-state', entityRevision: 1,
      profile: { evolution: { personId: 'missing-person', audience: [h.requester], period: 1, versions: [] } } }), h.run.snapshot().revision)
    const cut = await h.connection.collectCheckpointCandidate(8, 3)
    const body = await cut.exportArchive(limits); cut.release()
    const commandId = randomUUID()
    const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(body), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: `missing-owner-${commandId}` } } })
    await expect(preflightWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/no declared source owner/)
    expect(await h.ctx.simulations.inspect({ provider: input.selection.provider, spec: input.selection.spec })).toBeUndefined()
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('rejects colliding long and digest-shaped Entity identities before target allocation (%s)', async (backend) => {
  const longId = 'source-object-'.repeat(8), shortId = hash(longId).slice(0, 48)
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-de-review/identity',
    extraEntities: [{ id: longId, entityKind: 'object' }, { id: shortId, entityKind: 'object' }] })
  try {
    const cut = await h.connection.collectCheckpointCandidate(8, 3)
    const body = await cut.exportArchive(limits); cut.release()
    const commandId = randomUUID()
    const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(body), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: `identity-${commandId}` } } })
    await expect(preflightWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/identities collide/)
    await expect(createWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/identities collide/)
    expect(await h.ctx.simulations.inspect({ provider: input.selection.provider, spec: input.selection.spec })).toBeUndefined()
  } finally { await h.close() }
})


it.each(['json', 'sqlite'] as const)('retries a branch after inherited Session append fails before persistence and loses its committed reply (%s)', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.tmp/world-de-review/session-retry' })
  try {
    const cut = await h.connection.collectCheckpointCandidate(8, 3)
    const body = await cut.exportArchive(limits); cut.release()
    const commandId = randomUUID()
    const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, sourceHash: hash(body), selection: { ...h.selection,
        spec: { ...h.selection.spec, runId: `session-retry-${commandId}` } } })
    const append = vi.spyOn(h.ctx.sessionPersistence, 'append').mockRejectedValueOnce(new Error('Injected pre-write failure'))
    await expect(createWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/Injected pre-write failure/)
    append.mockRestore()
    const originalAppend = h.ctx.sessionPersistence.append.bind(h.ctx.sessionPersistence)
    const lostReply = vi.spyOn(h.ctx.sessionPersistence, 'append').mockImplementationOnce(async (id, events) => {
      await originalAppend(id, events)
      throw new Error('Injected committed reply loss')
    })
    await expect(createWorldExperimentBranch(h.ctx, body, input, limits, () => {})).rejects.toThrow(/Injected committed reply loss/)
    lostReply.mockRestore()
    const branch = await createWorldExperimentBranch(h.ctx, body, input, limits, () => {})
    try {
      for (const entity of Object.values(branch.run.snapshot().entities)) {
        if (entity.binding === undefined) continue
        const stored = await h.ctx.sessionPersistence.readFrom(entity.binding.sessionId, 0)
        expect(stored.events.filter(event => event.type === 'user/message')).toHaveLength(1)
      }
    } finally { await branch.connection.close(); await branch.run.close() }
  } finally { await h.close() }
})
