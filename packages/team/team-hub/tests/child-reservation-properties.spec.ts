import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { taskConcurrencyUsage, teamTaskSnapshotSchema } from '@clocky/clocky-team'
import type { TeamTaskDelegationPhase, TeamTaskSnapshot } from '@clocky/clocky-team'
import { task } from './fixtures.ts'

type Action = 'create' | 'create-retry' | 'bind' | 'stall' | 'cancel' | 'child-complete' | 'child-fail' | 'settle'

interface ModelState {
  readonly phase: TeamTaskDelegationPhase
  readonly childTeamId?: string
  readonly childCursor?: number
  readonly startedAt?: number
  readonly cancelRequested: boolean
  readonly childOutcome?: 'completed' | 'failed'
  readonly revision: number
  readonly updatedAt: number
}

const childTeamId = 'child-reservation-property'
const grant = {
  operations: ['register', 'usage', 'close'],
  workspaceModes: ['shared'],
  readScopes: [],
  writeScopes: [],
  budgets: {},
} as const
const initial = task({
  execution: {
    kind: 'child-team',
    templateId: 'child-property-v1',
    templateVersion: 1,
    authorityGrant: grant,
    budget: { maxConcurrency: 2 },
  },
  writeScopes: [],
  reviewPolicy: { kind: 'none' },
  maxAttempts: 1,
  attemptCount: 0,
  delegation: {
    id: 'delegation:child-reservation-property',
    phase: 'requested',
    requestedAt: 10,
    updatedAt: 10,
  },
})

const creation = {
  parentTeamId: initial.teamId,
  parentTaskId: initial.id,
  delegationId: initial.delegation!.id,
  goal: { objective: initial.description, budgets: { maxConcurrency: 2 } },
  rules: {},
  budgets: { maxConcurrency: 2 },
  authorityGrant: grant,
}

/** Build the durable task projection represented by one model state. */
function snapshot(state: ModelState): TeamTaskSnapshot {
  const reserved = state.startedAt !== undefined
  const terminal = state.phase === 'completed' || state.phase === 'failed' || state.phase === 'cancelled'
  const taskPhase = terminal ? state.phase : reserved ? 'running' : 'pending'
  const delegation = {
    ...initial.delegation!,
    phase: state.phase,
    updatedAt: state.updatedAt,
    ...state.startedAt === undefined ? {} : { startedAt: state.startedAt },
    ...state.childTeamId === undefined ? {} : { childTeamId: state.childTeamId, creation },
    ...state.childCursor === undefined ? {} : { childCursor: state.childCursor },
    ...state.phase === 'stalled' ? { failure: { code: 'CHILD_STALLED', message: 'The child reservation is stalled.' } } : {},
  }
  const cancellation = state.cancelRequested ? {
    requestedRevision: state.revision - 1,
    requestedBy: initial.createCommand.creator.participantId,
    requestedAt: state.updatedAt,
    target: {
      kind: 'delegation' as const,
      delegationId: initial.delegation!.id,
      ...state.childTeamId === undefined ? {} : { childTeamId: state.childTeamId },
    },
  } : undefined
  return teamTaskSnapshotSchema.parse({
    ...initial,
    revision: state.revision,
    phase: taskPhase,
    attemptCount: reserved ? 1 : 0,
    delegation,
    ...cancellation === undefined ? {} : { cancellation },
  })
}

/** Apply one bounded saga action; invalid interleavings are intentional no-ops. */
function step(state: ModelState, action: Action): ModelState {
  if (state.phase === 'completed' || state.phase === 'failed' || state.phase === 'cancelled') return state
  const next: ModelState = { ...state }
  let accepted = false
  switch (action) {
    case 'create':
    case 'create-retry':
      if (state.phase === 'requested' && !state.cancelRequested && state.childTeamId === undefined) {
        Object.assign(next, { phase: 'creating', childTeamId, startedAt: state.updatedAt + 1 })
        accepted = true
      }
      break
    case 'bind':
      if (state.phase === 'creating' && !state.cancelRequested && state.childTeamId !== undefined) {
        Object.assign(next, { phase: 'active', childCursor: 0 })
        accepted = true
      }
      break
    case 'stall':
      if (!state.cancelRequested && state.childTeamId !== undefined
        && (state.phase === 'creating' || state.phase === 'active' || state.phase === 'settling')) {
        Object.assign(next, { phase: 'stalled' })
        accepted = true
      }
      break
    case 'cancel':
      if (!state.cancelRequested) {
        Object.assign(next, { cancelRequested: true })
        accepted = true
      }
      break
    case 'child-complete':
    case 'child-fail':
      if (!state.cancelRequested && state.childTeamId !== undefined
        && (state.phase === 'creating' || state.phase === 'active' || state.phase === 'stalled')) {
        Object.assign(next, { phase: 'settling', childOutcome: action === 'child-complete' ? 'completed' : 'failed' })
        accepted = true
      }
      break
    case 'settle':
      if (state.cancelRequested) {
        Object.assign(next, { phase: 'cancelled' })
        accepted = true
      } else if (state.phase === 'settling' && state.childOutcome !== undefined) {
        Object.assign(next, { phase: state.childOutcome })
        accepted = true
      }
      break
  }
  return accepted
    ? { ...next, revision: state.revision + 1, updatedAt: state.updatedAt + 1 }
    : state
}

describe('child reservation state-machine properties', () => {
  it('keeps one reservation identity, bounded parent usage, and checkpoint agreement across interleavings', () => {
    const result = fc.check(fc.property(
      fc.array(fc.constantFrom<Action>('create', 'create-retry', 'bind', 'stall', 'cancel', 'child-complete', 'child-fail', 'settle'), {
        maxLength: 40,
      }),
      (actions) => {
        let state: ModelState = {
          phase: 'requested',
          cancelRequested: false,
          revision: initial.revision,
          updatedAt: initial.delegation!.updatedAt,
        }
        let createdIdentity: string | undefined
        for (const action of actions) {
          state = step(state, action)
          const current = snapshot(state)
          const identity = current.delegation?.childTeamId
          if (identity !== undefined) {
            createdIdentity ??= identity
            expect(identity).toBe(createdIdentity)
          }
          const active = current.delegation?.childTeamId !== undefined
            && (current.delegation.phase === 'creating' || current.delegation.phase === 'active'
              || current.delegation.phase === 'settling' || current.delegation.phase === 'stalled')
          expect(taskConcurrencyUsage(current)).toBe(active ? 2 : 0)
          expect(teamTaskSnapshotSchema.parse(structuredClone(current))).toEqual(current)
        }
        if (state.cancelRequested && state.startedAt === undefined) expect(state.childTeamId).toBeUndefined()
      },
    ), { numRuns: 100, seed: 20260912 })
    if (result.failed) throw new Error('child reservation property counterexample: ' + JSON.stringify(result))
  })
})
