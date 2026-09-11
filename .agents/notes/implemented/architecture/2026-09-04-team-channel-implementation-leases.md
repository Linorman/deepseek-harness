# Agent Note: Team channel implementation leases

Status: implemented

English | [中文](2026-09-04-team-channel-implementation-leases.zh.md)

## Problem

Versioned channel adapters, view policies, and workflow extensions can outlive the Cordis contribution that registered them. A live channel therefore needs the exact implementations it admitted, while an orphan or terminal channel must not pin retired objects indefinitely or publish durable visibility before its Team attachment exists.

## Decision

`TeamRuntime` keeps accepting registrations separate from retirement-retained entries and exposes release-once adapter and view-policy leases. `TeamHub` acquires those leases, plus adapter-private runtime leases, before channel WAL admission. Workflow graphs acquire one exact lease for every referenced condition and target extension, including the initial and default targets.

Cordis [effects](../../../../vendor/cordis/src/fiber.ts) run each registration's cleanup once. `TeamRuntime` publishes and removes its private registry entries only through those effects, so an old disposer cannot remove a replacement registration. Private lease counters have exactly two writers: creating one actual lease adds one, and that handle's first release subtracts one. The handle retains its own release-once check; released handles reject implementation access, and retired implementations remain reachable until their final handle releases them.

Terminal WAL state closes channel watchers and enters deferred eviction. Eviction waits for pending deliveries and all accepted Hub admissions, removes the in-memory projection, closes the stream, and releases every implementation lease through an idempotent cleanup. Receipt or expiry admission that drains the final pending delivery makes the terminal channel evictable. A channel WAL cursor conflict refreshes the external suffix through the existing retained implementation and returns a retryable conflict; it does not discard an active channel.

Channel creation writes its WAL and retains its local handle before committing `channel/attached`, but emits channel events, writes its checkpoint, and repairs its audit projection only after the Team reference is durable. A failed attachment discards the unexposed handle. An attached-channel lookup discards an orphan handle, and per-channel release barriers prevent recovery from racing stream close.

## Alternatives considered

**Add registry-owner and counter guards that duplicate effect and lease ownership.** Rejected because the private registries have no other mutation path and each actual lease contributes exactly one increment and decrement. Testing a different registry owner or a negative count would require bypassing those owners through private-state mutation; the public contract is registration replacement and independent release-once handles.

**Close every channel when its provider retires.** Rejected because provider retirement blocks new admission but does not invalidate work already accepted by a live channel.

**Release on the terminal WAL record without checking pending delivery.** Rejected because terminal channels can still require receipt or expiry admission for already accepted deliveries.

**Discard and reload after every channel cursor conflict.** Rejected because a retired provider cannot re-register the exact workflow extension objects needed to replay an active channel; the current retained lease is the authoritative implementation for that channel.

**Publish the channel event and audit before Team attachment.** Rejected because a failed cross-stream attachment would leave an irreversible visible orphan fact even though recovery ignores the unreferenced WAL.

## Consequences

HMR removes implementations from new channel resolution while accepted active channels continue with their exact adapter, view-policy, and workflow-extension objects. Terminal cleanup can delay collection while pending delivery or another accepted Hub operation remains, and a later recovery must still find the exact durable adapter, view-policy, and extension versions. Orphan WAL bytes remain durable for recovery diagnostics, but they have no channel event or audit projection and are not reachable through Team reads.

## Verification

Core runtime and workflow-extension lease suites cover retirement, replacement, exact graph references, and release idempotence. TeamHub tests cover JSON and SQLite terminal eviction, pending-delivery drain, watcher closure, cursor-conflict recovery, attachment failure cleanup, orphan lookup cleanup, and retained channel behavior after adapter retirement.

Core runtime tests also exercise resolver failure and recovery, individual proof revocation, rejection by another runtime, and source replacement after contribution disposal. Parsed provider snapshots verify pending human/workflow blockers after task, activation, and channel work settles; minimal providers explicitly reject unsupported product and scheduler capabilities.
