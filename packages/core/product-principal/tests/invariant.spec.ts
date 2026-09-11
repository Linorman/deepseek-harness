import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as ProductPrincipalInvariant from '../src/invariant.ts'

describe('Product principal invariant companion', () => {
  it('registers and unregisters its package-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ProductPrincipalInvariant)

    expect(ProductPrincipalInvariant.name).toBe('product-principal-invariant')
    expect(ProductPrincipalInvariant.inject).toEqual(['invariants'])
    expect('default' in ProductPrincipalInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
