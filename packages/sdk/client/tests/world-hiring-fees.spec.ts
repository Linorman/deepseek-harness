/** Client layers consume precise financial stop observations through the existing readonly control API. */
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { simulationControlResultSchema, simulationWorldPreflightParamsSchema } from '@clocky/clocky-sdk-protocol'
import { Clocky, HarnessClient, SdkProtocolError } from '../src/index.ts'

const input: unknown = JSON.parse(await readFile(new URL('../../protocol/tests/fixtures/world-hiring-fee-control.json', import.meta.url), 'utf8'))
if (!Array.isArray(input)) throw new Error('Hiring stop corpus must be an array')
const controls = input.map((item: unknown) => {
  if (item === null || typeof item !== 'object') throw new Error('Hiring stop corpus item must be an object')
  return simulationControlResultSchema.parse(Reflect.get(item, 'control'))
})
const source: unknown = JSON.parse(await readFile(new URL('../../protocol/tests/fixtures/world-hiring-fee-definition.json', import.meta.url), 'utf8'))
const definition = simulationWorldPreflightParamsSchema.parse({ definition: source }).definition

it.each(controls)('both APIs preserve $stop and reject foreign or private control responses', async (control) => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue()
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(control)
    expect(await client.getSimulationControl({ runId: 'run' })).toEqual(control)
    expect(send).toHaveBeenLastCalledWith('simulation/runs-control', { runId: 'run' })
    for (const patch of [{ runId: 'foreign' }, { stop: 'resource-minted' }, { feeQuote: {} }]) {
      send.mockResolvedValue({ ...control, ...patch })
      await expect(client.getSimulationControl({ runId: 'run' })).rejects.toBeInstanceOf(SdkProtocolError)
    }
  }
})

it('passes exact authored fees through both original preflight APIs without submitting a payment', async () => {
  const low = new HarnessClient({ command: process.execPath })
  const high = new Clocky({ launch: { command: process.execPath }, credential: 'fixture', provider: 'fixture', model: 'fixture' })
  vi.spyOn(high, 'start').mockResolvedValue()
  const invalid = { status: 'invalid', diagnostics: [{ source: 'scenario', path: ['organization', 'hiringFees', 0],
    code: 'unknown-reference', message: 'Host must resolve the original accounts' }] }
  for (const [client, transport] of [[low, low], [high, high.client]] as const) {
    const send = vi.spyOn(transport, 'request').mockResolvedValue(invalid)
    expect(await client.preflightSimulationWorld({ definition })).toEqual(invalid)
    expect(send).toHaveBeenLastCalledWith('simulation/world-preflight', { definition })
  }
})
