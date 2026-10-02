/** Structured failure metadata survives replay while arbitrary error text never becomes a public category. */
import { expect, it } from 'vitest'
import { simulationCheckpointRequestSchema, checkpointDiagnostic, SimulationCheckpointError,
  simulationCheckpointDiagnosticSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

it.each(['json', 'sqlite'] as const)('retains an immutable exact failure diagnosis in the %s checkpoint journal', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const input = simulationCheckpointRequestSchema.parse({ id: 'diagnostic-cut', implementationVersion: 'fixture-1',
      maxDrainRounds: 4, maxAttempts: 2 })
    await h.run.beginCheckpoint(input)
    const diagnostic = simulationCheckpointDiagnosticSchema.parse({ stage: 'publish', code: 'source-unavailable',
      subject: { kind: 'checkpoint', checkpointId: input.id } })
    const failed = await h.run.failCheckpoint(input.id, 'Private provider path /private/secret-owner-file', diagnostic)
    expect(failed).toMatchObject({ status: 'failed', diagnostic })
    expect(await h.run.failCheckpoint(input.id, 'A later unrelated failure', { ...diagnostic, code: 'unavailable' })).toEqual(failed)
    await h.run.close()
    const replayed = await h.provider.open({ ...h.selection, mode: 'open' })
    try { expect(replayed.snapshot().checkpoints?.[input.id]).toEqual(failed) }
    finally { await replayed.close() }
  } finally { await h.close() }
})

it('accepts only explicit category metadata and rejects extra provider payload at the durable boundary', () => {
  const fallback = simulationCheckpointDiagnosticSchema.parse({ stage: 'restore', code: 'unavailable', subject: { kind: 'run' } })
  const privateFailure = Object.assign(new Error('history-incomplete /private/provider-key'), { diagnostic: { ...fallback, code: 'history-incomplete' } })
  expect(checkpointDiagnostic(privateFailure, fallback)).toBe(fallback)
  expect(checkpointDiagnostic(new SimulationCheckpointError('Private text', fallback), fallback)).toBe(fallback)
  expect(simulationCheckpointDiagnosticSchema.safeParse({ ...fallback, privatePath: '/private/provider-key' }).success).toBe(false)
  expect(simulationCheckpointDiagnosticSchema.safeParse({ ...fallback, subject: { kind: 'file', path: '/private/provider-key' } }).success).toBe(false)
})
