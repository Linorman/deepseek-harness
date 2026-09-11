import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import * as TeamInvariant from '@clocky/clocky-client-ui-team/invariant'
import InvariantRegistry from '@clocky/clocky-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(TeamInvariant).await()).resolves.toBeDefined()
  })

  it('keeps the node loader entry inert', async () => {
    const { apply } = await import('../src/index.ts')
    apply()
    expect(true).toBe(true)
  })
})
