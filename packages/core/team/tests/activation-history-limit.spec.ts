import { expect, it } from 'vitest'
import { activationHistoryLimitDetails } from '../src/activation-history-limit.ts'
import { TeamError } from '../src/error.ts'
import { teamActivationHistoryLimitDetailsSchema } from '../src/schema.ts'

const details = { kind: 'activation-history-limit', teamId: 'team', teamCursor: 7, used: 1, limit: 1,
  participantId: 'participant', activationId: 'activation', sessionId: 'session', reservationId: 'reservation', cleanup: 'pending' }

it('requires complete exhausted history and explicit cleanup rather than interpreting error text or aggregate causes', () => {
  for (const cleanup of ['pending', 'confirmed', 'unconfirmed']) {
    const value = { ...details, cleanup }
    expect(activationHistoryLimitDetails(new TeamError('Opaque diagnostic', 'TEAM_CHANNEL_BACKPRESSURE', { details: value })))
      .toEqual(value)
  }
  for (const field of Object.keys(details).filter(value => value !== 'reservationId')) {
    const missing: Record<string, unknown> = { ...details }
    Reflect.deleteProperty(missing, field)
    expect(teamActivationHistoryLimitDetailsSchema.safeParse(missing).success).toBe(false)
  }
  for (const invalid of [{ ...details, used: 0 }, { ...details, used: 1, limit: 2 }, { ...details, limit: 0 },
    { ...details, teamCursor: -1 }, { ...details, cleanup: 'completed' }, { ...details, extra: true },
    { ...details, sessionId: '' }, { ...details, reservationId: '' }, { ...details, used: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(activationHistoryLimitDetails(new TeamError('Activation limit', 'TEAM_CHANNEL_BACKPRESSURE', { details: invalid })))
      .toBeUndefined()
  }
  const error = new TeamError('Activation limit', 'TEAM_CHANNEL_BACKPRESSURE', { details })
  expect(activationHistoryLimitDetails(new AggregateError([error]))).toBeUndefined()
  expect(activationHistoryLimitDetails(new TeamError('Activation limit', 'TEAM_BUDGET_EXCEEDED', { details }))).toBeUndefined()
  expect(activationHistoryLimitDetails(new Error('Activation limit'))).toBeUndefined()
  const { reservationId: _reservation, ...unreserved } = details
  expect(teamActivationHistoryLimitDetailsSchema.parse(unreserved)).toEqual(unreserved)
})
