# Agent Note: Local Team artifact retention

Status: implemented

English | [中文](2026-09-01-local-team-artifact-retention.zh.md)

## Problem

The local Team artifact provider stored content-addressed objects but its direct `delete()` operation was intentionally a no-op. That avoided breaking shared hashes, but left no provider-owned collection path and no Team-aware rule for deciding when an object was unreachable.

## Decision

`clocky-team-artifact` adds an optional bounded `collect()` provider capability. A collection request carries current reachable references, provider-owned object ids that have already passed the retention grace, an exclusive provider cursor, and a row limit. The result reports scanned, retained, unreachable, deleted, and per-object failure rows plus the next cursor. The registry fails loudly when a provider does not implement collection; direct `delete()` remains an explicit provider operation rather than an implicit garbage-collection shortcut.

`team-artifact-local` scans regular SHA-256 object files in deterministic digest order and never removes an object unless its id is both absent from the current reachable set and present in the approved reclaimable set. Symlinks, non-regular objects, inspection failures, and deletion failures remain visible in the bounded result; a later drive can retry cleanup. The scan cursor allows a large object root to be processed over multiple drives without materializing the complete file list.

An optional local retention owner pages through every non-archived Team using `listTeamsPage()`, reads each current Team state, and traces artifact references from completed task attempts. It keeps a bounded in-memory `unreachableSince` ledger, requires the configured `graceMs` to elapse before approving an id, and resets the provider cursor after a full sweep. A configured `pulseIntervalMs` drives recurring cleanup; without it, callers invoke the exported retention owner explicitly. Restarting the process drops the grace ledger, so an object is observed again before it can be removed. The shipped Headless and Web compositions opt into a 24-hour grace, a 128-object page, an hourly pulse, and a five-second disposal bound.

## Alternatives considered

**Make `delete()` remove the referenced file.** Rejected because one content-addressed object may be referenced by several Teams; a caller cannot prove global reachability from one reference.

**Load every object and every Team into one process-local sweep set.** Rejected because it creates an unbounded provider page and makes a large artifact root a memory-pressure source. The provider and Team listing use bounded pages; the local grace ledger is capped by the configured object page size and conservatively leaves excess candidates for later drives.

**Use object age as the grace rule.** Rejected because an old object can become unreachable only when a Team is archived. The retention owner records when it first observes an object as unreachable, and a restart starts that observation window again rather than deleting immediately.

## Consequences

The local store now has an explicit, retryable, cursor-bounded collection path while shared references remain safe. Collection is deliberately provider-specific: remote/object-store providers may omit it, and deployments must mount a Team-aware retention owner when they want automatic cleanup. The owner currently protects all references in non-archived Teams, including terminal Teams until their explicit archive marker hides them from the retention listing; audit-stream retention and WAL compaction remain separate gaps.

Core registry forwarding, unsupported-provider behavior, local bounded scanning, shared-object protection, Team reachability tracing, grace delay, post-grace deletion, and retained-reference protection are covered by the artifact package tests. Property/model-based, cross-host, failure-injection, large-state benchmark, and operational-alert evidence remains pending under the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md).
