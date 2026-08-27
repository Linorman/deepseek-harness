import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as AtomicWriteInvariant from '../src/invariant.ts'

describe('atomic-write invariant companion', () => {
  it('registers its explained empty runtime invariant', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(AtomicWriteInvariant)

    expect(() => {
      ctx.invariants.register('@clocky/clocky-atomic-write', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
