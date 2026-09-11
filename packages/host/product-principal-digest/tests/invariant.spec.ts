import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as DigestPrincipalInvariant from '../src/invariant.ts'

describe('Digest product principal invariant companion', () => {
  it('registers and unregisters its package-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(DigestPrincipalInvariant)

    expect(DigestPrincipalInvariant.name).toBe('product-principal-digest-invariant')
    expect(DigestPrincipalInvariant.inject).toEqual(['invariants'])
    expect('default' in DigestPrincipalInvariant).toBe(false)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
