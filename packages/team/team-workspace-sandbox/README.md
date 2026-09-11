# @clocky/clocky-team-workspace-sandbox

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace-sandbox` registers a `sandbox`-mode `TeamWorkspaceProvider` on `ctx.teamWorkspaces`. It creates one deterministic, provider-owned local directory for each exact task attempt, optionally copies a configured source directory into a new root, and exposes that root through the existing Team Agent Client lease.

## Configuration

`allocationParent` is an absolute existing directory that owns provider-created roots. `sourceRoot` is optional and, when set, must be another canonical directory; its contents are copied without following symlinks when a root is first materialized. `providerName`, `artifactProvider`, and `maxArtifactBytes` select the registry identity, optional Team artifact store, and bounded file publication size. `integrationRoot` is an optional separate absolute directory containing provider-specific target directories; `integrationEnabled` enables target-directory integration, and `maxIntegrationBytes` bounds the portable change-set artifact and decoded file bytes.

The provider writes a manifest beside each root, never derives ownership from a path alone, and refuses an unknown or tampered root during restore and release. Root creation happens after the Team allocation reservation, while release removes only a verified provider-owned root and manifest. The provider does not claim a filesystem lock. When integration is enabled, a publish with a configured artifact store also emits a portable provenance-bound patch change set; `integrateSource()` applies it to a target child directory after policy authorization and an expected snapshot-version check, using a provider-owned recovery marker.

## Publication

`publish()` compares the current root with the manifest's initial file snapshot and returns sorted changed paths. Regular files within `maxArtifactBytes` become provider-backed `TeamArtifactReference` values when `artifactProvider` is configured; without a store they retain a local file URI and content hash. When `integrationRoot` is configured, bounded file, symlink, and deletion changes are additionally encoded as one `patch` artifact for `integrateSource()`; an unsupported or oversized change set remains report-only. Deleted paths remain in the changed-path list without a file artifact.

`integrateSource()` treats `target` as a relative child directory name below `integrationRoot`. The provider stages a copy, rechecks the current content-derived target version, and replaces the target directory only after the expected-version fence passes. A marker outside integration targets permits a completed replacement to be recognized on retry, and a retry after a crash between moving the target to its provider-owned backup and installing the staged directory restores that backup before reapplying the change set. Provider-specific filesystem replacement is local-process serialized and is not a distributed lock.

## Model Experience

### Isolated Team sandbox

#### What the model sees

This package registers no prompt section, tool, model input, or model output. `team-agent-client` publishes the allocation root on the exact task Agent scope, and existing filesystem/process Consumers resolve that root for the task turn.

#### Token effect

Zero direct token effect; only explicitly reported changed paths and artifact references can enter a task result.

#### KV Cache effect

This provider owns no model-request prefix.

## Known Limitations and Deferred Work

- The local provider isolates filesystem roots but relies on the mounted filesystem and process Consumers for kernel enforcement.
- Integration is provider-specific: this provider integrates only its own portable change-set artifacts into local target directories and never performs Git branch merging.
- Root contents are local to one host; use an E2B or another remote provider for a different execution world.
