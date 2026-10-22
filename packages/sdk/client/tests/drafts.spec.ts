/** Draft SDK calls preserve original CAS payloads and reject mismatched or malformed responses. */
import { expect, it, vi } from 'vitest'
import { HarnessClient, SdkProtocolError } from '../src/index.ts'
import { sample } from '../../../simulation/simulation-scenario/tests/v1-fixtures.ts'

it('correlates exact private revisions, saved originals and conflicts', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const input = { draftId: 'draft', saveId: 'save', parentRevision: null, name: 'Draft', definition: sample, layout: [{ id: 'unit', x: 0, y: 0 }] }
  const saved = { ...input, revision: 0, author: 'owner', savedAt: 1 }
  const send = vi.spyOn(client, 'request').mockResolvedValue({ status: 'saved', value: saved })
  expect(await client.saveSimulationDraft(input)).toEqual({ status: 'saved', value: saved })
  expect(send).toHaveBeenCalledWith('simulation/draft-save', input)
  send.mockResolvedValue({ status: 'conflict', attempted: input, current: saved })
  expect((await client.saveSimulationDraft(input)).status).toBe('conflict')
  for (const value of [{ ...saved, layout: [] }, { ...saved, saveId: 'another' }, { ...saved, name: 'another' }, { ...saved, parentRevision: 10 }]) {
    send.mockResolvedValue({ status: 'saved', value })
    await expect(client.saveSimulationDraft(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockResolvedValue({ value: saved })
  expect((await client.readSimulationDraft({ draftId: 'draft', revision: 0 })).value).toEqual(saved)
  await expect(client.readSimulationDraft({ draftId: 'another' })).rejects.toBeInstanceOf(SdkProtocolError)
  await expect(client.readSimulationDraft({ draftId: 'draft', revision: 1 })).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockClear()
  await expect(client.saveSimulationDraft({ ...input, author: 'spoofed' } as never)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})
