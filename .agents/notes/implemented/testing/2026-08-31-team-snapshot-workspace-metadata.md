# Agent Note: Team snapshot workspace metadata

Status: implemented

English | [中文](2026-08-31-team-snapshot-workspace-metadata.zh.md)

## Problem

The Team workspace runtime now includes a `Workspace root` line in task-assignment messages so a worker can locate its assigned execution surface. Keyless headless TeamRun snapshot fixtures still parsed the older assignment form with an end-anchored `Attempt` line. The worker therefore failed to recover its task and never emitted `team_task_report`, leaving the coordinator waiting until the loader timeout. The SDK snapshot contract also listed only the pre-existing Team tools even though the assembled catalog exposes goal, message, heartbeat, and review controls.

## Decision

Treat assignment metadata after `Attempt` as forward-compatible fixture input: the deterministic adapter extracts the task and attempt identifiers without anchoring the match to the end of the text. The fixture continues to require the stable `Task` and `Attempt` lines and ignores only explicitly appended workspace metadata. The SDK snapshot's expected required-argument map now includes every Team control exposed by the assembled catalog, including `team_message`, `team_task_heartbeat`, and `team_task_review`.

Keyless ACP snapshots were refreshed through the repository's refresh mode so pinned prompt/schema sidecars and replay transcripts describe the current Team catalog. No live model recording or runtime behavior is changed by this migration.

## Alternatives considered

**Remove the workspace line from runtime assignments.** Rejected because workers need an explicit model-visible workspace location for shared and isolated execution surfaces.

**Match the entire assignment text exactly in the fixture adapter.** Rejected because adding another valid assignment metadata line would unnecessarily break deterministic tests and would not protect the stable identifiers they actually consume.

**Loosen all snapshot assertions.** Rejected because only the assignment parser needs forward-compatible suffix handling; request headers, tool schemas, and durable logs remain exact.

## Consequences

The headless TeamRun delegation snapshot proves the worker can consume assignments carrying workspace metadata and complete the durable task lifecycle. Future assignment metadata may be appended after the stable identifiers without invalidating this fixture. Snapshot sidecars now pin the complete current Team tool surface, so catalog additions produce an explicit reviewed refresh rather than a misleading replay failure.

## Verification

- `pnpm run test:snapshot` passes (14 files, 91 tests, 2 skipped), including both headless TeamRun flows, ACP replay, and SDK replay.
- `pnpm run test:e2e` passes (31 files, 120 tests, 24 files and 63 tests skipped).
