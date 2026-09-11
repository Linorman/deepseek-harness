# @clocky/clocky-team-human-client

English | [中文](README.zh.md)

`team-human-client` owns a durable principal inbox without creating an Agent, Activation, or Session. The Hub derives the principal from a final's immutable human owner, appends exact final content to this inbox, then records `principal-inbox` admission and the channel receipt. An unavailable or failed inbox prevents admission; restart repeats the same Envelope key without duplicating the delivery. System-owned Headless runs retain their separate `team-run-result` sink.

## Configuration and calls

Mount after `teams`, `storageLog`, and `productPrincipals`. All limits are required: `storagePageSize` bounds each storage read, `maxPageSize` bounds each API page, `maxDeliveryBytes` bounds the complete serialized delivery, `maxPendingOperations` bounds queued work and watches, `watchTimeoutMs` bounds long polls, and `pollIntervalMs` sets their storage observation interval. A SHA-256 digest partitions the version-one `principal-inbox/` stream by stable principal identity; credentials and runtime proofs are never persisted.

Host provides `team.inbox.read`, `team.inbox.watch`, and `team.inbox.acknowledge`; SDK stdio uses `team/inbox-read`, `team/inbox-watch`, and `team/inbox-acknowledge`. TypeScript `Clocky` and `HarnessClient` expose `inboxRead`, `inboxWatch`, and `inboxAcknowledge`; Python exposes their snake-case equivalents. Calls contain no principal or participant identity. Each page revalidates the authenticated call, exactly one active owned human recipient, its `dispatch` grant, and dispatch policy.

Read/watch accept optional `afterCursor` and `limit`. Omitted cursors resume after the principal-wide durable `displayCursor`; explicit `-1` reads from the beginning. `nextCursor` continues a bounded page, while `cursor` is the last scanned storage position. A display acknowledgement selects an actual delivery with `throughCursor`, advances monotonically, and is shared across devices. It never writes a channel receipt. A completed Team can therefore retain unread final content after the Host restarts.

Storage appends are serialized with one open stream at a time. Team visibility checks run outside that queue so a Hub final append cannot deadlock with an inbox read. Disposal closes admission, cancels long polls, and waits for accepted storage operations.

The startup delivery scan rejects a repeated or rewound Team-list cursor with `TEAM_CURSOR_CONFLICT` instead of rescanning the same Team page.

## Model Experience

### Principal final delivery

#### What the model sees

No new prompt or tool. The existing explicit `team_final` Envelope supplies the exact human-visible text.

#### Token effect

Zero additional model tokens.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

- Only final Envelopes are delivered. Ordinary human messages, approval/question continuations, review requests, and lifecycle notices require their own admission Consumers.
- Automatic compaction is disabled. A caller may compact only a prefix covered by the durable display checkpoint; default unread reads continue from the retained suffix, while explicit history or a cursor before the retained prefix fails explicitly instead of fabricating display history.
- Replay scans fixed-size pages and retains bounded memory. A durable display-cursor checkpoint lets the default unread read resume from the acknowledged suffix; explicit history reads still scan the retained prefix. Concurrent distributed writers receive the storage backend's expected-sequence conflict and must retry; this Consumer owns one local queue.
