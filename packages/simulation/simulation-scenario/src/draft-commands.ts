/** Inert authoring commands share the deployment compiler; layout never enters the world definition. */
import { z } from 'zod'
import { worldScenarioV1Schema } from './v1-schema.ts'
import { compileWorldScenarioV1 } from './v1-compiler.ts'
import type { WorldScenarioV1, ScenarioV1Catalog, ScenarioV1Compilation } from './v1-types.ts'

const key = worldScenarioV1Schema.shape.metadata.shape.id
/** Closed graph/list commands; arbitrary paths and executable template content are not accepted. */
export const scenarioDraftCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unit/create'), id: key, name: z.string().min(1), description: z.string().min(1), parentId: key }),
  z.strictObject({ kind: z.literal('unit/move'), id: key, parentId: key }),
  z.strictObject({ kind: z.literal('position/create'), position: worldScenarioV1Schema.shape.organization.shape.positions.element }),
  z.strictObject({ kind: z.literal('position/move'), id: key, unitId: key }),
  z.strictObject({ kind: z.literal('position/capacity'), id: key, capacity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  z.strictObject({ kind: z.literal('assignment/create'), assignment: worldScenarioV1Schema.shape.organization.shape.assignments.element }),
])
/** One validated authoring operation, independent of pointer or keyboard input. */
export type ScenarioDraftCommand = z.infer<typeof scenarioDraftCommandSchema>

/**
 * Preview one command against the same compiler used by source imports and Host creation.
 * @param definition - Complete original draft; never mutated.
 * @param request - Closed command from graph or equivalent list controls.
 * @param catalog - Current installed dependency versions and limits.
 * @returns compiled next definition or located diagnostics; this allocates no runtime identity or model call.
 */
export async function applyScenarioDraftCommand(definition: WorldScenarioV1, request: ScenarioDraftCommand,
  catalog: ScenarioV1Catalog): Promise<ScenarioV1Compilation> {
  const staged = stageScenarioDraftCommand(definition, request)
  return staged.ok ? compileWorldScenarioV1(staged.definition, catalog) : staged
}

/** Stage an inert candidate for Host preflight. Never publish it as a valid revision before compilation succeeds.
 * @param definition - Original complete draft.
 * @param request - Closed edit operation.
 * @returns candidate definition or missing-object diagnostic; semantic authorization belongs to the compiler. */
export function stageScenarioDraftCommand(definition: WorldScenarioV1, request: ScenarioDraftCommand):
{ readonly ok: true; readonly definition: WorldScenarioV1 } | Extract<ScenarioV1Compilation, { readonly ok: false }> {
  const command = scenarioDraftCommandSchema.parse(request)
  const next = worldScenarioV1Schema.parse(definition)
  const missing = () => ({ ok: false as const, diagnostics: [{ source: 'scenario' as const, path: ['command', 'id'],
    code: 'unknown-reference' as const, message: 'The edited object is absent from this draft revision' }] })
  switch (command.kind) {
    case 'unit/create':
      next.entities.push({ id: command.id, name: command.name, description: command.description, kind: 'organization', cognition: 'none' })
      next.organization.units.push({ id: command.id, parentId: command.parentId }); break
    case 'unit/move': {
      const unit = next.organization.units.find(value => value.id === command.id)
      if (unit === undefined) return missing()
      unit.parentId = command.parentId; break
    }
    case 'position/create': next.organization.positions.push(command.position); break
    case 'position/move': {
      const position = next.organization.positions.find(value => value.id === command.id)
      if (position === undefined) return missing()
      position.unitId = command.unitId; break
    }
    case 'position/capacity': {
      const position = next.organization.positions.find(value => value.id === command.id)
      if (position === undefined) return missing()
      position.capacity = command.capacity; break
    }
    case 'assignment/create': next.organization.assignments.push(command.assignment); break
    default: return assertNever(command)
  }
  return { ok: true as const, definition: next }
}

function assertNever(value: never): never { throw new Error(`Unsupported draft command: ${String(value)}`) }
