import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as SharedWorkspaceInvariant from '../src/invariant.ts'

describe('shared Team workspace invariant companion', () => {
  it('registers and releases its explained provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(SharedWorkspaceInvariant)

    expect(SharedWorkspaceInvariant.name).toBe('team-workspace-shared-invariant')
    expect(SharedWorkspaceInvariant.inject).toEqual(['invariants'])
    expect('default' in SharedWorkspaceInvariant).toBe(false)
    expect(() => ctx.invariants.register('@clocky/clocky-team-workspace-shared', () => {})).toThrow(/already registered/)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
