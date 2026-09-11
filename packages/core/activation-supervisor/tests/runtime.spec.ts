import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { activationBindingSnapshotSchema } from '@clocky/clocky-team'
import ActivationSupervisors from '../src/index.ts'
import type { ActivationSupervisorObservation, ActivationSupervisorProvider } from '../src/index.ts'

const binding = activationBindingSnapshotSchema.parse({
  activation: { id: 'epoch-1', teamId: 'team-1', participantId: 'worker-1', status: 'running' },
  sessionId: 'session-1', provider: 'sdk',
  recovery: {
    kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'sdk', profile: 'worker',
    agent: { provider: 'local', model: 'model' }, process: { hostId: 'host-b', pid: 10, started: 'exact-creation', processGroupId: 10 },
    supervisor: { name: 'worker-host', version: 1, hostId: 'host-b', endpointId: 'endpoint-b', generation: 'epoch-1', terminationMode: 'owned-process' },
  },
})
const descriptor = binding.recovery!.supervisor!
const signal = new AbortController().signal
function provider(overrides: Partial<ActivationSupervisorProvider> = {}): ActivationSupervisorProvider {
  return {
    name: 'worker-host', version: 1, validate() {},
    async health() { return { descriptor, status: 'reachable' } },
    async fence() { return { descriptor, status: 'terminated' } }, ...overrides,
  }
}

describe('activation supervision', () => {
  it('rejects absent versions and retires admission while a retained fence settles', async () => {
    const ctx = new Context()
    await ctx.plugin(ActivationSupervisors)
    let finish!: (value: ActivationSupervisorObservation) => void
    const fence = vi.fn(async () => await new Promise<ActivationSupervisorObservation>((resolve) => { finish = resolve }))
    const owner = provider({ fence })
    const fiber = await ctx.plugin({ name: 'test-supervisor-owner', inject: ['activationSupervisors'], apply(scope) { scope.activationSupervisors.registerProvider(owner) } })
    const pending = ctx.activationSupervisors.fence(binding, signal)
    await fiber.dispose()
    await expect(ctx.activationSupervisors.health(binding, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
    finish({ descriptor, status: 'terminated' })
    await expect(pending).resolves.toMatchObject({ status: 'terminated' })
    expect(fence).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('never upgrades unknown health or an unconfirmed fence to termination', async () => {
    const ctx = new Context()
    await ctx.plugin(ActivationSupervisors)
    ctx.activationSupervisors.registerProvider(provider({
      async health() { return { descriptor, status: 'unknown' } },
      async fence() { return { descriptor, status: 'unreachable' } },
    }))
    await expect(ctx.activationSupervisors.health(binding, signal)).resolves.toMatchObject({ status: 'unknown' })
    await expect(ctx.activationSupervisors.fence(binding, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_TERMINATION_UNCONFIRMED' })
    await ctx.fiber.dispose()
  })

  it('rejects changed generations before provider admission and rejects a mismatched response', async () => {
    const ctx = new Context()
    await ctx.plugin(ActivationSupervisors)
    const fence = vi.fn(async () => ({ descriptor: { ...descriptor, endpointId: 'other' }, status: 'terminated' as const }))
    ctx.activationSupervisors.registerProvider(provider({ fence }))
    const changed = structuredClone(binding)
    Object.assign(changed.activation, { id: 'another-epoch' })
    await expect(ctx.activationSupervisors.fence(changed, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_GENERATION_MISMATCH' })
    expect(fence).not.toHaveBeenCalled()
    await expect(ctx.activationSupervisors.fence(binding, signal)).rejects.toMatchObject({ code: 'SUPERVISOR_GENERATION_MISMATCH' })
    await ctx.fiber.dispose()
  })
})
