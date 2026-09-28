import { expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import SystemPrompt from '@clocky/clocky-system-prompt'
import ToolRuntime, { defineTool } from '@clocky/clocky-tools'
import { createScope } from '@clocky/clocky-scope'
import * as simulationTools from '../src/index.ts'
import * as role from '../src/role.ts'

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
    const fiber = ctx.plugin(Object.assign((child: Context) => { role.apply(createScope(child, key).ctx) }, { inject: ['tools'] }))
    await fiber
    register('later_probe')
    expect(ctx.tools.schemas(key).map(tool => tool.name).sort()).toEqual(['simulation_observe', 'simulation_stage', 'simulation_submit'])
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual(['later_probe', 'private_probe', 'run_code', 'simulation_observe', 'simulation_stage', 'simulation_submit'])
    expect(ctx.tools.get('private_probe', key)).toBeUndefined()
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

it('rejects a preset whose required global Simulation tools are missing', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Object.assign((child: Context) => {
      expect(() => { role.apply(createScope(child, {}).ctx) }).toThrow(/unknown global tool/)
    }, { inject: ['tools'] }))
  } finally { await ctx.fiber.dispose() }
})
