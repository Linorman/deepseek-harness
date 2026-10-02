# Agent Note: Immutable Team task creation time

Status: implemented

English | [中文](2026-09-29-team-task-creation-time.zh.md)

## Problem

Team task snapshots retain revision and creation-command identity without the time of first acceptance. A product query cannot order off-page tasks by creation time from those snapshots, and the current Team cursor or later mutation timestamp does not preserve their origin.

## Decision

The Hub stamps required `TeamTaskSnapshot.createdAt` with the same monotonic real-time timestamp as its first `task/changed` record. Command callers cannot supply it. Edits, assignments, attempts, reviews, cancellation and deletion retain the original value; an idempotent creation retry returns the existing task.

Journal replay checks equality with the first record and refuses changes in subsequent revisions. Checkpoint reconstruction checks that task creation falls within its owning Team's creation/update interval. Both Team journal and checkpoint formats are 40; the pre-release backend rejects prior formats instead of inventing a timestamp for retained tasks.

## Alternatives considered

**Order only the loaded browser page.** Off-page tasks remain unavailable and pagination changes the apparent collection order.

**Use the latest Team cursor or task mutation time.** An unrelated Team command or later task edit can reorder older tasks and cannot establish creation time.

**Default missing times during recovery.** The value cannot be reconstructed after retained-prefix compaction, and an arbitrary default gives old tasks a fabricated origin.

## Consequences

Complete task read records include another numeric field; existing complete-result byte allowances still apply. This timestamp uses real time and does not define Simulation ticks or change Session format. The [local Hub authority decision](2026-08-27-local-team-hub-durable-authority.md) retains journal, checkpoint and serializer ownership. The Team pending-item product query remains a separate implementation step.

## Verification

Fold tests preserve creation time through edit, deletion and checkpoint replay, and reject missing, forged-first-record, changed-revision and out-of-lifetime checkpoint values. JSON/SQLite replay fixtures retain valid timestamps while exercising their original corruption cases. Consumer suites cover Team, SDK, workspace and GUI record parsing. The keyless real-Host collection scenario checks accepted times, creation retries and unchanged time after task edits.
