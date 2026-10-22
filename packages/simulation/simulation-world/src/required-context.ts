/** Required World context shared by runtime rendering and allocation-free capacity preflight.
 * @module @clocky/clocky-simulation-world/required-context
 */
import type { SimulationContextRequest } from '@clocky/clocky-simulation'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'

type Section = SimulationContextRequest['sections'][number]

/**
 * Render the fixed required identity, authority and commitment sections without a live owner.
 * @param input - Already-validated actor/organization profiles and current assignment positions.
 * @returns exact runtime blocks; input/goals, domain material, system prompt and tools remain additional context.
 */
export function requiredWorldContext(input: {
  readonly entityId: string
  readonly profile: unknown
  readonly organization: { readonly name?: unknown; readonly description?: unknown }
  readonly assignments: readonly { readonly positionId: string; readonly position: unknown }[]
}): Record<'identity' | 'authority' | 'commitments', Section> {
  const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
  return {
    identity: { kind: 'identity', required: true, blocks: text({ entityId: input.entityId, persona: input.profile,
      organization: { name: input.organization.name, description: input.organization.description } }) },
    authority: { kind: 'authority', required: true, blocks: text({ assignments: input.assignments }) },
    commitments: { kind: 'commitments', required: true, blocks: text({ instruction: 'Accepted effects remain pending until Native execution. '
      + 'A submitted plan is not employment; notify only recorded results.' }) },
  }
}

/**
 * Select the known required subset of each declared actor's initial context without creating a run.
 * @param resolved - Validated inert compilation whose symbolic identities and profiles are retained for initialization.
 * @returns each actor/runtime selection and exact known sections; later material and full envelopes are unknown.
 */
export function initialWorldContext(resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1): readonly {
  readonly entityId: string
  readonly runtime: { readonly id: string; readonly version: string }
  readonly sections: readonly Section[]
}[] {
  const entities = new Map(resolved.entities.map(entity => [entity.id, entity]))
  const organization = entities.get(resolved.world.organizationEntityId)
  if (organization === undefined) throw new Error('Initial World context lost its compiled organization')
  const at = BigInt(resolved.native.origin)
  return resolved.actors.map((actor) => {
    const entity = entities.get(actor.entityId)
    if (entity === undefined) throw new Error('Initial World context lost its compiled actor')
    const sections = requiredWorldContext({ entityId: actor.entityId, profile: entity.profile,
      organization: organization.profile,
      assignments: resolved.relations.filter(value => value.subject === actor.entityId && value.relation === 'assignment'
        && value.scope === organization.id && BigInt(value.validFrom) <= at
        && (value.validUntil === null || at < BigInt(value.validUntil)))
        .map(value => ({ positionId: value.object, position: entities.get(value.object)?.profile })) })
    return { entityId: actor.entityId, runtime: actor.runtime, sections: [sections.identity, sections.authority, sections.commitments] }
  })
}
