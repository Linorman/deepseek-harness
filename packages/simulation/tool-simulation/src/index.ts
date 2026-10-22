/** Prepared observations and deferred business proposals for Simulation actors. @module @clocky/clocky-tool-simulation */
import type { Context } from '@clocky/cordis'
import { isJsonValue } from '@clocky/clocky-session'
import { defineTool } from '@clocky/clocky-tools'
import type { ToolRunContext, JsonValue } from '@clocky/clocky-tools'
import { simulationProposalSchema } from '@clocky/clocky-simulation'
import { SIMULATION_MODEL_TOOLS } from '@clocky/clocky-simulation-team'
import { stageParameters } from './schema.ts'

/** Cordis plugin name. */
export const name = 'tool-simulation'
/** Model operations are authorized by the actual Simulation cognition owner. */
export const inject = ['tools', 'simulationTeams']
function jsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new Error('Simulation observation contains a non-JSON block')
  return value as JsonValue
}
function caller(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('Simulation tools require a current Agent decision')
  exec.signal.throwIfAborted()
  return exec.agent
}

/**
 * Register the closed observation/staging/submission tool set.
 * @param ctx - Tool registry and cognition admission owner.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({ name: SIMULATION_MODEL_TOOLS[0],
    description: 'Confirm the authorized decision context already present in your input. Bounded World runs return its reference without duplicating it. Use sections to read only named chapters. Use detail: full only when all chapters are required; this never queries newer or hidden state.',
    parameters: { sections: { type: 'array', items: { type: 'string' }, description: 'Distinct current chapter kinds, e.g. input or authority; cannot be combined with detail.' }, detail: { type: 'string', enum: ['full'], description: 'Return the complete frozen sections instead of a context receipt.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', const: 'observed', required: true }, time: { type: 'string', required: true },
      context: { type: 'object', additionalProperties: false, properties: {
        inputId: { type: 'string', required: true }, hash: { type: 'string', required: true },
      } },
      sections: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true }, blocks: { type: 'array', required: true, items: { type: 'json' } },
      } } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const result = await ctx.simulationTeams.modelRequest(caller(exec),
        { kind: 'observe', ...args.sections === undefined ? {} : { sections: args.sections }, ...args.detail === 'full' ? { detail: 'full' as const } : {} }, exec.signal)
      if (result.status !== 'observed') throw new Error('Simulation observation returned another operation result')
      return { ...result, sections: result.sections.map(section => ({ kind: section.kind, blocks: section.blocks.map(jsonValue) })) }
    }, presentCall: () => ({ card: 'generic', title: 'Observe simulation', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({ name: SIMULATION_MODEL_TOOLS[1],
    description: 'Replace your complete staged proposal list. No world effects occur until a submitted proposal is executed. Send an empty list to stage no actions. After a staged result, call simulation_submit when the list is final. Restaging an unchanged list does not submit it. A rejected replacement preserves your previous staged list. Correct the reported paths using the exact protocol in this decision; staging does not grant permission to execute.',
    parameters: stageParameters, output: { schema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', const: 'staged', required: true }, count: { type: 'integer', required: true },
      effects: { type: 'string', const: 'none', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const result = await ctx.simulationTeams.modelRequest(caller(exec),
        { kind: 'stage', proposals: args.proposals.map(value => simulationProposalSchema.parse(value)) }, exec.signal)
      if (result.status !== 'staged') throw new Error('Simulation staging returned another operation result')
      return result
    }, presentCall: args => ({ card: 'generic', title: 'Stage simulation proposals', kind: 'other', rawInput: args.proposals }),
  }))
  ctx.tools.register(defineTool({ name: SIMULATION_MODEL_TOOLS[2],
    description: 'Submit the complete staged proposal list and end this decision. A submitted window proposal awaits ordered acceptance; accepted proposals await execution. Results arrive in a later decision. For a result decision, notification: {resultId} submits the exact frozen notification without staging or rewriting its text.',
    parameters: { notification: { type: 'object', additionalProperties: false, properties: { resultId: { type: 'string', required: true } } } }, output: { schema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', enum: ['accepted', 'submitted'], required: true }, effects: { type: 'string', const: 'pending', required: true },
      operationIds: { type: 'array', required: true, items: { type: 'string' } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      const result = await ctx.simulationTeams.modelRequest(caller(exec), { kind: 'submit', ...args.notification === undefined ? {} : { notification: args.notification } }, exec.signal)
      if (result.status !== 'accepted' && result.status !== 'submitted') throw new Error('Simulation submission returned another operation result')
      exec.concludeTurn()
      return result
    }, presentCall: () => ({ card: 'generic', title: 'Submit simulation decision', kind: 'other' }),
  }))
}
