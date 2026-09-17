/** Real storage writers/readers for serialized Team replay tests. @module */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { jsonValueSchema } from '@clocky/clocky-team'
import type { ChannelId, TeamId } from '@clocky/clocky-team'
import TeamHub, { type Config as TeamHubConfig } from '../src/index.ts'
import { foldTeamRecord, teamProjectionData } from '../src/fold.ts'
import { teamJournalRecordSchema } from '../src/schema.ts'
import { CHANNEL_CHECKPOINT_FORMAT_VERSION, CHANNEL_WAL_FORMAT_VERSION, TEAM_CHECKPOINT_FORMAT_VERSION, TEAM_JOURNAL_FORMAT_VERSION } from '../src/types.ts'
import type { TeamProjectionData } from '../src/types.ts'
import { teamId } from './fixtures.ts'

/** One serialized channel stream accompanying a Team journal fixture. */
export interface DurableChannelFixture {
  readonly id: ChannelId
  readonly records: readonly unknown[]
  readonly checkpoint?: unknown
}

/** An additional Team journal required to validate a cross-Team durable relationship. */
export interface DurableTeamFixture {
  readonly id: TeamId
  readonly records: readonly unknown[]
}

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Open one actual log backend with no Team provider retaining in-memory state. */
async function storage(backend: 'json' | 'sqlite', root: string): Promise<Context> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'teams.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  return ctx
}

/**
 * Persist JSON records, close the writer, and read them through a fresh authoritative Hub.
 * @param backend - Storage backend exercised by the replay.
 * @param records - Untrusted serialized Team journal records.
 * @param checkpoint - Optional serialized Team projection offered before journal replay.
 * @param id - Team stream identity.
 * @param channels - Channel streams attached by the Team journal.
 * @param checkpointCursor - Durable prefix represented by the optional Team checkpoint.
 * @param relatedTeams - Additional parent or child journals needed by the selected fixture.
 * @param hubConfig - Optional deployment settings for the fresh reader.
 * @returns Fresh Context whose Hub has not loaded the persisted Team yet.
 */
export async function recover(
  backend: 'json' | 'sqlite',
  records: readonly unknown[],
  checkpoint?: unknown,
  id: TeamId = teamId,
  channels: readonly DurableChannelFixture[] = [],
  checkpointCursor: number = records.length - 1,
  relatedTeams: readonly DurableTeamFixture[] = [],
  hubConfig: TeamHubConfig = {},
): Promise<Context> {
  const directory = join(process.cwd(), '.tmp')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(join(directory, 'hub-durable-lifecycle-'))
  roots.push(root)
  const writer = await storage(backend, root)
  const stream = await writer.storageLog.open({ name: `team/${id}`, version: TEAM_JOURNAL_FORMAT_VERSION })
  await stream.append(-1, records.map(record => jsonValueSchema.parse(JSON.parse(JSON.stringify(record)))))
  if (checkpoint !== undefined) {
    const serializedCheckpoint: unknown = JSON.parse(JSON.stringify(checkpoint))
    await stream.writeCheckpoint({ sequence: checkpointCursor, value: jsonValueSchema.parse({
      kind: 'team-projection', version: TEAM_CHECKPOINT_FORMAT_VERSION, teamId: id, projection: serializedCheckpoint,
    }) })
  }
  await stream.close()
  for (const channel of channels) {
    const wal = await writer.storageLog.open({ name: `channel/${channel.id}`, version: CHANNEL_WAL_FORMAT_VERSION })
    await wal.append(-1, channel.records.map(record => jsonValueSchema.parse(JSON.parse(JSON.stringify(record)))))
    if (channel.checkpoint !== undefined) {
      const serializedCheckpoint: unknown = JSON.parse(JSON.stringify(channel.checkpoint))
      await wal.writeCheckpoint({ sequence: channel.records.length - 1, value: jsonValueSchema.parse({
        kind: 'channel-projection', version: CHANNEL_CHECKPOINT_FORMAT_VERSION, channelId: channel.id, projection: serializedCheckpoint,
      }) })
    }
    await wal.close()
  }
  for (const related of relatedTeams) {
    const journal = await writer.storageLog.open({ name: `team/${related.id}`, version: TEAM_JOURNAL_FORMAT_VERSION })
    await journal.append(-1, related.records.map(record => jsonValueSchema.parse(JSON.parse(JSON.stringify(record)))))
    await journal.close()
  }
  await writer.fiber.dispose()
  contexts.delete(writer)
  const reader = await storage(backend, root)
  await reader.plugin(TeamHub, hubConfig)
  return reader
}

/**
 * Serialize a valid journal prefix into the checkpoint data published by the Hub.
 * @param records - Journal records whose parsed prefix must fold successfully.
 * @returns Checkpoint projection for the complete prefix.
 */
export function checkpointFor(records: readonly unknown[]): TeamProjectionData {
  let projection
  for (const [cursor, value] of records.entries()) {
    projection = foldTeamRecord(projection, teamJournalRecordSchema.parse(value), cursor, teamId)
  }
  if (projection === undefined) throw new Error('checkpoint fixture requires a created Team')
  return teamProjectionData(projection)
}
