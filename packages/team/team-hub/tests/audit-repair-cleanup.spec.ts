import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage, { type LogStream } from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { createTestRootTeam } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import TeamHub, { AUDIT_PROJECTION_FORMAT_VERSION } from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Leave a real source commit ahead of its derived audit by failing only the initial audit append. */
async function setup(backend: 'json' | 'sqlite') {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'audit-repair-cleanup-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 16 })
  const initialFailure = new Error('initial derived audit append unavailable')
  const open = ctx.storageLog.open.bind(ctx.storageLog)
  let owned: LogStream | undefined
  let auditOpens = 0
  vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
    const stream = await open(descriptor)
    if (descriptor.name.startsWith('audit/')) {
      auditOpens += 1
      if (owned === undefined) {
        owned = stream
        vi.spyOn(stream, 'append').mockRejectedValueOnce(initialFailure)
      }
    }
    return stream
  })
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Preserve source facts across competing audit repair.', budgets: {} }, rules: {}, budgets: {},
  })
  if (owned === undefined) throw new Error('Team creation did not attempt its audit projection')
  expect(owned.tailSequence).toBe(-1)
  expect(ctx.teams.getMetrics().auditProjectionFailures).toBe(1)
  return { ctx, root, created, owned, open, auditOpens: () => auditOpens }
}

describe('audit repair conflict cleanup', () => {
  for (const backend of ['sqlite'] as const) {
    it.each([false, true])(`retains the genuine audit conflict and recovers after close failure=%s on ${backend}`, async (closeFails) => {
      const harness = await setup(backend)
      const auditName = `audit/${harness.created.team.id}`
      const closeFailure = Object.assign(new Error('audit handle close failed after cleanup'), { code: 'EIO' })
      const closed = vi.fn()
      const close = harness.owned.close.bind(harness.owned)
      vi.spyOn(harness.owned, 'close').mockImplementationOnce(async () => {
        await close()
        closed()
        if (closeFails) throw closeFailure
      })
      const append = harness.owned.append.bind(harness.owned)
      let conflict: unknown
      let committedValues: readonly unknown[] = []
      vi.spyOn(harness.owned, 'append').mockImplementationOnce(async (cursor, values) => {
        const otherBackend = new StorageSqlite.SqliteStorageBackend({ path: join(harness.root, 'hub.db') })
        try {
          const competitor = await otherBackend.log.open({ name: auditName, version: AUDIT_PROJECTION_FORMAT_VERSION })
          expect(competitor).not.toBe(harness.owned)
          committedValues = structuredClone(values)
          try { await competitor.append(cursor, values) }
          finally { await competitor.close() }
        } finally { await otherBackend.close() }
        try { return await append(cursor, values) }
        catch (error: unknown) { conflict = error; throw error }
      })
      const input = { teamId: harness.created.team.id, afterCursor: -1, limit: 16 }
      const failure: unknown = await harness.ctx.teams.readAudit(input).then(() => undefined, (error: unknown) => error)
      expect(conflict, String(failure)).toMatchObject({ code: 'sequence-conflict' })
      expect(closed).toHaveBeenCalledTimes(1)
      if (closeFails) {
        expect(failure).toSatisfy((error: unknown) => error instanceof AggregateError
          && error.errors.length === 2 && error.errors[0] === conflict && error.errors[1] === closeFailure)
      } else { expect(failure).toBe(conflict) }
      expect(await harness.ctx.teams.getTeam({ teamId: input.teamId })).toEqual(harness.created)
      const repaired = await harness.ctx.teams.readAudit(input)
      expect(harness.auditOpens()).toBe(2)
      expect(repaired.items).toEqual(committedValues)
      expect(repaired.nextCursor).toBeUndefined()
      expect(await harness.ctx.teams.readAudit(input)).toEqual(repaired)
      expect(harness.auditOpens()).toBe(2)
      expect(closed).toHaveBeenCalledTimes(1)
      expect(await harness.ctx.teams.getTeam({ teamId: input.teamId })).toEqual(harness.created)
      const durable = (await harness.ctx.storageLog.list()).find(stream => stream.name === auditName)
      expect(durable?.tailSequence).toBe(harness.created.team.cursor)
    })
  }
})


describe('JSON audit owner and append recovery', () => {
  it('rejects a second live JSON log owner without changing the source or its audit', async () => {
    const harness = await setup('json')
    const auditName = `audit/${harness.created.team.id}`
    const otherBackend = new StorageJson.JsonStorageBackend(harness.root)
    try {
      await expect(otherBackend.log.open({ name: auditName, version: AUDIT_PROJECTION_FORMAT_VERSION }))
        .rejects.toMatchObject({ code: 'writer-locked' })
    } finally { await otherBackend.close() }
    expect(harness.owned.tailSequence).toBe(-1)
    expect(await harness.ctx.teams.getTeam({ teamId: harness.created.team.id })).toEqual(harness.created)
    const input = { teamId: harness.created.team.id, afterCursor: -1, limit: 16 }
    const repaired = await harness.ctx.teams.readAudit(input)
    const cursors = Array.from({ length: harness.created.team.cursor + 1 }, (_, cursor) => cursor)
    expect(repaired.items.map(entry => entry.cursor)).toEqual(cursors)
    expect(await harness.ctx.teams.readAudit(input)).toEqual(repaired)
    expect(harness.auditOpens()).toBe(1)
    expect(harness.owned.tailSequence).toBe(harness.created.team.cursor)
  })

  it('reuses a JSON audit append that committed before its EIO reply without duplicating facts', async () => {
    const harness = await setup('json')
    const replyFailure = Object.assign(new Error('audit append result unavailable after durable commit'), { code: 'EIO' })
    const append = harness.owned.append.bind(harness.owned)
    let committedValues: readonly unknown[] = []
    vi.spyOn(harness.owned, 'append').mockImplementationOnce(async (cursor, values) => {
      committedValues = structuredClone(values)
      await append(cursor, values)
      throw replyFailure
    })
    const close = vi.spyOn(harness.owned, 'close')
    const input = { teamId: harness.created.team.id, afterCursor: -1, limit: 16 }
    await expect(harness.ctx.teams.readAudit(input)).rejects.toBe(replyFailure)
    expect(harness.owned.tailSequence).toBe(harness.created.team.cursor)
    expect(close).not.toHaveBeenCalled()
    expect(harness.auditOpens()).toBe(1)
    expect(await harness.ctx.teams.getTeam({ teamId: input.teamId })).toEqual(harness.created)
    const repaired = await harness.ctx.teams.readAudit(input)
    expect(repaired.items).toEqual(committedValues)
    expect(repaired.nextCursor).toBeUndefined()
    expect(await harness.ctx.teams.readAudit(input)).toEqual(repaired)
    expect(harness.auditOpens()).toBe(1)
    expect(close).not.toHaveBeenCalled()
    expect(await harness.ctx.teams.getTeam({ teamId: input.teamId })).toEqual(harness.created)
  })
})
