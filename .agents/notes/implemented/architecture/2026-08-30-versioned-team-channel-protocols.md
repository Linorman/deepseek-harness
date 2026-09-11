# Agent Note: Versioned Team channel protocols

Status: implemented

English | [中文](2026-08-30-versioned-team-channel-protocols.zh.md)

## Problem

The Team Hub had a durable Envelope and direct/task-assignment adapters, but no native protocol for bounded consultation, multi-party discussion, or declarative handoff. A protocol that left termination to each consumer could persist a completed conversation as an active channel.

## Decision

`@clocky/clocky-team-channel-basic` registers version-one `consult` and `discussion` adapters. Consult freezes one initiator and one respondent, accepts exactly one request followed by one response, and asks the Hub to append closing records with the response admission. Discussion freezes an ordered roster, an explicit `round-robin` or `free-form` speaker policy, and a required `maxTurns` bound. Its delivery plan expands only explicit audiences or `null` broadcast to the other roster members.

`@clocky/clocky-team-channel-workflow` registers a version-one workflow adapter. Its JSON `TransitionGraph` validates ordered conditions, abstract targets, participant membership, and a hard turn bound before channel creation. Replay evaluates the first matching condition against the accepted Envelope and resolves `participant`, `round-robin`, `stay`, `return-to-initiator`, and `terminate` targets deterministically.

The workflow package mounts an effect-scoped `ctx.workflowExtensions` registry. Versioned condition and target implementations validate their JSON configuration before graph admission, execute only through the adapter's pure resolver, and fail loudly when the exact implementation is unavailable; an extension cannot return a participant outside the channel roster.

`TeamChannelAdapter.closeAfterAccept()` is optional. When it returns a reason, `TeamHub` appends `closing` and terminal `closed` records in the same channel-WAL batch as the Envelope and adapter records. Existing adapters omit the hook and retain their current lifecycle.

## Alternatives considered

**Make every protocol a direct channel variant.** Rejected because direct channels intentionally have no speaker state, turn cap, or protocol-owned termination; adding those concerns would make the product adapter ambiguous.

**Let consumers close completed channels in a later operation.** Rejected because a crash between Envelope acceptance and closure would leave the protocol's durable state inconsistent with its lifecycle.

**Import a third-party GroupChat implementation.** Rejected because its in-process mutable manager does not supply the Hub's durable replay, branded identities, policy boundary, or Cordis registration lifecycle.

## Consequences

Channel adapters remain synchronous, pure, and independently versioned. The Hub owns atomic lifecycle persistence; Link and Agent Client consumers still own delivery, receipts, and model execution. A workflow graph is durable data and must retain its exact adapter version for replay.

## Verification

Workflow tests cover condition/target resolution, graph and state rejection, terminal transitions, and the effect-scoped extension registry. The registry test proves duplicate and malformed extension rejection, registration-order listing, exact lookup, add/remove events, and idempotent disposal. The assembled Team snapshot suites cover workflow-plan compilation and restart reconstruction.

TypeScript and Python SDK subprocess tests consume one [channel-view wire corpus](../../../../packages/sdk/protocol/tests/fixtures/team-channel-view-cases.json). They preserve exact valid content and optional review provenance, and reject missing surface markers, ignorable views, invalid versions, duplicate or misordered source identities, and malformed optional authority fields. Session replay tests also preserve channel-only context without inventing task, reply, or review provenance.
