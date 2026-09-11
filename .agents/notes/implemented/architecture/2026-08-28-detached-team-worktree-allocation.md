# Agent Note: Detached Team worktree allocation

Status: implemented

English | [中文](2026-08-28-detached-team-worktree-allocation.zh.md)

## Problem

A `worktree` task needs an isolated checkout tied to one durable attempt, without deriving a path from untrusted Team identifiers, treating scheduler scopes as filesystem locks, or risking user files during cleanup.

The shared-root provider deliberately does not create checkouts. Its rejection of per-attempt worktree creation remains valid for shared mode, while an isolated mode needs its own Git lifecycle and release rules.

## Decision

`@clocky/clocky-team-workspace-worktree` registers a required-name `worktree` provider on `ctx.teamWorkspaces`. Mounting requires explicit canonical main-repository root, existing allocation parent, base ref, Git executable, subprocess grace, command timeout, output bound, and provider name. It resolves the executable through `ctx.subprocess`, verifies the configured repository is Git's canonical top-level, and resolves the base ref once to a commit before publication.

`eligible()` checks the current task revision, active Team, active local-agent Participant, deliverable exact activation binding, live Session-backed Agent, and both retained directories without allocating a root. `prepare()` rereads the Team and demands its active unexpired lease match every attempt, revision, Participant, activation, and Session field. It returns root-free provider metadata after the `workspace-allocate` policy accepts those facts. The Team Agent Client reserves that metadata in the Team journal before calling `materialize()`, which repeats the validation immediately before Git mutation.

The provider derives a safe deterministic child name from the complete attempt and binding identity, refuses any pre-existing path, and runs direct-argv `git worktree add --detach` from the frozen commit. It repeats exact Team/lease/activation/live-Agent/policy validation after Git creates the worktree and removes only that clean provider-created root when the second check fails. Git executes only through the subprocess seam with prompt disabled and ambient Git redirection variables removed; every command carries a deadline signal, then a fresh grace-bounded drain signal after termination. Repeating the exact current allocation reuses one immutable handle.

`release()` uses ordinary `git worktree remove` with no force option. A dirty worktree remains allocated when Git rejects removal, and the same handle retries after a caller resolves its contents. Per-attempt serialization makes a later allocation wait for an in-flight release; it creates a fresh root only after successful removal and propagates a release failure instead of returning a root being removed. `restore()` accepts only exact provider-minted metadata, verifies the deterministic canonical worktree and base commit, and reopens it. `reconcileRelease()` derives only that same root, treats a missing root as already cleaned, or performs normal Git removal without materializing a new root. The provider never removes arbitrary paths, commits, merges, pushes, or changes Team state. An accepted handle captures the subprocess capability, so provider unregistration blocks new allocations without preventing its later release.

## Alternatives considered

**Use raw Team ids in the worktree path.** Rejected because Team identifiers are only nonempty strings at the service boundary; a hash-derived child name avoids traversal, Git option, and path-ownership ambiguity.

**Remove a dirty worktree with `--force` or recursive filesystem deletion.** Rejected because either operation can discard the task's or user's unintegrated changes. Normal Git removal makes unresolved dirtiness observable and retryable.

**Create a branch, commit task output, or merge on release.** Deferred because allocation does not establish integration authority. A later integration Consumer owns review, merge proposal, conflict resolution, validation, and user authority.

## Consequences

`worktree` allocations may run independently of shared-work write-scope serialization, but they remain tied to the same durable lease fences described by the [task-attempt decision](2026-08-28-durable-task-attempt-leases.md). The [shared workspace decision](2026-08-28-shared-team-workspace-root.md) remains active because it owns the distinct same-checkout rule; it is not superseded.

The Team journal retains exact provider metadata and lifecycle state but never a filesystem root. The Agent Client restores active or reserved allocations only from those facts and keeps its Agent scope unavailable until recovery succeeds. The release-only `team-workspace-recovery` Consumer reconciles `release-requested` metadata, then confirms release or records preservation. There is no separate root catalog to infer from after a crash. Integration, broader artifact provenance, changed-path audit, sandbox roots, and remote providers remain work in the [native Team proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md).

## Verification

Provider tests create real Git repositories under project `.tmp` through `ctx.subprocess`. They verify root-free preparation, reserve-before-materialize ordering, canonical mount validation, complete subprocess-output handling, pre- and post-add Team/lease/activation/Session rejection, policy denial, deterministic idempotence, serialized materialize/release ordering, dirty retryable release, exact restore/reconciliation after live-map loss, base and Git-registration fences, bounded oversized-artifact fallback, malformed source patches, target-ref compare-and-set races, existing-path preservation, worktree verification cleanup, command timeout, and HMR release after unregistration. Client and recovery tests cover reservation, activation, terminal release, preservation, restart reconciliation, and bounded pulse shutdown. The focused provider suite currently reaches 95.07% statement, 92.76% branch, 93.47% function, and 96.01% line coverage; cleanup injection, internal concurrency windows, and impossible filesystem paths remain explicitly reported by the repository coverage gate.
