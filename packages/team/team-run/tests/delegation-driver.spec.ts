import { expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { registerTeamDelegationDriver, TeamRunService } from '../src/index.ts'

it('keeps one exact delegation driver registered until its own disposer runs', async () => {
  const ctx = new Context()
  const first = { drive: vi.fn(async () => {}) }
  const replacement = { drive: vi.fn(async () => {}) }
  try {
    const retireFirst = registerTeamDelegationDriver(ctx, first)
    expect(() => registerTeamDelegationDriver(ctx, replacement)).toThrow(/already registered/)
    retireFirst()
    const retireReplacement = registerTeamDelegationDriver(ctx, replacement)
    retireFirst()
    expect(() => registerTeamDelegationDriver(ctx, first)).toThrow(/already registered/)
    retireReplacement()
    const retireLast = registerTeamDelegationDriver(ctx, first)
    retireLast()
  } finally { await ctx.fiber.dispose() }
})

it('rejects duplicate capabilities and reserved or repeated custom Team roles at configuration load', async () => {
  const member = { role: 'analyst', displayName: 'Analyst', kind: 'local-agent' as const,
    capabilities: ['code'], provider: 'in-process', modelProvider: 'mock', model: 'mock/model', maxTokens: 32 }
  for (const members of [
    [{ ...member, role: 'human' }],
    [{ ...member, role: 'worker-2' }],
    [member, { ...member, displayName: 'Another Analyst' }],
    [{ ...member, capabilities: ['code', 'code'] }],
  ]) {
    const ctx = new Context()
    try {
      expect(() => new TeamRunService(ctx, { members })).toThrow()
    } finally { await ctx.fiber.dispose() }
  }
})
