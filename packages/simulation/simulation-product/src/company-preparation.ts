/** Versioned company topology preparation; no actor activation, model request or world execution. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationChangeSchema, simulationEntityIdSchema, simulationResourceSpecSchema,
  simulationCheckpointIdSchema, simulationQuantitySchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationCheckpointOperation, SimulationEntityBinding, SimulationEntityId } from '@clocky/clocky-simulation'
import type { SimulationTeams } from '@clocky/clocky-simulation-team'
import type { TeamId, ChannelId } from '@clocky/clocky-team'
import { simulationScenarioTopologySchema, resolveScenarioTopology } from './scenario-topology.ts'

/** Trusted immutable scenario settings; paths, runtime code and credentials are absent. */
export const simulationCompanyPreparationSchema = z.strictObject({
  version: z.literal('1'), ownerName: z.string().trim().min(1), objective: z.string().trim().min(1),
  buyerName: z.string().trim().min(1), supplierName: z.string().trim().min(1),
  initialStock: simulationQuantitySchema,
  topology: simulationScenarioTopologySchema.optional(),
  participant: z.strictObject({ provider: z.literal('in-process'), preset: z.string().trim().min(1),
    model: z.string().trim().min(1) }),
  checkpoint: z.strictObject({ id: simulationCheckpointIdSchema, maxDrainRounds: z.number().int().positive(),
    maxAttempts: z.number().int().positive() }),
})
/** Caller retains these immutable settings with the creation intent before preparation. */
export type SimulationCompanyPreparation = z.infer<typeof simulationCompanyPreparationSchema>
/** Exact prepared owner identities and durable initial checkpoint; this is a private Host result. */
export interface SimulationCompanyPrepared {
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly buyer: SimulationEntityBinding
  readonly supplier: SimulationEntityBinding
  readonly checkpoint: Extract<SimulationCheckpointOperation, { status: 'completed' }>
}
const buyer = simulationEntityIdSchema.parse('buyer')
const supplier = simulationEntityIdSchema.parse('supplier')
const active = new WeakMap<SimulationRun, { settings: SimulationCompanyPreparation; work: Promise<SimulationCompanyPrepared> }>()

/**
 * Reconcile original company reservations, fill absent topology, then collect an initial complete checkpoint.
 * @param teams - Production canonical Team and checkpoint integration.
 * @param run - Caller-owned exclusive run, paused without scheduling, decisions or effects; drain preparation before closing it.
 * @param request - Trusted settings retained by the creation owner; equal concurrent preparation shares one operation.
 * @returns original Team, Participant, Session and Channel identities with a complete paused checkpoint; the temporary
 * connection is drained before settlement. Missing steps are completed without inference. Changed existing topology,
 * progressed history and failed checkpoint identities reject; failures retain committed records for explicit reconciliation.
 */
export function prepareSimulationCompany(teams: Pick<SimulationTeams, 'ensureTeam' | 'attach'>, run: SimulationRun,
  request: SimulationCompanyPreparation): Promise<SimulationCompanyPrepared> {
  const settings = simulationCompanyPreparationSchema.parse(request)
  const pending = active.get(run)
  if (pending !== undefined) {
    if (!isDeepStrictEqual(pending.settings, settings)) return Promise.reject(new Error('Company preparation has another immutable request in flight'))
    return pending.work
  }
  validate(run, settings)
  const work = Promise.resolve().then(() => prepare(teams, run, settings)).finally(() => { active.delete(run) })
  active.set(run, { settings, work })
  return work
}

/** Reject unrelated or progressed facts before reserving or appending any preparation step. */
function validate(run: SimulationRun, settings: SimulationCompanyPreparation): void {
  const state = run.snapshot()
  if (state.phase !== 'paused' || state.time !== '0' || state.nextEventSlot !== '0' || state.nextDecisionSlot !== '0'
    || state.activeWindowId !== undefined || Object.keys(state.decisions).length !== 0 || Object.keys(state.operations).length !== 0
    || Object.keys(state.ingresses ?? {}).length !== 0 || Object.keys(state.relations).length !== 0) {
    throw new Error('Company preparation requires unstarted paused history')
  }
  const topology = resolveScenarioTopology(settings)
  if (state.spec.maxEntities < topology.actors.length || BigInt(settings.initialStock) > BigInt(state.spec.maxResourceQuantity)) {
    throw new Error('Company initial topology exceeds run capacity')
  }
  const entities = new Map(topology.actors.map(value => [value.id, value.name]))
  for (const entity of Object.values(state.entities)) {
    const name = entities.get(entity.id)
    if (name === undefined || entity.kind !== 'person' || entity.cognition !== 'agent' || entity.phase !== 'active'
      || entity.readiness === 'abandoned' || entity.profileRevision !== 1 || !isDeepStrictEqual(entity.profile, { name }) || entity.writer !== undefined) {
      throw new Error('Company retained entity differs from immutable preparation')
    }
  }
  const resources = new Map(resourceSpecs(settings).map(value => [value.id, value]))
  for (const resource of Object.values(state.resources)) {
    const expected = resources.get(resource.id)
    const { revision, ...spec } = resource
    if (revision !== 1 || !isDeepStrictEqual(spec, expected)) throw new Error('Company retained resource differs from immutable preparation')
  }
  const channels = new Map(topology.channels.map(value => [value.key, value]))
  for (const reservation of Object.values(state.channelReservations ?? {})) {
    if (!isDeepStrictEqual(reservation.spec, channels.get(reservation.spec.key))) {
      throw new Error('Company retained channel differs from immutable preparation')
    }
  }
}

/** Initial balances are immutable bootstrap facts; preparation never resets a retained account. */
function resourceSpecs(settings: SimulationCompanyPreparation) {
  return [simulationResourceSpecSchema.parse({ id: 'stock', owner: supplier, quantity: settings.initialStock,
    kind: 'inventory', unit: 'item', controllers: [supplier] }),
  simulationResourceSpecSchema.parse({ id: 'received', owner: buyer, quantity: '0',
    kind: 'inventory', unit: 'item', controllers: [buyer] })]
}
/** Caller owns the run; this operation owns and drains only its temporary Team attachment. */
async function prepare(teams: Pick<SimulationTeams, 'ensureTeam' | 'attach'>, run: SimulationRun,
  settings: SimulationCompanyPreparation): Promise<SimulationCompanyPrepared> {
  validate(run, settings)
  const team = await teams.ensureTeam(run, { goal: { objective: settings.objective, budgets: {} }, budgets: {} }, settings.ownerName)
  const connection = await teams.attach(run, team.team.id, settings.ownerName)
  try {
    const topology = resolveScenarioTopology(settings)
    for (const { id, name } of topology.actors) {
      if (run.snapshot().entities[id] === undefined) {
        await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'preparing', id, entityKind: 'person', cognition: 'agent',
          profile: { name } }), run.snapshot().revision)
      }
    }
    const bind = (id: SimulationEntityId, name: string) =>
      connection.ensureParticipant(id, { ...settings.participant, displayName: name, role: id, capabilities: [] })
    const bindings = new Map<SimulationEntityId, SimulationEntityBinding>()
    for (const { id, name } of topology.actors) bindings.set(id, await bind(id, name))
    const channels = new Map<string, ChannelId>()
    for (const spec of topology.channels) channels.set(spec.key, (await connection.ensureChannel(spec)).manifest.id)
    const buyerBinding = bindings.get(buyer), supplierBinding = bindings.get(supplier), channelId = channels.get('purchase')
    if (buyerBinding === undefined || supplierBinding === undefined || channelId === undefined) {
      throw new Error('Prepared topology lost its company foundation')
    }
    for (const spec of resourceSpecs(settings)) {
      if (run.snapshot().resources[spec.id] === undefined) await run.createResource(spec, run.snapshot().revision)
    }
    for (const { id } of topology.actors) {
      const entity = run.snapshot().entities[id]
      if (entity === undefined) throw new Error('Prepared topology lost its actor')
      if (entity.readiness === 'preparing') {
        await run.change(simulationChangeSchema.parse({ kind: 'entity/readiness', id,
          entityRevision: entity.revision, readiness: 'ready' }), run.snapshot().revision)
      }
    }
    const checkpoint = await connection.checkpoint({ ...settings.checkpoint, implementationVersion: 'company/1' })
    if (checkpoint.status !== 'completed') throw new Error('Company initial checkpoint is incomplete')
    return { teamId: team.team.id, channelId, buyer: buyerBinding, supplier: supplierBinding, checkpoint }
  } finally { await connection.close() }
}
