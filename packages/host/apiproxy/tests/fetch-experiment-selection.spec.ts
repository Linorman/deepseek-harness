import { simulationProductExperimentSourceSchema } from '@clocky/clocky-simulation-product/experiment-schema'
/** Host carrier rejects responses for a different private archive or branch original. */
import { expect, it } from 'vitest'
import { InProcessApiClient } from '../src/fetch/client.ts'
function client(value: unknown) {
  return new InProcessApiClient({ fetch: async (request, init) => {
    const frame = await new Request(request, init).json() as { rpcId: string }
    return new Response(JSON.stringify({ type: 'server-response', rpcId: frame.rpcId, result: { ok: true, value } }),
      { headers: { 'content-type': 'application/json' } })
  } })
}
const source = simulationProductExperimentSourceSchema.parse({ runId: 'parent', archiveCommandId: 'archive' }), commandId = '11111111-1111-4111-8111-111111111111'
const input = { source, commandId, name: 'Branch', memoryPolicy: 'public-facts' as const }
const branch = { status: 'completed', commandId, runId: commandId, source, sourceHash: 'a'.repeat(64),
  memoryPolicy: 'public-facts', phase: 'paused', realEffects: false }
it('preserves branch command and private source selection without starting the returned paused run', async () => {
  expect((await client(branch).simulations.branchWorld(input)).result).toEqual({ ok: true, value: branch })
  expect((await client(branch).simulations.readWorldBranch({ commandId })).result).toEqual({ ok: true, value: branch })
  for (const changed of [{ ...branch, source: { ...source, runId: 'other' } },
    { ...branch, memoryPolicy: 'authorized-memory' }, { status: 'not-found', commandId }])
    await expect(client(changed).simulations.branchWorld(input)).rejects.toThrow(/original selection/)
  await expect(client({ ...branch, commandId: '22222222-2222-4222-8222-222222222222' }).simulations.readWorldBranch({ commandId }))
    .rejects.toThrow(/original selection/)
})
it('refuses an otherwise valid causal page for another archived cut or outside the complete byte budget', async () => {
  const value = { source, sourceHash: 'a'.repeat(64), nodes: [], edges: [], coverage: 'unknown' }
  const query = { source, root: 'event:1', maxDepth: 2, maxNodes: 1, maxBytes: 4096 }
  expect((await client(value).simulations.queryWorldCausal(query)).result).toEqual({ ok: true, value })
  await expect(client({ ...value, source: { ...source, archiveCommandId: 'other' } }).simulations.queryWorldCausal(query))
    .rejects.toThrow(/original selection/)
  await expect(client(value).simulations.queryWorldCausal({ ...query, maxBytes: 1 })).rejects.toThrow(/bounds/)
})

it('checks both original observation selections on comparison responses', async () => {
  const right = simulationProductExperimentSourceSchema.parse({ runId: 'sibling', archiveCommandId: 'sibling-cut' })
  const value = { version: 1, observations: { left: source, right },
    parentCut: { runId: 'original', hash: 'a'.repeat(64), revision: 1 },
    variables: { left: {}, right: {} }, memoryPolicy: { left: 'public-facts', right: 'public-facts' },
    budget: { left: { maxTokens: 10, maxTime: '100' }, right: { maxTokens: 10, maxTime: '100' } }, differences: [],
    quality: { status: 'unknown' }, cost: { status: 'unknown' },
    stop: { left: { phase: 'paused', time: '0', stall: null }, right: { phase: 'paused', time: '0', stall: null } },
    nondeterminism: 'Recorded observations can differ', causalConclusion: 'not-established' }
  expect((await client(value).simulations.compareWorlds({ left: source, right })).result).toEqual({ ok: true, value })
  await expect(client({ ...value, observations: { left: right, right: source } }).simulations.compareWorlds({ left: source, right }))
    .rejects.toThrow(/original selection/)
})
