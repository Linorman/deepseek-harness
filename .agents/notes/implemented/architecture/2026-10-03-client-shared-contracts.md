# Agent Note: Client shared contracts and Team read ownership

Status: implemented

English | [中文](2026-10-03-client-shared-contracts.zh.md)

## Problem

Client contracts imported their implementing domains, and sibling UI domains imported each other's input types, render instructions, and transcript readers. The domain graph rejected these edges. Team readers also repeated cancellation, authorized-window publication, and journal-watermark handling; independent copies obscured the ordering required by synchronous abort callbacks.

## Decision

The runtime `contract/` layer owns shared conversation snapshots, pending-response carriers, context provenance, Agent context types, Session service types, Team read types, Workspace list types, and the generic notifier. Concrete scope creation stays in `sessions/`, its production owner. Shared declarations contain their definitions and never re-export domain implementations.

The conversation `contract/` layer owns input currency, composer blockers, queue projections, decoration instructions, reference glyphs, transcript readers, and numeric presentation helpers used by multiple domains. The input machine and blocker registry stay in `input/`; chat rendering stays in `chat/`. Workspace browsing and its rows share the `rows/` domain. Existing package exports and behavior remain stable.

Team readers own independent `ReadRequest` instances. Cancellation advances the generation before retiring timers or running abort callbacks, and clears the old carrier before aborting it. Settlement retires only its own carrier and schedules polling only while that carrier remains current. `ReadPageRevision` retains a selection's minimum journal cursor; a matching Team update marks an older loaded page stale. Each reader retains its endpoint-specific identity and page validation. Authorization rejection retires private data before notifying the Team owner; ordinary failures preserve authorized content.

Team selection, archive, task mutation reconciliation, and reconnect share their existing teardown and publication operations. Transcript Team channel provenance uses the session surface's `deriveEventMessage`, keeping the persisted event's model and UI source projection identical.

## Alternatives considered

**Contract re-export facades.** Re-exporting implementation types through `contract/` leaves the layer dependent on its domains and hides ownership rather than correcting it. Shared definitions live in the contract layer instead.

**Moving all implementations into contracts.** Machines, endpoint inspectors, and registries retain their domain ownership. Only shared data, response carriers, observable projections, and pure presentation operations belong to the common layer.

**One shared Team request controller.** Readers support independent selections and cancellation. They reuse lifecycle rules through separate instances so navigation in one view cannot cancel another view's request.

## Consequences

The client domain graph passes without exceptions. Shared Team reader behavior has one implementation, while each reader remains responsible for its own retained data, polling, and revision validation. Imports of package-private moved files use their current paths; package-facing APIs remain available.

## Testing

The runtime, conversation, and workspace suites pass: 92 files and 1,260 tests. Existing reader tests cover superseded responses, authorization retirement, exact pagination, and reentrant abort callbacks that replace or close a selection. The focused runtime/conversation duplication scan reports zero clones, and the client domain graph reports no violations.
