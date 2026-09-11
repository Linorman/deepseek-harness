import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import { describe, expect, it } from 'vitest'
import * as SdkRuntimeInvariant from '../src/invariant.ts'

describe('SDK AgentRuntime invariant companion', () => {
  it('registers and releases its explicit no-op ownership slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(SdkRuntimeInvariant)
    expect(SdkRuntimeInvariant.name).toBe('agent-runtime-sdk-invariant')
    expect(SdkRuntimeInvariant.inject).toEqual(['invariants'])
    expect('default' in SdkRuntimeInvariant).toBe(false)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
