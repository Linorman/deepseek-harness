import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { teamIdSchema, teamArtifactReferenceSchema } from '@clocky/clocky-team'
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


it.each(['', ' invalid', 'invalid '])('rejects the invalid artifact provider identity %j before registration', async (name) => {
  const ctx = new Context()
  await ctx.plugin(TeamArtifactStore)
  try {
    expect(() => ctx.teamArtifacts.registerProvider({ name, save: async () => { throw new Error('unused') },
      read: async () => new Uint8Array() })).toThrow(expect.objectContaining({ code: 'TEAM_ARTIFACT_PROVIDER_INVALID' }))
    expect(ctx.teamArtifacts.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('rejects duplicate live registrations and does not let repeated retirement remove their replacement', async () => {
  const ctx = new Context()
  await ctx.plugin(TeamArtifactStore)
  const provider: TeamArtifactProvider = { name: 'lifecycle', save: async () => { throw new Error('unused') },
    read: async () => new Uint8Array() }
  try {
    const retire = ctx.teamArtifacts.registerProvider(provider)
    expect(ctx.teamArtifacts.listProviders()).toEqual([{ name: 'lifecycle' }])
    expect(ctx.teamArtifacts.listProviders()[0]).not.toBe(provider)
    expect(() => ctx.teamArtifacts.registerProvider(provider)).toThrow(expect.objectContaining({ code: 'TEAM_ARTIFACT_PROVIDER_DUPLICATE' }))
    retire()
    const replacement = { ...provider, read: async () => new Uint8Array([7]) }
    const retireReplacement = ctx.teamArtifacts.registerProvider(replacement)
    retire()
    expect(ctx.teamArtifacts.getProvider('lifecycle')).toBe(replacement)
    retireReplacement()
    expect(ctx.teamArtifacts.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('forwards exact deletion facts while refusing unsupported and unavailable providers', async () => {
  const ctx = new Context()
  await ctx.plugin(TeamArtifactStore)
  const deletion = vi.fn(async () => {})
  const provider: TeamArtifactProvider = { name: 'mutable', save: async () => { throw new Error('unused') },
    read: async () => new Uint8Array(), delete: deletion }
  const deletionRequest = { reference: { id: 'artifact', provider: 'mutable', kind: 'log' as const,
    uri: 'artifact:test', visibility: 'team' as const } }
  try {
    ctx.teamArtifacts.registerProvider(provider)
    await expect(ctx.teamArtifacts.delete('mutable', deletionRequest)).resolves.toBeUndefined()
    expect(deletion).toHaveBeenCalledWith(deletionRequest)
    ctx.teamArtifacts.registerProvider({ name: 'read-only',
      save: async () => { throw new Error('unused') }, read: async () => new Uint8Array() })
    await expect(ctx.teamArtifacts.delete('read-only', deletionRequest)).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_INVALID' })
    await expect(ctx.teamArtifacts.delete('absent', deletionRequest)).rejects.toMatchObject({ code: 'TEAM_ARTIFACT_PROVIDER_NOT_FOUND' })
  } finally { await ctx.fiber.dispose() }
})


it('dispatches bytes and references to the explicitly named provider without interpreting storage contents', async () => {
  const ctx = new Context()
  await ctx.plugin(TeamArtifactStore)
  const reference = teamArtifactReferenceSchema.parse({ id: 'report', provider: 'memory', kind: 'report', uri: 'artifact:report', visibility: 'team' })
  const bytes = new Uint8Array([1, 2, 3])
  const save = vi.fn(async () => reference)
  const read = vi.fn(async () => bytes)
  try {
    ctx.teamArtifacts.registerProvider({ name: 'memory', save, read })
    const write = { teamId: teamIdSchema.parse('team'), kind: 'report' as const, visibility: 'team' as const, data: bytes }
    await expect(ctx.teamArtifacts.save('memory', write)).resolves.toBe(reference)
    expect(save).toHaveBeenCalledWith(write)
    const request = { reference }
    await expect(ctx.teamArtifacts.read('memory', request)).resolves.toBe(bytes)
    expect(read).toHaveBeenCalledWith(request)
  } finally { await ctx.fiber.dispose() }
})
