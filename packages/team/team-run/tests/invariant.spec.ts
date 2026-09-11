import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamRun from '../src/index.ts'
import * as TeamRunInvariant from '../src/invariant.ts'

describe('Team-run invariant companion', () => {
  it('registers its topology-owner companion and exports a function-plugin module', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(TeamRunInvariant)
    expect(ctx.get('invariants')).toBeInstanceOf(InvariantRegistry)
    expect(TeamRun).toMatchObject({
      name: 'team-run',
      inject: ['teamChannelAdmission', 'teams', 'teamActivations', 'agentDefaultModel', 'systemPrompt', 'agents'],
    })
    expect('default' in TeamRun).toBe(false)
    await ctx.fiber.dispose()
  })
})
