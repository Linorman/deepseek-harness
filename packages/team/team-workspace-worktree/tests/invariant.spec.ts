import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as WorktreeWorkspaceInvariant from '../src/invariant.ts'

describe('worktree Team workspace invariant companion', () => {
  it('registers and releases its explained provider-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(WorktreeWorkspaceInvariant)

    expect(WorktreeWorkspaceInvariant.name).toBe('team-workspace-worktree-invariant')
    expect(WorktreeWorkspaceInvariant.inject).toEqual(['invariants'])
    expect('default' in WorktreeWorkspaceInvariant).toBe(false)
    expect(() => ctx.invariants.register('@clocky/clocky-team-workspace-worktree', () => {})).toThrow(/already registered/)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
