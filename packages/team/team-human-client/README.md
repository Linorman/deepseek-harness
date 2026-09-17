# @clocky/clocky-team-human-client

English | [中文](README.zh.md)

`team-human-client` owns a durable principal inbox without creating an Agent, Activation, or Session. The Hub derives the principal from a final's immutable human owner, appends exact final content to this inbox, then records `principal-inbox` admission and the channel receipt. An unavailable or failed inbox prevents admission; restart repeats the same Envelope key without duplicating the delivery. System-owned Headless runs retain their separate `team-run-result` sink.

## Configuration and calls

Mount after `teams`, `storageLog`, and `productPrincipals`. The base limits are required: `storagePageSize` bounds each storage read, `maxPageSize` bounds each API page, `maxDeliveryBytes` bounds the complete serialized delivery, `maxPendingOperations` bounds queued work and watches, `watchTimeoutMs` bounds long polls, and `pollIntervalMs` sets their storage observation interval. A SHA-256 digest partitions the version-one `principal-inbox/` stream by stable principal identity; credentials and runtime proofs are never persisted.

Optional `retention` enables automatic migration of displayed history. It requires `tailRecords`, `maxStreamsPerDrive`, `maxRecordsPerDrive`, and `maxBytesPerDrive` (the larger serialized source or anchor for each selected record); omission disables it. A record larger than the configured byte budget reports backpressure; a stream that cannot fit the remaining batch budget resumes on the next drive. Unread records and source actions that still await an answer pin the prefix. Each migrated delivery is first indexed in an immutable `principal-inbox-admission/<principal digest>/<admission digest>` stream. Index format 2 stores final metadata and a SHA-256 digest of JSON-encoded text; a Hub-authorized retry supplies the text and must match the digest before the original sequence returns. Messages and actions retain their full payload; ordinary receipt recovery still reads the original rendered view. Version-one anchors reject without migration. A checkpoint records `indexedThroughCursor` before compaction; later acknowledgements preserve it. Final/message receipts and action-revision deduplication resolve these anchors before the retained suffix.

Host provides `team.inbox.read`, `team.inbox.watch`, and `team.inbox.acknowledge`; SDK stdio uses `team/inbox-read`, `team/inbox-watch`, and `team/inbox-acknowledge`. TypeScript `Clocky` and `HarnessClient` expose `inboxRead`, `inboxWatch`, and `inboxAcknowledge`; Python exposes their snake-case equivalents. Calls contain no principal or participant identity. Each page revalidates the authenticated call, exactly one active owned human recipient, its `dispatch` grant, and dispatch policy.

Read/watch accept optional `afterCursor` and `limit`. Omitted cursors resume after the principal-wide durable `displayCursor`; explicit `-1` reads from the beginning. `nextCursor` continues a bounded page, while `cursor` is the last scanned storage position. A display acknowledgement selects an actual delivery with `throughCursor`, advances monotonically, and is shared across devices. It never writes a channel receipt. A completed Team can therefore retain unread final content after the Host restarts. Reads and acknowledgements replay display records after the checkpoint and repair it without changing admission-index watermarks; a committed acknowledgement survives a lost append response or failed checkpoint write.

Inbox operations are serialized; retention opens at most one admission anchor beside its inbox stream. Team visibility checks run outside that queue so a Hub final append cannot deadlock with an inbox read or display acknowledgement. Acknowledgement rechecks the exact selected record before commit and preserves a concurrent newer display position. Disposal closes admission, cancels long polls, and waits for accepted storage operations.

The startup delivery scan rejects a repeated or rewound Team-list cursor with `TEAM_CURSOR_CONFLICT` instead of rescanning the same Team page.

Human-action responses revalidate the live principal after every asynchronous responder, including unavailable fallbacks; revocation prevents returning action data without undoing a committed answer.

## Model Experience

### Principal final delivery

#### What the model sees

No new prompt or tool. The existing explicit `team_final` Envelope supplies the exact human-visible text.

#### Token effect

Zero additional model tokens.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

- Final text is reclaimed after display retention, but message/action anchors retain their payloads. Metadata still grows with admission count; reclaiming other payloads requires source-owned reference release.
- Display checkpoints alone do not release replay or idempotency references. A read before the retained prefix returns `TEAM_INBOX_COMPACTED` with `details.firstCursor`. Host clients receive `team-inbox-compacted`; SDK read/watch errors carry JSON-RPC `data.code` and `data.firstCursor`. Explicitly read after `firstCursor - 1` to inspect retained history. The browser preserves its current page until “View retained history” succeeds.
- Replay scans fixed-size pages and retains bounded memory. A durable display-cursor checkpoint lets the default unread read resume from the acknowledged suffix; explicit history reads still scan the retained prefix. Concurrent distributed writers receive the storage backend's expected-sequence conflict and must retry; this Consumer owns one local queue.
