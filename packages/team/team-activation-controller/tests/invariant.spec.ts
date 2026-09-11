import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamActivationController from '../src/index.ts'
import * as TeamActivationControllerInvariant from '../src/invariant.ts'

describe('Team activation controller invariant companion', () => {
  it('registers its intentionally empty bind-or-dispose companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(TeamActivationControllerInvariant)
    expect(ctx.get('invariants')).toBeInstanceOf(InvariantRegistry)
    await ctx.fiber.dispose()
  })

  it('exports function-plugin metadata without a default export', () => {
    expect(TeamActivationController).toMatchObject({
      name: 'team-activation-controller',
      inject: ['teams', 'agentRuntimes'],
    })
    expect('default' in TeamActivationController).toBe(false)
  })
})
