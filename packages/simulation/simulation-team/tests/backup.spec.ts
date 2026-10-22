import { createHash } from 'node:crypto'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { createWorldBackup, verifyWorldBackup, planWorldBackupMigration, worldMigrationPlanSchema } from '../src/backup.ts'
import { verifyWorldArchive } from '../src/archive.ts'
import type { WorldArchiveBody } from '../src/archive.ts'

const limits = { maxEntries: 16, maxBytes: 65536, pageSize: 4 }
function archive(): WorldArchiveBody {
  const native = { name: 'native/test', version: 1, entries: [{ sequence: 0, value: { kind: 'original-evidence' } }] }
  const team = { name: 'team/test', version: 2, entries: [] }
  return { version: 1, snapshot: { phase: 'paused', revision: 0, spec: { runId: 'test' } },
    native, owners: [team], sessions: [], attachments: [], references: {
      run: { runId: 'test', stream: { name: native.name, version: native.version }, firstSequence: 0, cursor: 0 },
      team: { stream: { name: team.name, version: team.version }, firstSequence: 0, cursor: -1 }, channels: [],
      sessions: [{ kind: 'unmaterialized', sessionId: 'never-created' }],
    } }
}
describe('private full backup format and evidence-preserving offline migration', () => {
  it('includes exact cuts, original implementation versions and unmaterialized identities without materializing records', () => {
    const body = archive(), before = JSON.stringify(body), bundle = createWorldBackup(body, limits)
    expect(bundle.manifest).toMatchObject({ format: 'world-backup/1', writableRestore: true,
      native: { cursor: 0, version: 1 }, owners: [{ cursor: -1, version: 2 }],
      unmaterializedSessions: ['never-created'], executionPolicy: { credentials: 'target-host-only',
        paths: 'explicit-target-mapping', realEffects: 'disabled', activation: 'explicit-start' } })
    expect(bundle.body).toEqual(body)
    expect(JSON.stringify(body)).toBe(before)
    expect(bundle.body).not.toBe(body)
    expect(verifyWorldBackup(JSON.stringify(bundle), limits)).toEqual(bundle)
  })
  it('refuses plain backups and envelope migration when any retained world requires a federation mailbox cut', () => {
    const body = archive(), fence = { ownerId: 'mail-test', runId: 'test', generation: 1, sourceSequence: 0,
      limit: '0', blockedPeers: [], sourceHash: 'a'.repeat(64) }
    body.snapshot = { ...z.record(z.string(), z.json()).parse(body.snapshot), federationTime: fence }
    expect(verifyWorldArchive(JSON.stringify(body), limits)).toMatchObject({ snapshot: { federationTime: fence } })
    expect(() => createWorldBackup(body, limits)).toThrow(/complete federation checkpoint/)
    expect(() => planWorldBackupMigration(JSON.stringify(body), limits)).toThrow(/complete federation checkpoint/)
    const hidden = archive()
    hidden.native.entries[0]!.value = { kind: 'run/federation-time', evidence: fence }
    expect(() => createWorldBackup(hidden, limits)).toThrow(/complete federation checkpoint/)
    let parent = verifyWorldArchive(JSON.stringify(body), limits)
    for (let depth = 0; depth < 2; depth++) {
      const descendant = archive()
      descendant.provenance = [z.json().parse(parent)]
      descendant.snapshot = { ...z.record(z.string(), z.json()).parse(descendant.snapshot), experiment: {
        parentRunId: 'test', sourceRevision: 0,
        sourceHash: createHash('sha256').update(JSON.stringify(parent)).digest('hex'),
      } }
      parent = verifyWorldArchive(JSON.stringify(descendant), limits)
      expect(() => createWorldBackup(parent, limits)).toThrow(/complete federation checkpoint/)
    }
  })
  it('applies byte limits to the entire bundle including metadata', () => {
    const body = archive(), full = JSON.stringify(createWorldBackup(body, limits)), bytes = Buffer.byteLength(full)
    expect(createWorldBackup(body, { ...limits, maxBytes: bytes })).toBeDefined()
    expect(() => createWorldBackup(body, { ...limits, maxBytes: bytes - 1 })).toThrow(/including manifest/)
    expect(() => verifyWorldBackup(full, { ...limits, maxBytes: bytes - 1 })).toThrow(/byte budget/)
  })
  it('rejects changed evidence even when record sequences still match', () => {
    const bundle = createWorldBackup(archive(), limits)
    bundle.body.native.entries[0]!.value = { kind: 'forged-approval' }
    expect(() => verifyWorldBackup(JSON.stringify(bundle), limits)).toThrow(/manifest differs/)
  })
  it('refuses redacted datasets, host execution configuration and unsupported versions', () => {
    const bundle = createWorldBackup(archive(), limits)
    for (const manifest of [{ ...bundle.manifest, kind: 'redacted-dataset' },
      { ...bundle.manifest, writableRestore: false }, { ...bundle.manifest, format: 'world-backup/2' },
      { ...bundle.manifest, credentials: { token: 'private' } }]) {
      expect(() => verifyWorldBackup(JSON.stringify({ ...bundle, manifest }), limits)).toThrow()
    }
    expect(() => verifyWorldBackup(JSON.stringify({ ...bundle, hostConfig: { provider: 'source-machine' } }), limits)).toThrow()
  })
  it('binds the only supported conversion to exact input/output hashes and a fixed converter without business rewriting', () => {
    const text = JSON.stringify(archive()), plan = planWorldBackupMigration(text, limits)
    expect(plan).toMatchObject({ source: 'world-archive/1', target: 'world-backup/1', converter: 'archive-envelope/1', losses: [] })
    expect(planWorldBackupMigration(text, limits)).toEqual(plan)
    expect(planWorldBackupMigration(text + ' ', limits).inputHash).not.toBe(plan.inputHash)
    expect(planWorldBackupMigration(text + ' ', limits).outputHash).toBe(plan.outputHash)
    expect(() => worldMigrationPlanSchema.parse({ ...plan, losses: ['approval'] })).toThrow()
    expect(() => worldMigrationPlanSchema.parse({ ...plan, converter: 'infer-approval/1' })).toThrow()
    expect(() => planWorldBackupMigration(JSON.stringify({ ...archive(), version: 2 }), limits)).toThrow()
  })
  it('refuses unknown required Session events in both backup and migration while preserving explicitly ignorable originals', () => {
    const body = archive(), header = { id: 'future-session', version: 0 }
    body.sessions.push({ header, events: [{ seq: 0, type: 'future/required', data: {} }] })
    ;(body.references as { sessions: unknown[] }).sessions.push({ kind: 'materialized', header, sequence: 0 })
    expect(() => createWorldBackup(body, limits)).toThrow(/unknown required Session event/)
    expect(() => planWorldBackupMigration(JSON.stringify(body), limits)).toThrow(/unknown required Session event/)
    Object.assign(body.sessions[0]!.events[0]!, { ignorable: true })
    expect(createWorldBackup(body, limits).body.sessions).toEqual(body.sessions)
  })
  it('rejects incomplete required evidence instead of assigning default channel or Session success', () => {
    const body = archive()
    const missingChannel = structuredClone(body)
    ;(missingChannel.references as { channels: unknown[] }).channels.push({ stream: { name: 'missing', version: 4 }, cursor: 0, firstSequence: 0 })
    expect(() => planWorldBackupMigration(JSON.stringify(missingChannel), limits)).toThrow(/closure/)
    const missingSession = structuredClone(body)
    ;(missingSession.references as { sessions: unknown[] }).sessions.push({ kind: 'materialized', header: { id: 'missing' }, sequence: 0 })
    expect(() => planWorldBackupMigration(JSON.stringify(missingSession), limits)).toThrow(/Session closure/)
  })
})
