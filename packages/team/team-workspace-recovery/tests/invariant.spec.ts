import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as WorkspaceRecoveryInvariant from '../src/invariant.ts'

describe('Team workspace recovery invariant companion', () => {
  it('registers and unregisters its explicit provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(WorkspaceRecoveryInvariant)

    expect(WorkspaceRecoveryInvariant.name).toBe('team-workspace-recovery-invariant')
    expect(WorkspaceRecoveryInvariant.inject).toEqual(['invariants'])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
