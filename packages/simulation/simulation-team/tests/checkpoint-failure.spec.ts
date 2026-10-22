/** Structured checkpoint failures keep the owner and retry classification without parsing private text. */
import { expect, it } from 'vitest'
import { SimulationCheckpointError, SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import { TeamError } from '@clocky/clocky-team'
import { checkpointOwnerMoved, checkpointRule, checkpointSource } from '../src/checkpoint-failure.ts'

const subject = { kind: 'run' as const }

it('attributes a changed Native cut as source movement while retaining its original revision conflict', async () => {
  const failure = new SimulationRevisionConflictError(12, 14)
  await expect(checkpointSource('validate', subject, async () => { throw failure })).rejects.toMatchObject({
    diagnostic: { stage: 'validate', code: 'source-moved', subject }, cause: failure,
  })
})

it('preserves an already attributed checkpoint failure', async () => {
  const failure = checkpointRule('Original trusted failure', 'collect', 'history-incomplete', subject)
  await expect(checkpointSource('collect', subject, async () => { throw failure })).rejects.toBe(failure)
  expect(failure).toBeInstanceOf(SimulationCheckpointError)
  expect(checkpointOwnerMoved(failure)).toBe(false)
})

it('classifies both Team cursor conflicts as moved sources without accepting unrelated Team failures', async () => {
  for (const code of ['TEAM_CURSOR_CONFLICT', 'TEAM_CHANNEL_CURSOR_CONFLICT'] as const) {
    const failure = new TeamError('Private owner details', code)
    expect(checkpointOwnerMoved(failure)).toBe(true)
    await expect(checkpointSource('collect', subject, async () => { throw failure }))
      .rejects.toMatchObject({ diagnostic: { stage: 'collect', code: 'source-moved', subject } })
  }
  expect(checkpointOwnerMoved(new TeamError('Unavailable', 'TEAM_INVALID_ARGUMENT'))).toBe(false)
  await expect(checkpointSource('collect', subject, async () => { throw 'private non-error failure' }))
    .rejects.toMatchObject({ diagnostic: { stage: 'collect', code: 'source-unavailable', subject } })
})
