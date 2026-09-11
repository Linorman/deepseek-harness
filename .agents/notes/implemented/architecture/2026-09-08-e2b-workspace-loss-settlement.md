# Agent Note: E2B workspace loss settlement

Status: implemented

English | [中文](2026-09-08-e2b-workspace-loss-settlement.zh.md)

## Problem

An expired E2B sandbox cannot restore its workspace from a path. A missing manifest also prevents safe reuse, but does not prove that the execution world stopped. Treating both cases as a generic preserved directory leaves task outcomes, artifact reachability, and execution termination ambiguous.

## Decision

Remote allocation metadata records the exact E2B execution-world identity. The provider checks that identity during restore and cleanup and polls a bounded number of owned manifests. Only an authoritative `SandboxNotFoundError` proves sandbox expiry; a changed world or missing manifest is unavailable without termination proof. Network failures remain ordinary retryable observation failures.

The Team journal records allocation `unavailable` with its exact world, loss reason, termination evidence, and retained artifact references. A source-owned proof binds the allocation revision and complete observation. The Hub rejects another world, discarded artifacts, and completion of a task whose workspace was lost. Unconfirmed loss atomically stalls Team admission. Loss records remain through preservation and release.

The Agent Client blocks the unavailable root and uses the task's exact Session turn evidence to stop its work. Confirmed expiry permits resource release followed by a failed attempt; the existing attempt limit selects retry or terminal failure. Unconfirmed execution keeps the resource unavailable and the Team stalled. Failure to establish stopped-task evidence preserves the allocation with a specific reason instead of settling its attempt prematurely.

Provider-backed artifacts are recorded in a local versioned storage-log manifest after each successful save. Partial publication therefore retains committed references after sandbox expiry and provider restart. Loss snapshots participate in artifact reachability, Host/SDK byte reads, and private-reference filtering. A remote-only URI is not retained as available bytes.

## Alternatives considered

**Recreate the sandbox under the same path.** Rejected because paths do not establish execution-world identity or recover lost files.

**Treat a missing manifest as terminated execution.** Rejected because processes can remain live in that sandbox; missing ownership evidence cannot authorize deletion.

**Keep artifact references only in the publishing operation.** Rejected because a later read can fail after earlier files were saved, orphaning otherwise usable evidence.

## Consequences

The [sandbox provider decision](2026-09-03-team-sandbox-workspace-providers.md) retains allocation and integration ownership. This decision adds explicit loss settlement and does not supersede local sandbox, shared-root, or worktree behavior. [Supervisor endpoints](2026-09-08-owned-activation-supervisor-endpoints.md) continue to own remote process fencing; a lost workspace never supplies an unrelated activation fence.

## Verification

Provider tests cover partial publication followed by expiry, retained references after provider restart, repeated loss notification, network uncertainty, and changed-world refusal. Real Agent/Hub tests prove exact-turn settlement before release, attempt retry, unconfirmed-loss stall, and denial of a foreign-world observation. Artifact transport tests cover retained loss references and private-reference denial. Keyed E2B expiry and multi-host deployment remain separate release evidence.
