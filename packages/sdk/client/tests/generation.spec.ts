import { simulationGenerationResultSchema } from '@clocky/clocky-sdk-protocol'
import { expect, it, vi } from 'vitest'
import { HarnessClient, Clocky, SdkProtocolError } from '../src/index.ts'
import type { SimulationGenerationRequestParams } from '@clocky/clocky-sdk-protocol'

const request: SimulationGenerationRequestParams = { runId: 'run', job: {
  id: 'original', purpose: 'explanation', assistantEntityId: 'helper', scope: 'org', audience: ['org'],
  inputs: [{ source: 'user-authored', content: 'Public input', audience: ['org'] }], outputSchema: 'text/1',
  model: { provider: 'fixture', name: 'fixture', version: '1' }, promptVersion: 'clocky.product-generation/1', policyVersion: '1',
  budget: { maxTokens: 100, maxOutputBytes: 1000, maxAttempts: 1 }, deadline: '100',
} }
const result = { apiVersion: 'clocky.generation/v1', runId: 'run', job: { job: request.job,
  binding: { teamId: 'team', participantId: 'participant', sessionId: 'session' }, acceptedSequence: 1, interval: '0', status: 'accepted' } }

it('correlates all explicit generation methods and rejects substituted originals or forged provider actions', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request').mockResolvedValue(result)
  const selections = [
    ['request', () => client.generationRequest(request)],
    ['read', () => client.generationRead({ runId: 'run', jobId: 'original' })],
    ['execute', () => client.generationExecute({ runId: 'run', jobId: 'original' })],
    ['transition', () => client.generationTransition({ runId: 'run', change: { kind: 'validate', id: 'original' } })],
    ['persona-draft', () => client.generationPersonaDraft({ runId: 'run', jobId: 'original', positionEntityId: 'position',
      templateId: 'template', templateVersion: '1', draftId: 'draft', validUntil: '100' })],
  ] as const
  for (const [method, invoke] of selections) {
    send.mockResolvedValue(result)
    expect(await invoke()).toEqual(result)
    expect(send).toHaveBeenLastCalledWith(`simulation/generation-${method}`, expect.objectContaining({ runId: 'run' }))
    for (const changed of [{ ...result, runId: 'other' }, { ...result, nativeProof: {} },
      { ...result, job: { ...result.job, job: { ...request.job, id: 'other' } } }]) {
      send.mockResolvedValue(changed)
      await expect(invoke()).rejects.toBeInstanceOf(SdkProtocolError)
    }
  }
  send.mockResolvedValue({ ...result, job: null })
  expect((await client.generationRead({ runId: 'run', jobId: 'original' })).job).toBeNull()
  await expect(client.generationExecute({ runId: 'run', jobId: 'original' })).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockClear()
  await expect(client.generationRequest({ ...request, job: { ...request.job,
    inputs: [{ source: 'forged-private-record', content: 'secret', audience: ['org'] }] } })).rejects.toBeInstanceOf(SdkProtocolError)
  await expect(client.generationTransition({ runId: 'run', change: { kind: 'output', id: 'original', content: 'forged' } } as never))
    .rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})

it('high-level generation reads start only transport and never execute the selected job', async () => {
  const api = new Clocky({ launch: { command: process.execPath }, credential: 'test', provider: 'test', model: 'test' })
  const start = vi.spyOn(api, 'start').mockResolvedValue(undefined)
  const client = api.client
  const read = vi.spyOn(client, 'generationRead').mockResolvedValue(simulationGenerationResultSchema.parse({ apiVersion: 'clocky.generation/v1', runId: 'run', job: null }))
  const execute = vi.spyOn(client, 'generationExecute')
  await api.generationRead({ runId: 'run', jobId: 'original' })
  expect(start).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledWith({ runId: 'run', jobId: 'original' })
  expect(execute).not.toHaveBeenCalled()
})
