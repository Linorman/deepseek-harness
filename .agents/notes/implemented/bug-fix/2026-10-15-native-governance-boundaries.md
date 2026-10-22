# Agent Note: Productive Native governance boundaries

Status: implemented

English | [中文](2026-10-15-native-governance-boundaries.zh.md)

## Problem

A vote is immutable when Native accepts its original actor Decision, before a director acknowledgement plan exists. Waiting for a deadline can leave a fully determined proposal unresolved while an earlier enactment goal is already due. A trusted test calling Native closure directly does not establish that the installed product driver performs that transition.

## Decision

The [World dispatcher](../../../../packages/simulation/simulation-world/src/execution.ts) exposes a generic bounded domain boundary callback. An explicitly running driver invokes it after the active decision window settles and before another drive or clock advance. Each step can retain at most one domain transition. The dispatcher acquires the original manifest pin, coalesces concurrent boundary callers and keeps the implementation lease through completion. Disposal closes new admission and drains an admitted callback.

The governance vote provider selects an eligible original proposal, including one whose accepted final vote has no director plan. Eligibility and [Native closure](../../../../packages/simulation/simulation/src/world-governance.ts) share the same frozen quorum, threshold and remaining-vote calculation. Native still validates the actual original ballot sources and computes the sole resolution. No director or product reader supplies a tally, outcome or replacement vote.

The strict `closeWorldGovernance(proposalId, { boundary: true })` overload rechecks running phase, settled window, time before the original deadline and early-closure eligibility inside the write queue. A pause winning that queue position returns `undefined` without an append. An already retained resolution returns unchanged. The existing trusted overload retains its explicit mechanical-close semantics. Both use the original atomic resolution, proposer wake and pending-deadline cancellation batch; ordinary deadline closure retains its original scheduler phase.

Paused reads, restore and reconciliation do not invoke this boundary. After process loss before closure, an explicit start derives eligibility from the same original votes. After loss following the append, the retained resolution prevents another transition. Neither case requires inference to close the proposal. A queued announcement remains a responsibility rather than proof of Session consumption.

Vote execution uses `clocky.governance.vote/native/3`, generation `2`, with unchanged `schema/2` payload parsers. Native and execution providers use the same pin constant. An older pin requires its exact original implementation; the new artifact is not a compatibility alias. Existing record shapes and Native stream version remain unchanged.

## Alternatives considered

**Close only after a vote acknowledgement callback.** An accepted immutable vote can exist without any director plan. A process can also disappear between acknowledgement and closure. Scanning original domain facts at a settled boundary covers both windows without manufacturing another plan or callback observation.

**Count votes in Product or move authored enactment times.** Both hide the missing domain transition. The Native rule owns eligibility, and the original author timing remains intact.

**Close during paused restoration or swallow pending errors.** Reads and recovery must not silently advance governance. Pure eligibility avoids using exceptions as a polling protocol, and unrelated append failures still reject while preserving the original records.

## Consequences

Boundary work consumes the existing finite driver-step allowance and Native complete-record byte limits. It adds no model call, external provider IO, durable record kind or user authority. Passing a proposal still does not enact its Norm; the separately authorized enactment request remains necessary.

The keyless Loader fixtures retain real accepted votes, kill processes before and after the atomic close, and race an actual queued pause. Independent cold processes verify unchanged votes, paused zero-model behavior and the sole original resolution. The complete authored workflow asserts the production driver closed proposals rather than calling closure itself. Full product browser and live-provider acceptance remain separate evidence.

[Scoped disclosure](../architecture/2026-10-13-world-scope-disclosure.md) and [checkpoint reference coverage](../architecture/2026-10-14-world-checkpoint-reference-coverage.md) remain independent authorities; this decision does not supersede their body-access or retained-source rules.
