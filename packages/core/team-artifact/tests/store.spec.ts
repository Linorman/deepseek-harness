import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { TeamArtifactError } from '../src/error.ts'
import TeamArtifactStore from '../src/index.ts'
import type {
  TeamArtifactCollectRequest,
  TeamArtifactProvider,
} from '../src/types.ts'

const request: TeamArtifactCollectRequest = {
  reachable: [],
  reclaimableIds: ['collector:artifact'],
  afterCursor: 'cursor',
  limit: 2,
}

describe('TeamArtifactStore collection', () => {
  it('forwards bounded collection requests to a provider', async () => {
    const result = {
      scanned: 1,
      retained: 1,
      unreachable: ['collector:artifact'],
      deleted: [],
      failures: [],
      nextCursor: 'next',
    }
    const collect = vi.fn(async () => result)
    const provider: TeamArtifactProvider = {
      name: 'collector',
      save: async () => { throw new Error('save is not used') },
      read: async () => new Uint8Array(),
      collect,
    }
    const ctx = new Context()
    await ctx.plugin(TeamArtifactStore)
    const unregister = ctx.teamArtifacts.registerProvider(provider)

    await expect(ctx.teamArtifacts.collect('collector', request)).resolves.toBe(result)
    expect(collect).toHaveBeenCalledWith(request)

    unregister()
    await ctx.fiber.dispose()
  })

  it('fails loudly when a provider has no collection capability', async () => {
    const provider: TeamArtifactProvider = {
      name: 'read-only',
      save: async () => { throw new Error('save is not used') },
      read: async () => new Uint8Array(),
    }
    const ctx = new Context()
    await ctx.plugin(TeamArtifactStore)
    const unregister = ctx.teamArtifacts.registerProvider(provider)

    await expect(ctx.teamArtifacts.collect('read-only', request)).rejects.toMatchObject({
      code: 'TEAM_ARTIFACT_COLLECTION_UNAVAILABLE',
    })
    await expect(ctx.teamArtifacts.collect('missing', request)).rejects.toMatchObject({
      code: 'TEAM_ARTIFACT_PROVIDER_NOT_FOUND',
    })
    expect(TeamArtifactError).toBeDefined()

    unregister()
    await ctx.fiber.dispose()
  })
})
