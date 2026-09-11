/** Shared provenance helpers for provider-owned source integration operations. */

import { TeamError } from '@clocky/clocky-team'
import type { TeamArtifactReference } from '@clocky/clocky-team'
import type {
  TeamWorkspaceSourceIntegrateRequest,
  TeamWorkspaceSourceIntegrateResult,
} from './types.ts'

/**
 * Select the sole patch artifact that a completed source attempt may expose to integration.
 * @param request - source artifact manifest and integration identities.
 * @returns the unique provenance-bound patch reference.
 * @throws {@link TeamError} when the source has zero or multiple eligible patches.
 */
export function selectTeamWorkspacePatchArtifact(
  request: TeamWorkspaceSourceIntegrateRequest,
): TeamArtifactReference {
  const patches = request.source.artifacts.filter(artifact => (
    artifact.kind === 'patch' && artifact.sourceAttemptId === request.source.attemptId
  ))
  if (patches.length !== 1 || patches[0] === undefined) {
    throw new TeamError(
      `source attempt '${request.source.attemptId}' must retain exactly one provenance-bound patch artifact`,
      'TEAM_INVALID_ARGUMENT',
    )
  }
  return patches[0]
}

/**
 * Preserve all source and integration identities around a provider result.
 * @param request - source and integration task identities.
 * @param result - provider-owned operation outcome.
 * @returns a result with the caller-independent provenance restored.
 */
export function teamWorkspaceSourceIntegrationResult(
  request: TeamWorkspaceSourceIntegrateRequest,
  result: Pick<TeamWorkspaceSourceIntegrateResult, 'status' | 'targetVersion' | 'artifact' | 'conflictPaths'>,
): TeamWorkspaceSourceIntegrateResult {
  return {
    teamId: request.source.teamId,
    sourceTaskId: request.source.taskId,
    sourceAttemptId: request.source.attemptId,
    integrationTaskId: request.integrationTaskId,
    integrationAttemptId: request.integrationAttemptId,
    target: request.target,
    status: result.status,
    ...result.targetVersion === undefined ? {} : { targetVersion: result.targetVersion },
    ...result.artifact === undefined ? {} : { artifact: result.artifact },
    ...result.conflictPaths === undefined ? {} : { conflictPaths: [...result.conflictPaths] },
  }
}
