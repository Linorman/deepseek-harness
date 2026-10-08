# Agent Note: Shared Team protocol recipes

Status: implemented

English | [中文](2026-10-03-team-protocol-recipes.zh.md)

## Problem

Team parsers, channel adapters and lifecycle providers repeat the same payload fields, transcript projections and disposal waits. Independent copies can disagree about optional fields, property order, source attribution or timer cleanup. Sharing an entire authorization pipeline would create a different risk: distinct operations must validate their own proof and revalidate it after policy or provider work yields.

## Decision

The Team Service Definition owns shared Envelope payload parser fields, immutable summary-source fields, Simulation execution binding fields and participant invitation descriptors. Each parser retains its own strictness, discriminant and operation-specific fields. Reusing field objects preserves the existing parse property order and JSON contracts.

The configuration catalog follows shared validator-field factories through workspace re-exports without evaluating modules. A factory must declare fixed Schemastery validator members and return one literal object with exactly those plain keys. Unknown or indexed field sets, computed keys, optional members, dynamic returns and recursive compositions fail the gate. Nested object and array validator paths still undergo the declared-config subset check.

`channelEnvelopeMessages()` projects only accepted Envelope id, sender, kind and original payload in WAL order. The caller still selects the records, validates protocol state and applies visibility. Basic and workflow adapters share this frozen message-list projection; direct policies retain their own metadata and payload selection. The workflow provider aliases the Definition's exact condition vocabulary while retaining its participant-id target vocabulary, which differs from the plan's role targets.

Channel recovery parsers share only the exact own-key check, JSON object guard and nonempty-text check; each protocol supplies its fixed keys and diagnostic subject. Discussion and workflow delivery share audience projection only after their own manifest, state and Envelope validation. The projection retains audience order, excludes the sender only for broadcast and freezes every delivery intent. Adapter rejection and delivery tests cover all branches of these shared functions.

`teamEventOwnerId()` supplies notification attribution to scheduling and closure consumers. Providers reuse the existing LLM deep-freeze implementation for detached snapshots. `withTeamOperationTimeout()` shares timer ownership across Team provider waits, preserves each provider's timeout failure, and leaves cancellation and draining with the caller.

`trackTeamOperation()` observes a provider-owned accepted Promise once, releases the same Promise from its set on settlement, then invokes the provider diagnostic. It does not wrap or replace caller-visible outcomes. Diagnostic exceptions are contained so reporting cannot produce another unobserved rejection; cancellation, closing-time suppression and draining remain provider-owned.

Workspace allocation publishers are uniquely registered by the actual same-process owner object. A synchronous Cordis contribution keeps that owner key until its at-most-once effect cleanup deletes it; repeated disposal cannot retire a later replacement. Registry operations reject unavailable capabilities, invalid preparation or recovery identities, and foreign publication provenance before accepting their result. Failed mismatch cleanup preserves both the primary ownership refusal and the cleanup failure.

TeamRun constructs repeated closure targets and completion payloads through pure local helpers. Workflow terminal-result validation consumes the bindings and tasks synchronously proven by the preceding compilation check under the same Team serializer. It retains exact projection order, terminal phases and stored result/failure comparisons; incomplete compilation and contradictory terminal facts reject before journal mutation. The Hub shares the final stall commit after each caller has authorized and revalidated its own closure source. Its goal edits and phase transitions share the same revision, policy and post-policy authority checks while retaining operation-specific next-state validation. Tool schemas reuse their existing artifact and failure carriers. These helpers neither issue authority nor move validation outside its mutation operation.

## Alternatives considered

**Share the complete authorization and mutation pipeline.** Different operations select different opaque proofs, cursor or revision fences, policy facts and cleanup guarantees. Sharing those decisions would hide the exact revalidation point after an `await`; the operation retains that ownership.

**Keep every parser and projection inline.** The same protocol field or view must then be updated in several places. Shared field objects and pure projections keep one implementation without merging independent protocol states or providers.

## Consequences

Provider configuration, error codes, disposal ownership and wire formats remain unchanged. Timeout does not mean that work stopped. Shared views do not grant visibility, and shared payloads do not grant mutation authority. The [Team Definition decision](2026-08-27-durable-storage-logs-and-team-service-definition.md) and [Hub authority decision](2026-08-27-local-team-hub-durable-authority.md) remain active for their independent persistence and lock guarantees. The [client contract decision](2026-10-03-client-shared-contracts.md) owns client reader state and does not replace these provider operations.

## Verification

Core protocol, scheduler, closure, activation, Link, artifact and Agent-client unit suites pass. Basic, direct and workflow channel tests retain their existing projections. The shared timeout and channel-message helpers have 100% focused coverage. TeamRun and tool tests preserve completion payloads and artifact/failure schemas; real Loader replay compares the existing model-visible and durable outputs after a unified build.
