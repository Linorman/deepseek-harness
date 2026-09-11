import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as TeamAgentClientInvariant from '../src/invariant.ts'
import * as TeamAgentClient from '../src/index.ts'

describe('Team Agent Client invariant companion', () => {
  it('registers its intentionally empty local-binding companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(TeamAgentClientInvariant)
    expect(ctx.get('invariants')).toBeInstanceOf(InvariantRegistry)
    await ctx.fiber.dispose()
  })

  it('exports function-plugin metadata without a default export', () => {
    expect(TeamAgentClient).toMatchObject({
      name: 'team-agent-client',
      inject: ['teams', 'teamLinks', 'agents', 'sessions'],
    })
    expect('default' in TeamAgentClient).toBe(false)
  })
})
