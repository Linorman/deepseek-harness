/** Authorization errors require eviction; ordinary failures preserve same-scope display data. */
import { expect, it } from 'vitest'
import { isTeamAuthorizationError } from '../src/client/teams/access.ts'

it('distinguishes revoked and ambiguous membership from transport and revision failures', () => {
  expect(isTeamAuthorizationError(undefined)).toBe(false)
  expect(isTeamAuthorizationError({ code: 'internal', message: 'Transport unavailable', details: {} })).toBe(false)
  expect(isTeamAuthorizationError({ code: 'team-cursor-conflict', message: 'Refresh current revision', details: {} })).toBe(false)
  expect(isTeamAuthorizationError({ code: 'TEAM_HUMAN_ACTOR_AMBIGUOUS', message: 'Membership changed', details: {} })).toBe(true)
  expect(isTeamAuthorizationError({ code: 'PRODUCT_AUTH_INVALID', message: 'Credential revoked', details: {} })).toBe(true)
})
