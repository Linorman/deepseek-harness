# Agent Note: Durable storage logs and Team service definition

Status: implemented

English | [中文](2026-08-27-durable-storage-logs-and-team-service-definition.zh.md)

## Problem

The experimental Team runtime stores Team facts in a Lead Session and derives its state by replaying that Session. A stable Team provider needs a persistence root that is independent of a live Agent and a durable expected-sequence operation for Team journals and channel WALs. The existing storage KV facet provides atomic current-record writes but cannot atomically compare a stream tail, append a complete event batch, and preserve a projection checkpoint.

The product also needs a Team vocabulary that cannot confuse a Team, participant, channel, activation, envelope, task, or attempt with a Session. Reusing the experimental `TeamId(SessionId)` conversion would retain the identity coupling that the native work-system design removes.

## Decision

`@clocky/clocky-storage` exposes an optional `log` facet beside `kv`. A `LogStream` appends a non-empty batch only when the caller's expected tail matches the durable tail, reads bounded ordered pages, and stores a monotonic checkpoint no later than that tail. Every value crosses the durable boundary as a detached JSON snapshot. `@clocky/clocky-storage-log` mounts `ctx.storage.log` and `ctx.storageLog`, routes one caller-owned stream handle per opaque name, lists only streams that remain owned by their configured route, and closes admission before draining accepted opens and handles during disposal.

The JSON backend stores each log stream under an encoded filename and holds one root-wide owner record for all log operations. A live same-host or foreign-host owner rejects another Hub; a proven-dead same-host owner is atomically quarantined before recovery. The SQLite backend stores stream metadata, entries, and checkpoints in its schema. `BEGIN IMMEDIATE` encloses tail comparison, complete-batch insert, tail advance, and commit, so independently opened SQLite backends cannot both accept the same expected tail. Its physical schema version is `2`; pre-release databases stamped with another version fail loud.

`@clocky/clocky-team` defines independent branded Team identities, parsers for durable and wire records, closed lifecycle vocabularies with pure transition checks, versioned channel-adapter registration, Team policy waterfalls, and contained post-commit observers at `ctx.teams`. Channel manifests freeze adapter configuration while the WAL records lifecycle edges separately. It imports neither AgentLoop nor the experimental Team runtime. It is an abstract Service Definition. [`@clocky/clocky-team-hub`](../../../../packages/team/team-hub/README.md) is its local provider for Team journals, channel WALs, projections, recovery, roster/task mutations, and cursor watches; delivery, scheduling, Agent placement, and product operations remain separate work.

The Phase 0 inventory records every current direct Session creation, resume, fork, and model-visible orchestration path in `.agents/inventory/direct-session-entrypoints.json`. Its verifier runs with the static package checks, so a later cutover starts from checked source locations rather than a prose-only list.

## Alternatives considered

**Keep Team state in the Lead Session and add methods to the experimental service.** Rejected because stable Team identity, durable ordering, authorization, and recovery would still require a live Lead Session and direct-child lineage.

**Build expected-tail append from the KV facet.** Rejected because independent load and write calls cannot provide a backend-level compare-and-set batch or checkpoint watermark; a provider would falsely claim atomic recovery semantics.

**Use Session identifiers as Team identifiers.** Rejected because a Session is an optional local transcript for one participant, while a Team is a durable collaboration and authorization root. Cross-boundary IDs remain distinct brands and are parsed only at durable or wire boundaries.

**Mount a Team Hub without the log form or replace product Session entry points in this foundation.** Rejected because a local Hub needs durable expected-tail streams, replay, and checkpoints before it can own Team state. The [local Team Hub](2026-08-27-local-team-hub-durable-authority.md) uses that foundation; Agent runtime placement, channel delivery, task scheduling, and product APIs remain separate work.

## Consequences

JSON and SQLite consumers share one append-log contract. JSON explicitly refuses concurrent Hub ownership instead of silently accepting last-writer-wins stream updates; SQLite supplies transactional expected-tail behavior. The log data form remains host-side and contributes no model-visible prompt, tool, or Session event.

The Team Service Definition is public to providers. The local Hub creates durable Teams only when it is explicitly mounted and changes no current Session, Goal, workflow, SDK, Web, ACP, or CLI operation. The experimental Team packages remain the shipped opt-in coordination implementation until a product cutover replaces them.

The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because its scheduler, workspace, and product work are not shipped; the [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) records its completed local-durability portion. The [domain KV storage proposal](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) remains active for its domain and workspace decisions. The [implicit-Lead Team retirement decision](../simplification/2026-08-29-retire-implicit-lead-agent-teams.md) owns the removed legacy implementation.

## Verification

The JSON and SQLite backends run the same log conformance suite for expected-tail conflicts, atomic batches, paging, checkpoint monotonicity, restart, malformed tails, close, and stream listing. Provider-specific tests cover JSON single-Hub ownership, encoded opaque stream names, same-host stale-lock recovery, SQLite independent-backend compare-and-set, and shutdown admission. The log form tests route resolution, stream discovery, HMR-style mount/unmount, in-flight open disposal, and aggregate cleanup. The Team package tests runtime schemas, identity separation, adapter registration disposal, policy waterfalls, and post-commit observer containment. The local Hub tests exercise real JSON and SQLite restart recovery, checkpoint fallback, task CAS/DAG validation, channel WAL reads/watches, and post-commit invariants.
