import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import { describe, expect, it } from 'vitest'
import * as ServerInvariant from '../src/invariant.ts'

describe('SDK server invariant companion', () => {
  it('registers and releases its explicit no-op ownership slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(ServerInvariant)
    expect(ServerInvariant.name).toBe('sdk-jsonrpc-server-invariant')
    expect(ServerInvariant.inject).toEqual(['invariants'])
    expect('default' in ServerInvariant).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
