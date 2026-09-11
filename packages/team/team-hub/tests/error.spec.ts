import { describe, expect, it } from 'vitest'
import { TeamHubError } from '../src/error.ts'

describe('TeamHubError', () => {
  it('retains its stable code and optional causal failure', () => {
    const plain = new TeamHubError('bad journal', 'TEAM_JOURNAL_MALFORMED')
    const cause = new Error('storage failed')
    const caused = new TeamHubError('bad channel', 'TEAM_CHANNEL_WAL_MALFORMED', { cause })

    expect(plain).toMatchObject({
      name: 'TeamHubError',
      message: 'bad journal',
      code: 'TEAM_JOURNAL_MALFORMED',
    })
    expect(caused).toMatchObject({
      name: 'TeamHubError',
      message: 'bad channel',
      code: 'TEAM_CHANNEL_WAL_MALFORMED',
      cause,
    })
    expect(caused).toBeInstanceOf(Error)
  })
})
