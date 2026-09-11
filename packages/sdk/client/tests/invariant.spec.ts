import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import { describe, expect, it } from 'vitest'
import * as ClientInvariant from '../src/invariant.ts'

describe('SDK client invariant companion', () => {
  it('registers and releases its explicit no-op ownership slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ClientInvariant)
    expect(ClientInvariant.name).toBe('sdk-client-invariant')
    expect(ClientInvariant.inject).toEqual(['invariants'])
    expect('default' in ClientInvariant).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
