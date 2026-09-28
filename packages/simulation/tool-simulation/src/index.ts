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
    description: 'Read the authorized observations prepared for your current simulation decision. This does not query newer or hidden world state.',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', const: 'observed', required: true }, time: { type: 'string', required: true },
      sections: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true }, blocks: { type: 'array', required: true, items: { type: 'json' } },
      } } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (_args, exec) => {
      const result = await ctx.simulationTeams.modelRequest(caller(exec), { kind: 'observe' }, exec.signal)
      if (result.status !== 'observed') throw new Error('Simulation observation returned another operation result')
      return { ...result, sections: result.sections.map(section => ({ kind: section.kind, blocks: section.blocks.map(jsonValue) })) }
    }, presentCall: () => ({ card: 'generic', title: 'Observe simulation', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({ name: SIMULATION_MODEL_TOOLS[1],
    description: 'Replace your complete staged proposal list. No world effects occur until a submitted proposal is executed. Send an empty list to stage no actions.',
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
    description: 'Submit the complete staged proposal list and end this decision. A submitted window proposal awaits ordered acceptance; accepted proposals await execution. Results arrive in a later decision.',
    parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', enum: ['accepted', 'submitted'], required: true }, effects: { type: 'string', const: 'pending', required: true },
      operationIds: { type: 'array', required: true, items: { type: 'string' } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (_args, exec) => {
      const result = await ctx.simulationTeams.modelRequest(caller(exec), { kind: 'submit' }, exec.signal)
      if (result.status !== 'accepted' && result.status !== 'submitted') throw new Error('Simulation submission returned another operation result')
      exec.concludeTurn()
      return result
    }, presentCall: () => ({ card: 'generic', title: 'Submit simulation decision', kind: 'other' }),
  }))
}
