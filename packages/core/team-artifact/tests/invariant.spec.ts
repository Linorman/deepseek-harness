import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamArtifactInvariant from '../src/invariant.ts'

describe('Team artifact invariant companion', () => {
  it('registers and unregisters its provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamArtifactInvariant)

    expect(TeamArtifactInvariant.name).toBe('team-artifact-invariant')
    expect(TeamArtifactInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamArtifactInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
