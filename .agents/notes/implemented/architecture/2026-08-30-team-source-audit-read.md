# Agent Note: Team source audit reads

Status: implemented

English | [中文](2026-08-30-team-source-audit-read.zh.md)

## Problem

The Host could inspect a Team or channel projection, but it had no bounded read path for the durable records that explain how that projection reached its current state.

## Decision

`TeamRuntime.readAudit()` reads a source-cursor page from the Team journal or an attached channel WAL. Each entry retains the owning Team, optional channel, source cursor, record type, timestamp, and JSON facts with source metadata removed. The Host exposes it as `team.audit.read` with default cursor and page handling; it never treats the projection as a second authority.

## Alternatives considered

**Build audit entries by combining current Team and channel snapshots.** Rejected because snapshots omit the ordered transitions needed for replay and incident diagnosis.

**Persist a second audit database.** Rejected because a read projection would add another failure and consistency boundary without owning business truth.

## Consequences

Host and browser clients can page durable Team or channel history by source cursor, including archive and adapter transitions, while the existing journal and WAL remain the only authoritative streams.
