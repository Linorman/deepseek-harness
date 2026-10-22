/** Both public SDK clients correlate complete human previews and original command receipts. */
import { expect, expectTypeOf, it, vi } from 'vitest'
import { Clocky, HarnessClient, SdkProtocolError } from '../src/index.ts'
import type { SimulationWorldManagementPreviewResult } from '@clocky/clocky-sdk-protocol'
import { managementDraft, managementFields, managementPreview, managementSubmit, managementCommandBoundaries, managementReasonBoundaries } from '../../../simulation/simulation-product/tests/world-management-fixture.ts'

it('preserves the whole public preview type through low and high level clients', () => {
  expectTypeOf<Awaited<ReturnType<HarnessClient['previewSimulationWorldManagement']>>>().toEqualTypeOf<SimulationWorldManagementPreviewResult>()
  expectTypeOf<Awaited<ReturnType<Clocky['previewSimulationWorldManagement']>>>().toEqualTypeOf<SimulationWorldManagementPreviewResult>()
})
it.each(['fields', 'preview', 'submit'] as const)('validates and correlates the exact original management %s on both public clients', async (kind) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  const start = vi.spyOn(high, 'start').mockResolvedValue(undefined)
  const input = kind === 'fields' ? { runId: managementDraft.runId, targetId: managementDraft.targetId, action: managementDraft.action }
    : kind === 'preview' ? managementDraft : managementSubmit
  const output = kind === 'fields' ? managementFields : kind === 'preview' ? managementPreview
    : { kind: 'world-management', commandId: managementSubmit.commandId, runId: managementSubmit.runId, acceptedAt: 1, status: 'accepted' }
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(output)
    const invoke = (raw: unknown) => kind === 'fields' ? client.readSimulationWorldManagementFields(raw as never)
      : kind === 'preview' ? client.previewSimulationWorldManagement(raw as never) : client.submitSimulationWorldManagement(raw as never)
    expect(await invoke(input)).toEqual(output)
    expect(send).toHaveBeenCalledWith(`simulation/world-management-${kind}`, input)
    send.mockResolvedValue({ ...output, runId: 'foreign' })
    await expect(invoke(input)).rejects.toBeInstanceOf(SdkProtocolError)
    send.mockResolvedValue(kind === 'preview' ? { ...managementPreview,
      input: { ...managementDraft, values: { ...managementDraft.values, reason: 'Replaced original reason' } } }
      : kind === 'fields' ? { ...managementFields, action: 'depart' } : { ...output, commandId: 'foreign' })
    await expect(invoke(input)).rejects.toBeInstanceOf(SdkProtocolError)
    send.mockResolvedValue({ ...output, nativeSnapshot: {} })
    await expect(invoke(input)).rejects.toBeInstanceOf(SdkProtocolError)
    await expect(invoke({ ...input, principalId: 'spoofed' })).rejects.toBeInstanceOf(SdkProtocolError)
  }
  expect(start).toHaveBeenCalled()
})

it.each(managementCommandBoundaries)('rejects malformed $label management identities before TS SDK transport', async ({ commandId, allowed }) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue({ kind: 'world-management', commandId,
      runId: managementSubmit.runId, acceptedAt: 1, status: 'accepted' })
    const input = { ...managementSubmit, commandId }
    if (allowed) {
      expect((await client.submitSimulationWorldManagement(input as never)).commandId).toBe(commandId)
      expect(send).toHaveBeenCalledTimes(1)
    } else {
      await expect(client.submitSimulationWorldManagement(input as never)).rejects.toBeInstanceOf(SdkProtocolError)
      expect(send).not.toHaveBeenCalled()
    }
  }
})

it.each(managementReasonBoundaries)('keeps the original $label reason and refuses invalid management input before SDK IO', async ({ reason, allowed }) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue(undefined)
  for (const action of ['transfer', 'depart', 'hire-existing'] as const) {
    const values = action === 'hire-existing' ? { position: 'position', reason }
      : { assignmentId: 'assignment', effective: 'boundary', reason, ...action === 'transfer' ? { position: 'position' } : { retire: 'no' } }
    const draft = { ...managementDraft, action, values }, input = { ...managementSubmit, draft }
    for (const [client, transport] of [[low, low], [high, high.client]] as const) {
      const send = vi.spyOn(transport, 'request').mockReset().mockResolvedValue({ kind: 'world-management', commandId: input.commandId,
        runId: input.runId, acceptedAt: 1, status: 'accepted' })
      if (allowed) {
        await client.submitSimulationWorldManagement(input as never)
        expect(send).toHaveBeenCalledWith('simulation/world-management-submit', input)
      } else {
        await expect(client.submitSimulationWorldManagement(input as never)).rejects.toBeInstanceOf(SdkProtocolError)
        await expect(client.previewSimulationWorldManagement(draft as never)).rejects.toBeInstanceOf(SdkProtocolError)
        expect(send).not.toHaveBeenCalled()
      }
    }
  }
})
