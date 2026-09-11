# Agent Note: Isolated Team sandbox workspace providers

Status: implemented

English | [中文](2026-09-03-team-sandbox-workspace-providers.zh.md)

## Problem

The Team workspace vocabulary already admitted `sandbox` and `remote` task modes, but only shared-root and detached-worktree providers could materialize an execution root. A scheduler could therefore select a mode that the task Agent could not consume, and workflow compilation had no mode-aware provider check.

## Decision

`@clocky/clocky-team-workspace-sandbox` registers a local `sandbox` provider. It creates a deterministic root under an explicitly configured allocation parent only after the Team allocation reservation, optionally seeds the root from a canonical source directory, retains a manifest outside the model-facing root, verifies that manifest during restore and release, and reports sorted changed files with bounded optional artifact publication. When explicitly enabled with an integration target root and artifact provider, it also emits and consumes a portable provenance-bound patch change set with an expected content-version fence and provider-owned recovery marker; if a process stops after an existing target moves to that provider-owned backup, a retry restores the backup before reapplying the change set. The provider owns cleanup of its roots but does not claim a distributed filesystem lock or Git integration authority.

`@clocky/clocky-team-workspace-e2b` registers an opt-in `remote` provider over the E2B execution world owned by `ctx.e2b`. It normalizes configured POSIX roots before containment checks, rejects NUL bytes, traversal outside the E2B runtime, and overlap between workspace and integration state, creates isolated remote allocation and manifest paths after reservation, verifies exact metadata before restore or release, and publishes bounded remote files through the configured Team artifact provider when available. When explicitly enabled, it consumes its portable patch change set into an E2B target directory after an expected content-version check, hashes bounded target files, includes `modifiedTime` for larger target files, writes a `prepared` marker before remote mutation with whether the target root was provider-created, and records the integrated target version only after all writes settle; a retry may treat only that provider-created empty root as equivalent to the original `missing` version, while any changed target remains a conflict. The E2B sandbox remains a runtime resource; a new E2B process cannot recover an expired sandbox.

The Team Agent Client already publishes every provider root on the exact activation-owned Agent workspace lease. TeamRun workflow compilation now accepts a non-shared workspace mode only when its provider is explicitly mounted; shared plans retain the existing local test and product composition behavior. Source integration remains an explicit provider-specific capability and is not inferred from a sandbox root.

`@clocky/clocky-team-workspace-shared` now supports the same portable source-integration boundary as an explicit opt-in. It snapshots a bounded source baseline for a live shared allocation, publishes file and patch references through the configured artifact provider, and applies its own patch only to a separate target directory with policy authorization, an expected content-version fence, staged replacement, and retry markers; a retry after target removal restores a provider-owned backup before reapplying the patch. It never locks or rewrites the shared source checkout.

All three providers coalesce concurrent materialization calls for one exact preparation into one allocation handle, so an async allocation race cannot publish multiple provider-owned resources for the same task attempt.

Shared release removes its provider-owned baseline only after sidecar cleanup succeeds; a cleanup error leaves the allocation and recovery evidence available for a later retry.

The keyed E2B workflow now exercises a real remote allocation, bounded publication, and provider-owned target-directory integration. Keyed remote cancellation and restart-after-expiry evidence remain external follow-up work.

Exact E2B world loss, task settlement, and retained partial artifacts are owned by the [workspace loss decision](2026-09-08-e2b-workspace-loss-settlement.md).

## Alternatives considered

**Treat `sandbox` as another shared root.** Rejected because a sandbox task needs a provider-owned root whose cleanup and visibility do not depend on the caller's Session cwd.

**Use an arbitrary path as a recovered remote allocation.** Rejected because remote paths are execution-world resources; the provider manifest must prove the exact allocation identity before a restart or release can touch them.

**Add a generic target mutation algorithm to every workspace provider.** Rejected because non-Git sandbox and remote targets have no common physical replacement or distributed compare-and-set semantics. The shared portable change-set encoding removes artifact-shape duplication, while each provider still owns its target authority and failure boundary.

## Consequences

Local sandbox tasks can consume an isolated root and publish bounded file evidence without affecting the main checkout. An explicitly configured local target directory can receive the provider's portable change set under policy and an expected-version fence; the operation is serialized within one provider process and does not claim a distributed lock or Git branch merge. Shared-root tasks can use the same artifact-sourced target-directory boundary without changing the source checkout, while retaining the shared provider's no-lock semantics. E2B tasks can consume a separate remote root while sharing the already mounted E2B process and filesystem adapters, and can apply bounded portable files to an explicit remote target while that sandbox remains live. Provider-less non-shared workflow plans fail before durable workflow task/channel creation; keyed remote cancellation and restart after sandbox expiry remain explicit follow-up work.

## Verification

- Portable change-set tests cover canonical round trips and rejection of unsafe paths, duplicate paths, invalid provenance, and oversized file bytes.
- Local sandbox provider tests cover source seeding, exact metadata restore, changed-file publication, provider-backed and provider-local artifacts, patch publication including symlink changes and no-change reports, existing-root reuse, reconciliation, large-file bounds, target-directory integration, expected-version conflict, prepared-marker backup recovery, retry recovery, policy/stale/tampered-root rejection, release, invalid configuration, and root-overlap configuration failure.
- E2B provider tests use a fake remote filesystem to cover normalized-root containment and overlap rejection, invalid configuration, allocation, bounded publication, provider-local fallback artifacts, patch publication, target-directory integration, expected-version conflict including a same-size large-file change, prepared-marker retry recognition after an interrupted first write, concurrent materialization, repeated abandonment, provider-owned reconciliation, restore, release, unavailable-sandbox failure, disabled integration, policy denial, malformed source patches, unsafe targets, non-directory/symlink/non-file target entries, tampered manifests, and forged allocations.
- Shared provider tests cover opt-in baseline and patch publication, report-only fallback artifacts and non-file entries, ownership fencing, prepared-marker backup recovery, proposal/integration policy, separate target-directory application, expected-version conflict, retry recognition, restart baseline restore, and configuration overlap or missing-dependency rejection; the default report-only behavior remains covered by the same suite.
- Shared, sandbox, and E2B provider tests assert concurrent materialization returns the same exact allocation handle.
- Shared provider tests assert a failed baseline-sidecar cleanup does not discard recovery state and that a later release retry succeeds.
- TeamRun tests cover compilation of a `sandbox` workflow task only when the `sandbox` provider is mounted; the existing shared workflow compile test remains green.
- The keyed E2B workflow runs a real sandbox through allocation, bounded publication, and target-directory integration; the keyless provider suite remains the source of deterministic failure-path coverage.
