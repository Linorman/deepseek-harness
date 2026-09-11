# Agent Note: Bounded Team control-plane read pages

Status: implemented

English | [中文](2026-09-01-bounded-team-control-plane-pages.zh.md)

## Problem

The Team provider already read channel WALs in storage-sized pages, but its product-facing channel, Team, participant, and task reads could still return an entire logical result. Host, SDK, Python, and Web consumers therefore had no shared continuation contract, and a long-lived Team could turn a management request into an unnecessarily large response. Internal scheduler and recovery scans still need complete projections, so changing every existing full-read caller would mix product pagination with provider-owned replay.

## Decision

`clocky-team` defines separate bounded read seams: `listTeamsPage()`, `listParticipantsPage()`, `listTasksPage()`, and `readChannelPage()`. Each request carries an exclusive `afterCursor` and positive `limit`; each response returns at most one page and an optional `nextCursor` only when a bounded look-ahead proves another item exists.

Team-list cursors address materialized journal descriptor ordinals, including archived descriptors that are omitted from visible items. Participant and task cursors address stable provider order retained by their durable projection maps. Channel cursors are channel-WAL sequences. The local Hub caps requested pages by `recoveryPageSize`, validates channel record continuity, and applies view policies only to the records in the bounded page. Its existing full `listTeams()`, `listTasks()`, and `readChannel()` methods remain provider-owned seams for scheduler, recovery, and finalization scans.

Recovery Consumers commit a Team discovery cursor only after hydrating every summary in that page. Channel-admission and human-delivery queues reinsert the selected channel before propagating a transient Team, channel, storage, or admission failure, so the next bounded pass retries the same work instead of advancing past it.

The Host `team.list`, `team.member.list`, `team.task.list`, and `team.channel.read` routes accept optional cursor/limit fields and forward resolved defaults to the page seams. The TypeScript SDK protocol and high-level API expose the same fields and continuation results. The Python SDK forwards snake-case cursor/limit arguments to the same wire fields. The browser Team refresh follows Team-list continuation pages and exposes channel-page continuation through its runtime contract.

The existing `readAudit()` page now reads one bounded look-ahead record as well, so an exactly-full final audit page omits `nextCursor` instead of advertising an empty continuation.

This is a read-only contract change and does not alter Team journal, checkpoint, channel WAL, or channel checkpoint format versions. Existing unpaged product callers receive the server's bounded default page; callers needing more data must continue explicitly.

## Alternatives considered

**Change the existing full-read methods in place.** Rejected because scheduler, recovery, finalization, and test-only authoritative scans intentionally need complete data. Mixing their contracts with product pages would either break recovery or force provider internals to reconstruct a full result from an API-shaped page.

**Let Host slice `getTeam()` or an already materialized full result.** Rejected because it leaves the provider and transport boundary unbounded and still makes channel reads reconstruct the entire WAL before slicing. The provider-owned page seams bound the response at the storage/projection boundary.

**Use a string token or a Team journal cursor for every list.** Rejected because participant/task list positions are projection-order cursors rather than journal positions, and introducing opaque token persistence would add state without improving the local pre-release contract. The distinct numeric cursor semantics are documented per list family.

**Return `nextCursor` whenever a page is exactly full without look-ahead.** Rejected because an exactly-full final page would advertise a phantom continuation and cause an avoidable empty request. One bounded look-ahead record makes exhaustion explicit while keeping memory bounded.

## Consequences

The management plane has one page vocabulary across local Hub, Host, TypeScript SDK, Python SDK, and Web refreshes. A response is bounded by the caller's limit and the Hub's configured recovery size; channel view projection no longer requires a complete WAL in the product read path. The trade-off is that list traversal is a caller responsibility, and concurrent insertions can be observed according to the documented provider-order traversal semantics. Full provider scans remain available only to code that owns replay or repair.

Core schema, JSON/SQLite Hub restart, Host fetch, SDK server forwarding, Web refresh, and Python wire tests cover page limits, cursor advancement, final-page exhaustion, channel look-ahead, and restart reconstruction. Property/model-based, real-model, distributed, browser/GIF, and load/retention evidence remains pending under the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md).
