/** Native domain admission and provider cleanup share one Fiber obligation, including retained unknown responsibility. */
import { rm } from 'node:fs/promises'
import { Context } from '@clocky/cordis'
import Simulations, { WORLD_GENERATE_AND_HIRE_PIN, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN,
  WORLD_EXTERNAL_MEDIATED_PIN, WORLD_REPRESENTATION_PIN } from '@clocky/clocky-simulation'
import { expect, it, vi } from 'vitest'
import * as Local from '../src/index.ts'
import { simulationTemp } from './temp.ts'

it('reports provider cleanup failure without waiting forever on its original domain lease or releasing it early', async () => {
  const root = await simulationTemp('domain-disposal'), ctx = new Context()
  const failure = new Error('Original writer retirement remains unknown')
  const close = vi.spyOn(Local.LocalSimulationProvider.prototype, 'close').mockRejectedValueOnce(failure)
  const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  await ctx.plugin(Simulations)
  await ctx.plugin(Local, { name: 'local', root, backend: 'json', replayPageSize: 1 })
  const registry = ctx.simulations.domains('local'), lease = registry.acquire(WORLD_GENERATE_AND_HIRE_PIN)
  try {
    await ctx.fiber.dispose()
    expect(close).toHaveBeenCalledOnce()
    expect(errors).toHaveBeenCalledWith(failure)
    expect(() => registry.acquire(WORLD_GENERATE_AND_HIRE_PIN)).toThrow(expect.objectContaining({
      code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' }))
    expect(lease.implementation.ref).toBe(WORLD_GENERATE_AND_HIRE_PIN.implementationRef)
    expect(() => registry.register(lease.implementation.definition, lease.implementation)).toThrow(/already registered/)
    // Only the original responsibility owner releases this lease after observing its terminal outcome.
    lease.release()
    expect(() => registry.acquire(WORLD_GENERATE_AND_HIRE_PIN)).toThrow(expect.objectContaining({
      code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' }))
  } finally {
    lease.release()
    close.mockRestore()
    errors.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
}, 5000)


it.each([WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, WORLD_REPRESENTATION_PIN])(
  'removes external version $version on unload and re-registers it under a fresh plugin lifetime', async (pin) => {
    const root = await simulationTemp('external-disposal'), ctx = new Context()
    await ctx.plugin(Simulations)
    const config = { name: 'local', root, backend: 'json' as const, replayPageSize: 1 }
    const fiber = ctx.plugin(Local, config)
    await fiber
    const registry = ctx.simulations.domains('local')
    expect(registry.pin({ domain: pin.domain, operation: pin.operation, version: pin.version })).toEqual(pin)
    await fiber.dispose()
    expect(() => registry.acquire(pin)).toThrow(expect.objectContaining({
      code: 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' }))
    const next = ctx.plugin(Local, config)
    await next
    try {
      const replacement = ctx.simulations.domains('local')
      expect(replacement).not.toBe(registry)
      const lease = replacement.acquire(pin)
      try { expect(lease.implementation.definition.operation).toBe(pin.operation) }
      finally { lease.release() }
    } finally { await next.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
