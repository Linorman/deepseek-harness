import { indexInboxAdmission, readInboxAdmission } from '../src/admission-index.ts'
import { teamDiscoveryCursorSchema, teamHumanActionResponseInputSchema, teamHumanMessageInputSchema, teamSnapshotSchema } from '@clocky/clocky-team'
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
import { TeamRuntime, fingerprintTeamFinalContent, jsonObjectSchema, teamHumanFinalInputSchema, teamHumanInboxActionSchema } from '@clocky/clocky-team'
import type { ParticipantSnapshot, TeamSnapshot, TeamStateSnapshot } from '@clocky/clocky-team'
import * as Inbox from '../src/index.ts'

abstract class TestTeamRuntime extends (TeamRuntime as unknown as new (ctx: Context) => TeamRuntime) {
  admitMessage(inbox: import('@clocky/clocky-team').TeamHumanDeliveryRuntime, input: import('@clocky/clocky-team').TeamHumanMessageInput) {
    return this.withHumanSinkProof({ kind: 'message', input }, async proof => await inbox.admitMessage(input, proof))
  }
  admitFinal(inbox: import('@clocky/clocky-team').TeamHumanDeliveryRuntime, input: import('@clocky/clocky-team').TeamHumanFinalInput) {
    return this.withHumanSinkProof({ kind: 'final', input }, async proof => await inbox.admitFinal(input, proof))
  }
  withFinalProof<T>(input: import('@clocky/clocky-team').TeamHumanFinalInput,
    operation: (proof: import('@clocky/clocky-team').TeamHumanSinkProof) => Promise<T>) {
    return this.withHumanSinkProof({ kind: 'final', input }, operation)
  }
  participants: ParticipantSnapshot[] = []
  override listTeamsPage(): Promise<import('@clocky/clocky-team').TeamListPage> { return Promise.resolve({ items: [], scanned: 0 }) }
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
function actionItem(sequence = 0) {
  return teamHumanInboxActionSchema.parse({ kind: 'action', principalId, recipientId: 'human', teamId: 'team', sequence,
    text: 'Await approval', action: { id: 'approval', teamId: 'team', sessionId: 'session', participantId: 'worker', sourceId: 'approval-source',
      kind: 'approval', phase: 'pending', createdAt: 1, updatedAt: 1, details: { toolName: 'shell', reason: 'Confirm', callId: 'call' } } })
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
async function retainedFirst(ctx: Context): Promise<number> {
  const info = (await ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))!
  const stream = await ctx.storageLog.open({ name: info.name, version: info.version })
  try { return stream.firstSequence } finally { await stream.close() }
}
const retention: Inbox.InboxRetentionConfig = { tailRecords: 1, maxStreamsPerDrive: 32, maxRecordsPerDrive: 4, maxBytesPerDrive: 8192 }

describe.each(['json', 'sqlite'] as const)('%s principal inbox', (backend) => {
  it('deduplicates ordinary message admission and rejects changed retries or oversized content', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const input = teamHumanMessageInputSchema.parse({ principalId, recipientId: 'human', teamId: 'team', channelId: 'channel',
      envelopeId: 'message', text: 'Message', envelope: { id: 'message', teamId: 'team', channelId: 'channel', sequence: 1,
        senderId: 'coordinator', audience: ['human'], kind: 'message', payload: { text: 'Message' }, delivery: 'turn', priority: 'normal', createdAt: 1 } })
    const item = await f.runtime.admitMessage(f.inbox, input)
    expect(await f.runtime.admitMessage(f.inbox, input)).toEqual(item)
    await expect(f.runtime.admitMessage(f.inbox, { ...input, text: 'Changed' })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const another = teamHumanMessageInputSchema.parse({ ...input, envelopeId: 'large', text: 'x'.repeat(4096),
      envelope: { ...input.envelope, id: 'large' } })
    await expect(f.runtime.admitMessage(f.inbox, another)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    expect((await f.inbox.read(call(), {})).items).toEqual([item])
  })

  it('delivers action revisions once, enforces policy and size, and rejects mutation of an accepted revision', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const action = actionItem().action
    const team = teamSnapshotSchema.parse({ id: action.teamId, cursor: 0, createdAt: 0, updatedAt: 0, phase: 'active', depth: 0, maxTeamDepth: 1,
      goal: { teamId: action.teamId, revision: 1, objective: 'Answer action', phase: 'active', budgets: {} } })
    const human = { ...f.runtime.participants[0]!, authorityGrant: { operations: ['dispatch', 'human-action'] as const,
      workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} } }
    let state = { ...await f.runtime.getTeam(), team, participants: [human], humanActions: [action] }
    vi.spyOn(f.runtime, 'getTeam').mockImplementation(async () => state)
    vi.spyOn(f.runtime, 'listTeamsPage').mockResolvedValue({ items: [team], scanned: 1 })
    const policy = vi.spyOn(f.runtime, 'authorize').mockResolvedValue({ kind: 'deny', code: 'DENIED', message: 'Not visible' })
    await service.runOnce()
    expect((await f.inbox.read(call(), {})).items).toEqual([])
    policy.mockResolvedValue({ kind: 'allow' })
    await service.runOnce()
    await service.runOnce()
    expect((await f.inbox.read(call(), {})).items).toMatchObject([{ kind: 'action', sequence: 0, action }])
    state = { ...state, humanActions: [{ ...action, details: { reason: 'changed revision content' } }] }
    await expect(service.runOnce()).rejects.toThrow('revision changed its retained content')
    state = { ...state, humanActions: [{ ...action, updatedAt: 2, details: { reason: 'x'.repeat(4096) } }] }
    await expect(service.runOnce()).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    state = { ...state, humanActions: [{ ...action, updatedAt: 2, phase: 'resolved', outcome: { answer: 'Approved' } }] }
    await service.runOnce()
    expect((await f.inbox.read(call(), { afterCursor: 0 })).items).toMatchObject([{ sequence: 1, action: { updatedAt: 2, phase: 'resolved' } }])
  })

  it('routes an action to a current responder and removes its authority on disposal', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const input = teamHumanActionResponseInputSchema.parse({ teamId: 'team', actionId: 'approval', expectedUpdatedAt: 1,
      idempotencyKey: 'answer', answer: { kind: 'approval', outcome: 'rejected' } })
    const action = actionItem().action
    const fallback = vi.fn(async () => ({ kind: 'unavailable' as const, action }))
    const first = f.inbox.registerActionResponder({ respond: async () => undefined, unavailable: fallback })
    const accepted = f.inbox.registerActionResponder({ respond: async () => ({ kind: 'accepted', action }),
      unavailable: async () => { throw new Error('Only the first available fallback should run') } })
    expect(await f.inbox.respond(call(), input)).toEqual({ kind: 'accepted', action })
    expect(fallback).not.toHaveBeenCalled()
    accepted()
    expect(await f.inbox.respond(call(), input)).toEqual({ kind: 'unavailable', action })
    expect(fallback).toHaveBeenCalledOnce()
    first()
    await expect(f.inbox.respond(call(), input)).rejects.toThrow('No human-action continuation provider')
  })

  it.each(['accepted', 'unavailable'] as const)('does not return %s action data after its principal revokes during the callback', async (kind) => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const abort = new AbortController()
    const input = teamHumanActionResponseInputSchema.parse({ teamId: 'team', actionId: 'approval', expectedUpdatedAt: 1,
      idempotencyKey: 'answer', answer: { kind: 'approval', outcome: 'allowed-once' } })
    f.inbox.registerActionResponder({
      async respond() {
        if (kind === 'unavailable') return undefined
        abort.abort()
        return { kind, action: actionItem().action }
      },
      async unavailable() { abort.abort(); return { kind: 'unavailable', action: actionItem().action } },
    })
    await expect(f.inbox.respond({ ...call(), signal: abort.signal }, input)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })

  it('allows a policy-triggered delivery while acknowledging only the selected display position', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const first = await f.runtime.admitFinal(f.inbox, final())
    const authorize = f.runtime.authorize.bind(f.runtime)
    let reads = 0
    let delivery: Promise<unknown> | undefined
    vi.spyOn(f.runtime, 'authorize').mockImplementation(async (request) => {
      if (request.facts.operation === 'principal-inbox-read' && ++reads === 2) {
        const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
        let entered = false
        const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
          entered = true
          return await open(descriptor)
        })
        try {
          delivery = f.runtime.admitFinal(f.inbox, final(1))
          await new Promise(resolve => setImmediate(resolve))
          expect(entered, 'inbox queue must be free while Team policy runs').toBe(true)
          await delivery
        } finally { opening.mockRestore() }
      }
      return await authorize(request)
    })
    try {
      expect(await f.inbox.acknowledge(call(), { throughCursor: first.sequence })).toEqual({ displayCursor: first.sequence })
      expect((await f.inbox.read(call(), {})).items.map(item => item.kind === 'final' ? item.envelopeId : item.kind)).toEqual(['final-1'])
    } finally { await delivery }
  })

  it('keeps a newer display acknowledgement when retention removes the selected row during policy', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention })
    await (f.inbox as Inbox.TeamHumanClient).runOnce()
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    const authorize = f.runtime.authorize.bind(f.runtime)
    let reads = 0
    vi.spyOn(f.runtime, 'authorize').mockImplementation(async (request) => {
      if (request.facts.operation === 'principal-inbox-read' && ++reads === 2) {
        await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
        await (f.inbox as Inbox.TeamHumanClient).runOnce()
      }
      return await authorize(request)
    })
    expect(await f.inbox.acknowledge(call(), { throughCursor: first.sequence })).toEqual({ displayCursor: second.sequence })
    expect(await retainedFirst(f.ctx)).toBe(second.sequence + 1)
    expect((await f.ctx.storageLog.list()).find(value => value.name.startsWith('principal-inbox/'))?.tailSequence).toBe(2)
  })

  it('refuses display advancement if credentials revoke during the final policy check', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const item = await f.runtime.admitFinal(f.inbox, final())
    const abort = new AbortController()
    const authorize = f.runtime.authorize.bind(f.runtime)
    let reads = 0
    vi.spyOn(f.runtime, 'authorize').mockImplementation(async (request) => {
      if (request.facts.operation === 'principal-inbox-read' && ++reads === 2) abort.abort()
      return await authorize(request)
    })
    await expect(f.inbox.acknowledge({ ...call(), signal: abort.signal }, { throughCursor: item.sequence }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    expect((await f.inbox.read(call(), {})).displayCursor).toBe(-1)
  })

  it('rejects a retained delivery that changes while display policy is running', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const item = await f.runtime.admitFinal(f.inbox, final())
    const authorize = f.runtime.authorize.bind(f.runtime)
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    let reads = 0
    let restore: (() => void) | undefined
    vi.spyOn(f.runtime, 'authorize').mockImplementation(async (request) => {
      if (request.facts.operation === 'principal-inbox-read' && ++reads === 2) {
        const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementationOnce(async (descriptor) => {
          const stream = await open(descriptor)
          const read = stream.read.bind(stream)
          vi.spyOn(stream, 'read').mockImplementation(async (...args) => (await read(...args)).map(row => ({ ...row,
            value: row.sequence === item.sequence ? { ...jsonObjectSchema.parse(row.value), text: 'Changed after authorization' } : row.value })))
          return stream
        })
        restore = () => { opening.mockRestore() }
      }
      return await authorize(request)
    })
    try {
      await expect(f.inbox.acknowledge(call(), { throughCursor: item.sequence }))
        .rejects.toThrow('delivery changed during authorization')
    } finally { restore?.() }
    expect((await f.inbox.read(call(), {})).displayCursor).toBe(-1)
  })

  it('reclaims displayed final text while retaining exact retry evidence across restart', async () => {
    const path = await root()
    const f = await setup(backend, path, { pollIntervalMs: 60000, maxDeliveryBytes: 32768,
      retention: { ...retention, maxBytesPerDrive: 32768 } })
    await (f.inbox as Inbox.TeamHumanClient).runOnce()
    const text = 'Final evidence 🙂'.repeat(512)
    const input = { ...final(), text, contentFingerprint: fingerprintTeamFinalContent({ text }) }
    const item = await f.runtime.admitFinal(f.inbox, input)
    await f.inbox.acknowledge(call(), { throughCursor: item.sequence })
    await (f.inbox as Inbox.TeamHumanClient).runOnce()
    const info = (await f.ctx.storageLog.list()).find(value => value.name.startsWith('principal-inbox-admission/'))!
    const anchor = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try {
      const encoded = JSON.stringify((await anchor.read(-1, 1))[0]?.value)
      expect(encoded).not.toContain('Final evidence')
      expect(Buffer.byteLength(encoded)).toBeLessThan(1024)
    } finally { await anchor.close() }
    await f.ctx.fiber.dispose()
    contexts.delete(f.ctx)
    const resumed = await setup(backend, path, { pollIntervalMs: 60000 })
    expect(await resumed.runtime.admitFinal(resumed.inbox, input)).toEqual(item)
    await expect(resumed.runtime.admitFinal(resumed.inbox, { ...input, text: `${text}!` }))
      .rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
    expect((await resumed.inbox.read(call(), {})).items).toEqual([])
  })

  it('counts digest metadata before accepting a retention batch with short final text', async () => {
    const input = { ...final(), text: 'x', contentFingerprint: fingerprintTeamFinalContent({ text: 'x' }) }
    const maxBytesPerDrive = Buffer.byteLength(JSON.stringify({ ...input, kind: 'final', sequence: 0 }))
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention: { ...retention, maxBytesPerDrive } })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const item = await f.runtime.admitFinal(f.inbox, input)
    await f.inbox.acknowledge(call(), { throughCursor: item.sequence })
    await expect(service.runOnce()).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    expect(await retainedFirst(f.ctx)).toBe(0)
    expect((await f.ctx.storageLog.list()).some(value => value.name.startsWith('principal-inbox-admission/'))).toBe(false)
  })

  it.each([-1, 0])('enforces the complete final-anchor byte boundary with offset %s', async (offset) => {
    const input = { ...final(), text: 'x', contentFingerprint: fingerprintTeamFinalContent({ text: 'x' }) }
    const { text: _text, ...metadata } = input
    const anchorBytes = Buffer.byteLength(JSON.stringify({ ...metadata, kind: 'final', sequence: 0, textSha256: '0'.repeat(64) }))
    const f = await setup(backend, await root(), { pollIntervalMs: 60000,
      retention: { ...retention, maxBytesPerDrive: anchorBytes + offset } })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const item = await f.runtime.admitFinal(f.inbox, input)
    await f.inbox.acknowledge(call(), { throughCursor: item.sequence })
    if (offset < 0) {
      await expect(service.runOnce()).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      expect(await retainedFirst(f.ctx)).toBe(0)
    } else {
      await service.runOnce()
      expect(await retainedFirst(f.ctx)).toBe(1)
      const info = (await f.ctx.storageLog.list()).find(value => value.name.startsWith('principal-inbox-admission/'))!
      const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
      try { expect(Buffer.byteLength(JSON.stringify((await stream.read(-1, 1))[0]?.value))).toBe(anchorBytes) }
      finally { await stream.close() }
      expect(await f.runtime.admitFinal(f.inbox, input)).toEqual(item)
    }
  })

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
  it.each([
    { phase: 'append-response', base: 'fresh' }, { phase: 'checkpoint-write', base: 'fresh' },
    { phase: 'append-response', base: 'checkpoint' }, { phase: 'checkpoint-write', base: 'checkpoint' },
    { phase: 'append-response', base: 'compacted' }, { phase: 'checkpoint-write', base: 'compacted' },
  ] as const)(
    'replays a committed display acknowledgement after $phase failure from $base history and restart', async ({ phase, base }) => {
      const path = await root()
      const f = await setup(backend, path, { pollIntervalMs: 60000, retention })
      const service = f.inbox as Inbox.TeamHumanClient
      await service.runOnce()
      const first = await f.runtime.admitFinal(f.inbox, final())
      if (base !== 'fresh') await f.inbox.acknowledge(call(), { throughCursor: first.sequence })
      if (base === 'compacted') await service.runOnce()
      const second = await f.runtime.admitFinal(f.inbox, final(1))
      const failure = new Error('Display acknowledgement interrupted before checkpoint')
      const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
      const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('principal-inbox/')) {
          if (phase === 'append-response') {
            const append = stream.append.bind(stream)
            vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
              await append(...args)
              throw failure
            })
          } else vi.spyOn(stream, 'writeCheckpoint').mockRejectedValue(failure)
        }
        return stream
      })
      try { await expect(f.inbox.acknowledge(call(), { throughCursor: second.sequence })).rejects.toBe(failure) }
      finally { opening.mockRestore() }
      const unread = await f.runtime.admitFinal(f.inbox, final(2))
      await f.ctx.fiber.dispose()
      contexts.delete(f.ctx)
      const recovered = await setup(backend, path, { pollIntervalMs: 60000, retention })
      expect(await recovered.inbox.read(call(), {})).toMatchObject({ items: [unread], displayCursor: second.sequence })
      expect(await recovered.inbox.acknowledge(call(), { throughCursor: first.sequence }))
        .toEqual({ displayCursor: second.sequence })
      await (recovered.inbox as Inbox.TeamHumanClient).runOnce()
      expect(await retainedFirst(recovered.ctx)).toBe(second.sequence + 1)
      expect(await recovered.runtime.admitFinal(recovered.inbox, final())).toEqual(first)
      expect(await recovered.runtime.admitFinal(recovered.inbox, final(1))).toEqual(second)
    })
  it.each(['rewound', 'display-target'] as const)('rejects a %s display record after its checkpoint', async (mode) => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    const info = (await f.ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))!
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try {
      await stream.append(stream.tailSequence, [{ kind: 'display', principalId,
        throughCursor: mode === 'rewound' ? first.sequence : stream.tailSequence }])
    } finally { await stream.close() }
    await expect(f.inbox.read(call(), {})).rejects.toThrow('monotonic retained delivery')
    await expect(f.inbox.acknowledge(call(), { throughCursor: first.sequence })).rejects.toThrow('monotonic retained delivery')
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
    await expect(f.inbox.read(call(), { afterCursor: -1 })).rejects.toMatchObject({
      code: 'TEAM_INBOX_COMPACTED', details: { firstCursor: first.sequence + 1 },
    })
    expect((await f.inbox.read(call(), { afterCursor: first.sequence })).items).toEqual([second])
  })
  it('does not compact displayed history when retention is omitted', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000 })
    const first = await f.runtime.admitFinal(f.inbox, final())
    await f.inbox.acknowledge(call(), { throughCursor: first.sequence })
    await (f.inbox as Inbox.TeamHumanClient).runOnce()
    expect(await retainedFirst(f.ctx)).toBe(0)
  })

  it.each(['tailRecords', 'maxStreamsPerDrive', 'maxRecordsPerDrive', 'maxBytesPerDrive'] as const)(
    'rejects a zero retention %s at plugin load', async (field) => {
      await expect(setup(backend, await root(), { retention: { ...retention, [field]: 0 } })).rejects.toThrow()
    })

  it.each(['checkpoint', 'compact'] as const)('recovers a retention %s response lost after its durable commit', async (phase) => {
    const path = await root()
    const f = await setup(backend, path, { pollIntervalMs: 60000, retention })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    const failure = new Error('Retention response lost after commit')
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    let injected = false
    const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await open(descriptor)
      if (descriptor.name.startsWith('principal-inbox/')) {
        if (phase === 'checkpoint') {
          const write = stream.writeCheckpoint.bind(stream)
          vi.spyOn(stream, 'writeCheckpoint').mockImplementation(async (checkpoint) => {
            await write(checkpoint)
            if (!injected) { injected = true; throw failure }
          })
        } else {
          const compact = stream.compact.bind(stream)
          vi.spyOn(stream, 'compact').mockImplementation(async (request) => {
            await compact(request)
            if (!injected) { injected = true; throw failure }
          })
        }
      }
      return stream
    })
    try {
      await expect(service.runOnce()).rejects.toBe(failure)
      expect(await retainedFirst(f.ctx)).toBe(phase === 'checkpoint' ? 0 : second.sequence + 1)
      expect(await f.runtime.admitFinal(f.inbox, final())).toEqual(first)
    } finally { opening.mockRestore() }
    await f.ctx.fiber.dispose()
    contexts.delete(f.ctx)
    const recovered = await setup(backend, path, { pollIntervalMs: 60000, retention })
    await (recovered.inbox as Inbox.TeamHumanClient).runOnce()
    expect(await retainedFirst(recovered.ctx)).toBe(second.sequence + 1)
    expect(await recovered.runtime.admitFinal(recovered.inbox, final())).toEqual(first)
  })

  it.each(['missing', 'future'] as const)('refuses retention when a compacted prefix has a %s admission watermark', async (mode) => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.runtime.admitFinal(f.inbox, final(2))
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    const info = (await f.ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))!
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try {
      const checkpoint = (await stream.readCheckpoint())!
      if (mode === 'future') await stream.writeCheckpoint({ sequence: checkpoint.sequence,
        value: { version: 1, principalId, displayCursor: second.sequence, indexedThroughCursor: checkpoint.sequence + 1 } })
      await stream.compact({ throughSequence: 0, expectedCheckpointSequence: checkpoint.sequence })
    } finally { await stream.close() }
    await expect(service.runOnce()).rejects.toThrow('retention checkpoint is invalid')
    expect(await retainedFirst(f.ctx)).toBe(1)
    await expect(f.runtime.admitFinal(f.inbox, final())).rejects.toThrow('no admission reference checkpoint')
    expect((await f.ctx.storageLog.list()).some(item => item.name.startsWith('principal-inbox-admission/'))).toBe(false)
  })

  it('compacts only displayed prefixes within the configured drive budget and keeps receipt retries durable', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention: { ...retention, maxRecordsPerDrive: 1 } })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    const unread = await f.runtime.admitFinal(f.inbox, final(2))
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(0)
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(1)
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(2)
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(2)
    expect((await f.inbox.read(call(), {})).items).toEqual([unread])
    expect(await f.runtime.admitFinal(f.inbox, final())).toEqual(first)
  })

  it('leaves the prefix intact when one record exceeds the retention byte budget', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention: { ...retention, maxBytesPerDrive: 1 } })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const first = await f.runtime.admitFinal(f.inbox, final())
    await f.inbox.acknowledge(call(), { throughCursor: first.sequence })
    await expect(service.runOnce()).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    expect(await retainedFirst(f.ctx)).toBe(0)
    expect((await f.ctx.storageLog.list()).some(item => item.name.startsWith('principal-inbox-admission/'))).toBe(false)
  })

  it('pins an unanswered action even after display acknowledgement, then releases its history after resolution', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    f.runtime.participants = f.runtime.participants.map(member => ({ ...member, authorityGrant: {
      operations: ['dispatch', 'human-action'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {},
    } }))
    await f.runtime.admitFinal(f.inbox, final())
    const item = actionItem(1)
    const info = (await f.ctx.storageLog.list()).find(value => value.name.startsWith('principal-inbox/'))!
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try { await stream.append(stream.tailSequence, [item]) } finally { await stream.close() }
    const last = await f.runtime.admitFinal(f.inbox, final(1))
    const action = vi.spyOn(f.runtime, 'getHumanAction').mockResolvedValue(item.action)
    await f.inbox.acknowledge(call(), { throughCursor: last.sequence })
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(1)
    action.mockResolvedValue({ ...item.action, phase: 'resolved', updatedAt: 2 })
    await service.runOnce()
    expect(await retainedFirst(f.ctx)).toBe(last.sequence + 1)
    expect(await readInboxAdmission(f.ctx, item)).toEqual(item)
  })

  it('keeps history and its checkpoint unchanged when an admission-anchor write fails, and retries the copy', async () => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention })
    const service = f.inbox as Inbox.TeamHumanClient
    await service.runOnce()
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    const failure = new Error('Admission anchor storage unavailable')
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    let indexes = 0
    const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await open(descriptor)
      if (descriptor.name.startsWith('principal-inbox-admission/') && ++indexes === 2) {
        vi.spyOn(stream, 'append').mockRejectedValueOnce(failure)
      }
      return stream
    })
    try {
      await expect(service.runOnce()).rejects.toBe(failure)
      expect(await retainedFirst(f.ctx)).toBe(0)
      await service.runOnce()
      expect(await retainedFirst(f.ctx)).toBe(second.sequence + 1)
      expect(await f.runtime.admitFinal(f.inbox, final())).toEqual(first)
    } finally { opening.mockRestore() }
  })

  it('retains final admission identity across indexed prefix compaction, later display acknowledgement and restart', async () => {
    const path = await root()
    const f = await setup(backend, path)
    const first = await f.runtime.admitFinal(f.inbox, final())
    const second = await f.runtime.admitFinal(f.inbox, final(1))
    await f.runtime.admitFinal(f.inbox, final(2))
    await f.inbox.acknowledge(call(), { throughCursor: second.sequence })
    await indexInboxAdmission(f.ctx, first)
    await indexInboxAdmission(f.ctx, second)
    await indexInboxAdmission(f.ctx, first)
    const info = (await f.ctx.storageLog.list()).find(item => item.name.startsWith('principal-inbox/'))!
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try {
      const checkpoint = (await stream.readCheckpoint())!
      await stream.writeCheckpoint({ sequence: checkpoint.sequence,
        value: { version: 1, principalId, displayCursor: second.sequence, indexedThroughCursor: second.sequence } })
      await stream.compact({ throughSequence: second.sequence, expectedCheckpointSequence: checkpoint.sequence })
    } finally { await stream.close() }
    expect(await f.runtime.admitFinal(f.inbox, final())).toEqual(first)
    const changed = { ...final(), text: 'changed', contentFingerprint: fingerprintTeamFinalContent({ text: 'changed' }) }
    await expect(f.runtime.admitFinal(f.inbox, changed)).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
    const fresh = await f.runtime.admitFinal(f.inbox, final(3))
    expect(fresh.sequence).toBeGreaterThan(second.sequence)
    await f.inbox.acknowledge(call(), { throughCursor: fresh.sequence })
    await f.ctx.fiber.dispose()
    contexts.delete(f.ctx)
    const recovered = await setup(backend, path)
    expect(await recovered.runtime.admitFinal(recovered.inbox, final())).toEqual(first)
    expect(await recovered.inbox.read(call(), {})).toMatchObject({ items: [], displayCursor: fresh.sequence })
    await expect(recovered.inbox.read(call(), { afterCursor: -1 })).rejects.toMatchObject({ code: 'TEAM_INBOX_COMPACTED' })
  })

  it('rejects changed or malformed immutable admission anchors without exposing another principal', async () => {
    const f = await setup(backend, await root())
    const item = await f.runtime.admitFinal(f.inbox, final())
    await indexInboxAdmission(f.ctx, item)
    expect(await readInboxAdmission(f.ctx, item)).toEqual(item)
    expect(await readInboxAdmission(f.ctx, { ...item, principalId: productPrincipalId('other') })).toBeUndefined()
    await expect(indexInboxAdmission(f.ctx, { ...item, sequence: item.sequence + 1 })).rejects.toThrow('immutable')
    const info = (await f.ctx.storageLog.list()).find(stream => stream.name.startsWith('principal-inbox-admission/') && stream.tailSequence === 0)!
    const stream = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    try { await stream.append(0, [item]) } finally { await stream.close() }
    await expect(readInboxAdmission(f.ctx, item)).rejects.toThrow('one immutable record')
  })

  it.each(['final', 'action'] as const)('rejects an indexed %s from another principal even when its storage sequence matches', async (kind) => {
    const f = await setup(backend, await root())
    const item = kind === 'final' ? await f.runtime.admitFinal(f.inbox, final()) : actionItem()
    await indexInboxAdmission(f.ctx, item)
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementationOnce(async (descriptor) => {
      const stream = await open(descriptor)
      const [row] = await stream.read(-1, 1)
      if (row === undefined) throw new Error('Expected a persisted admission anchor')
      vi.spyOn(stream, 'read').mockResolvedValueOnce([{ sequence: 0,
        value: { ...jsonObjectSchema.parse(row.value), principalId: productPrincipalId('other') } }])
      return stream
    })
    try { await expect(readInboxAdmission(f.ctx, item)).rejects.toThrow('identity does not match its key') }
    finally { opening.mockRestore() }
    expect(await readInboxAdmission(f.ctx, item)).toEqual(item)
  })

  it('rejects a final digest stored under an ordinary-message identity', async () => {
    const f = await setup(backend, await root())
    const item = await f.runtime.admitFinal(f.inbox, final())
    await indexInboxAdmission(f.ctx, item)
    const info = (await f.ctx.storageLog.list()).find(value => value.name.startsWith('principal-inbox-admission/'))!
    const source = await f.ctx.storageLog.open({ name: info.name, version: info.version })
    let value: unknown
    try { value = (await source.read(-1, 1))[0]!.value } finally { await source.close() }
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementationOnce(async (descriptor) => {
      const stream = await open(descriptor)
      await stream.append(-1, [value])
      return stream
    })
    try {
      await expect(readInboxAdmission(f.ctx, { ...item, kind: 'message' }))
        .rejects.toThrow('identity does not match its key')
    } finally { opening.mockRestore() }
  })

  it.each(['\ud801', '\ufffd'])('does not equate distinct text after UTF-8 replacement (%j)', async (changed) => {
    const f = await setup(backend, await root(), { pollIntervalMs: 60000, retention })
    const text = '\ud800'
    const input = { ...final(), text, contentFingerprint: fingerprintTeamFinalContent({ text }) }
    const item = await f.runtime.admitFinal(f.inbox, input)
    await f.inbox.acknowledge(call(), { throughCursor: item.sequence })
    await (f.inbox as Inbox.TeamHumanClient).runOnce()
    expect(await f.runtime.admitFinal(f.inbox, input)).toEqual(item)
    await expect(f.runtime.admitFinal(f.inbox, { ...input, text: changed })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
  })

  it('rejects version-one admission anchors without rewriting them', async () => {
    const f = await setup(backend, await root())
    const item = await f.runtime.admitFinal(f.inbox, final())
    const open = f.ctx.storageLog.open.bind(f.ctx.storageLog)
    const opening = vi.spyOn(f.ctx.storageLog, 'open').mockImplementationOnce(async (descriptor) => {
      const legacy = await open({ ...descriptor, version: 1 })
      try { await legacy.append(-1, [item]) } finally { await legacy.close() }
      return await open(descriptor)
    })
    try { await expect(readInboxAdmission(f.ctx, item)).rejects.toMatchObject({ code: 'version-mismatch' }) }
    finally { opening.mockRestore() }
    await expect(readInboxAdmission(f.ctx, item)).rejects.toMatchObject({ code: 'version-mismatch' })
    const info = (await f.ctx.storageLog.list()).find(stream => stream.name.startsWith('principal-inbox-admission/'))!
    expect(info.version).toBe(1)
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
      .mockResolvedValueOnce({ items: ['team' as unknown as TeamSnapshot], scanned: 1, nextCursor: teamDiscoveryCursorSchema.parse('next') })
      .mockResolvedValueOnce({ items: ['team' as unknown as TeamSnapshot], scanned: 1, nextCursor: teamDiscoveryCursorSchema.parse('next') })
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
      scanned: 1, nextCursor: teamDiscoveryCursorSchema.parse('next'),
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
