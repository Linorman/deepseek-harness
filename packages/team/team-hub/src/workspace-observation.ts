/** Derive workspace observation relations from authoritative allocation and task facts. @module */
import { isDeepStrictEqual } from 'node:util'
import { TeamError } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocationSnapshot, TeamTaskSnapshot, TeamWorkspaceObservationInput, TeamWorkspaceObservation } from '@clocky/clocky-team'

/**
 * Validate scan continuity and classify observed paths without attributing a writer.
 * @param allocation - Exact retained provider allocation.
 * @param task - Authoritative task and its current or settled attempt window.
 * @param input - Provider scan facts selected outside the Team queue.
 * @param observedAt - Monotonic Team journal commit timestamp.
 * @returns The complete durable observation with derived provenance.
 */
export function projectWorkspaceObservation(
  allocation: TeamWorkspaceAllocationSnapshot, task: TeamTaskSnapshot, input: TeamWorkspaceObservationInput, observedAt: number,
): TeamWorkspaceObservation {
  const prior = allocation.observation
  if (allocation.id !== input.allocationId || allocation.teamId !== input.teamId || allocation.revision !== input.expectedRevision
    || allocation.lifecycle === 'released' || task.id !== allocation.taskId || task.teamId !== allocation.teamId
    || prior?.id !== input.previousObservationId || prior?.id === input.id
    || observedAt < input.final.finishedAt || input.final.finishedAt < input.final.startedAt
    || (prior === undefined ? input.stage !== 'baseline' || input.base !== null || input.paths.length !== 0
      : input.base === null || !isDeepStrictEqual(input.base, prior.base ?? prior.final) || input.stage === 'baseline')
    || (!input.baselineAvailable && input.paths.length > 0)
    || (input.stage !== 'release' && allocation.lifecycle === 'release-requested')) {
    throw new TeamError('Workspace observation has a stale allocation, baseline or lifecycle window', 'TEAM_INVALID_ARGUMENT')
  }
  let previousPath = ''
  for (const path of input.paths) {
    if (path.path <= previousPath || (path.change === 'deleted' && !input.final.complete)
      || (path.change === 'added' && input.base?.complete !== true)) {
      throw new TeamError('Workspace observation paths are unordered or infer absence from a partial scan', 'TEAM_INVALID_ARGUMENT')
    }
    previousPath = path.path
  }
  return { ...input, taskId: allocation.taskId, attemptId: allocation.attemptId, observedAt,
    truncated: !input.baselineAvailable || !input.final.complete || input.base?.complete === false || input.omittedPaths > 0,
    paths: classifyObservationPaths(allocation, task, input),
  }
}

/** Derive classifications from immutable write scopes and the retained matching attempt window. */
function classifyObservationPaths(
  allocation: TeamWorkspaceAllocationSnapshot, task: TeamTaskSnapshot, input: TeamWorkspaceObservationInput,
): TeamWorkspaceObservation['paths'] {
  const lease = task.lease?.attemptId === allocation.attemptId ? task.lease : undefined
  const history = task.attemptHistory.find(attempt => attempt.id === allocation.attemptId)
  const start = lease?.startedAt ?? history?.startedAt
  const end = lease?.expiresAt ?? (history === undefined ? undefined : Math.min(history.settledAt, history.leaseExpiresAt))
  const ownedWindow = start !== undefined && end !== undefined && input.base !== null
    && input.base.startedAt >= start && input.final.finishedAt <= end
  return input.paths.map(path => ({ ...path, classification: !ownedWindow ? 'external-window'
    : task.writeScopes.some(scope => scope === '.' || scope === path.path || path.path.startsWith(`${scope.replace(/\/$/u, '')}/`))
      ? 'declared' : 'undeclared' }))
}

/**
 * Validate the latest checkpoint observation against its retained allocation, task, and Team timestamp.
 * @param allocation - Parsed allocation checkpoint carrying its optional latest observation.
 * @param task - Retained task whose immutable scopes and attempt history determine classifications.
 * @param updatedAt - Current Team checkpoint timestamp.
 */
export function assertWorkspaceObservationSnapshot(
  allocation: TeamWorkspaceAllocationSnapshot, task: TeamTaskSnapshot, updatedAt: number,
): void {
  const observation = allocation.observation
  if (observation === undefined) return
  const paths = observation.paths.map(({ path, change }) => ({ path, change }))
  const input = { ...observation, paths }
  if (observation.teamId !== allocation.teamId || observation.allocationId !== allocation.id
    || observation.taskId !== allocation.taskId || observation.attemptId !== allocation.attemptId
    || observation.expectedRevision > allocation.revision || observation.observedAt > updatedAt
    || observation.observedAt < observation.final.finishedAt
    || (observation.stage === 'baseline' ? observation.base !== null || observation.previousObservationId !== undefined || paths.length !== 0
      : observation.base === null || observation.previousObservationId === undefined
        || observation.previousObservationId === observation.id)
    || observation.truncated !== (!observation.baselineAvailable || !observation.final.complete
      || observation.base?.complete === false || observation.omittedPaths > 0)
    || !isDeepStrictEqual(observation.paths, classifyObservationPaths(allocation, task, input))) {
    throw new TeamError('Workspace checkpoint observation does not match its allocation, scope or scan completeness', 'TEAM_INVALID_ARGUMENT')
  }
  let previousPath = ''
  for (const path of paths) {
    if (path.path <= previousPath || (!observation.baselineAvailable && paths.length > 0)
      || (path.change === 'added' && observation.base?.complete !== true) || (path.change === 'deleted' && !observation.final.complete)) {
      throw new TeamError('Workspace checkpoint observation has invalid path or partial-absence facts', 'TEAM_INVALID_ARGUMENT')
    }
    previousPath = path.path
  }
}
