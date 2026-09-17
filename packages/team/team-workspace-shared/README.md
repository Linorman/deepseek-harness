# @clocky/clocky-team-workspace-shared

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace-shared` registers a local shared-root `TeamWorkspaceProvider` on `ctx.teamWorkspaces`. It allocates one already-existing checkout root only for matching local-Agent attempts; it neither creates a checkout nor changes an Agent's working directory.

`observationExcludedRoots` is an explicit list of existing absolute runtime directories, empty by default. The scanner omits these subtrees; the configured shared root must not be inside an excluded directory. Headless and Web exclude their configured Clocky home so Session and Team journal writes do not become worker change evidence. Other workspace files remain observable.

## Root configuration

`root` is required and must be an absolute path to an existing directory. Mounting resolves it through `fs.realpath` and retains that canonical directory as the fallback root. A relative, missing, or non-directory root rejects at load. A symlink spelling is accepted only as its resolved target, so all later comparisons use one path identity. `allowTeamWorkspacePath` is opt-in; when true, a Team's durable `workspacePath` selects the canonical existing root for that Team's allocations.

The shipped Headless and Web Team compositions pass `process.cwd()` as the fallback and enable `allowTeamWorkspacePath`, so a folder selected before `team.start` is used by the coordinator and every worker. A worker whose Session header records another `cwd` remains ineligible, and `materialize()` rejects rather than rewriting the header or changing the selected root.

`artifactProvider` and `maxArtifactBytes` optionally enable bounded file publication through `ctx.teamArtifacts`. `integrationRoot` is an optional separate directory containing provider-specific target directories; `integrationEnabled` additionally enables target-directory integration and requires both `integrationRoot` and `artifactProvider`. `maxIntegrationBytes` bounds the portable change-set and decoded file bytes.

## Eligibility and allocation

`eligible()` returns `false` unless the task requests `shared`, its current owner is a `local-agent`, and a live local Agent has the exact bound Session with a header `cwd` equal to the selected canonical root. With `allowTeamWorkspacePath`, that root comes from the Team's durable workspace rule; otherwise it is the configured fallback. It never changes a session header, accepts a child directory, or treats a different spelling as an alternate execution root.

`prepare()` and `materialize()` reread Team state before returning a root. They require the current active lease to match the Team, task, attempt, assigned revision, Participant, activation, and Session in the request; they then recheck the exact live local Agent and header. They submit validated facts to the Team `workspace-allocate` policy hook, so a denial rejects before publication. Repeating the same current allocation request reuses its logical attempt allocation until `release()` rather than creating an additional resource.

The returned `release()` is logical and idempotent. It never removes the configured root, creates a filesystem lock, serializes writes, or rewrites any Team record. Shared-work write-scope serialization remains the scheduler's durable advisory rule; unknown filesystem writes remain outside this provider's authority.

`publish()` remains report-only when no artifact or integration configuration is present. With optional publication enabled it snapshots the shared root when the allocation is materialized, returns sorted changed paths, and can persist bounded file references. With `integrationRoot` and an artifact provider it also emits one provenance-bound portable change-set patch; the source baseline is retained in a provider-owned state directory until release. `integrateSource()` is an explicit policy-authorized target-directory operation with an expected content-version fence, staged replacement, and local-process retry marker. A retry after a crash between moving an existing target to its provider-owned backup and installing the staged directory restores that backup before reapplying the change set. It never merges Git refs or writes the shared source root.

## Model Experience

### Shared Team workspace

#### What the model sees

This package registers no prompt section, tool, model input, or model output. A separate Agent preset Consumer may use a `shared` allocation root to compose filesystem and process authority.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This provider owns no model request prefix.

## Known Limitations and Deferred Work

- **No isolated execution roots** — worktree, sandbox, and remote providers own separate roots and their cleanup rules.
- **No filesystem enforcement** — this provider does not lock write scopes or inspect external writes. Shared-work serialization remains a scheduler rule, and target integration is provider-local rather than a distributed lock or Git merge authority.
- **Integration requires an explicit separate target root and artifact store** — without the opt-in configuration, `publish()` remains report-only for integration purposes and `integrateSource()` cannot apply a source change set.
- **No Agent lifecycle or task settlement** — activation placement, delivery-bound attempt start, heartbeat, result reporting, and review remain independent Team roles.
