# @clocky/clocky-team-workspace-worktree

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace-worktree` registers one `worktree`-mode `TeamWorkspaceProvider` on `ctx.teamWorkspaces`. It creates an isolated detached Git worktree for one exact current local-Agent task attempt, then releases only that provider-created worktree through normal Git removal.

## Required configuration

Every field is explicit. `repoRoot` and `allocationParent` must be absolute existing directories; mounting canonicalizes both with `fs.realpath`, requires `repoRoot` to equal Git's reported top-level, resolves `gitExecutable` through `ctx.subprocess`, and freezes `baseRef` as one commit before provider registration. `providerName`, `gitExecutable`, and `baseRef` reject empty or whitespace-padded values. `processGraceMs`, `commandTimeoutMs`, and `outputMaxBytes` must be positive integers; grace and timeout cannot exceed the subprocess timer limit.

| Key | Meaning |
|---|---|
| `providerName` | Registry identity for this provider. |
| `repoRoot` | Canonical main Git worktree and execution directory for Git commands. |
| `allocationParent` | Existing parent directory for provider-minted detached worktrees. |
| `baseRef` | Revision expression resolved to the immutable detached base commit at mount. |
| `gitExecutable` | Absolute Git executable or bare name resolved in the subprocess execution world. |
| `processGraceMs` | TERM-to-KILL grace for every finite Git command. |
| `commandTimeoutMs` | Wall-time bound for one Git command; termination then receives a fresh `processGraceMs` drain deadline. |
| `outputMaxBytes` | Bounded stdout and stderr retention for every Git command. |
| `artifactProvider` | Optional `ctx.teamArtifacts` provider used to persist bounded file and patch bytes; omitted keeps provider-local references. |
| `integrationEnabled` | Explicit opt-in for this provider's detached merge authority; defaults to `false`. |
| `integrationAuthorName` / `integrationAuthorEmail` | Author identity for commits created only by an explicitly accepted integration. |

Git runs through `ctx.subprocess` with direct argv, ignored stdin, `GIT_TERMINAL_PROMPT=0`, and ambient `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` removed. A timed-out command is terminated and observed with a fresh bounded drain signal; an unproven drain rejects loudly. The provider never invokes a shell or `child_process` directly.

## Eligibility, allocation, and release

`eligible()` returns `false` unless the task remains `worktree` mode at the observed revision, the Team is active, its candidate Participant is an active `local-agent`, the exact activation binding is deliverable, and its Session remains a live local Agent. It creates no directory and does not read or rewrite the Agent Session working directory.

`allocate()` rereads the Team projection before Git mutation. It requires an active unexpired assigned or running lease matching the request's Team, task, attempt, assigned revision, Participant, activation, and Session, then submits the validated facts and derived root to the Team `workspace-allocate` policy hook. A policy denial rejects with `TEAM_POLICY_DENIED` before `git worktree add` runs. It repeats the exact currentness and policy check after Git creates the worktree, removing only that just-created clean root if the second check rejects.

The provider derives a safe deterministic child directory from the complete attempt and binding identity, rejects any existing path instead of claiming or deleting it, and runs `git worktree add --detach` from the mount-time base commit. Repeating a current exact request returns the same immutable allocation until release. Worktree roots are never created from raw Team identifiers.

`release()` is idempotent after success and uses `git worktree remove` without `--force`. A dirty worktree therefore remains allocated and a rejected release can be retried after its contents are resolved. Allocation and release serialize per exact attempt: a later allocation waits for an in-flight removal, recreates only after successful removal and revalidation, and propagates a removal failure instead of returning a root being removed. The provider never recursively removes directories. Provider unregistration blocks new allocations; an accepted allocation retains the subprocess capability it needs for a later release.

`integrate({ mode: 'integrate' })` is a separate, opt-in authority. It requires the `workspace-integrate` policy hook, validates a local branch target and optional `expectedTarget` commit, builds a temporary source commit through an isolated index, merges it in a provider-created detached worktree, and updates the target ref with Git's expected-old-value compare-and-set. `integrateSource()` applies the same target-fence and detached-worktree authority to a completed source attempt's persisted binary patch, so it does not require the source allocation to remain live. Source patches include tracked changes, deletions, and untracked additions while leaving the source worktree index untouched. A successful result includes the resulting `targetVersion`, so a Team integration task can retain the exact target fence and outcome in its durable attempt record. Conflicts return `status: 'conflict'` and paths without changing the target; checked-out targets are rejected. The task worktree and the user's main checkout are never staged, committed, merged, or force-pushed by this operation.

## Model Experience

### Detached Team worktree

#### What the model sees

This package registers no prompt section, tool, model input, or model output. `team-agent-client` publishes a returned `TeamWorkspaceAllocation.root` on the exact task Agent scope; shell and discovery Consumers resolve that root for their process calls. The assignment message also carries the root so the model can reconstruct the execution context from its Session log.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This provider owns no model request prefix.

## Known Limitations and Deferred Work

- **Execution-root consumption is binding-aware** — the Team Agent Client validates and retains the allocation for the exact attempt and exposes it to scoped shell/discovery Consumers.
- **Provider-backed artifacts and explicit integration** — `publish()` records changed paths, persists bounded file bytes through the configured artifact provider when available, and persists a binary patch for tracked changes, deletions, and untracked additions. Without `artifactProvider`, it returns provider-local file references. Integration remains disabled unless `integrationEnabled` and the Team policy allow it; proposal mode is always available, while the explicit authority updates only an unoccupied target branch.
- **No crash recovery catalog** — an untracked worktree left after process loss is preserved rather than claimed or removed by a new provider instance.
