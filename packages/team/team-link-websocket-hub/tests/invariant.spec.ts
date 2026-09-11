import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as Invariant from '../src/invariant.ts'

describe('WebSocket Team Link Hub invariant companion', () => {
  it('registers and unregisters its Team-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(Invariant)
    expect(Invariant.name).toBe('team-link-websocket-hub-invariant')
    expect(Invariant.inject).toEqual(['invariants'])
    expect('default' in Invariant).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
