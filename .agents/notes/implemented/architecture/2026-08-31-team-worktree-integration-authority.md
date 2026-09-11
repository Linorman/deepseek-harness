# Agent Note: Team worktree integration authority

Status: implemented

English | [中文](2026-08-31-team-worktree-integration-authority.zh.md)

## Problem

The detached Team worktree provider could report changed paths and produce a reviewable patch, but no configured authority could safely apply an accepted change set to a target branch. Treating `publish()` as an implicit merge would risk dirty user worktrees, race with concurrent branch updates, and make policy approval indistinguishable from observation.

## Decision

`team-workspace-worktree` exposes an explicit `integrationEnabled` configuration and commit author identity. `integrate({ mode: 'integrate' })` first runs the `workspace-integrate` policy waterfall, resolves a local branch target, and optionally checks the caller's `expectedTarget` commit. It builds a temporary source commit with an isolated `GIT_INDEX_FILE`, creates a provider-owned detached integration worktree from the target commit, performs a no-ff merge, and updates `refs/heads/<target>` with Git's expected-old-value compare-and-set.

The operation returns `status: 'integrated'` only after the target ref update succeeds and includes the resulting target commit as `targetVersion`. A merge conflict returns `status: 'conflict'`, `accepted: false`, and unmerged paths after aborting the temporary merge. A target branch checked out by any worktree is rejected because updating it would leave a user checkout stale. Temporary indexes, source commits, and integration worktrees are cleaned up under the provider's bounded subprocess and aggregate-cleanup rules. The task allocation and the user's main checkout are never staged or committed by the integration operation.

Proposal and conflict results never carry `targetVersion`; only `integrated` proves that the target ref advanced to a new revision.

The Team task contract retains an explicit integration task that names a completed source attempt, provider, target, expected target revision, and proposal or merge mode. The Hub validates that source and target fence at task creation and validates the provider result at task settlement. `executeTeamIntegrationTask()` obtains the completed source artifact manifest, invokes the named workspace provider, and settles the result through the current activation-owned task lease. The `team_task_integrate` tool and local/WebSocket Link operations expose only task/attempt fences and optional verification; source, provider, target, and mode remain durable task facts. Worktree providers accept the source patch through `integrateSource()`, so integration does not require a live source allocation; the patch is diffed from the allocation base and includes committed changes, deletions, and untracked additions without staging the source index.

The Host RPC and TypeScript SDK task-create payloads retain the same integration specification, and their fixtures preserve it through the carrier. Those product writes still fail closed until an authenticated Team actor is available; the shared wire contract does not silently drop an authorized integration request.

`integrationEnabled` defaults to `false`; proposal mode remains available without it. The provider never pushes, force-updates a ref, or changes Team task state. Callers still decide when the source allocation is clean and can be released after integration.

## Alternatives considered

**Merge directly in the task worktree.** Rejected because it would mutate the task-owned checkout, make release cleanup depend on merge state, and conflate source execution with integration authority.

**Apply a patch directly to the user's main checkout.** Rejected because the checkout may contain unrelated dirty work and has no durable target revision fence.

**Update a target branch without an expected old commit.** Rejected because a concurrent writer could be overwritten silently. Git's expected-old-value ref update is the final compare-and-set boundary even when the caller omits `expectedTarget`.

**Use a temporary index in the task worktree.** Rejected because the source Agent's index is provider-owned state that must remain untouched; the isolated index captures tracked and untracked changes without staging the live allocation.

## Consequences

Deployments can opt into a concrete, auditable integration path while preserving the safe report-only default. Branch races and merge conflicts are explicit results, and target changes remain atomic at the ref boundary. Integration creates a commit using the configured author identity and therefore requires a policy decision and operational retention for the resulting history. Remote pushes, human review UI, and cross-host authority coordination remain caller responsibilities.

## Verification

- Worktree provider tests cover successful detached integration, resulting target-version provenance, expected-target mismatch, same-file merge conflicts, policy-disabled integration, dirty-source preservation, source/target checkout safety, and artifact-sourced integration with tracked, deleted, and untracked paths.
- Team Hub tests cover durable integration-task source/result fences, mismatched result rejection, and JSON restart reconstruction.
- Workspace executor and tool composition tests cover provider delegation, idempotent settlement, local task assignment, and the model-visible integration result.
- The WebSocket Hub test covers the real remote `task-start` and `task-integrate` dispatch through proof-derived workspace authority and durable settlement.
- `pnpm exec vitest run packages/team/team-workspace-worktree/tests/provider.spec.ts` passes.
- The focused Hub, schema, and worktree integration tests, the host typecheck, and the full Vitest suite pass.
