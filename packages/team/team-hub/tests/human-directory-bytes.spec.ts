/** Product Team directory keeps its published page within the configured byte bound. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema } from '@clocky/clocky-team'
import type { ParticipantId, TeamHumanActorProof, TeamHumanActorScope, TeamHumanReaderProof,
  TeamId, TeamProductDiscoveryCursor } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import type { ProductDirectory } from '../src/product-directory.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from
  '../../../core/team/tests/bootstrap-topology-authority.ts'

const principalId = 'directory-owner'
const contexts = new Set<Context>()
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(root: string, maxSelectionBytes?: number): Promise<Context> {
  const ctx = new Context(); contexts.add(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub, maxSelectionBytes === undefined ? {} : { maxSelectionBytes })
  return ctx
}

function principalAuthority(ctx: Context, humanId: ParticipantId): {
  readonly reader: TeamHumanReaderProof
  goal(input: { readonly teamId: TeamId; readonly expectedRevision: number; readonly objective: string }): TeamHumanActorProof
  advanceGeneration(): void
} {
  const reader = Object.freeze({}) as TeamHumanReaderProof
  const goals = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  let credentialGeneration = 1
  ctx.teams.registerHumanActorProofSource({ name: 'directory-reader-test',
    resolveHumanActorProof: candidate => goals.get(candidate),
    resolveHumanReaderProof: candidate => candidate === reader
      ? { principalId: principalId as never, issuer: 'test', subject: 'owner', credentialGeneration }
      : undefined })
  return { reader, advanceGeneration() { credentialGeneration += 1 }, goal(input) {
    const proof = Object.freeze({}) as TeamHumanActorProof
    const fence = { kind: 'revision' as const, revision: input.expectedRevision }
    goals.set(proof, { teamId: input.teamId, participantId: humanId, operation: 'goal-mutate', fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload({ teamId: input.teamId,
        operation: 'goal-mutate', fence, payload: jsonObjectSchema.parse(input) }) })
    return proof
  } }
}

it('refuses a human directory page one byte larger than its response allowance', async () => {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'team-directory-bytes-')); roots.push(root)
  const first = await hub(root)
  const team = await createTestRootTeam(first, { goal: { objective: 'Read this durable Team directory page.', budgets: {} },
    rules: {}, budgets: {} })
  const human = await inviteBootstrapParticipant(first, { teamId: team.team.id,
    expectedCursor: (await first.teams.getTeam({ teamId: team.team.id })).team.cursor,
    kind: 'human', role: 'human', displayName: 'Directory owner', capabilities: [],
    owner: { kind: 'product-principal', principalId: principalId as never },
    authorityGrant: { operations: ['goal-mutate'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} } })
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(first, { teamId: team.team.id, participantId: human.id,
      expectedCursor: (await first.teams.getTeam({ teamId: team.team.id })).team.cursor, phase })
  }
  expect((await first.teams.getTeam({ teamId: team.team.id })).participants.find(member => member.id === human.id))
    .toMatchObject({ phase: 'active', owner: { principalId } })
  await expect(first.teams.resolveHumanReadAuthority({ teamId: team.team.id, principalId: principalId as never }))
    .resolves.toMatchObject({ teamId: team.team.id, participantId: human.id })
  expect((await first.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items.map(item => item.id))
    .toEqual([team.team.id])
  const proof = principalAuthority(first, human.id).reader
  const pagedIds = []
  let afterCursor: TeamProductDiscoveryCursor | -1 = -1
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    const next = await first.teams.listHumanTeamsPage({ reader: proof, afterCursor, limit: 1 })
    pagedIds.push(...next.items.map(item => item.id))
    if (next.nextCursor === undefined) break
    afterCursor = next.nextCursor
  }
  expect(pagedIds).toEqual([team.team.id])
  const page = await first.teams.listHumanTeamsPage({ reader: proof, afterCursor: -1, limit: 128 })
  expect(page.items.map(item => item.id)).toEqual([team.team.id])
  const size = Buffer.byteLength(JSON.stringify(page))
  await first.fiber.dispose(); contexts.delete(first)
  const bounded = await hub(root, size - 1)
  await expect(bounded.teams.listHumanTeamsPage({ reader: principalAuthority(bounded, human.id).reader,
    afterCursor: -1, limit: 128 }))
    .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE', message: 'Team directory row exceeds response allowance' })
  await bounded.fiber.dispose(); contexts.delete(bounded)
  const raced = await hub(root, size + 128)
  const raceAuthority = principalAuthority(raced, human.id)
  const directory = (raced.teams as unknown as { readonly productDirectory: ProductDirectory }).productDirectory
  const read = directory.read.bind(directory)
  const publish = vi.spyOn(directory, 'read').mockImplementation(async (cursor, scope, allowance, maxBytes, callbacks) =>
    await read(cursor, scope, allowance, maxBytes, { ...callbacks,
      publish: async (ids, nextCursor) => {
        const current = await raced.teams.getTeam({ teamId: team.team.id })
        const input = { teamId: team.team.id, expectedRevision: current.goal.revision,
          objective: 'Directory contents changed while a page was being prepared. '.repeat(7) }
        await raced.teams.updateTeamGoal({ actor: raceAuthority.goal(input), ...input })
        return await callbacks.publish(ids, nextCursor)
      },
    }))
  try {
    await expect(raced.teams.listHumanTeamsPage({ reader: raceAuthority.reader, afterCursor: -1, limit: 128 }))
      .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE',
        message: 'Team directory changed beyond response allowance; refresh' })
    expect((await raced.teams.getTeam({ teamId: team.team.id })).goal.objective)
      .toContain('Directory contents changed')
  } finally { publish.mockRestore() }
  await raced.fiber.dispose(); contexts.delete(raced)
  const rotated = await hub(root)
  const rotatedAuthority = principalAuthority(rotated, human.id)
  const rotatedDirectory = (rotated.teams as unknown as { readonly productDirectory: ProductDirectory }).productDirectory
  const rotatedRead = rotatedDirectory.read.bind(rotatedDirectory)
  const rotate = vi.spyOn(rotatedDirectory, 'read').mockImplementation(async (cursor, scope, allowance, maxBytes, callbacks) =>
    await rotatedRead(cursor, scope, allowance, maxBytes, { ...callbacks,
      publish: async (ids, nextCursor) => {
        rotatedAuthority.advanceGeneration()
        return await callbacks.publish(ids, nextCursor)
      },
    }))
  try {
    await expect(rotated.teams.listHumanTeamsPage({ reader: rotatedAuthority.reader, afterCursor: -1, limit: 128 }))
      .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID', message: 'Team reader changed during discovery' })
  } finally { rotate.mockRestore() }
})
