# Agent Note: Checkpoint-gated Team WAL compaction

Status: implemented

English | [中文](2026-09-01-checkpoint-gated-team-wal-compaction.zh.md)

## Problem

Team and channel streams had checkpoints but no physical retention operation. A large closed channel therefore retained its complete WAL forever, while an unrestricted prefix delete could leave a checkpoint unable to reconstruct the remaining state or make an old product cursor appear to advance across an invisible gap.

## Decision

`clocky-storage` adds `LogStream.compact({ throughSequence, expectedCheckpointSequence })`. A backend removes a prefix only when the exact later checkpoint is durable, the checkpoint is after the requested prefix, and the request does not remove the complete retained history. JSON records a non-zero retained `firstSequence` in its stream header; SQLite derives the same boundary from the first retained row. Reads that start before a compacted prefix return the typed storage error `compacted`; appends and checkpoint reads continue at their original monotonically increasing sequences.

The shared storage package owns the compaction-fence validation used by both backends, so the checkpoint and bounds contract cannot drift between formats. Its shared contract runs compaction, checkpoint, suffix-read, append, restart, and invalid-fence cases against JSON and SQLite. The routed `storageLog` handle delegates the operation and retains the same caller-owned lifecycle.

`clocky-team` exposes provider-owned `compactChannel()` and `compactTeam()` maintenance commands. The local Hub requires matching identity and cursor facts, a terminal source, an authorized maintenance actor, and a current audit projection; channel compaction additionally requires zero pending deliveries and scans the retained suffix so a causal predecessor is never removed. It force-writes the source checkpoint, then checkpoints and compacts the audit projection before compacting the source WAL, retaining the configured `auditRetentionTail`. Team/channel projection state is unchanged because each checkpoint already represents the complete state; restart restores it from the retained checkpoint. Channel and audit reads surface compaction explicitly instead of silently returning a partial history.

`team-scheduler-dag` may opt into a bounded retention drive by configuring `terminalChannelRetentionTail` and `maxCompactionsPerDrive` together. Each drive proposes terminal Team-journal and channel prefixes and delegates the checkpoint, audit, cursor, policy, and channel pending-delivery gates to `compactTeam()` or `compactChannel()`; omitting the pair leaves compaction explicit-only. A pending delivery or policy denial is retained for a later drive rather than treated as a scheduler failure.

## Alternatives considered

**Delete the prefix directly from the Team or channel medium.** Rejected because the Team projection, checkpoint, pending-delivery state, and audit provenance need a durable rebuild boundary; a raw file/database delete bypasses those checks.

**Compact active channels or channels with pending deliveries.** Rejected because an unacknowledged Envelope or causation-reachable delivery may still be required by replay and receipt semantics. Only terminal channels with no pending delivery are eligible in this slice.

**Renumber the retained suffix from zero.** Rejected because source cursors, receipts, summary ranges, and audit entries use stable sequences. Compaction preserves the original sequence numbers and makes the retained first sequence explicit in the JSON backend.

**Let an old cursor read the first retained record after compaction.** Rejected because that would present a discontinuous history as a valid suffix. The storage boundary and Team Hub return `compacted` so a caller must establish a new cursor from the retained range.

## Consequences

Closed Team, channel, and audit storage can now reclaim obsolete prefixes without weakening restart recovery, cursor monotonicity, or audit/source separation. Compaction remains provider-owned; it is explicit either through a maintenance command or an opt-in bounded scheduler drive. Compacted channel snapshots and audit pages disclose their first retained cursor through Host and SDK reads so clients can resume at a known boundary. The configured audit tail is a deployment choice, while source compaction callers select the exact prefix fence. Cross-stream compaction is not atomic: a failure after one stream compacts leaves the other stream rebuildable and observable, never a business rollback.

Principal inboxes use the durable display checkpoint as the same exact fence: default unread reads may continue from a retained suffix after a valid prefix compaction, while explicit history and cursors before the retained boundary fail closed. This does not enable automatic inbox retention or define its policy.

Storage contract tests cover JSON and SQLite physical retention, checkpoint gating, non-zero retained sequences, append/restart, and compacted cursor errors. Team Hub tests cover terminal-channel and Team-journal checks, audit-tail retention, JSON/SQLite restart, typed old-cursor errors, actor policy admission, causal-predecessor protection, and compaction/checkpoint metrics; the SDK server test retains the first audit cursor through its wire projection; scheduler tests cover the bounded opt-in retention drive. The Hub load suite retains a 4,096-record default regression and exposes a separate `CLOCKY_TEAM_HUB_LARGE_LOAD=1` run that replays 16,384 records through bounded SQLite pages; production performance budgets and operational alerts remain under the native multi-agent work-system proposal.
