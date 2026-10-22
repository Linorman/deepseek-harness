/** Real JSON/SQLite streams and the opt-in Host service retain finite grants and unknown outcomes. */
import { expect, it, vi } from 'vitest'
import { fixture, call } from './fixtures.ts'
import Sandbox from '../src/external-effect-sandbox.ts'
import { ExternalEffectOwner } from '../src/external-effect-owner.ts'
import type { ExternalEffectAdapter } from '../src/external-effect-owner.ts'

const intent = { effectId: 'action-1', adapterId: 'local-sandbox', action: 'record-test-action', target: 'local-test-ledger', units: 2, payload: 'test' }
const grant = { grantId: 'grant-1', effectId: intent.effectId, action: intent.action, target: intent.target,
  maxUnits: 2, expiresAt: 4102444800000, environment: 'test' as const }
const config = { stream: 'external-test', authorizedPrincipals: ['reader'], mode: 'live' as const,
  maxOccupiedUnits: 2, maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 }

for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: unknown sink acceptance retains occupancy, reconciles after restart, and never resends`, async () => {
    const { ctx } = await fixture(backend)
    const first = ctx.plugin(Sandbox, config); await first
    await ctx.externalEffectSandbox.propose(intent, call())
    await ctx.externalEffectSandbox.grant(grant, call())
    const sink = ctx.storageLog.get('external-test:sink')!, original = sink.append.bind(sink)
    sink.append = async (...args) => { await original(...args); throw new Error('lost provider receipt') }
    expect(await ctx.externalEffectSandbox.execute(intent.effectId, call())).toMatchObject({ status: 'outcome-unknown' })
    await ctx.externalEffectSandbox.revoke(intent.effectId, call())
    const other = { ...intent, effectId: 'action-2' }
    await ctx.externalEffectSandbox.propose(other, call())
    await ctx.externalEffectSandbox.grant({ ...grant, grantId: 'grant-2', effectId: other.effectId }, call())
    await expect(ctx.externalEffectSandbox.execute(other.effectId, call())).rejects.toThrow('allowance occupied')
    await first.dispose()
    await ctx.plugin(Sandbox, config)
    const result = await ctx.externalEffectSandbox.execute(intent.effectId, call())
    expect(result).toMatchObject({ status: 'confirmed', revoked: true, receipt: { effectId: intent.effectId, units: 2 } })
    expect(ctx.storageLog.get('external-test:sink')!.tailSequence).toBe(0)
    await expect(ctx.externalEffectSandbox.propose({ ...intent, units: 1 }, call())).rejects.toThrow('intent changed')
    await expect(ctx.externalEffectSandbox.inspect(intent.effectId, call(undefined, 'simulated-ceo'))).rejects.toThrow('authorization')
    await expect(ctx.externalEffectSandbox.grant({ ...grant, grantId: 'changed' }, call())).rejects.toThrow('original changed')
  })
  it(`${backend}: grant scope, strict parser and cancelled unstarted effect refuse IO`, async () => {
    const { ctx } = await fixture(backend); await ctx.plugin(Sandbox, config)
    await expect(ctx.externalEffectSandbox.propose({ ...intent, secret: 'invalid' } as never, call())).rejects.toThrow()
    await ctx.externalEffectSandbox.propose(intent, call())
    await expect(ctx.externalEffectSandbox.execute(intent.effectId, call())).rejects.toThrow('consent unavailable')
    await expect(ctx.externalEffectSandbox.grant({ ...grant, target: 'elsewhere' }, call())).rejects.toThrow('scope')
    await expect(ctx.externalEffectSandbox.grant({ ...grant, expiresAt: 1 }, call())).rejects.toThrow('expiry')
    await ctx.externalEffectSandbox.grant(grant, call())
    await expect(ctx.externalEffectSandbox.execute(intent.effectId, { ...call(), credentialGeneration: 2 })).rejects.toThrow('consent')
    await ctx.externalEffectSandbox.revoke(intent.effectId, call())
    expect(await ctx.externalEffectSandbox.execute(intent.effectId, call())).toMatchObject({ status: 'cancelled' })
    expect(ctx.storageLog.get('external-test:sink')!.tailSequence).toBe(-1)
  })
}

it.each(['replay', 'branch', 'import', 'inspect'] as const)('%s cannot grant or dispatch; inspection is pure', async (mode) => {
  const { ctx } = await fixture(); await ctx.plugin(Sandbox, { ...config, mode })
  await ctx.externalEffectSandbox.propose(intent, call())
  await expect(ctx.externalEffectSandbox.grant(grant, call())).rejects.toThrow('disabled')
  await expect(ctx.externalEffectSandbox.execute(intent.effectId, call())).rejects.toThrow('disabled')
  expect(await ctx.externalEffectSandbox.inspect(intent.effectId, call())).toMatchObject({ status: 'proposed', source: 'real-test' })
  expect(ctx.storageLog.get('external-test:sink')!.tailSequence).toBe(-1)
})

it('persists a provider result before refusing a revoked response, and only queries the original key', async () => {
  const { ctx } = await fixture(), stream = await ctx.storageLog.open({ name: 'lease-effect', version: 1 })
  const controller = new AbortController(), current = call(controller)
  let dispatches = 0, queries = 0
  const adapter: ExternalEffectAdapter = { id: intent.adapterId, environment: 'test', action: intent.action,
    targets: [intent.target], maxOccupiedUnits: 4,
    dispatch: async (input, key) => { dispatches++; controller.abort(); return { effectId: input.effectId,
      idempotencyKey: key, action: input.action, target: input.target, units: input.units, outcome: 'confirmed', receiptId: 'receipt' } },
    query: async () => { queries++; return null } }
  const owner = new ExternalEffectOwner(stream, [adapter], { authorizedPrincipals: ['reader'], mode: 'live',
    maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 })
  await owner.load(); await owner.propose(intent, current); await owner.grant(grant, current)
  await expect(owner.execute(intent.effectId, current)).rejects.toThrow('authorization')
  expect(owner.inspect(intent.effectId, call())).toMatchObject({ status: 'confirmed' })
  await owner.execute(intent.effectId, call())
  expect([dispatches, queries]).toEqual([1, 0])
  await expect(owner.load()).rejects.toThrow('already loaded')
  await owner.drain(); await stream.close()
})


it.each(['json', 'sqlite'] as const)('%s: compensation is a separately authorized action and never rewrites the confirmed original', async (backend) => {
  const { ctx } = await fixture(backend)
  const first = ctx.plugin(Sandbox, { ...config, maxOccupiedUnits: 4 }); await first
  await ctx.externalEffectSandbox.propose(intent, call())
  const compensation = { ...intent, effectId: 'compensation-1', compensatesEffectId: intent.effectId, payload: 'explicit corrective action' }
  await expect(ctx.externalEffectSandbox.propose(compensation, call())).rejects.toThrow(/confirmed original/)
  await ctx.externalEffectSandbox.grant(grant, call())
  const original = await ctx.externalEffectSandbox.execute(intent.effectId, call())
  expect(original.status).toBe('confirmed')
  await ctx.externalEffectSandbox.propose(compensation, call())
  await expect(ctx.externalEffectSandbox.execute(compensation.effectId, call())).rejects.toThrow(/consent/)
  await expect(ctx.externalEffectSandbox.grant({ ...grant, effectId: compensation.effectId }, call())).rejects.toThrow(/another effect/)
  await ctx.externalEffectSandbox.grant({ ...grant, grantId: 'compensation-grant', effectId: compensation.effectId }, call())
  const correction = await ctx.externalEffectSandbox.execute(compensation.effectId, call())
  expect(correction).toMatchObject({ status: 'confirmed', intent: { compensatesEffectId: intent.effectId } })
  expect(correction.idempotencyKey).not.toBe(original.idempotencyKey)
  expect(await ctx.externalEffectSandbox.inspect(intent.effectId, call())).toEqual(original)
  await first.dispose()
  await ctx.plugin(Sandbox, { ...config, maxOccupiedUnits: 4 })
  expect(await ctx.externalEffectSandbox.execute(compensation.effectId, call())).toEqual(correction)
  expect(ctx.storageLog.get('external-test:sink')!.tailSequence).toBe(1)
  expect(await ctx.externalEffectSandbox.inspect(intent.effectId, call())).toEqual(original)
})


it('grant expiry during the durable dispatch append prevents Host IO and retains an uncertain reservation', async () => {
  const { ctx } = await fixture(), stream = await ctx.storageLog.open({ name: 'expiry-barrier', version: 1 })
  let now = 1000, dispatches = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const append = stream.append.bind(stream)
  stream.append = async (...args) => {
    const result = await append(...args)
    if (args[1].some(value => (value as { record?: { status?: string } }).record?.status === 'dispatched')) now = 2000
    return result
  }
  const adapter: ExternalEffectAdapter = { id: intent.adapterId, environment: 'test', action: intent.action,
    targets: [intent.target], maxOccupiedUnits: 4,
    dispatch: () => { dispatches++; return Promise.reject(new Error('must never reach adapter')) }, query: () => Promise.resolve(null) }
  const owner = new ExternalEffectOwner(stream, [adapter], { authorizedPrincipals: ['reader'], mode: 'live',
    maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 })
  try {
    await owner.load(); await owner.propose(intent, call()); await owner.grant({ ...grant, expiresAt: 2000 }, call())
    await expect(owner.execute(intent.effectId, call())).rejects.toThrow('consent unavailable')
    expect(owner.inspect(intent.effectId, call()).status).toBe('dispatched')
    expect((await owner.execute(intent.effectId, call())).status).toBe('outcome-unknown')
    expect(dispatches).toBe(0)
  } finally { clock.mockRestore(); await owner.drain(); await stream.close() }
})

it.each(['json', 'sqlite'] as const)('%s replay rejects a grant identity reused by another effect and closes dispatch admission', async (backend) => {
  const { ctx } = await fixture(backend), stream = await ctx.storageLog.open({ name: 'grant-original', version: 1 })
  let dispatches = 0
  const adapter: ExternalEffectAdapter = { id: intent.adapterId, environment: 'test', action: intent.action,
    targets: [intent.target], maxOccupiedUnits: 4,
    dispatch: () => { dispatches++; return Promise.reject(new Error('must not dispatch malformed recovered history')) },
    query: () => Promise.resolve(null) }
  const options = { authorizedPrincipals: ['reader'], mode: 'live' as const, maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 }
  const first = new ExternalEffectOwner(stream, [adapter], options)
  await first.load(); await first.propose(intent, call()); await first.grant(grant, call())
  const other = { ...intent, effectId: 'other-effect' }
  await first.propose(other, call())
  await expect(first.grant({ ...grant, effectId: other.effectId }, call())).rejects.toThrow('already belongs to another effect')
  await first.grant({ ...grant, effectId: other.effectId, grantId: 'second-grant' }, call())
  const rows = await stream.read(-1, 100), corrupt = await ctx.storageLog.open({ name: 'grant-corrupt', version: 1 })
  const values = rows.map(row => structuredClone(row.value))
  const last = values.at(-1) as { record: { grant: { grantId: string } } }; last.record.grant.grantId = grant.grantId
  await corrupt.append(-1, values)
  const recovered = new ExternalEffectOwner(corrupt, [adapter], options)
  await expect(recovered.load()).rejects.toThrow('already belongs to another effect')
  await expect(recovered.execute(intent.effectId, call())).rejects.toThrow('authorization unavailable')
  expect(dispatches).toBe(0)
  await recovered.drain(); await first.drain(); await corrupt.close(); await stream.close()
})

it('a durable unstarted reservation cannot bypass a lower current Host allowance after recovery', async () => {
  const { ctx } = await fixture(), stream = await ctx.storageLog.open({ name: 'quota-recovery', version: 1 })
  let dispatches = 0
  const adapter: ExternalEffectAdapter = { id: intent.adapterId, environment: 'test', action: intent.action,
    targets: [intent.target], maxOccupiedUnits: 4, dispatch: () => { dispatches++; return Promise.reject(new Error('must not dispatch')) },
    query: () => Promise.resolve(null) }
  const options = { authorizedPrincipals: ['reader'], mode: 'live' as const, maxEntries: 100, maxEntryBytes: 65536, pageSize: 1 }
  const first = new ExternalEffectOwner(stream, [adapter], options)
  await first.load(); await first.propose(intent, call()); await first.grant(grant, call())
  const append = stream.append.bind(stream)
  stream.append = async (...args) => {
    const result = await append(...args)
    if (args[1].some(value => (value as { record?: { status?: string } }).record?.status === 'reserved')) throw new Error('lost reservation reply')
    return result
  }
  await expect(first.execute(intent.effectId, call())).rejects.toThrow('lost reservation reply')
  stream.append = append
  const recovered = new ExternalEffectOwner(stream, [{ ...adapter, maxOccupiedUnits: 0 }], options)
  await recovered.load()
  await expect(recovered.execute(intent.effectId, call())).rejects.toThrow('allowance occupied')
  expect(recovered.inspect(intent.effectId, call()).status).toBe('reserved')
  expect(dispatches).toBe(0)
  await first.drain(); await recovered.drain(); await stream.close()
})
