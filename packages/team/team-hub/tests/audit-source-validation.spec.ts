import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import type { LogEntry, LogStream } from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { jsonObjectSchema, channelInvitationIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ParticipantId } from '@clocky/clocky-team'
import { directChannelAdapter } from '../../team-channel-direct/src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import TeamHub, { AUDIT_PROJECTION_FORMAT_VERSION } from '../src/index.ts'
import { CHANNEL_WAL_FORMAT_VERSION, TEAM_JOURNAL_FORMAT_VERSION } from '../src/types.ts'
import { postActor } from './fixtures.ts'

type Backend = 'json' | 'sqlite'
const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Open real durable storage without assuming a live JSON owner's lock can be bypassed. */
async function storage(backend: Backend, root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  return ctx
}

async function dispose(ctx: Context) {
  await ctx.fiber.dispose()
  contexts.delete(ctx)
}

async function hub(backend: Backend, root: string, onOpen?: (stream: LogStream) => void) {
  const ctx = await storage(backend, root)
  if (onOpen !== undefined) {
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await open(descriptor)
      onOpen(stream)
      return stream
    })
  }
  await ctx.plugin(TeamHub, { recoveryPageSize: 64, checkpointEvery: 1 })
  ctx.teams.registerAdapter(directChannelAdapter)
  return ctx
}

/** Seed authoritative records, audit rows and checkpoints through public Hub commands. */
async function seed(backend: Backend, source: 'team' | 'channel') {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'audit-source-validation-'))
  roots.push(root)
  const ctx = await hub(backend, root)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Audit only retained authoritative records.', budgets: {} }, rules: {}, budgets: {},
  })
  const teamId = created.team.id
  const members: ParticipantId[] = []
  for (const role of ['sender', 'recipient']) {
    const participant = await inviteBootstrapParticipant(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.push(participant.id)
  }
  const [sender, recipient] = members
  if (sender === undefined || recipient === undefined) throw new Error('Audit fixture requires two participants')
  const actor = await postActor(ctx, teamId, sender)
  const channel = await openTestChannel(ctx, {
    teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 1 }, participants: [{ id: sender, role: 'sender' }, { id: recipient, role: 'recipient' }], limits: {},
  })
  const channelId = channel.manifest.id
  for (const member of members) {
    const endpointActor = await postActor(ctx, teamId, member)
    const admission = await ctx.teams.getChannelAdmission({ channelId })
    const invitation = admission.invitations.find(value => value.participantId === member)
    if (invitation === undefined) throw new Error('Audit fixture requires endpoint invitations')
    await ctx.teams.acknowledgeChannelInvitation({ actor: endpointActor, channelId,
      revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
      idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`audit-consent:${member}`) })
  }
  await ctx.teams.postChannelEnvelope({ actor, expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
    draft: { channelId, audience: [recipient], kind: 'message', payload: { text: 'Authoritative audit source.' }, delivery: 'context' } })
  const request = { teamId, ...source === 'channel' ? { channelId } : {}, afterCursor: -1, limit: 64 }
  const valid = await ctx.teams.readAudit(request)
  const team = await ctx.teams.getTeam({ teamId })
  await dispose(ctx)
  const sourceName = source === 'team' ? `team/${teamId}` : `channel/${channelId}`
  const auditName = source === 'team' ? `audit/${teamId}` : `audit/${teamId}/channel/${channelId}`
  const version = source === 'team' ? TEAM_JOURNAL_FORMAT_VERSION : CHANNEL_WAL_FORMAT_VERSION
  const writer = await storage(backend, root)
  const audit = await writer.storageLog.open({ name: auditName, version: AUDIT_PROJECTION_FORMAT_VERSION })
  const sourceStream = await writer.storageLog.open({ name: sourceName, version })
  const rows = await audit.read(-1, 64)
  const sourceRows = await sourceStream.read(-1, 64)
  await dispose(writer)
  return { root, team, channelId, request, valid, sourceName, auditName, version, rows, sourceRows,
    code: source === 'team' ? 'TEAM_JOURNAL_MALFORMED' : 'TEAM_CHANNEL_WAL_MALFORMED' }
}

/** Rewrite only serialized audit rows while all JSON handles are closed. */
async function replaceAudit(backend: Backend, root: string, name: string, rows: readonly LogEntry[]) {
  if (backend === 'json') {
    const path = join(root, 'logs', `${Buffer.from(name).toString('base64url')}.json`)
    const document = jsonObjectSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    const stream = jsonObjectSchema.parse(document['stream'])
    await writeFile(path, `${JSON.stringify({ ...document, stream: { ...stream, tailSequence: rows.at(-1)?.sequence ?? -1 }, entries: rows }, null, 2)}\n`)
  } else {
    sql(root, (db) => {
      db.exec('BEGIN IMMEDIATE')
      db.prepare('DELETE FROM log_entries WHERE stream = ?').run(name)
      const insert = db.prepare('INSERT INTO log_entries (stream, sequence, value) VALUES (?, ?, ?)')
      for (const row of rows) insert.run(name, row.sequence, JSON.stringify(row.value))
      db.prepare('UPDATE log_streams SET tail_sequence = ? WHERE name = ?').run(rows.at(-1)?.sequence ?? -1, name)
      db.exec('COMMIT')
    })
  }
}

/** Execute a durable SQLite fault through an independent connection, then close it. */
function sql(root: string, operation: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(join(root, 'hub.db'))
  try { operation(db) }
  finally { db.close() }
}

describe('audit validation against durable sources', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const source of ['team', 'channel'] as const) {
      it(`rejects damaged ${source} audit values and recovers from restored rows on ${backend}`, async () => {
        const fixture = await seed(backend, source)
        const first = fixture.rows[0]
        if (first === undefined) throw new Error('Audit fixture requires retained rows')
        const value = jsonObjectSchema.parse(first.value)
        const rows = fixture.rows
        const variants = [
          { rows: [{ ...first, value: { ...value, cursor: 1 } }, ...rows.slice(1)], message: 'cursor disagrees with storage' },
          { rows: [{ ...first, value: { ...value, createdAt: Number(value.createdAt) + 1 } }, ...rows.slice(1)], message: 'disagrees with its source record' },
          { rows: [...rows, { sequence: rows.length, value: { ...value, cursor: rows.length } }], message: 'has no matching source record' },
        ]
        for (const variant of variants) {
          await replaceAudit(backend, fixture.root, fixture.auditName, variant.rows)
          const reader = await hub(backend, fixture.root)
          await expect(reader.teams.readAudit(fixture.request)).rejects.toMatchObject({ code: fixture.code })
          await expect(reader.teams.readAudit(fixture.request)).rejects.toThrow(variant.message)
          expect(await reader.teams.getTeam({ teamId: fixture.request.teamId })).toEqual(fixture.team)
          await dispose(reader)
          await replaceAudit(backend, fixture.root, fixture.auditName, rows)
          const recovered = await hub(backend, fixture.root)
          expect(await recovered.teams.readAudit(fixture.request)).toEqual(fixture.valid)
          await dispose(recovered)
        }
        const inspect = await storage(backend, fixture.root)
        const retained = await inspect.storageLog.open({ name: fixture.sourceName, version: fixture.version })
        expect(await retained.read(-1, 64)).toEqual(fixture.sourceRows)
        await dispose(inspect)
      })

      it(`rejects ${source} audit entries whose source prefix was compacted and accepts aligned retention on ${backend}`, async () => {
        const fixture = await seed(backend, source)
        const writer = await storage(backend, fixture.root)
        const sourceStream = await writer.storageLog.open({ name: fixture.sourceName, version: fixture.version })
        const checkpoint = await sourceStream.readCheckpoint()
        if (checkpoint === undefined) throw new Error('Source compaction requires the Hub checkpoint')
        await sourceStream.compact({ throughSequence: 0, expectedCheckpointSequence: checkpoint.sequence })
        await dispose(writer)
        const reader = await hub(backend, fixture.root)
        await expect(reader.teams.readAudit(fixture.request)).rejects.toMatchObject({ code: fixture.code })
        await expect(reader.teams.readAudit(fixture.request)).rejects.toThrow('no longer has a retained source record')
        await dispose(reader)
        const repair = await storage(backend, fixture.root)
        const audit = await repair.storageLog.open({ name: fixture.auditName, version: AUDIT_PROJECTION_FORMAT_VERSION })
        await audit.writeCheckpoint({ sequence: audit.tailSequence, value: { retainedThrough: audit.tailSequence } })
        await audit.compact({ throughSequence: 0, expectedCheckpointSequence: audit.tailSequence })
        await dispose(repair)
        const recovered = await hub(backend, fixture.root)
        const result = await recovered.teams.readAudit({ ...fixture.request, afterCursor: 0 })
        expect(result.items).toEqual(fixture.valid.items.slice(1))
        expect(result.firstCursor).toBe(1)
        expect((await recovered.teams.getTeam({ teamId: fixture.request.teamId })).team).toEqual(fixture.team.team)
      })
    }
  }

  for (const source of ['team', 'channel'] as const) {
    it(`detects a ${source} audit gap introduced after SQLite open validation`, async () => {
      const fixture = await seed('sqlite', source)
      let changed = false
      const reader = await hub('sqlite', fixture.root, (stream) => {
        if (stream.name !== fixture.auditName || changed) return
        changed = true
        sql(fixture.root, (db) => { db.prepare('DELETE FROM log_entries WHERE stream = ? AND sequence = 1').run(fixture.auditName) })
      })
      await expect(reader.teams.readAudit(fixture.request)).rejects.toThrow('audit projection has a cursor gap at 2')
      expect(changed).toBe(true)
      await dispose(reader)
      await replaceAudit('sqlite', fixture.root, fixture.auditName, fixture.rows)
      const recovered = await hub('sqlite', fixture.root)
      expect(await recovered.teams.readAudit(fixture.request)).toEqual(fixture.valid)
    })

    it(`validates live ${source} SQLite audit pages and propagates real source decode failures`, async () => {
      const fixture = await seed('sqlite', source)
      const reader = await hub('sqlite', fixture.root)
      await reader.teams.getTeam({ teamId: fixture.request.teamId })
      if (source === 'channel') await reader.teams.getChannel({ channelId: fixture.channelId })
      const update = (name: string, value: string) => {
        sql(fixture.root, (db) => {
          db.prepare('UPDATE log_entries SET value = ? WHERE stream = ? AND sequence = 0').run(value, name)
        })
      }
      const originalSource = fixture.sourceRows[0]
      const originalAudit = fixture.rows[0]
      if (originalSource === undefined || originalAudit === undefined) throw new Error('Decode fixture requires retained rows')
      update(fixture.sourceName, '{')
      await expect(reader.teams.readAudit(fixture.request)).rejects.toMatchObject({ code: 'malformed-medium' })
      update(fixture.sourceName, JSON.stringify(originalSource.value))
      expect(await reader.teams.readAudit(fixture.request)).toEqual(fixture.valid)
      update(fixture.auditName, '{')
      await expect(reader.teams.readAudit(fixture.request)).rejects.toMatchObject({ code: 'malformed-medium' })
      update(fixture.auditName, JSON.stringify({ ...jsonObjectSchema.parse(originalAudit.value), cursor: 1 }))
      await expect(reader.teams.readAudit(fixture.request)).rejects.toThrow('audit record cursor disagrees with storage')
      update(fixture.auditName, JSON.stringify(originalAudit.value))
      sql(fixture.root, (db) => { db.prepare('DELETE FROM log_entries WHERE stream = ? AND sequence = 1').run(fixture.auditName) })
      await expect(reader.teams.readAudit(fixture.request)).rejects.toThrow('audit stream has a cursor gap at 2')
      await replaceAudit('sqlite', fixture.root, fixture.auditName, fixture.rows)
      expect(await reader.teams.readAudit(fixture.request)).toEqual(fixture.valid)
      expect(await reader.teams.getTeam({ teamId: fixture.request.teamId })).toEqual(fixture.team)
    })
  }
})
