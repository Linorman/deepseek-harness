import { expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import SystemPrompt from '@clocky/clocky-system-prompt'
import ToolRuntime, { defineTool, type ToolRunContext } from '@clocky/clocky-tools'
import { createScope, scopeTarget } from '@clocky/clocky-scope'
import * as simulationTools from '../src/index.ts'
import * as role from '../src/role.ts'

/** A lifecycle subject needs only its scoped context in these registry tests. */
function join(ctx: Context, parent: object) {
  const agent = {} as NonNullable<ToolRunContext['agent']>
  const scoped = createScope(ctx, agent, { parent })
  Object.assign(agent, { ctx: scoped.ctx })
  ctx.emit(scopeTarget(agent, agent), 'agent/created', { agent })
  return agent
}

it('masks existing and later global tools only for the role and removes its scoped restrictions on unload', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'both' })
    simulationTools.apply(ctx)
    const register = (name: string) => ctx.tools.register(defineTool({ name, description: 'Other role capability', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => true }))
    register('private_probe')
    const key = {}
    const fiber = ctx.plugin(Object.assign((child: Context) => { role.apply(createScope(child, key).ctx) }, { inject: ['tools', 'systemPrompt'] }))
    await fiber
    const actor = join(fiber.ctx, key)
    register('later_probe')
    expect(ctx.tools.schemas(actor).map(tool => tool.name).sort()).toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual(['later_probe', 'private_probe', 'run_code', 'simulation_observe', 'simulation_stage', 'simulation_submit'])
    expect(ctx.tools.get('private_probe', actor)).toBeUndefined()
    await fiber.dispose()
    expect(ctx.tools.schemas(key).map(tool => tool.name).sort()).toEqual(['later_probe', 'private_probe', 'run_code', 'simulation_observe', 'simulation_stage', 'simulation_submit'])
  } finally { await ctx.fiber.dispose() }
})

it('rejects a plain-context mount before masking tools for unrelated agents', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() => { role.apply(ctx) }).toThrow(/scoped context/)
    expect(ctx.tools.schemas()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('installs native capabilities inside the role even with no global Simulation definitions', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const key = {}
    const fiber = ctx.plugin(Object.assign((child: Context) => {
      role.apply(createScope(child, key).ctx)
    }, { inject: ['tools', 'systemPrompt'] }))
    await fiber
    const actor = join(fiber.ctx, key)
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.tools.schemas(actor).map(tool => tool.name).sort()).toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
  } finally { await ctx.fiber.dispose() }
})

it('filters later actor-owned tools from assembled requests without changing another scope or registry execution rules', async () => {
  const ctx = new Context()
  const key = {}
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    simulationTools.apply(ctx)
    const register = (target: Context, name: string) => target.tools.register(defineTool({ name, description: 'Actor-owned tool',
      parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => true }))
    const fiber = ctx.plugin(Object.assign((child: Context) => {
      const scoped = createScope(child, key).ctx
      role.apply(scoped)
    }, { inject: ['tools', 'systemPrompt'] }))
    await fiber
    const actor = join(fiber.ctx, key)
    register(actor.ctx, 'team_message')
    expect(ctx.tools.schemas(actor).map(tool => tool.name)).toContain('team_message')
    const filtered = await ctx.systemPrompt.assemble({ scope: actor })
    expect(filtered.tools.map(tool => tool.name).sort()).toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
    const other = await ctx.systemPrompt.assemble({ scope: {} })
    expect(other.tools.map(tool => tool.name)).not.toContain('team_message')
    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble({ scope: key })).tools.map(tool => tool.name).sort())
      .toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
  } finally { await ctx.fiber.dispose() }
})
