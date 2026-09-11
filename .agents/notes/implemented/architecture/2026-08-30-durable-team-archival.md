# Agent Note: Durable Team archival

Status: implemented

English | [中文](2026-08-30-durable-team-archival.zh.md)

## Problem

Team creation and terminal settlement were durable, but there was no Team-owned way to hide a finished Team from ordinary product listings without deleting its journals.

## Decision

The Team Hub appends a versioned `team/archived` journal record only for `completed`, `failed`, or `cancelled` Teams. `TeamSnapshot.archivedAt` records the marker, `getTeam()` retains the complete state, and `listTeams()` omits archived Teams. Repeating archival is idempotent and returns the existing state; stale or active archival requests fail before append. Team and checkpoint format versions advance with the new record.

## Alternatives considered

**Keep archival in the Host or browser registry.** Rejected because a process restart would expose the Team again and different clients could disagree about visibility.

**Delete the Team journal.** Rejected because archival must preserve replay, task, channel, and transcript references.

## Consequences

Product clients can archive terminal Teams by `TeamId` while recovery and direct reads remain lossless. Schedulers and default listings naturally skip archived Teams; the journals and channel WALs remain available for inspection.
