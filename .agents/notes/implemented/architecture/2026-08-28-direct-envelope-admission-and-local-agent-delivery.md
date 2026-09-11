# Agent Note: Direct Envelope admission and local Agent delivery

Status: implemented

English | [中文](2026-08-28-direct-envelope-admission-and-local-agent-delivery.zh.md)

## Problem

The Team Hub can retain channel state without a Lead Session, but a channel cannot yet accept a participant message or make that durable fact available to a local Participant's model. Reusing the experimental mailbox would restore an implicit Session-as-Team identity and couple the Hub to AgentLoop.

## Decision

`TeamRuntime.postChannelEnvelope()` accepts a sender identity resolved by a trusted caller, an observed channel cursor, and an unstamped draft. `@clocky/clocky-team-hub` locks the owning Team and channel, requires active sender and explicit audience membership, requires each `causationId` to reference an already committed Envelope in that channel, applies the `send` policy, validates the adapter draft, stamps the Envelope, and atomically appends it with adapter follow-up records. `maxEnvelopeBytes` is Hub configuration and defaults to `65536`.

`@clocky/clocky-team-channel-direct` supplies the initial `direct` v1 adapter. It accepts a channel with at least two distinct participants, no adapter limits, one explicit non-self recipient, and `message` payloads containing only nonempty text. It has `null` fold state, emits no automatic reply, and derives one delivery intent without executing delivery. Team Hub applies `maxPendingDeliveriesPerChannel` to the derived pending-recipient projection before WAL append; a full channel rejects further admission until a receipt removes capacity.

`@clocky/clocky-team-agent-client` is a Consumer, not a Hub extension. It reconciles the paired opaque Team and Participant ids materialized in an Agent Session header with the exact durable activation binding before accepting delivery, then opens its configured activation-bound Link. The Link owns cancellable pending-page replay and notifications; its claim atomically validates the matching running or idle activation, Session, channel, and pending recipient admission under Hub coordination. The client rechecks the returned claim, deduplicates the Envelope against durable `user/message` and live inbox state, appends a deterministic `team-envelope:<EnvelopeId>` message through the public Agent inbox operation, waits for `ctx.sessions.flush()`, and records the recipient receipt. Waking input carries a pre-step barrier, so the source flushes before the model request proceeds. A prior same-channel recipient reply with matching causation becomes a receipt without another inbox write. A flushed source awaiting only a receipt retry is confirmed without another inbox write, while a claimed source rejected before `user/message` is admitted again. The message source retains the Team, channel, Envelope, sender, delivery intent, and optional causation ids.

## Alternatives considered

**Deliver from Team Hub.** Rejected because the Hub must remain independent of Agent, Session, AgentLoop, and placement providers; durable admission and local inbox delivery have different ownership and recovery rules.

**Reuse the experimental Agent Teams mailbox.** Rejected because it derives Team identity from the Lead Session and preserves the direct-child lifecycle that the durable Team model removes.

**Add a separate delivery record.** Rejected because pending delivery is defined as accepted Envelopes minus receipts. The Hub derives pending recipient admissions from the adapter plan and channel WAL; a separate delivery record would duplicate authority.

## Consequences

The local path proves one participant-to-participant direct message from Hub WAL acceptance to a flushed target Session and durable receipt without a parent Session relationship. `context`, `turn`, and `steer` use the existing public inbox behavior, duplicate Link notifications do not create another target message, and a durable-bound Agent reconnects its Link after a terminal transport failure. The [durable local activation binding decision](2026-08-28-durable-local-activation-binding.md) owns the bind-before-delivery condition.

The Conversation client preserves that intent in its projection: a durable `turn` Envelope is rendered as a user message, `steer` as a steering message, and `context` as an injected-context row. This keeps the visible transcript and pending queue consistent with the same source distinction used by the Host and Agent Client.

The [Direct v4 messaging decision](../feature/2026-09-06-direct-v4-recipient-delivery.md) extends this receipt mechanism to explicit subsets and broadcast. Scheduling, transport, and product entry points have separate Consumers; they do not belong to the direct adapter. The [local Team Link recovery decision](2026-08-28-cancellable-local-team-link-recovery.md) owns Link replay and reconnect behavior. The [linearized direct delivery claim decision](2026-08-28-linearized-direct-delivery-claims.md) owns the activation/channel cutoff and causal-reply behavior. The [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) remains active because it owns the Team and channel durability rules.

## Verification

Core schemas and the fake provider cover authenticated post, receipt, and claim requests. Team Hub tests use JSON and SQLite to prove stamped Envelope persistence, adapter batch atomicity, derived pending delivery, claim/receipt idempotence and high-water ordering, causal-reply suppression, restart recovery, cursor conflict, membership, policy, adapter, channel lifecycle, and byte-limit rejection. The direct adapter tests prove protocol restrictions and pure delivery planning. The local client tests use a real Agent factory and Session persistence to prove claim-gated context, turn, and steer inbox admission, source flush before a waking model request, source provenance including delivery intent, duplicate-event and causal-reply de-duplication, startup replay, and unload cutoff. Host Team API tests prove that a Team `steer` source remains a pending `steering` item in the `session/queue` projection.
