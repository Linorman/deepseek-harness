/** Human products exclude private references without changing provider-owned result facts. */
import { expect, it } from 'vitest'
import { withoutPrivateTeamArtifacts, withoutPrivateWorkflowArtifacts } from '@clocky/clocky-team/selection'
import type { TeamStateSnapshot, TeamWorkflowPlanSnapshot } from '@clocky/clocky-team'
import { task, settledAttempt } from '../../../team/team-hub/tests/fixtures.ts'

const visible = { id: 'visible', kind: 'report', uri: 'artifact:visible', visibility: 'team' }
const privateRef = { ...visible, id: 'private-result', uri: 'artifact:private', visibility: 'private' }
const result = { summary: 'Completed', artifacts: [visible, privateRef],
  integration: { target: 'workspace', status: 'proposed', proposalArtifact: privateRef } }

it('keeps shared result facts and removes private references from every Team carrier without mutating the journal snapshot', () => {
  const completed = settledAttempt({ outcome: { kind: 'completed', result } })
  const released = settledAttempt({ id: 'attempt-released', ordinal: 2, outcome: { kind: 'released' } })
  const work = task({ attemptHistory: [completed, released], attemptCount: 2, maxAttempts: 2 })
  const state = { tasks: [work], workspaceAllocations: [{ id: 'resident' },
    { id: 'lost', loss: { artifacts: [visible, privateRef], reason: 'Lost writer' } }],
  } as unknown as TeamStateSnapshot
  const original = structuredClone(state)
  const projected = withoutPrivateTeamArtifacts(state)
  expect(JSON.stringify(projected)).not.toContain('private-result')
  expect(projected.tasks[0]?.attemptHistory[0]?.outcome).toMatchObject({ kind: 'completed', result: {
    summary: 'Completed', artifacts: [visible], integration: { target: 'workspace', status: 'proposed' },
  } })
  expect(projected.tasks[0]?.attemptHistory[1]).toEqual(released)
  expect(projected.workspaceAllocations[1]?.loss).toMatchObject({ reason: 'Lost writer', artifacts: [visible] })
  expect(state).toEqual(original)
})

it('retains incomplete workflow states and filters completed results without inventing a workflow result', () => {
  const incomplete = { id: 'compiling' } as unknown as TeamWorkflowPlanSnapshot
  expect(withoutPrivateWorkflowArtifacts(incomplete)).toBe(incomplete)
  const plan = { id: 'workflow', result: { tasks: [{ phase: 'completed', result },
    { phase: 'cancelled', reason: 'No delivery' }] } } as unknown as TeamWorkflowPlanSnapshot
  const original = structuredClone(plan)
  const projected = withoutPrivateWorkflowArtifacts(plan)
  expect(JSON.stringify(projected)).not.toContain('private-result')
  expect(projected.result?.tasks).toEqual([{ phase: 'completed', result: {
    summary: 'Completed', artifacts: [visible], integration: { target: 'workspace', status: 'proposed' },
  } }, { phase: 'cancelled', reason: 'No delivery' }])
  expect(plan).toEqual(original)
})
