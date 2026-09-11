import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TaskAssignmentInvariant from '../src/invariant.ts'

describe('task-assignment channel invariant companion', () => {
  it('registers the package-owned explained empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TaskAssignmentInvariant)
    expect(() => ctx.invariants.register('@clocky/clocky-team-channel-task-assignment', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
