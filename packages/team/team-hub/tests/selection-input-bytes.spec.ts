import { expect, it } from 'vitest'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, teamId, teamPhase } from './fixtures.ts'

it('rejects complete attention and identity selections above the configured input byte allowance', async () => {
  const records = [createdTeam(), teamPhase()]
  const ctx = await recover('json', records, undefined, teamId, [], records.length - 1, [], {
    maxSelectionBytes: 1,
  })
  await expect(ctx.teams.getTeamAttention({ teamId, actor: {} as never }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(ctx.teams.resolveIdentities({ teamId, participantIds: ['member' as never], actor: {} as never }))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})
