import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import ProductPrincipals, { productPrincipalId } from '@clocky/clocky-product-principal'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { TeamRuntime, fingerprintTeamFinalContent, teamHumanFinalInputSchema } from '@clocky/clocky-team'
import type { ParticipantSnapshot, TeamSnapshot, TeamStateSnapshot } from '@clocky/clocky-team'
import * as Inbox from '../src/index.ts'

abstract class TestTeamRuntime extends (TeamRuntime as unknown as new (ctx: Context) => TeamRuntime) {
  admitFinal(inbox: import('@clocky/clocky-team').TeamHumanDeliveryRuntime, input: import('@clocky/clocky-team').TeamHumanFinalInput) {
    return this.withHumanSinkProof({ kind: 'final', input }, async proof => await inbox.admitFinal(input, proof))
  }
  withFinalProof<T>(input: import('@clocky/clocky-team').TeamHumanFinalInput,
    operation: (proof: import('@clocky/clocky-team').TeamHumanSinkProof) => Promise<T>) {
    return this.withHumanSinkProof({ kind: 'final', input }, operation)
  }
  participants: ParticipantSnapshot[] = []
  override listTeamsPage(): Promise<import('@clocky/clocky-team').TeamListPage> { return Promise.resolve({ items: [] }) }
  override getTeam(): Promise<TeamStateSnapshot> {
    return Promise.resolve({ participants: this.participants, humanActions: [], channelIds: [] } as unknown as TeamStateSnapshot)
  }
}
const contexts = new Set<Context>()
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const config: Inbox.Config = {
  storagePageSize: 1, maxPageSize: 1, maxDeliveryBytes: 4096, maxPendingOperations: 16, watchTimeoutMs: 100, pollIntervalMs: 5,
}
const principalId = productPrincipalId('principal/with-partition-separator')
function call(id = principalId): AuthenticatedProductCall {
  return { principal: { id, issuer: 'test', subject: id, assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
}
function final(index = 0) {
  return teamHumanFinalInputSchema.parse({ teamId: 'team', channelId: 'channel', envelopeId: `final-${index}`, envelopeSequence: index + 2,
    contentFingerprint: fingerprintTeamFinalContent({ text: `Result ${index}` }), idempotencyKey: `final-${index}`, principalId, recipientId: 'human', text: `Result ${index}` })
}
async function setup(backend: 'json' | 'sqlite', root: string, limits: Partial<Inbox.Config> = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'inbox.sqlite') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TestTeamRuntime as unknown as new (ctx: Context) => TestTeamRuntime)
  const runtime = ctx.teams as TestTeamRuntime
  runtime.participants = [{ id: 'human', kind: 'human', phase: 'active', owner: { kind: 'product-principal', principalId },
    authorityGrant: { operations: ['dispatch'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} } } as unknown as ParticipantSnapshot]
  await ctx.plugin(ProductPrincipals)
  await ctx.plugin(Inbox, Object.assign({}, config, limits))
  return { ctx, runtime, inbox: ctx.teamHumanDelivery }
}
async function root() {
  await mkdir('.tmp', { recursive: true })
  const value = await mkdtemp(join(process.cwd(), '.tmp/inbox-'))
  roots.push(value)
  return value
}
describe.each(['json', 'sqlite'] as const)('%s principal inbox', (backend) => {
  it('rejects forged, revoked and payload-mismatched sink capabilities before accepting content', async () => {
    const f = await setup(backend, await root())
    await expect(f.inbox.admitFinal(final(), {} as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const revoked = await f.runtime.withFinalProof(final(), async proof => proof)
    await expect(f.inbox.admitFinal(final(), revoked)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(f.runtime.withFinalProof(final(), async proof =>
      await f.inbox.admitFinal({ ...final(), text: 'substituted' }, proof))).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(f.inbox.getMessageAdmission(final(), {} as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.inbox.read(call(), {})).items).toEqual([])
  })
  it('survives restart, deduplicates accepted finals and separates display from delivery', async () => {
    const path = await root()
    const first = await setup(backend, path)
    const one = await first.runtime.admitFinal(first.inbox, final())
    const two = await first.runtime.admitFinal(first.inbox, final(1))
    expect(one.sequence).toBe(0)
    expect(two.sequence).toBe(1)
    expect(await first.inbox.read(call(), {})).toMatchObject({ items: [one], displayCursor: -1, nextCursor: 0 })
    expect(await first.inbox.acknowledge(call(), { throughCursor: 0 })).toEqual({ displayCursor: 0 })
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)
    const recovered = await setup(backend, path)
    expect(await recovered.runtime.admitFinal(recovered.inbox, final())).toEqual(one)
    expect(await recovered.inbox.read(call(), {})).toMatchObject({ items: [two], displayCursor: 0 })
    expect(await recovered.inbox.acknowledge(call(), { throughCursor: 1 })).toEqual({ displayCursor: 1 })
    expect(await recovered.inbox.acknowledge(call(), { throughCursor: 0 })).toEqual({ displayCursor: 1 })
    expect((await recovered.inbox.read(call(), {})).items).toEqual([])
    expect((await recovered.inbox.read(call(), { afterCursor: -1 })).items).toEqual([one])
  })
  it('anchors the default display cursor in a durable checkpoint', async () => {
    const f = await setup(backend, await root())
    await f.runtime.admitFinal(f.inbox, final())
    await f.inbox.acknowledge(call(), { throughCursor: 0 })
    const info = (await f.ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))
    expect(info?.checkpointSequence).toBe(1)
    const readStarts: number[] = []
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    vi.spyOn(f.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await open(descriptor)
      const read = stream.read.bind(stream)
      vi.spyOn(stream, 'read').mockImplementation(async (afterSequence, limit) => {
        readStarts.push(afterSequence)
        return await read(afterSequence, limit)
      })
      return stream
    })
    expect((await f.inbox.read(call(), {})).items).toEqual([])
    expect(readStarts).not.toContain(-1)
    expect(readStarts[0]).toBe(0)
  })
  it('continues default reads after checkpoint-gated prefix compaction but rejects explicit history', async () => {
    const f = await setup(backend, await root())
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.inbox.acknowledge(call(), { throughCursor: first.sequence })
    const info = (await f.ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))
    if (info === undefined) throw new Error('Principal inbox stream was not materialized')
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try {
      const checkpoint = await stream.readCheckpoint()
      if (checkpoint === undefined) throw new Error('Principal inbox display checkpoint was not persisted')
      await stream.compact({ throughSequence: first.sequence, expectedCheckpointSequence: checkpoint.sequence })
      expect(stream.firstSequence).toBe(first.sequence + 1)
    } finally {
      await stream.close()
    }
    expect((await f.inbox.read(call(), {})).items).toEqual([second])
    await expect(f.inbox.read(call(), { afterCursor: -1 })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })
  it('keeps another principal isolated and rejects revoked or ambiguous recipient ownership', async () => {
    const f = await setup(backend, await root())
    await f.runtime.admitFinal(f.inbox, final())
    expect((await f.inbox.read(call(productPrincipalId('other')), {})).items).toEqual([])
    const abort = new AbortController(); abort.abort()
    await expect(f.inbox.read({ ...call(), signal: abort.signal }, {})).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    f.runtime.participants.push({ ...f.runtime.participants[0]!, id: 'second-human' as never })
    await expect(f.inbox.read(call(), {})).rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_AMBIGUOUS' })
    f.runtime.participants.length = 0
    await expect(f.inbox.read(call(), {})).rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' })
  })
  it('acknowledges only the selected prefix without requiring access to later deliveries', async () => {
    const f = await setup(backend, await root(), { maxPageSize: 2 })
    await f.runtime.admitFinal(f.inbox, final())
    await f.runtime.admitFinal(f.inbox, { ...final(1), recipientId: 'retired-human' as never })
    await expect(f.inbox.read(call(), {})).rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND' })
    await expect(f.inbox.acknowledge(call(), { throughCursor: 0 })).resolves.toEqual({ displayCursor: 0 })
  })
  it('rejects changed retries, oversized complete records and invalid display positions', async () => {
    const f = await setup(backend, await root())
    await f.runtime.admitFinal(f.inbox, final())
    await expect(f.runtime.admitFinal(f.inbox, { ...final(), text: 'changed' })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
    await expect(f.runtime.admitFinal(f.inbox, { ...final(1), text: 'x'.repeat(4096) })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    await expect(f.inbox.acknowledge(call(), { throughCursor: 20 })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(f.inbox.read(call(), { afterCursor: 20 })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })
  it('enforces policy again after page load and wakes a long poll without an Agent Session', async () => {
    const f = await setup(backend, await root())
    const waiting = f.inbox.watch(call(), {})
    const item = await f.runtime.admitFinal(f.inbox, final())
    expect((await waiting).items).toEqual([item])
    vi.spyOn(f.runtime, 'authorize').mockResolvedValue({ kind: 'deny', code: 'denied', message: 'not allowed' })
    await expect(f.inbox.read(call(), {})).rejects.toMatchObject({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' })
  })
  it('fails closed on a repeated Team-list cursor during delivery recovery', async () => {
    const f = await setup(backend, await root())
    const runOnce = (f.inbox as unknown as { readonly runOnce: () => Promise<void> }).runOnce.bind(f.inbox)
    await runOnce()
    const list = vi.spyOn(f.runtime, 'listTeamsPage')
      .mockResolvedValueOnce({ items: ['team' as unknown as TeamSnapshot], nextCursor: 0 })
      .mockResolvedValueOnce({ items: ['team' as unknown as TeamSnapshot], nextCursor: 0 })
    await runOnce()
    await expect(runOnce()).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('retries the same Team page after transient Team hydration failure', async () => {
    const f = await setup(backend, await root())
    const runOnce = (f.inbox as unknown as { readonly runOnce: () => Promise<void> }).runOnce.bind(f.inbox)
    await runOnce()
    const list = vi.spyOn(f.runtime, 'listTeamsPage').mockResolvedValue({
      items: [{ id: 'team-retry' }] as never,
      nextCursor: 0,
    })
    const state = { participants: f.runtime.participants, humanActions: [], channelIds: [] } as unknown as TeamStateSnapshot
    const getTeam = vi.spyOn(f.runtime, 'getTeam')
      .mockRejectedValueOnce(new Error('transient Team read'))
      .mockResolvedValue(state)

    await expect(runOnce()).rejects.toThrow('transient Team read')
    await expect(runOnce()).resolves.toBeUndefined()
    expect(list).toHaveBeenNthCalledWith(1, { afterCursor: -1, limit: 1 })
    expect(list).toHaveBeenNthCalledWith(2, { afterCursor: -1, limit: 1 })
    expect(getTeam).toHaveBeenCalledTimes(2)
  })

  it('fails closed when durable inbox storage repeats one row sequence', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    ctx.provide('teams', {
      registerSystemHumanDeliveryProofSource: vi.fn(() => () => {}),
    } as never)
    const client = new Inbox.TeamHumanClient(ctx, config)
    const value = { ...final(), kind: 'final' as const, sequence: 0 }
    const stream = {
      firstSequence: 0,
      tailSequence: 0,
      read: vi.fn(async () => [{ sequence: 0, value }]),
    }
    const records = (client as unknown as {
      records(stream: unknown, principalId: unknown): AsyncGenerator
    }).records(stream, principalId)
    const consume = async (): Promise<void> => {
      for await (const _record of records) {}
    }
    await expect(consume()).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })
})
