/** Native durable clock enforcement cannot be bypassed through drive, cohort collection, or scheduler replay. */
import { afterEach, expect, it } from 'vitest'
import { simTimeSchema, simulationFederationTimeSchema, simulationWakeRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { foldSchedulerRecord } from '../src/scheduler.ts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: Native queue and direct scheduler fold enforce the retained Host boundary after reopen`, async () => {
    const h = await createBusinessHarness(backend); cleanup.push(h.close)
    const actor = await h.actor('fenced-actor')
    await h.run.setPhase('paused', h.run.snapshot().revision)
    let evidence = simulationFederationTimeSchema.parse({ ownerId: 'mailbox-owner', runId: h.run.snapshot().spec.runId,
      generation: 1, sourceSequence: 0, limit: '0', blockedPeers: [], sourceHash: 'a'.repeat(64) })
    const { sourceSequence: _cursor, ...missingCursor } = evidence
    expect(() => simulationFederationTimeSchema.parse(missingCursor)).toThrow()
    const binding = h.run.bindFederationTime('mailbox-owner', () => evidence)
    await binding.sync()
    const valid = evidence
    evidence = { ...evidence, sourceHash: 'b'.repeat(64) }
    await expect(binding.sync()).rejects.toThrow('owner/generation/time changed')
    evidence = valid
    await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'future-wake', time: '5', entityId: actor.id, reason: 'Peer-dependent work' }), h.run.snapshot().revision)
    await h.run.setPhase('running', h.run.snapshot().revision)
    const before = h.run.snapshot()
    await expect(h.run.drive({ until: simTimeSchema.parse('0') })).rejects.toThrow('Federation clock blocked')
    await expect(h.run.drive({ until: simTimeSchema.parse('10') })).rejects.toThrow('Federation clock blocked')
    await expect(h.run.collectDecisionWakes({ until: simTimeSchema.parse('10') })).rejects.toThrow('Federation clock blocked')
    expect(h.run.snapshot()).toEqual(before)
    expect(() => foldSchedulerRecord(before, { kind: 'clock/advanced', time: simTimeSchema.parse('1') }, before.revision + 1, undefined)).toThrow('Federation clock blocked')
    expect(() => foldSchedulerRecord(before, { kind: 'event/consumed', id: simulationWakeRequestSchema.parse({ id: 'future-wake', time: '5', entityId: actor.id, reason: 'Peer-dependent work' }).id }, before.revision + 1, undefined)).toThrow('Federation clock blocked')
    evidence = { ...evidence, sourceSequence: 1, limit: simTimeSchema.parse('5') }; await binding.sync(); binding.dispose()
    expect((await h.run.drive({ until: simTimeSchema.parse('4') })).reason).toBe('until')
    expect(h.run.snapshot().time).toBe('4')
    await actor.lease.revoke(); await actor.lease.release(); h.leases.splice(0)
    await h.run.close()
    const recovered = await h.provider.open({ ...h.selection, mode: 'open' })
    await expect(recovered.drive({ until: simTimeSchema.parse('5') })).rejects.toThrow('Federation clock blocked')
    const nextBinding = recovered.bindFederationTime('mailbox-owner', () => ({ ...evidence, sourceSequence: 2, limit: simTimeSchema.parse('6'), blockedPeers: ['peer'] }))
    await nextBinding.sync(); nextBinding.dispose()
    await expect(recovered.drive({ until: simTimeSchema.parse('4') })).rejects.toThrow('permanently stopped')
    const attemptUnstop = recovered.bindFederationTime('mailbox-owner', () => ({ ...evidence, limit: simTimeSchema.parse('6'), blockedPeers: [] }))
    await expect(attemptUnstop.sync()).rejects.toThrow('owner/generation/time changed'); attemptUnstop.dispose()
    await recovered.close()
  })
}


it.each(['json', 'sqlite'] as const)('%s exclusive maxTime+1 frontier permits the actual final Native tick', async (backend) => {
  const h = await createBusinessHarness(backend); cleanup.push(h.close)
  await h.run.setPhase('paused', h.run.snapshot().revision)
  const binding = h.run.bindFederationTime('terminal-mailbox', () => simulationFederationTimeSchema.parse({ ownerId: 'terminal-mailbox',
    runId: h.run.snapshot().spec.runId, generation: 1, sourceSequence: 0, limit: String(BigInt(h.run.snapshot().spec.maxTime) + 1n),
    blockedPeers: [], sourceHash: 'a'.repeat(64) }))
  await binding.sync(); binding.dispose()
  await h.run.setPhase('running', h.run.snapshot().revision)
  expect((await h.run.drive({ until: h.run.snapshot().spec.maxTime })).reason).toBe('until')
  expect(h.run.snapshot().time).toBe(h.run.snapshot().spec.maxTime)
})
