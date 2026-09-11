import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as RecoveryInvariant from '../src/invariant.ts'

describe('Team activation recovery invariant companion', () => {
  it('reserves its explained empty invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(RecoveryInvariant)

    expect(RecoveryInvariant.name).toBe('team-activation-recovery-invariant')
    expect(RecoveryInvariant.inject).toEqual(['invariants'])
    expect('default' in RecoveryInvariant).toBe(false)
    expect(() => ctx.invariants.register('@clocky/clocky-team-activation-recovery', () => {})).toThrow(/already registered/)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
