# Agent Note: World effect sandbox and cross-run mailbox

Status: implemented

English | [中文](2026-10-20-world-effect-sandbox-mailbox.zh.md)

## Problem

Simulated approval does not provide real user consent, and uncertain transport results cannot establish whether an effect or peer message was accepted. Recovery must preserve original responsibility before optional real providers or distributed world execution can be considered.

## Decision

The [product owners](../../../../packages/simulation/simulation-product/README.md) expose separate opt-in Host services. The effect sandbox persists explicit authenticated consent and dispatch before IO; unknown results reserve capacity and only query the original key. Its adapter owns a local durable test sink. No external provider is enabled.

The mailbox preserves outbox/inbox originals and hash-bound receipts. Business identity is the JSON tuple of source run, generation and local message ID; receipt positions remain source-scoped to avoid disclosing another peer’s traffic. The first journal frame fixes principal/peer policy, and boundary events retain the authenticated author. Peer authority, generations, source order and same-source causal references are checked on acceptance and replay; another peer’s private message cannot satisfy or reveal a predecessor. Durable source boundaries prohibit earlier sends; destination time advances only behind every peer's covered promise. Permanent failure stops progress. Mailbox acceptance does not mutate Native business facts. Authenticated `syncNativeClock` commits the mailbox cut through a nonserializable Host capability; Native stores its exact mailbox sequence and complete original archive-prefix SHA-256; drive, decision-wake collection and scheduler replay enforce the exclusive limit and permanent stops. Zero freezes initial consumption, and an absent peer promise cannot advance even to zero. The same pure clock/stop projector supplies both live time facts and checkpoint prefix validation.

## Alternatives considered

Blind effect retries can duplicate unknown outcomes. Treating simulated votes as grants conflates model permissions with Host authority. Counting messages as resource settlement or collecting mailbox snapshots as a distributed checkpoint would claim atomicity without a protocol.

## Consequences

The [tests](../../../../packages/simulation/simulation-product/tests/external-effect.spec.ts) cover finite authorization and unknown results on JSON/SQLite; a [Loader fixture](../../../../packages/simulation/simulation-product/tests/fixtures/external-effect/cordis.yml) proves fresh-process reconciliation with actual credential leases. [Mailbox tests](../../../../packages/simulation/simulation-product/tests/federation-mailbox.spec.ts) cover receipt loss, causal blocks and conservative time. Compensation is a separate effect requiring a new explicit grant and cannot rewrite its confirmed source. The shared live/replay validator forbids grant identity reuse across effects, and malformed replay closes dispatch admission. Real provider qualification and independent security review and measured distributed demand remain separate acceptance obligations.
