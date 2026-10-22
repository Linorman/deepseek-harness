/** Experiment responses must remain bound to the exact caller-retained command and archived observations. */
import { expect, it, vi } from 'vitest'
import { HarnessClient, SdkProtocolError } from '../src/index.ts'
const source = { runId: 'parent', archiveCommandId: 'archive-parent' }
const commandId = '11111111-1111-4111-8111-111111111111'
const input = { source, commandId, name: 'Branch', memoryPolicy: 'public-facts' as const }
const branch = { status: 'completed', commandId, runId: commandId, source, sourceHash: 'a'.repeat(64),
  memoryPolicy: 'public-facts', phase: 'paused', realEffects: false }
const causal = { source, sourceHash: 'a'.repeat(64), nodes: [], edges: [], coverage: 'unknown' }
const right = { runId: 'sibling', archiveCommandId: 'archive-sibling' }
const comparison = { version: 1, observations: { left: source, right }, parentCut: { runId: 'original', hash: 'a'.repeat(64), revision: 1 },
  variables: { left: {}, right: {} }, memoryPolicy: { left: 'public-facts', right: 'public-facts' },
  budget: { left: { maxTokens: 10, maxTime: '100' }, right: { maxTokens: 10, maxTime: '100' } }, differences: [],
  quality: { status: 'unknown' }, cost: { status: 'unknown' },
  stop: { left: { phase: 'paused', time: '0', stall: null }, right: { phase: 'paused', time: '0', stall: null } },
  nondeterminism: 'Recorded observations can differ', causalConclusion: 'not-established' }

it('keeps branch original IDs, source cuts and memory policy through write and refresh', async () => {
  const client = new HarnessClient({ command: process.execPath }), send = vi.spyOn(client, 'request').mockResolvedValue(branch)
  expect(await client.branchWorld(input)).toEqual(branch)
  expect(send).toHaveBeenLastCalledWith('simulation/world-branch', input)
  expect(await client.readWorldBranch({ commandId })).toEqual(branch)
  expect(send).toHaveBeenLastCalledWith('simulation/world-branch-read', { commandId })
  for (const changed of [{ ...branch, commandId: '22222222-2222-4222-8222-222222222222' },
    { ...branch, source: { ...source, archiveCommandId: 'other' } }, { ...branch, memoryPolicy: 'authorized-memory' },
    { ...branch, phase: 'running' }, { ...branch, realEffects: true }, { ...branch, privateMemory: 'secret' },
    { status: 'not-found', commandId }]) {
    send.mockResolvedValue(changed)
    await expect(client.branchWorld(input)).rejects.toBeInstanceOf(SdkProtocolError)
  }
  send.mockClear()
  await expect(client.branchWorld({ ...input, start: true } as typeof input)).rejects.toBeInstanceOf(SdkProtocolError)
  expect(send).not.toHaveBeenCalled()
})
it('correlates causal and comparison observations while enforcing complete response byte and node bounds', async () => {
  const client = new HarnessClient({ command: process.execPath }), send = vi.spyOn(client, 'request').mockResolvedValue(causal)
  const query = { source, root: 'event:1', maxDepth: 3, maxNodes: 1, maxBytes: 4096 }
  expect(await client.queryWorldCausal(query)).toEqual(causal)
  expect(send).toHaveBeenLastCalledWith('simulation/world-causal', query)
  send.mockResolvedValue({ ...causal, source: right })
  await expect(client.queryWorldCausal(query)).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockResolvedValue(causal)
  await expect(client.queryWorldCausal({ ...query, maxBytes: 1 })).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockResolvedValue({ ...causal, nodes: [0, 1].map(sequence => ({ key: `event:${sequence}`, kind: 'event', sequence, recordHash: 'b'.repeat(64) })) })
  await expect(client.queryWorldCausal(query)).rejects.toBeInstanceOf(SdkProtocolError)
  send.mockResolvedValue(comparison)
  expect(await client.compareWorlds({ left: source, right })).toEqual(comparison)
  expect(send).toHaveBeenLastCalledWith('simulation/world-compare', { left: source, right })
  send.mockResolvedValue({ ...comparison, observations: { left: right, right: source } })
  await expect(client.compareWorlds({ left: source, right })).rejects.toBeInstanceOf(SdkProtocolError)
})
