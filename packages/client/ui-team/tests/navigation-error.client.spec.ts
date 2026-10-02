/** Navigation categories preserve rejection semantics without exposing another target's body. */
import { expect, it } from 'vitest'
import { TeamTaskStartError } from '@clocky/clocky-client-runtime/client'
import { describeNavigationFailure, WorkspaceNavigationError } from '../src/client/navigation-error.ts'
it.each([
  { error: { code: 'team-not-found', details: { teamId: 'missing' as never } }, reason: 'missing' },
  { error: { code: 'team-task-not-found', details: {} }, reason: 'missing' },
  { error: { code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', details: {} }, reason: 'forbidden' },
  { error: { code: 'PRODUCT_AUTH_INVALID', details: {} }, reason: 'forbidden' },
  { error: { code: 'team-service-unavailable', details: {} }, reason: 'failed' },
] as const)('classifies $error.code as $reason', ({ error, reason }) => {
  expect(describeNavigationFailure(new TeamTaskStartError('Host detail', { ...error, message: 'Host detail' })))
    .toEqual({ reason, detail: 'Host detail' })
})
it('keeps invalid links and historical binding refusals explicit, while unknown failures remain retryable reads', () => {
  expect(describeNavigationFailure(new WorkspaceNavigationError('invalid', 'Bad link')).reason).toBe('invalid')
  expect(describeNavigationFailure(new WorkspaceNavigationError('binding', 'Old Session')).reason).toBe('binding')
  expect(describeNavigationFailure(new TypeError('Failed to fetch')).reason).toBe('failed')
})
