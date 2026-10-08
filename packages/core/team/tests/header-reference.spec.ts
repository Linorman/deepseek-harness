import { expect, it } from 'vitest'
import { parseTeamParticipantHeader } from '../src/header-reference.ts'

it('requires both valid header members and ignores unrelated Session metadata', () => {
  const header = { teamId: 'team', participantId: 'participant', cwd: '/workspace' }
  expect(parseTeamParticipantHeader(header)).toEqual({ teamId: 'team', participantId: 'participant' })
  for (const header of [ {}, { teamId: 'team' }, { participantId: 'participant' },
    { teamId: '', participantId: 'participant' }, { teamId: 'team', participantId: 4 } ]) {
    expect(parseTeamParticipantHeader(header)).toBeUndefined()
  }
})
