import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as WorkflowInvariant from '../src/invariant.ts'

describe('workflow Team-channel invariant companion', () => {
  it('registers and disposes its package-owned companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(WorkflowInvariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-workflow', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-workflow', () => {})).not.toThrow()
    await ctx.fiber.dispose()
  })
})
