/** Provider-independent Team artifact storage contracts. @module @clocky/clocky-team-artifact/types */

import type {
  JsonObject,
  TaskAttemptId,
  TeamArtifactReference,
  TeamId,
  TeamTaskId,
} from '@clocky/clocky-team'

/** Bytes or UTF-8 text submitted to an artifact provider. */
export type TeamArtifactData = Uint8Array | string

/** One artifact write whose provenance is checked by the provider. */
export interface TeamArtifactWriteRequest {
  /** Team that owns the artifact. */
  readonly teamId: TeamId
  /** Task that produced the artifact, when the artifact belongs to a task. */
  readonly taskId?: TeamTaskId | undefined
  /** Attempt that produced the artifact, when the artifact belongs to a task. */
  readonly sourceAttemptId?: TaskAttemptId | undefined
  /** Artifact category used by Team views and integration consumers. */
  readonly kind: TeamArtifactReference['kind']
  /** Visibility requested by the owning Team policy. */
  readonly visibility: TeamArtifactReference['visibility']
  /** Optional caller label retained only as provider metadata. */
  readonly name?: string | undefined
  /** Complete bytes or text to persist. */
  readonly data: TeamArtifactData
  /** Optional JSON metadata that the provider may retain beside the object. */
  readonly metadata?: JsonObject | undefined
}

/** Read request for one provider-owned artifact reference. */
export interface TeamArtifactReadRequest {
  /** Reference previously returned by this provider. */
  readonly reference: TeamArtifactReference
  /** Optional cancellation for bounded storage reads. */
  readonly signal?: AbortSignal | undefined
}

/** Optional provider-level retention operation for one Team artifact. */
export interface TeamArtifactDeleteRequest {
  /** Reference previously returned by this provider. */
  readonly reference: TeamArtifactReference
  /** Optional cancellation for a delete operation. */
  readonly signal?: AbortSignal | undefined
}

/** One bounded provider sweep used by a reachability owner. */
export interface TeamArtifactCollectRequest {
  /** References that are reachable from the current Team projections. */
  readonly reachable: readonly TeamArtifactReference[]
  /** Provider-owned object ids that already passed the retention grace period. */
  readonly reclaimableIds: readonly string[]
  /** Opaque exclusive cursor returned by the preceding sweep page. */
  readonly afterCursor?: string | undefined
  /** Maximum object rows to inspect during this sweep page. */
  readonly limit: number
  /** Optional cancellation for a bounded collection pass. */
  readonly signal?: AbortSignal | undefined
}

/** One provider-owned cleanup failure retained without aborting sibling objects. */
export interface TeamArtifactCollectionFailure {
  /** Provider-owned object id that could not be inspected or deleted. */
  readonly id: string
  /** Bounded human-readable failure description. */
  readonly message: string
}

/** Result of one bounded provider collection page. */
export interface TeamArtifactCollectResult {
  /** Candidate object rows inspected during this page. */
  readonly scanned: number
  /** Inspected rows retained because they are reachable or not reclaimable. */
  readonly retained: number
  /** Provider-owned ids observed as currently unreachable. */
  readonly unreachable: readonly string[]
  /** Provider-owned ids removed by this page. */
  readonly deleted: readonly string[]
  /** Per-object failures that did not prevent other rows from being processed. */
  readonly failures: readonly TeamArtifactCollectionFailure[]
  /** Opaque cursor for a following page, when the store has more rows. */
  readonly nextCursor?: string | undefined
}

/** Provider-owned durable artifact store. */
export interface TeamArtifactProvider {
  /** Stable provider name used in diagnostics and artifact ids. */
  readonly name: string
  /** Persist one bounded artifact and return its immutable reference. */
  save(request: TeamArtifactWriteRequest): Promise<TeamArtifactReference>
  /** Read and verify one provider-owned artifact. */
  read(request: TeamArtifactReadRequest): Promise<Uint8Array>
  /** Optionally remove one provider-owned object after retention policy settles. */
  delete?(request: TeamArtifactDeleteRequest): Promise<void>
  /** Optionally sweep a bounded page after a reachability owner settles retention. */
  collect?(request: TeamArtifactCollectRequest): Promise<TeamArtifactCollectResult>
}

/** Read-only provider identity exposed by the registry. */
export interface TeamArtifactProviderRef {
  /** Stable provider name. */
  readonly name: string
}
