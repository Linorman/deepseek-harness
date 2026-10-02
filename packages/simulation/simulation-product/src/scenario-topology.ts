/** Trusted bounded topology extends the company foundation without adding actor grants or execution routes. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationChannelKeySchema, simulationChannelSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationEntityId, SimulationChannelKey, SimulationChannelSpec } from '@clocky/clocky-simulation'

const entityId = z.string().trim().min(1).max(128).pipe(simulationEntityIdSchema)
const channelKey = z.string().trim().min(1).max(128).pipe(simulationChannelKeySchema)
const actor = z.strictObject({ id: entityId, name: z.string().trim().min(1) })
const channel = z.strictObject({ key: channelKey,
  members: z.array(z.strictObject({ entityId, role: z.string().trim().min(1).max(128) })).min(2).max(32),
}).refine(value => new Set(value.members.map(member => member.entityId)).size === value.members.length,
  'Channel membership must contain distinct actors')

/** Complete prepared identities share one parser and include fixed foundation actors and channel. */
const completeTopologySchema = z.strictObject({ actors: z.array(actor).min(2).max(32), channels: z.array(channel).min(1).max(32) })
  .refine(value => new Set(value.actors.map(item => item.id)).size === value.actors.length
    && new Set(value.channels.map(item => item.key)).size === value.channels.length,
  'Prepared actor and channel identities must be unique')
  .refine(value => value.channels.every(item => item.members.every(member => value.actors.some(person => person.id === member.entityId))),
    'Every channel member must be a prepared actor')

/** Fixed company participants form the foundation for both procurement and installed report workflows. */
function foundation(buyerName: string, supplierName: string) {
  return { actors: [{ id: 'buyer', name: buyerName }, { id: 'supplier', name: supplierName }],
    channels: [{ key: 'purchase', members: [{ entityId: 'buyer', role: 'buyer' }, { entityId: 'supplier', role: 'supplier' }] }] }
}

/** Installed extra actors and channels inherit the sole trusted participant placement and empty channel limits. */
export const simulationScenarioTopologySchema = z.strictObject({
  actors: z.array(actor.extend({ name: z.string().trim().min(1).max(256) })).max(30), channels: z.array(channel).max(31),
})
  .refine((value) => {
    const base = foundation('Buyer', 'Supplier')
    return completeTopologySchema.safeParse({ actors: [...base.actors, ...value.actors],
      channels: [...base.channels, ...value.channels] }).success
  }, 'Installed topology repeats foundation identities or references an unprepared actor')
/** Private immutable deployment topology, never accepted in a public creation payload. */
export type SimulationScenarioTopology = z.infer<typeof simulationScenarioTopologySchema>

/**
 * Resolve one complete actor/channel topology for validation, preparation, capacity and authorized ingress.
 * @param settings - Public foundation names and retained trusted optional additions.
 * @returns bounded validated actors and native channels; every actor uses the same installed participant placement.
 */
export function resolveScenarioTopology(settings: {
  readonly buyerName: string
  readonly supplierName: string
  readonly topology?: SimulationScenarioTopology | undefined
}): { actors: readonly { id: SimulationEntityId; name: string }[]; channels: readonly SimulationChannelSpec[] } {
  const base = foundation(settings.buyerName, settings.supplierName)
  const resolved = completeTopologySchema.parse({ actors: [...base.actors, ...settings.topology?.actors ?? []],
    channels: [...base.channels, ...settings.topology?.channels ?? []] })
  return { actors: resolved.actors, channels: resolved.channels.map(value => simulationChannelSpecSchema.parse({ ...value, limits: {} })) }
}

/**
 * Validate a report's exact route against its installed channel and actor membership.
 * @param topology - Complete prepared topology.
 * @param step - Trusted source/executor/recipient and optional independent reviewer.
 * @returns whether all identities exist and the executor and recipient belong to the selected channel.
 */
export function preparedScenarioRoute(topology: ReturnType<typeof resolveScenarioTopology>, step: {
  readonly sourceEntityId: SimulationEntityId
  readonly entityId: SimulationEntityId
  readonly recipientEntityId: SimulationEntityId
  readonly reviewerEntityId?: SimulationEntityId | undefined
  readonly channelKey: SimulationChannelKey
}): boolean {
  const members = topology.channels.find(value => value.key === step.channelKey)?.members
  return [step.sourceEntityId, step.entityId, step.recipientEntityId, ...step.reviewerEntityId === undefined ? [] : [step.reviewerEntityId]]
    .every(id => topology.actors.some(value => value.id === id))
    && members?.some(value => value.entityId === step.entityId) === true
    && members.some(value => value.entityId === step.recipientEntityId)
}
