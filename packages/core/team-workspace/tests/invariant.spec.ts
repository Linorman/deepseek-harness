import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamWorkspaceInvariant from '../src/invariant.ts'

describe('Team workspace invariant companion', () => {
  it('registers and unregisters its explicit provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamWorkspaceInvariant)

    expect(TeamWorkspaceInvariant.name).toBe('team-workspace-invariant')
    expect(TeamWorkspaceInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamWorkspaceInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
