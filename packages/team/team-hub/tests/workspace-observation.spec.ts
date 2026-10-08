import { describe, expect, it } from 'vitest'
import { teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import type {
  TeamTaskSnapshot,
  TeamWorkspaceAllocationSnapshot,
  TeamWorkspaceObservationInput,
  TeamWorkspaceScanVersion,
} from '@clocky/clocky-team'
import { assertWorkspaceObservationSnapshot, projectWorkspaceObservation } from '../src/workspace-observation.ts'

const teamId = teamIdSchema.parse('observation-team')
const taskId = teamTaskIdSchema.parse('observation-task')
const attemptId = 'observation-attempt' as TeamWorkspaceAllocationSnapshot['attemptId']

function scan(startedAt: number, finishedAt: number, complete = true): TeamWorkspaceScanVersion {
  return { digest: `scan-${String(startedAt)}-${String(finishedAt)}` as TeamWorkspaceScanVersion['digest'],
    complete, startedAt, finishedAt, scannedEntries: 2, hashedBytes: 8, knownOmittedEntries: 0,
    incompleteReasons: complete ? [] : ['limit'] }
}

function allocation(overrides: Partial<TeamWorkspaceAllocationSnapshot> = {}): TeamWorkspaceAllocationSnapshot {
  return { id: 'observation-allocation' as TeamWorkspaceAllocationSnapshot['id'], revision: 1, teamId, taskId,
    attemptId, assignedRevision: 1, participantId: 'worker' as TeamWorkspaceAllocationSnapshot['participantId'],
    activationId: 'activation' as TeamWorkspaceAllocationSnapshot['activationId'],
    sessionId: 'session' as TeamWorkspaceAllocationSnapshot['sessionId'], provider: 'test', mode: 'shared',
    lifecycle: 'active', reservedAt: 5, updatedAt: 5, ...overrides }
}

type TaskOverrides = Omit<Partial<TeamTaskSnapshot>, 'lease'> & { lease?: TeamTaskSnapshot['lease'] | undefined }
function task(overrides: TaskOverrides = {}): TeamTaskSnapshot {
  // Only task identity, scope and attempt windows are inputs to this pure projection.
  return { id: taskId, teamId, writeScopes: ['src'], attemptHistory: [],
    lease: { attemptId, startedAt: 10, expiresAt: 30 }, ...overrides } as TeamTaskSnapshot
}

function baseline(overrides: Partial<TeamWorkspaceObservationInput> = {}): TeamWorkspaceObservationInput {
  return { teamId, allocationId: allocation().id, expectedRevision: 1,
    id: 'baseline' as TeamWorkspaceObservationInput['id'], stage: 'baseline', base: null,
    baselineAvailable: true, final: scan(12, 13), paths: [], omittedPaths: 0, ...overrides }
}

describe('workspace observation projection', () => {
  it('classifies only changes inside the retained attempt and declared scopes', () => {
    const first = projectWorkspaceObservation(allocation(), task(), baseline(), 14)
    const next = baseline({ id: 'periodic' as TeamWorkspaceObservationInput['id'],
      previousObservationId: first.id, stage: 'periodic', base: first.final,
      final: scan(15, 16), paths: [
        { path: 'src/a.ts', change: 'modified' }, { path: 'tmp/a.ts', change: 'modified' },
      ] })
    const observed = projectWorkspaceObservation(allocation({ observation: first }), task(), next, 17)
    expect(observed.paths).toEqual([
      { path: 'src/a.ts', change: 'modified', classification: 'declared' },
      { path: 'tmp/a.ts', change: 'modified', classification: 'undeclared' },
    ])
    expect(observed.truncated).toBe(false)
    expect(() => { assertWorkspaceObservationSnapshot(allocation({ observation: observed }), task(), 17) }).not.toThrow()

    const outside = projectWorkspaceObservation(allocation({ observation: first }), task(),
      { ...next, final: scan(31, 32), omittedPaths: 1 }, 33)
    expect(outside.paths.map(path => path.classification)).toEqual(['external-window', 'external-window'])
    expect(outside.truncated).toBe(true)

    const attempt: TeamTaskSnapshot['attemptHistory'][number] = { id: attemptId, teamId, taskId,
      ordinal: 1, participantId: allocation().participantId, activationId: allocation().activationId,
      assignedAt: 9, startedAt: 10, settledAt: 25, leaseExpiresAt: 30, outcome: { kind: 'released' } }
    const settled = task({ lease: undefined, attemptHistory: [attempt] })
    const fromHistory = projectWorkspaceObservation(allocation({ observation: first }), settled,
      { ...next, paths: [{ path: 'src/a.ts', change: 'added' }] }, 17)
    expect(fromHistory.paths[0]?.classification).toBe('declared')
    expect(projectWorkspaceObservation(allocation({ observation: first }), settled,
      { ...next, final: scan(25, 26) }, 27).paths[0]?.classification).toBe('external-window')
    expect(projectWorkspaceObservation(allocation({ observation: first }), task({ lease: undefined }),
      next, 17).paths[0]?.classification).toBe('external-window')
    const early = projectWorkspaceObservation(allocation(), task(), baseline({ final: scan(9, 13) }), 14)
    expect(projectWorkspaceObservation(allocation({ observation: early }), task(),
      { ...next, base: early.final }, 17).paths[0]?.classification).toBe('external-window')
    expect(projectWorkspaceObservation(allocation({ observation: first }), task({ writeScopes: ['.'] }),
      next, 17).paths.map(path => path.classification)).toEqual(['declared', 'declared'])
  })

  it('rejects stale allocation, bad scan continuity, and unsafe absence claims', () => {
    const owner = allocation()
    const current = task()
    for (const input of [
      baseline({ allocationId: 'other' as TeamWorkspaceObservationInput['allocationId'] }),
      baseline({ expectedRevision: 2 }),
      baseline({ stage: 'periodic' }),
      baseline({ base: scan(8, 9) }),
      baseline({ paths: [{ path: 'src/a.ts', change: 'modified' }] }),
      baseline({ final: scan(13, 12) }),
      baseline({ baselineAvailable: false, paths: [{ path: 'src/a.ts', change: 'modified' }] }),
    ]) expect(() => projectWorkspaceObservation(owner, current, input, 14)).toThrow()
    const first = projectWorkspaceObservation(owner, current, baseline(), 14)
    const next = baseline({ id: 'next' as TeamWorkspaceObservationInput['id'],
      previousObservationId: first.id, stage: 'periodic', base: first.final, final: scan(15, 16) })
    for (const input of [
      { ...next, previousObservationId: undefined },
      { ...next, id: first.id },
      { ...next, base: scan(7, 8) },
      { ...next, stage: 'baseline' as const },
      { ...next, baselineAvailable: false, paths: [{ path: 'src/a.ts', change: 'modified' as const }] },
      { ...next, paths: [{ path: 'b', change: 'modified' as const }, { path: 'a', change: 'modified' as const }] },
      { ...next, paths: [{ path: 'added', change: 'added' as const }], base: scan(12, 13, false) },
      { ...next, paths: [{ path: 'deleted', change: 'deleted' as const }], final: scan(15, 16, false) },
    ]) expect(() => projectWorkspaceObservation(allocation({ observation: first }), current, input, 17)).toThrow()
    expect(() => projectWorkspaceObservation(allocation({ lifecycle: 'release-requested', observation: first }),
      current, next, 17)).toThrow()
    expect(projectWorkspaceObservation(allocation({ lifecycle: 'release-requested', observation: first }),
      current, { ...next, stage: 'release' }, 17).stage).toBe('release')
  })

  it('refuses altered checkpoint provenance, classification, and path order', () => {
    const first = projectWorkspaceObservation(allocation(), task(), baseline(), 14)
    const next = projectWorkspaceObservation(allocation({ observation: first }), task(), baseline({
      id: 'periodic' as TeamWorkspaceObservationInput['id'], previousObservationId: first.id,
      stage: 'periodic', base: first.final, final: scan(15, 16),
      paths: [{ path: 'src/a.ts', change: 'modified' }],
    }), 17)
    const owner = allocation({ observation: next })
    expect(() => { assertWorkspaceObservationSnapshot(allocation(), task(), 17) }).not.toThrow()
    for (const observation of [
      { ...next, taskId: teamTaskIdSchema.parse('foreign-task') },
      { ...next, observedAt: 18 },
      { ...next, truncated: true },
      { ...next, paths: [{ ...next.paths[0]!, classification: 'undeclared' as const }] },
      { ...next, paths: [{ ...next.paths[0]!, path: '' }] },
    ]) expect(() => { assertWorkspaceObservationSnapshot({ ...owner, observation }, task(), 17) }).toThrow()
    const corruptPaths = [
      { ...next, baselineAvailable: false, truncated: true },
      { ...next, paths: [{ path: 'other/a.ts', change: 'added' as const, classification: 'undeclared' as const }],
        base: scan(12, 13, false), truncated: true },
      { ...next, paths: [{ path: 'other/a.ts', change: 'deleted' as const, classification: 'undeclared' as const }],
        final: scan(15, 16, false), truncated: true },
      { ...next, paths: [{ path: '', change: 'modified' as const, classification: 'undeclared' as const }] },
    ]
    for (const observation of corruptPaths) {
      expect(() => { assertWorkspaceObservationSnapshot({ ...owner, observation }, task(), 17) }).toThrow(/invalid path/)
    }
  })
})
