# Agent Note: Shared Team workspace root allocation

Status: implemented

English | [中文](2026-08-28-shared-team-workspace-root.zh.md)

## Problem

An assigned shared-work task needs a concrete execution root that agrees with the local Agent Session, rather than an ambient process directory, a child directory, or a second spelling of the checkout.

The scheduler's declared write scopes constrain task selection but are not filesystem locks, so a provider must not present advisory scheduling facts as exclusive filesystem ownership.

## Decision

`@clocky/clocky-team-workspace-shared` registers the `shared-local` `shared`-mode provider on `ctx.teamWorkspaces`. Its required `root` configuration is an absolute existing directory resolved through `fs.realpath` at mount; the canonical result remains fixed for that provider lifetime.

`eligible()` returns false unless a current active Team projection retains the candidate task revision in `shared` mode, its Participant is an active `local-agent`, its exact current activation is available, and the live local Agent's Session header `cwd` string equals the configured canonical root. It neither canonicalizes nor rewrites the header, accepts a child directory, or substitutes another root.

`prepare()` rereads the Team projection and requires an active unexpired assigned or running lease whose attempt, assignment revision, Participant, activation, and Session match the request. It rechecks the active local Participant, available activation, live Agent, and exact header `cwd`, then calls the Team `workspace-allocate` policy hook. A policy denial remains a `TEAM_POLICY_DENIED` error. It returns root-free deterministic metadata; the Agent Client commits its Team reservation before `materialize()` returns one logical root. `restore()` and `reconcileRelease()` accept only that exact metadata.

An allocation retains a bounded immutable baseline sidecar independently of artifact/integration configuration. Publication and release append `workspace/observed` facts with complete/partial content versions, actual scan windows and scope classifications; these identify no writer. The allocation projection retains only the latest observation, with history in existing journal/audit pages. Release removes the logical entry and sidecar while preserving the user root; observation failures do not suppress other resource cleanup.

Task reports resolve an effect-owned publisher by the actual Agent object and exact task/attempt/allocation revision. AgentClient verifies the claimed Session turn, running lease, binding and root, then awaits provider publication before settlement. Release and disposal await that publication, including cancellation. The keyless FS/Shell Loader and queued-B isolation scenario exercise these actual paths.

An external `observationStateRoot` is created with owner-only directories at first load. The provider checks each ancestor and rejects user-controlled symlinks; root-owned aliases immediately below a protected filesystem root may resolve to their canonical system directory. This lets a fresh Harness home retain observations without pre-creating its state directory or writing through a repository-controlled redirect.

## Alternatives considered

**Canonicalize or accept every Session `cwd` spelling.** Rejected because a shared allocation must prove that the preconfigured execution root and the Agent's durable Session header are the same directory identity; silently adapting a header would hide a misplaced Agent.

**Claim filesystem locks from `writeScopes`.** Rejected because the scheduler's declared scopes are only selection constraints and cannot account for shell commands, generators, or other external writers. A lock claim would overstate the provider's authority.

**Create a worktree for every shared allocation.** Rejected because isolated checkout creation, base revision, cleanup, integration, and user dirty-tree handling belong to the separate [detached worktree allocation decision](2026-08-28-detached-team-worktree-allocation.md), not the shared-root provider.

## Consequences

The [deterministic Team DAG scheduler decision](2026-08-28-deterministic-team-dag-scheduler.md) continues to serialize overlapping declared shared write scopes, while this provider supplies the concrete root only after owner validation. The [durable task attempt lease decision](2026-08-28-durable-task-attempt-leases.md) remains the authority for task/lease identity and lifecycle.

The provider supplies no worktree, sandbox, or remote root and does not own Agent lifecycle. The Agent Client owns root exposure and fail-closed recovery; the provider returns bounded observed paths and optional artifacts with `accepted: false`. Integration remains an explicit provider/policy operation.

## Verification

Provider tests cover root validation and canonicalization, exact and stale eligibility, every lease/Participant/activation/Session rejection, policy denial, logical idempotence, release, and deleted-root handling. A real JSON-backed Team Hub plus live Agent Session composition verifies current-lease allocation and HMR unregistration without deleting the shared root.
