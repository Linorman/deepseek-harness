import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import { describe, expect, it } from 'vitest'
import * as ProtocolInvariant from '../src/invariant.ts'

describe('SDK protocol invariant companion', () => {
  it('registers and releases its explicit no-op ownership slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ProtocolInvariant)
    expect(ProtocolInvariant.name).toBe('sdk-protocol-invariant')
    expect(ProtocolInvariant.inject).toEqual(['invariants'])
    expect('default' in ProtocolInvariant).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
