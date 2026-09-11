# Agent Note: Durable Team audit projection

Status: implemented

English | [中文](2026-09-01-durable-team-audit-projection.zh.md)

## Problem

`readAudit()` previously read the Team journal or channel WAL directly and converted raw records into `TeamAuditEntry` values during every request. That made the audit surface another read-time interpretation of business data, provided no independent audit cursor or durable projection, and gave a failed post-commit audit write no repair path.

## Decision

The local Team Hub owns one rebuildable audit stream per source: `audit/<TeamId>` for the Team journal and `audit/<TeamId>/channel/<ChannelId>` for a channel WAL. Each stream uses audit projection format `1`, stores one validated `TeamAuditEntry` per source record, and keeps the source cursor aligned with the audit-stream sequence. Business records remain the authority; audit entries contain the source kind, optional channel identity, source cursor, timestamp, discriminator, and structured facts.

After a Team or channel business append succeeds, the Hub best-effort repairs and appends the corresponding audit suffix. Audit failure is logged and does not roll back the committed business record. A later audit read or post-commit maintenance pass reopens the projection, validates its existing prefix against the source facts, detects an audit tail ahead of the source, and appends missing source records in `recoveryPageSize` batches. Storage sequence conflicts discard the stale audit handle so the next pass can reopen it against the current durable tail.

`TeamMetricsSnapshot` counts successful audit-projection maintenance passes and failures separately from the existing event and delivery counters. The counters make a degraded audit projection visible through the existing Host and SDK metrics path without making operational metrics part of Team business authority.

`readAudit()` repairs the selected audit projection before reading a bounded `limit + 1` page. It parses only audit entries, verifies stream identity, cursor alignment, and exact source facts, and returns the source-specific continuation cursor; it never falls back to interpreting raw business records as the public audit model. Team and channel audit streams are closed with the Hub and use the same JSON/SQLite storage-log route as their source.

## Alternatives considered

**Continue projecting raw Team/channel records during each read.** Rejected because the public audit model would have no independent durable state or repair watermark, and every consumer could accidentally grow a different interpretation.

**Let audit append failure reject the business mutation.** Rejected because audit is a rebuildable operational projection; rolling back a committed Team or channel fact is impossible across the independent storage streams.

**Use one mixed Team audit stream for all channel sources.** Rejected because a channel read would need to filter a global stream and could no longer use the source cursor as a bounded continuation without rescanning unrelated channels. Source-specific streams preserve cursor alignment and ownership.

**Keep a process-local audit cache.** Rejected because restart would erase the projection and concurrent Hub writers would have no durable repair boundary. The audit stream is durable; in-memory maps only retain open handles and serialize local maintenance.

## Consequences

Audit reads now have an independent, validated, paged projection and survive Hub restart. Missing audit suffixes are repairable, while malformed, facts-mismatched, or ahead-of-source audit data fails loudly instead of silently reverting to raw business interpretation. Audit writes add a second storage append after business commit and can increase write latency; failures remain observable through logs and the existing metrics route, and remain retryable. Terminal Team and channel source/audit prefixes can be compacted only behind current checkpoints, configured audit tails, and the Hub's retention gates; full replay-watermark policy, telemetry, and operational alerts remain under the native multi-agent work-system proposal.

Team Hub tests cover persisted Team and channel audit reads, source-specific cursors, JSON/SQLite restart, missing Team audit suffix repair, source facts validation, separate audit stream materialization, and business success when the JSON audit stream has an incompatible version. Property/model-based, distributed conflict, load, and browser evidence remains pending.
