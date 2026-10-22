import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { HarnessClient, SdkProtocolError } from '../src/index.ts'

const plan = { runId: 'run', version: 1, planHash: 'a'.repeat(64), snapshotRevision: 3, bytes: 100,
  nativeEntries: 4, ownerStreams: 2, materializedSessions: 1, unmaterializedSessions: 1, attachments: 0,
  destructive: false, reclaimableBytes: 0, pinPolicy: 'complete-owner-history' }
const result = { runId: 'run', commandId: 'original', status: 'completed', plan, archiveHash: 'b'.repeat(64) }

it('retains exact archive commands, source cuts and separately selected owner pages', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const send = vi.spyOn(client, 'request').mockResolvedValue(plan)
  expect(await client.retentionPreview({ runId: 'run' })).toEqual(plan)
  expect(send).toHaveBeenLastCalledWith('simulation/retention-preview', { runId: 'run' })
  const command = { runId: 'run', commandId: 'original', expectedRevision: 3, planHash: plan.planHash }
  send.mockResolvedValue(result)
  expect(await client.retentionExecute(command)).toEqual(result)
  expect(await client.retentionRead({ runId: 'run', commandId: 'original' })).toEqual(result)
  for (const changed of [{ ...result, commandId: 'other' }, { ...result, plan: { ...plan, snapshotRevision: 4 } },
    { ...result, plan: { ...plan, runId: 'another' } }, { ...result, plan: { ...plan, destructive: true } }]) {
    send.mockResolvedValue(changed)
    await expect(client.retentionExecute(command)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  const selection = { runId: 'run', commandId: 'original', owner: 'native' as const, ownerId: 'native-run', afterSequence: -1, limit: 2 }
  const page = { runId: 'run', commandId: 'original', archiveHash: result.archiveHash, owner: 'native', ownerId: 'native-run',
    entries: [{ sequence: 0, value: { kind: 'original-record' } }], hasMore: false }
  send.mockResolvedValue(page)
  expect(await client.retentionRecords(selection)).toEqual(page)
  for (const changed of [{ ...page, ownerId: 'other' }, { ...page, entries: [...page.entries, ...page.entries] },
    { ...page, entries: [{ sequence: -1, value: {} }] }]) {
    send.mockResolvedValue(changed)
    await expect(client.retentionRecords(selection)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockClear()
  await expect(client.retentionExecute({ ...command, deleteOriginals: true } as typeof command)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})


it('exports only the selected completed private bytes and refuses changed identities or content', async () => {
  const client = new HarnessClient({ command: process.execPath })
  const bundle = '{"manifest":{"format":"world-backup/1"}}'
  const original = { runId: 'run', commandId: 'original', archiveHash: 'a'.repeat(64),
    bundleHash: createHash('sha256').update(bundle).digest('hex'), bundle, kind: 'full-private-backup' }
  const send = vi.spyOn(client, 'request').mockResolvedValue(original)
  const selection = { runId: 'run', commandId: 'original' }
  expect(await client.backupExport(selection)).toEqual(original)
  expect(send).toHaveBeenLastCalledWith('simulation/backup-export', selection)
  for (const changed of [{ ...original, runId: 'other' }, { ...original, commandId: 'other' },
    { ...original, bundle: bundle + ' ' }, { ...original, kind: 'redacted-dataset' }]) {
    send.mockResolvedValue(changed)
    await expect(client.backupExport(selection)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockClear()
  await expect(client.backupExport({ ...selection, start: true } as typeof selection)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})
