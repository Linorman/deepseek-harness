import { describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import InvariantRegistry from '@clocky/clocky-invariants'
import * as SchedulerInvariant from '../src/invariant.ts'

describe('Team DAG scheduler invariant companion', () => {
  it('registers and releases its explained Team-owned invariant slot', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(SchedulerInvariant)

    expect(SchedulerInvariant.name).toBe('team-scheduler-dag-invariant')
    expect(SchedulerInvariant.inject).toEqual(['invariants'])
    expect('default' in SchedulerInvariant).toBe(false)
    expect(() => ctx.invariants.register('@clocky/clocky-team-scheduler-dag', () => {})).toThrow(/already registered/)

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
