# @clocky/clocky-team-workspace-e2b

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace-e2b` registers a `remote`-mode `TeamWorkspaceProvider` on `ctx.teamWorkspaces`. It allocates one isolated directory per exact task attempt inside the E2B sandbox owned by `ctx.e2b`, then publishes bounded remote file artifacts through the same Team Agent Client workspace lease.

## Configuration

`workspaceParent` is an optional absolute POSIX directory under the E2B runtime; omission derives a child of `ctx.e2b.runtimeRoot`. The provider normalizes both configured roots before containment checks, rejects NUL bytes and traversal outside the runtime, and rejects overlap between workspace and integration state. `providerName`, `artifactProvider`, `maxArtifactBytes`, `maxEntriesPerPublish`, and `maxListDepth` select provider identity, optional durable bytes, and bounded remote publication scans. `integrationRoot` is an optional remote directory under the same E2B runtime; `integrationEnabled` enables provider-specific target-directory integration, and `maxIntegrationBytes` bounds its portable change-set artifact. Mounting does not create another E2B sandbox; the E2B owner remains responsible for sandbox lifetime and disposal.

Materialization creates an `allocations/<digest>` root and a sibling `manifests/<digest>.json` record only after the Team allocation reservation. Restore and release verify the exact manifest, so an arbitrary remote path cannot become a recovered allocation. Metadata and version-2 manifests retain the exact E2B world identity. Sandbox expiry, missing manifests, and world changes produce explicit loss facts; transient network failure never proves termination. The Team Agent Client stops the exact task turn and either releases a confirmed expired allocation before attempt retry, or retains an unavailable allocation and stalls the Team.

`lossPollIntervalMs` defaults to 5000 ms; `maxLossChecksPerPoll` defaults to 16. Provider-backed artifacts require `storageLog`: each saved reference enters a local versioned manifest before publication continues, bounded by `maxRetainedArtifacts` (default 4096). Loss retains those references through provider restart, artifact collection, and Host/SDK reads. [Loss settlement](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.md).

## Publication

`publish()` lists the owned root to the configured depth, rejects a result larger than `maxEntriesPerPublish`, and returns stable relative file paths. Files no larger than `maxArtifactBytes` are read once and saved through the configured Team artifact provider when one is mounted; otherwise a remote URI and content hash identify the bytes in the live E2B sandbox. When integration is enabled, the bounded remote files are additionally encoded as one provider-bound `patch` artifact; `integrateSource()` applies that set to a remote target child after policy authorization and an expected content-version check.

`integrateSource()` treats `target` as a relative child directory below `integrationRoot`, creates only provider-owned target paths, and persists a `prepared` marker before the first remote mutation. The marker records whether the target root was provider-created, so a crash after creating an otherwise empty root can resume from an original `missing` target. A retry may resume only while the target still matches the marker's expected version; a changed target remains a conflict. After all bounded writes settle, the marker records the integrated target version. Remote file writes are serialized by this provider process; target versions hash bounded file contents and include `modifiedTime` for larger files so same-size remote changes still invalidate the expected-version fence. E2B does not provide a distributed compare-and-set or recovery after the sandbox itself expires.

## Model Experience

### Remote Team workspace

#### What the model sees

This package registers no prompt section, tool, model input, or model output. A mounted E2B filesystem and subprocess composition consumes the root published by `team-agent-client`; the model sees only the task's ordinary tool results and explicitly reported artifact references.

#### Token effect

Zero direct token effect; bounded publication metadata may enter a task result.

#### KV Cache effect

This provider owns no model-request prefix.

## Known Limitations and Deferred Work

- The E2B sandbox is a shared runtime resource, not a durable multi-host workspace store; a new E2B runtime cannot restore an expired sandbox.
- Integration is provider-specific: this provider integrates only its own portable file change sets into remote target directories and does not merge Git refs or recover an expired E2B sandbox.
- The keyed E2E covers live allocation, publication, and target-directory integration; keyed remote cancellation/restart evidence still requires `E2B_API_KEY` and remains outside keyless unit coverage.
