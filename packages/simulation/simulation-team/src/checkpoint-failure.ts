/** Cross-owner IO failures retain a canonical subject while provider text remains private. */
import { SimulationCheckpointError, SimulationCheckpointCleanupError, SimulationRevisionConflictError } from '@clocky/clocky-simulation'
import type { SimulationCheckpointDiagnostic, SimulationCheckpointSubject } from '@clocky/clocky-simulation'
import { TeamError } from '@clocky/clocky-team'
import { SessionPersistenceReferenceChanged } from '@clocky/clocky-session-persistence'

/**
 * Attribute one owner read to its caller-proven reference without interpreting private error strings.
 * @param stage - Actual checkpoint pipeline stage.
 * @param subject - Canonical subject selected by the owned run/manifest.
 * @param operation - Exactly one owner IO.
 * @returns the unchanged result, or throws a structured failure with a private cause.
 */
export async function checkpointSource<T>(stage: SimulationCheckpointDiagnostic['stage'], subject: SimulationCheckpointSubject,
  operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (cause: unknown) {
    if (cause instanceof SimulationCheckpointError || cause instanceof SimulationCheckpointCleanupError) throw cause
    const moved = cause instanceof SimulationRevisionConflictError || cause instanceof SessionPersistenceReferenceChanged
      || cause instanceof TeamError
      && (cause.code === 'TEAM_CURSOR_CONFLICT' || cause.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
    throw new SimulationCheckpointError(cause instanceof Error ? cause.message : String(cause),
      { stage, subject, code: moved ? 'source-moved' : 'source-unavailable' }, { cause })
  }
}

/**
 * Construct a rule failure at the exact check rather than parsing its eventual prose.
 * @param message - Private explanation preserved for trusted native callers.
 * @param stage - Actual collection or recovery stage.
 * @param code - Public violated rule.
 * @param subject - Exact canonical owner/reference selected by the current pipeline.
 * @returns the structured error; this helper performs no IO or state mutation.
 */
export function checkpointRule(message: string, stage: SimulationCheckpointDiagnostic['stage'],
  code: SimulationCheckpointDiagnostic['code'], subject: SimulationCheckpointSubject): SimulationCheckpointError {
  return new SimulationCheckpointError(message, { stage, code, subject })
}

/** Classify only owner movement failures that permit another bounded collection or recovery attempt.
 * @param error - Current owner-read failure, before the caller decides whether its retry allowance remains.
 * @returns whether the failed observation moved rather than violating ownership or availability.
 */
export function checkpointOwnerMoved(error: unknown): boolean {
  return error instanceof SimulationCheckpointError && error.diagnostic.code === 'source-moved'
    || error instanceof SessionPersistenceReferenceChanged
    || error instanceof TeamError && (error.code === 'TEAM_CURSOR_CONFLICT' || error.code === 'TEAM_CHANNEL_CURSOR_CONFLICT')
}
