import { seedSource } from './sources-fixture.ts'
/** Frozen source selection combines real durable Team authority with native read-only Simulation history. */
import { expect, it, vi } from 'vitest'
import ProductPrincipals from '@clocky/clocky-product-principal'
import TeamHub from '@clocky/clocky-team-hub'
import * as Humans from '@clocky/clocky-team-human-actor'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { jsonObjectSchema } from '@clocky/clocky-team'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { fixture, registration, call } from './fixtures.ts'

it('refuses source lookup when the registered native history is unavailable', async () => {
  const h = await fixture()
  const { products } = await h.mount()
  await expect(products.inspectSource({ runId: registration().id, decisionId: 'missing-decision' as never,
    sourceIndex: 0, limit: 1 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  expect(h.open).not.toHaveBeenCalled()
})

it('invalidates an in-flight source lookup when its disclosure policy changes', async () => {
  const native = await createBusinessHarness('json')
  const h = await fixture('json', { imports: [{ ...registration(), spec: native.selection.spec }] })
  try {
    const { products } = await h.mount()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<{ snapshot: ReturnType<typeof native.run.snapshot>; owner: 'unowned' }>()
    h.inspect.mockImplementationOnce(async () => { entered.resolve(undefined); return await release.promise })
    const pending = products.inspectSource({ runId: registration().id, decisionId: 'missing-decision' as never,
      sourceIndex: 0, limit: 1 }, call())
    await entered.promise
    const revoke = products.contextReaderRegistrar()([{ principalId: call().principal.id,
      entityIds: ['actor' as never], content: ['sources'] }])
    release.resolve({ snapshot: native.run.snapshot(), owner: 'unowned' })
    await expect(pending).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    revoke()
  } finally { await native.close() }
})

it.each(['json', 'sqlite'] as const)('locates exact originals and pages Unicode text only while both read authorities remain valid (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }],
    maxPageSize: 2, maxContextPartBytes: 4 })
  h.unregister(); h.ctx.simulations.registerProvider(native.provider)
  try {
    await h.ctx.plugin(TeamHub)
    await h.ctx.plugin(ProductPrincipals)
    await h.ctx.plugin(Humans)
    await h.ctx.plugin(Direct)
    const { teamId, members, original, decisionId, id } = await seedSource(h.ctx, native, call())
    let before = native.run.snapshot()
    const { products } = await h.mount()
    const input = { runId: registration().id, decisionId, sourceIndex: 0, limit: 2 }
    const readNative = h.ctx.teams.readChannelPage.bind(h.ctx.teams)
    const channelRead = vi.spyOn(h.ctx.teams, 'readChannelPage')
    expect((await products.inspectSource(input, call())).status).toBe('withheld')
    expect(channelRead).not.toHaveBeenCalled()
    const remove = products.contextReaderRegistrar()([{ principalId: call().principal.id, entityIds: [id], content: ['sources'] }])
    let found = await products.inspectSource(input, call())
    let searching = 0
    while (found.status === 'searching') {
      expect(found.items).toEqual([]); searching++
      if (searching > 20) throw new Error('Lookup did not advance')
      found = await products.inspectSource({ ...input, cursor: found.nextCursor, expectedRevision: found.snapshotRevision }, call())
    }
    expect(searching).toBeGreaterThan(0)
    expect(found.status).toBe('found')
    expect(found.envelope?.sequence).toBe(original.sequence)
    const originalPage = found
    await native.run.setPhase('paused', native.run.snapshot().revision)
    before = native.run.snapshot()
    await expect(products.inspectSource({ ...input, envelopeSequence: original.sequence, cursor: originalPage.nextCursor,
      expectedRevision: originalPage.snapshotRevision }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    const parts: string[] = []
    for (;;) {
      for (const item of found.items) if (item.body.status === 'text') parts.push(item.body.text)
      if (found.nextCursor === undefined) break
      found = await products.inspectSource({ ...input, envelopeSequence: original.sequence, cursor: found.nextCursor }, call())
    }
    expect(parts.join('')).toBe('精确🙂来源正文')
    expect((await products.inspectSource({ ...input, sourceIndex: 1 }, call())).status).toBe('missing')
    expect((await products.inspectSource({ ...input, envelopeSequence: original.sequence - 1 }, call())).status).toBe('missing')
    await expect(products.inspectSource({ ...input, sourceIndex: 1, cursor: originalPage.nextCursor }, call())).resolves.toMatchObject({ status: 'missing' })
    remove()
    expect((await products.inspectSource({ ...input, envelopeSequence: original.sequence }, call())).status).toBe('withheld')
    const revoke = products.contextReaderRegistrar()([{ principalId: call().principal.id, entityIds: [id], content: ['sources'] }])
    channelRead.mockImplementationOnce(async (request) => {
      revoke()
      return await readNative(request)
    })
    await expect(products.inspectSource({ ...input, envelopeSequence: original.sequence }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    channelRead.mockRestore()
    products.contextReaderRegistrar()([{ principalId: call().principal.id, entityIds: [id], content: ['sources'] }])
    const leave = { teamId, participantId: members[0]!.id, expectedCursor: (await h.ctx.teams.getTeam({ teamId })).team.cursor, phase: 'left' as const }
    const revokeDuringRead = vi.spyOn(h.ctx.teams, 'readChannelPage').mockImplementationOnce(async (request) => {
      const value = await readNative(request)
      await h.ctx.teamHumanActors.withProof(call(), { teamId, operation: 'close', fence: { kind: 'cursor', cursor: leave.expectedCursor },
        payload: jsonObjectSchema.parse(leave) }, async actor => await h.ctx.teams.transitionParticipantPhase({ actor, ...leave }))
      return value
    })
    const revoked = await products.inspectSource({ ...input, envelopeSequence: original.sequence }, call())
    expect(revoked.status).toBe('withheld')
    expect(JSON.stringify(revoked)).not.toContain('来源正文')
    revokeDuringRead.mockRestore()
    expect((await products.inspectSource({ ...input, envelopeSequence: original.sequence }, call())).status).toBe('withheld')
    expect(native.run.snapshot()).toEqual(before)
  } finally { await native.close() }
})
