import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as LocalFilesInvariant from '../src/invariant.ts'

describe('local Team workspace files invariant companion', () => {
  it('registers its explained empty slot and releases ownership on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(LocalFilesInvariant)

    expect(LocalFilesInvariant.name).toBe('team-workspace-local-files-invariant')
    expect(LocalFilesInvariant.inject).toEqual(['invariants'])
    expect('default' in LocalFilesInvariant).toBe(false)
    expect(() => ctx.invariants.register('@clocky/clocky-team-workspace-local-files', () => {}))
      .toThrow(/already registered/)

    await fiber.dispose()
    expect(() => ctx.invariants.register('@clocky/clocky-team-workspace-local-files', () => {}))
      .not.toThrow()
    await ctx.fiber.dispose()
  })
})
