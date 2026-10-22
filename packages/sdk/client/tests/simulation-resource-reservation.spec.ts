/** Reservation operations use existing authenticated readonly SDK selectors; no Native transaction API is introduced. */
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { simulationObjectResultSchema, simulationRecordsResultSchema } from '@clocky/clocky-sdk-protocol'
import { Clocky, HarnessClient, SdkProtocolError } from '../src/index.ts'

const input: unknown = JSON.parse(await readFile(new URL('../../protocol/tests/fixtures/simulation-resource-reservation-cases.json', import.meta.url), 'utf8'))
if (!Array.isArray(input)) throw new Error('Reservation corpus must be an array')
const cases = input.map((item: unknown) => {
  if (item === null || typeof item !== 'object') throw new Error('Reservation corpus item must be an object')
  const kind: unknown = Reflect.get(item, 'kind')
  if (typeof kind !== 'string') throw new Error('Reservation corpus kind must be a string')
  return { kind, operation: simulationObjectResultSchema.parse(Reflect.get(item, 'operation')),
    records: simulationRecordsResultSchema.parse(Reflect.get(item, 'records')) }
})

it.each(cases)('both client layers keep original $kind selections and reject foreign or private results', async ({ operation, records }) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue()
  if (operation.selection.collection !== 'operations' || operation.selection.section !== 'execution'
    || records.selection.sequence === undefined) throw new Error('Reservation corpus requires exact operation and record selectors')
  const objectInput = { runId: operation.runId, expectedRevision: operation.snapshotRevision, ...operation.selection }
  const recordsInput = { runId: records.runId, expectedRevision: records.snapshotRevision,
    mode: records.mode, sequence: records.selection.sequence, limit: 1 }
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const request = vi.spyOn(transport, 'request').mockResolvedValue(operation)
    expect(await client.inspectSimulationObject(objectInput)).toEqual(operation)
    expect(request).toHaveBeenLastCalledWith('simulation/objects-inspect', objectInput)
    request.mockResolvedValue({ ...operation, runId: 'foreign' })
    await expect(client.inspectSimulationObject(objectInput)).rejects.toBeInstanceOf(SdkProtocolError)
    request.mockResolvedValue({ ...operation, nativeReservation: {} })
    await expect(client.inspectSimulationObject(objectInput)).rejects.toBeInstanceOf(SdkProtocolError)
    request.mockResolvedValue(records)
    expect(await client.readSimulationRecords(recordsInput)).toEqual(records)
    expect(request).toHaveBeenLastCalledWith('simulation/records-list', recordsInput)
    request.mockResolvedValue({ ...records, selection: { sequence: 100 } })
    await expect(client.readSimulationRecords(recordsInput)).rejects.toBeInstanceOf(SdkProtocolError)
    request.mockResolvedValue({ ...records, bodyAccess: 'withheld' })
    await expect(client.readSimulationRecords(recordsInput)).rejects.toBeInstanceOf(SdkProtocolError)
  }
})
