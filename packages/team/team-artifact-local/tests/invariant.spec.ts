import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamArtifactLocalInvariant from '../src/invariant.ts'

describe('local Team artifact invariant companion', () => {
  it('registers and unregisters its provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(TeamArtifactLocalInvariant)

    expect(TeamArtifactLocalInvariant.name).toBe('team-artifact-local-invariant')
    expect(TeamArtifactLocalInvariant.inject).toEqual(['invariants'])
    expect('default' in TeamArtifactLocalInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
