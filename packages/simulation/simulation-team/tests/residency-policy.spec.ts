import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import { simulationEntityIdSchema, simulationWakeRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { companyFixture } from '../../simulation-product/tests/company-driver-fixture.ts'
import { selectResidencyCandidates, simulationResidencyPolicySchema } from '../src/residency-policy.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const buyer = simulationEntityIdSchema.parse('buyer'), supplier = simulationEntityIdSchema.parse('supplier')
const policy = simulationResidencyPolicySchema.parse({ version: '1', idleFor: '5', maxCandidates: 1 })
const placement = () => ({ provider: 'in-process', seed: { kind: 'fresh' as const },
  agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: new AbortController().signal })

describe.each(['json', 'sqlite'] as const)('%s automatic residency', (backend) => {
  it('retains an unknown retirement as charged ownership and does not repeat eviction on retry', async () => {
    const fixture = await companyFixture(backend, true, { maxResidentActors: 1, maxDecisionsPerWindow: 1 })
    cleanups.push(() => fixture.close())
    const provider = fixture.ctx.agentRuntimes.getProvider('in-process')!
    const activate = provider.activate.bind(provider)
    let refuse = true, stops = 0
    const interception = vi.spyOn(provider, 'activate').mockImplementation(async (...args) => {
      const handle = await activate(...args), dispose = handle.dispose.bind(handle)
      handle.dispose = async () => {
        stops++
        if (refuse) throw new AgentRuntimeTerminationUnconfirmedError('retirement remains unconfirmed')
        await dispose()
      }
      return handle
    })
    try {
      await fixture.connection.activate(buyer, placement())
      const choice = { activation: placement(), evict: [buyer], policy: { ...policy, idleFor: simTimeSchema.parse('0') } }
      const original = fixture.run.snapshot().entities[buyer]!.writer!.epoch
      expect(await fixture.connection.ensureResident(supplier, choice)).toEqual({ status: 'recovery-required', entityId: buyer })
      const count = stops
      expect(await fixture.connection.ensureResident(supplier, choice)).toEqual({ status: 'recovery-required', entityId: buyer })
      expect(stops).toBe(count)
      expect(fixture.run.snapshot().entities[buyer]!.writer).toMatchObject({ phase: 'revoked', epoch: original })
      expect(fixture.run.population().chargedActors).toBe(1)
      expect(fixture.run.snapshot().entities[supplier]!.writer).toBeUndefined()
    } finally {
      refuse = false
      await fixture.connection.hibernate(buyer)
      interception.mockRestore()
    }
  })

  it('waits for the simulated idle threshold, then resumes the same Session without inference', async () => {
    const fixture = await companyFixture(backend, true, { maxResidentActors: 1, maxDecisionsPerWindow: 1 })
    cleanups.push(() => fixture.close())
    const { run, connection, requests } = fixture
    const first = await connection.activate(buyer, placement())
    expect(await connection.ensureResident(supplier, { activation: placement(), evict: [buyer], policy }))
      .toMatchObject({ status: 'capacity' })
    await fixture.start()
    await connection.drive({ until: simTimeSchema.parse('5') }, () => 0)
    expect((await connection.ensureResident(supplier, { activation: placement(), evict: [buyer], policy })).status).toBe('resident')
    expect(run.snapshot().entities[buyer]?.writer?.phase).toBe('released')
    await connection.hibernate(supplier)
    const resumed = await connection.resume(buyer, { ...placement() })
    expect(resumed.binding.sessionId).toBe(first.binding.sessionId)
    expect(resumed.binding.activation.id).not.toBe(first.binding.activation.id)
    expect(run.population().chargedActors).toBe(1)
    expect(requests).toEqual([])
  })

  it('keeps pending wake responsibility and rejects malformed or duplicate policy input', async () => {
    const fixture = await companyFixture(backend)
    cleanups.push(() => fixture.close())
    const { run, connection } = fixture
    await connection.activate(buyer, placement())
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'keep-awake', time: '0', entityId: buyer, reason: 'pending' }), run.snapshot().revision)
    await fixture.start()
    await connection.drive({ until: simTimeSchema.parse('0') }, () => 0)
    expect(selectResidencyCandidates(run.snapshot(), [buyer], { ...policy, idleFor: simTimeSchema.parse('0') })).toEqual([])
    expect(() => selectResidencyCandidates(run.snapshot(), [buyer, buyer], policy)).toThrow(/distinct/)
    expect(() => simulationResidencyPolicySchema.parse({ ...policy, maxCandidates: 0 })).toThrow()
    expect(() => simulationResidencyPolicySchema.parse({ ...policy, force: true })).toThrow()
    expect(run.population().chargedActors).toBe(1)
  })
})
