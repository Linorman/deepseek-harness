/** Initial-world experiment branches use fresh owner commands; original archives remain immutable provenance. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import { Session } from '@clocky/clocky-session'
import type { SessionHeader, SessionEvent } from '@clocky/clocky-session'
import { createUserMessage } from '@clocky/clocky-llm'
import { simulationChangeSchema, simulationRunSelectionSchema, simulationResourceSpecSchema,
  simulationWorldDefinitionSchema, simulationWorldBootstrapRequestSchema, simulationChannelSpecSchema,
  simulationExperimentInitSchema, simulationEntityIdSchema, simulationWorldFactRequestSchema, simulationKnowledgeRequestSchema, personEvolutionStateSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from './types.ts'
import { verifyWorldArchive, retainWorldExperimentProvenance } from './archive.ts'
import type { WorldArchiveBody } from './archive.ts'
import type { LogArchiveLimits } from '@clocky/clocky-storage'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Strict original command. Variables describe the explicit intervention; execution settings are a separate validated selection. */
export const worldExperimentBranchSchema = z.strictObject({ commandId: z.uuid(),
  memoryPolicy: z.enum(['public-facts', 'authorized-memory']), variables: z.strictObject({ memoryPolicy: z.enum(['public-facts', 'authorized-memory']) }),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), selection: simulationRunSelectionSchema,
})
/** Complete branch result retains open owners; caller closes connection then run. */
export interface WorldExperimentBranch {
  readonly run: SimulationRun
  readonly connection: SimulationTeamConnection
  readonly lineage: Readonly<Record<string, string>>
}

/**
 * Create a paused simulation from an initial-world cut. Dynamic histories require an owner seed contract.
 * Every identity is allocated by the target run's normal Team/Participant/Channel owners. No source proof or receipt is rewritten.
 * @param ctx - Target configured Native, Team and Session owners.
 * @param body - Complete immutable protected source archive, authorized independently by the caller.
 * @param input - Original branch command, explicit memory policy and target selection.
 * @param limits - Complete source and inherited-input bounds.
 * @param authorize - Current whole-record ownership grant, rechecked around awaited IO.
 * @returns caller-owned paused branch, with new canonical identities and retained actual Session input.
 */
export async function createWorldExperimentBranch(ctx: Context, body: WorldArchiveBody,
  input: z.infer<typeof worldExperimentBranchSchema>, limits: LogArchiveLimits,
  authorize: () => void): Promise<WorldExperimentBranch> {
  const { request, source, seedPolicy } = validateBranchSource(ctx, body, input, limits, authorize)
  // Identifiers are derived from the original command so process retries retain all selected identities.
  const namespace = request.commandId
  const lineage = branchLineage(source, namespace)
  const remap = (value: unknown): unknown => remapBranchReferences(value, lineage)
  const selected = ctx.simulations.resolve(request.selection)
  const provenance = simulationExperimentInitSchema.parse({ version: 2, parentRunId: source.spec.runId,
    sourceHash: request.sourceHash, sourceRevision: source.revision, namespace, memoryPolicy: request.memoryPolicy,
    variables: request.variables, budget: { maxTokens: selected.spec.maxTokensPerInterval, maxTime: selected.spec.maxTime },
    realEffects: false, cutTime: source.time, seedPolicy })
  authorize()
  const observed = await ctx.simulations.inspect({ provider: selected.provider, spec: selected.spec })
  authorize()
  if (observed !== undefined && observed.snapshot.revision !== 0 && !isDeepStrictEqual(observed.snapshot.experiment, provenance))
    throw new Error('Branch target already exists with another original provenance')
  authorize()
  await retainWorldExperimentProvenance(ctx, namespace, body, limits)
  authorize()
  const run = await ctx.simulations.open({ ...selected, mode: observed === undefined ? 'create' : 'open' })
  let connection: SimulationTeamConnection | undefined
  try {
    authorize()
    await run.initializeBranch(provenance)
    authorize()
    const team = source.teamReservation
    if (team === undefined || !team.confirmed) throw new Error('Branch source has no confirmed Team')
    const { rules: _sourceRules, ...creation } = team.creation
    const ownerName = `simulation/experiment/${namespace}`
    const targetTeam = await ctx.simulationTeams.ensureTeam(run, creation, ownerName)
    authorize()
    connection = await ctx.simulationTeams.attach(run, targetTeam.team.id, ownerName)
    for (const entity of Object.values(source.entities)) {
      authorize()
      if (run.snapshot().entities[simulationEntityIdSchema.parse(lineage[entity.id])] === undefined) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: lineage[entity.id], entityKind: entity.kind,
        cognition: entity.cognition, readiness: seedPolicy === 'initial-world-cut' && source.worldBootstrap !== undefined && entity.cognition === 'agent' ? 'preparing' : entity.readiness, profile: remapBranchProfile(entity, lineage) }), run.snapshot().revision)
      if (entity.cognition === 'agent') {
        const participant = entity.participantReservation?.participant
        if (participant === undefined) throw new Error('Branch actor lacks original participant configuration')
        authorize()
        const binding = await connection.ensureParticipant(simulationEntityIdSchema.parse(lineage[entity.id]), participant)
        if (entity.binding !== undefined && (binding.teamId === entity.binding.teamId
          || binding.participantId === entity.binding.participantId || binding.sessionId === entity.binding.sessionId))
          throw new Error('Branch reused a source writable identity')
        const content = inheritedInput(body, source, entity.id, entity.binding?.sessionId, request)
        if (Buffer.byteLength(content) > selected.spec.maxKnowledgeBytes) throw new Error('Complete inherited Session input exceeds branch bounds')
        authorize()
        const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
        authorize()
        // A failed first append can leave only a lazy reservation in this process.
        // list() observes durable headers, whereas isUnmaterialized() also observes that reservation.
        const persisted = !unmaterialized && (await ctx.sessionPersistence.list()).some(header => header.id === binding.sessionId)
        authorize()
        if (persisted) {
          const stored = await ctx.sessionPersistence.readFrom(binding.sessionId, 0)
          authorize()
          const inherited = stored.events.filter(event => event.type === 'user/message').map((event) => {
            const message = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(event.data)
            return message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          })
          if (!inherited.includes(content)) throw new Error('Branch inherited Session differs from its retained original input')
          continue
        }
        authorize()
        const session = ctx.sessions.prepare(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId,
          agentPreset: participant.preset } })
        session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: content }] }), { surfaceOp: 'append' })
        if (unmaterialized) await ctx.sessionPersistence.create(session.header)
        authorize()
        await ctx.sessionPersistence.append(binding.sessionId, session.events)
      }
    }
    for (const relation of Object.values(source.relations)) {
      const { revision: _revision, ...fields } = relation
      authorize()
      if (Object.hasOwn(run.snapshot().relations, relation.id)) continue
      await run.change(simulationChangeSchema.parse({ kind: 'relation/create', ...remap(fields) as object,
        id: relation.id }), run.snapshot().revision)
    }
    for (const channel of Object.values(source.channelReservations ?? {})) {
      authorize()
      const created = await connection.ensureChannel(simulationChannelSpecSchema.parse(remap(channel.spec)))
      if (created.manifest.id === channel.channelId) throw new Error('Branch reused a source Channel identity')
    }
    authorize()
    if (source.worldBootstrap !== undefined && seedPolicy === 'initial-world-cut') {
      const bootstrap = structuredClone(source.worldBootstrap.request)
      if (request.memoryPolicy === 'public-facts') Object.assign(bootstrap.data, { knowledge: [], facts: bootstrap.data.facts.filter(fact => fact.audience.kind === 'public') })
      const mapped = simulationWorldBootstrapRequestSchema.parse(remap(bootstrap))
      mapped.data.committeePolicies = mapped.data.committeePolicies.map(policy => ({ ...policy,
        id: simulationEntityIdSchema.parse(branchEntityReference(policy.id, lineage)) }))
      const { definitionHash: _parentHash, ...seed } = mapped
      await run.initializeWorld(simulationWorldBootstrapRequestSchema.parse({ ...seed, definitionHash: `sha256:${hash(seed)}` }),
        run.snapshot().revision)
    } else {
      for (const resource of Object.values(source.resources)) {
        authorize()
        if (Object.hasOwn(run.snapshot().resources, resource.id)) continue
        await run.createResource(simulationResourceSpecSchema.parse(remap({ id: resource.id, owner: resource.owner, kind: resource.kind,
          unit: resource.unit, quantity: resource.quantity, controllers: resource.controllers })), run.snapshot().revision)
      }
      if (source.world !== undefined && run.snapshot().world === undefined)
        await run.configureWorld(simulationWorldDefinitionSchema.parse(remap(source.world.definition)), run.snapshot().revision)
    }
    if (seedPolicy === 'settled-world-cut') {
      const atCut = (time: string) => BigInt(time) < BigInt(source.time) ? source.time : time
      for (const history of Object.values(source.world?.facts ?? {})) {
        const fact = history.at(-1)
        if (fact === undefined || fact.effectiveUntil !== null && BigInt(fact.effectiveUntil) <= BigInt(source.time)) continue
        if (request.memoryPolicy === 'public-facts' && fact.audience.kind !== 'public') continue
        const { source: _source, sequence: _sequence, recordedAt: _clock, ...fields } = fact
        authorize()
        await run.recordWorldFact(simulationWorldFactRequestSchema.parse(remap({ ...fields, version: '1', supersedes: null,
          effectiveFrom: atCut(fact.effectiveFrom), availableAt: atCut(fact.availableAt),
          sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: 1 }] })))
      }
      if (request.memoryPolicy === 'authorized-memory') for (const history of Object.values(source.knowledge ?? {})) {
        const knowledge = history.at(-1)
        if (knowledge === undefined || knowledge.validUntil !== null && BigInt(knowledge.validUntil) <= BigInt(source.time)) continue
        authorize()
        await run.recordKnowledge(simulationKnowledgeRequestSchema.parse(remap({ id: knowledge.id, owner: knowledge.owner,
          expectedRevision: 0, statement: knowledge.statement,
          source: { kind: 'belief', profileRevision: 1, policyVersion: selected.spec.policyVersion },
          observedAt: source.time, availableAt: atCut(knowledge.availableAt), validFrom: atCut(knowledge.validFrom),
          validUntil: knowledge.validUntil, readers: knowledge.readers })))
      }
    }
    authorize()
    return { run, connection, lineage }
  } catch (error) {
    await connection?.close(); await run.close(); throw error
  }
}

function branchLineage(source: SimulationSnapshot, namespace: string): Record<string, string> {
  const lineage = Object.fromEntries(Object.keys(source.entities).map(id =>
    [id, `branch-${namespace}-${id.length > 70 ? hash(id).slice(0, 48) : id}`]))
  if (new Set(Object.values(lineage)).size !== Object.keys(lineage).length)
    throw new Error('Branch source Entity identities collide in the target namespace')
  return lineage
}

const entityReferenceFields = new Set(['owner', 'subject', 'object', 'scope', 'entityId', 'personId', 'personIds',
  'subjectId', 'scopeId', 'directorEntityId', 'organizationEntityId', 'requesterEntityId', 'scopeEntityId', 'targetEntityId',
  'positionEntityId', 'positionId', 'positionIds', 'committeeId', 'targetId', 'ownerId', 'actorIds', 'entityIds',
  'readers', 'controllers', 'actorDisclosure'])
function branchEntityReference(id: string, lineage: Readonly<Record<string, string>>): string {
  const mapped = Object.hasOwn(lineage, id) ? lineage[id] : undefined
  if (mapped === undefined) throw new Error('Branch Entity reference has no declared source owner')
  return mapped
}
/** This mapper is only for closed world/bootstrap/resource/relation/knowledge schemas, never opaque profiles or text. */
function remapBranchReferences(value: unknown, lineage: Readonly<Record<string, string>>, field = ''): unknown {
  if (typeof value === 'string') return entityReferenceFields.has(field) ? branchEntityReference(value, lineage) : value
  if (Array.isArray(value)) return value.map(child => remapBranchReferences(child, lineage, field))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, remapBranchReferences(child, lineage, key)]))
  return value
}
function remapBranchProfile(entity: SimulationSnapshot['entities'][keyof SimulationSnapshot['entities']],
  lineage: Readonly<Record<string, string>>): unknown {
  if (entity.kind !== 'person-state' || entity.profile.evolution === undefined) return entity.profile
  const evolution = personEvolutionStateSchema.parse(entity.profile.evolution)
  return { ...entity.profile, evolution: { ...evolution,
    personId: branchEntityReference(evolution.personId, lineage),
    audience: evolution.audience.map(id => branchEntityReference(id, lineage)) } }
}

function validateBranchSource(ctx: Context, body: WorldArchiveBody, input: z.infer<typeof worldExperimentBranchSchema>,
  limits: LogArchiveLimits, authorize: () => void) {
  const request = worldExperimentBranchSchema.parse(input)
  authorize()
  verifyWorldArchive(JSON.stringify(body), limits)
  if (hash(body) !== request.sourceHash) throw new Error('Branch source hash differs from the original cut')
  const source = body.snapshot as unknown as SimulationSnapshot
  let ancestor: WorldArchiveBody | undefined = body
  while (ancestor !== undefined) {
    if (z.object({ federationTime: z.unknown().optional() }).parse(ancestor.snapshot).federationTime !== undefined
      || ancestor.native.entries.some(entry => z.object({ kind: z.string() }).parse(entry.value).kind === 'run/federation-time'))
      throw new Error('Federated branch sources require an explicit complete federation seed protocol')
    ancestor = ancestor.provenance?.[0] === undefined ? undefined : verifyWorldArchive(JSON.stringify(ancestor.provenance[0]), limits)
  }
  const replayed = ctx.simulations.validateArchivePrefix(request.selection.provider,
    { version: body.native.version, spec: source.spec, entries: body.native.entries })
  if (!isDeepStrictEqual(replayed, source)) throw new Error('Branch snapshot differs from its owner-validated immutable Native prefix')
  if (request.selection.mode !== 'create' || request.selection.spec.runId === source.spec.runId)
    throw new Error('Branch requires a fresh target run namespace')
  if (request.variables.memoryPolicy !== request.memoryPolicy) throw new Error('Branch variable differs from the actual intervention')
  const { runId: _parentId, maxTokensPerInterval: _parentTokens, ...sourceSemantics } = source.spec
  const { runId: _targetId, maxTokensPerInterval: _targetTokens, ...targetSemantics } = request.selection.spec
  if (!isDeepStrictEqual(sourceSemantics, targetSemantics)) throw new Error('Branch cannot silently change source execution semantics')
  branchLineage(source, request.commandId)
  const seedPolicy = selectSeedPolicy(body)
  const lineage = Object.fromEntries(Object.keys(source.entities).map(id => [id, id]))
  for (const resource of Object.values(source.resources)) remapBranchReferences(resource, lineage)
  for (const relation of Object.values(source.relations)) remapBranchReferences(relation, lineage)
  if (source.world !== undefined) remapBranchReferences(source.world.definition, lineage)
  if (source.worldBootstrap !== undefined) {
    remapBranchReferences(source.worldBootstrap.request, lineage)
    for (const committee of source.worldBootstrap.request.data.committeePolicies) branchEntityReference(committee.id, lineage)
  }
  for (const entity of Object.values(source.entities)) remapBranchProfile(entity, lineage)
  for (const history of Object.values(source.world?.facts ?? {})) for (const fact of history) {
    remapBranchReferences({ subject: fact.subject, scope: fact.scope, audience: fact.audience }, lineage)
  }
  for (const history of Object.values(source.knowledge ?? {})) for (const knowledge of history)
    remapBranchReferences({ owner: knowledge.owner, readers: knowledge.readers }, lineage)
  if (BigInt(source.time) > BigInt(request.selection.spec.maxTime)) throw new Error('Branch horizon precedes its source cut time')
  for (const entity of Object.values(source.entities)) if (entity.cognition === 'agent') {
    if (entity.participantReservation?.participant === undefined) throw new Error('Branch actor lacks original participant configuration')
    const bytes = Buffer.byteLength(inheritedInput(body, source, entity.id, entity.binding?.sessionId, request))
    if (bytes > request.selection.spec.maxKnowledgeBytes)
      throw new Error('Complete inherited Session input exceeds branch bounds')
  }
  authorize()
  return { request, source, seedPolicy }
}

function inheritedInput(body: WorldArchiveBody, source: SimulationSnapshot, entityId: string, sessionId: string | undefined,
  request: z.infer<typeof worldExperimentBranchSchema>): string {
  const original = body.sessions.find(session => z.object({ id: z.string() }).parse(session.header).id === sessionId)
  const messages = request.memoryPolicy !== 'authorized-memory' || original === undefined ? []
    : Session.create((original.header as unknown as SessionHeader).id,
      original.events as unknown as SessionEvent[], original.header as unknown as SessionHeader).deriveMessages()
  if (request.memoryPolicy === 'authorized-memory') {
    const requireText = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(requireText); return }
      if (value === null || typeof value !== 'object') return
      const object = value as Record<string, unknown>
      if (object['attachment'] !== undefined || Array.isArray(object['artifacts']) && object['artifacts'].length !== 0
        || ['image', 'image_url', 'audio', 'video', 'file'].includes(String(object['type'])))
        throw new Error('Authorized branch memory supports textual Session history only; media needs an explicit inheritance owner')
      if (Array.isArray(object['content']) && object['content'].some((block: unknown) =>
        block !== null && typeof block === 'object' && 'type' in block && block.type !== 'text'))
        throw new Error('Authorized branch memory supports textual content blocks only')
      Object.values(object).forEach(requireText)
    }
    requireText(messages)
  }
  return JSON.stringify({ kind: 'experiment/initial-memory', version: 2,
    parentRunId: source.spec.runId, sourceHash: request.sourceHash, sourceRevision: source.revision,
    lineageKey: entityId, policy: request.memoryPolicy,
    inherited: messages })
}

/** Validate deterministic source, memory, namespace and installed reducer requirements before command acceptance.
 * @param ctx - Installed provider and read-only target inspection services.
 * @param body - Complete immutable original archive.
 * @param input - Exact original branch command.
 * @param limits - Complete source bounds.
 * @param authorize - Independent current whole-record grant.
 * @returns after validation without creating Native, Team, Session or provenance owners.
 */
export async function preflightWorldExperimentBranch(ctx: Context, body: WorldArchiveBody,
  input: z.infer<typeof worldExperimentBranchSchema>, limits: LogArchiveLimits, authorize: () => void): Promise<void> {
  const { request } = validateBranchSource(ctx, body, input, limits, authorize)
  const observed = await ctx.simulations.inspect({ provider: request.selection.provider, spec: request.selection.spec })
  authorize()
  if (observed !== undefined && observed.snapshot.revision !== 0
    && (observed.snapshot.experiment?.namespace !== request.commandId || observed.snapshot.experiment.sourceHash !== request.sourceHash))
    throw new Error('Branch target already exists with another original provenance')
}

function selectSeedPolicy(body: WorldArchiveBody): 'initial-world-cut' | 'settled-world-cut' {
  const state = body.snapshot as unknown as SimulationSnapshot
  const safeKinds = new Set(['run/created', 'run/change', 'run/team-reserved', 'run/team-confirmed',
    'run/writer', 'run/phase', 'run/participant-reserved', 'run/channel-reserved', 'run/channel-confirmed', 'run/world-bootstrap', 'run/checkpoint'])
  let initial = true
  for (const entry of body.native.entries) {
    const record = z.object({ kind: z.string(), change: z.unknown().optional(), phase: z.string().optional() }).parse(entry.value)
    if (safeKinds.has(record.kind)) continue
    if (record.kind === 'run/phase' && record.phase === 'paused') continue
    if (record.kind === 'run/writer' && z.object({ kind: z.literal('entity/bound') }).safeParse(record.change).success) continue
    if (record.kind === 'run/world' && z.object({ kind: z.literal('world/defined') }).safeParse(record.change).success) continue
    if (record.kind === 'run/business' && z.object({ kind: z.literal('resource/created') }).safeParse(record.change).success) continue
    initial = false
  }
  if (state.phase !== 'paused' || Object.values(state.entities).some(entity => entity.phase !== 'active'
    || entity.readiness !== 'ready' || entity.writer !== undefined && entity.writer.phase !== 'released'))
    throw new Error('Branch requires quiescent active actors without unresolved effects')
  if (initial && state.time === '0') return 'initial-world-cut'
  if (state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.operations).some(value => value.status !== 'applied' && value.status !== 'rejected')
    || Object.values(state.decisions).some(value => value.status === 'open' || value.status === 'submitted')
    || Object.values(state.scheduledEvents).some(value => value.status === 'pending')
    || Object.values(state.wakes).some(value => value.status === 'pending' || value.status === 'claimed')
    || Object.values(state.commitments).some(value => value.phase === 'open')
    || Object.values(state.interactions).some(value => value.execution !== 'completed' && value.execution !== 'cancelled')
    || Object.values(state.resourceReservations).some(value => value.phase === 'active')
    || Object.values(state.tokenReservations ?? {}).some(value => value.status === 'reserved' || value.status === 'unknown')
    || Object.values(state.generationJobs ?? {}).some(value => !['incorporated', 'rejected', 'cancelled'].includes(value.status))
    || Object.values(state.world?.requests ?? {}).some(value => !['committed', 'rejected', 'cancelled'].includes(value.status)))
    throw new Error('Branch cannot seed unresolved effects, accepted duties or pending simulated events')
  if (Object.keys(state.world?.norms.versions ?? {}).length || (state.worldBootstrap?.request.data.committeePolicies.length ?? 0) > 0
    || Object.keys(state.world?.external.identities ?? {}).length
    || Object.values(state.entities).some(value => value.profile.externalRepresentations !== undefined
      || value.kind === 'environment' && value.profile.environment !== undefined
      || value.kind === 'person-state' && value.profile.evolution !== undefined)
    || Object.values(state.world?.facts ?? {}).some(history => history.some(fact => fact.schemaRef !== 'clocky.world-fact/text/1')))
    throw new Error('Branch requires an explicit seed owner for institutions, external identities, environment/evolution or adjudicated facts')
  return 'settled-world-cut'

}

/** Automatic history merges have no supported owner protocol and always reject before IO.
 * @returns never; callers must review separate business commands.
 */
export function mergeWorldExperimentBranches(): never {
  throw new Error('Automatic branch merge is unsupported; review separate business commands instead')
}
