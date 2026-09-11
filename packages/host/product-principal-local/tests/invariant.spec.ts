import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as LocalPrincipalInvariant from '../src/invariant.ts'

describe('Local product principal invariant companion', () => {
  it('registers and unregisters its package-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(LocalPrincipalInvariant)

    expect(LocalPrincipalInvariant.name).toBe('product-principal-local-invariant')
    expect(LocalPrincipalInvariant.inject).toEqual(['invariants'])
    expect('default' in LocalPrincipalInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
