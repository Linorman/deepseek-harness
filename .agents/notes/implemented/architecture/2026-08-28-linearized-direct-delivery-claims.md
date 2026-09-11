# Agent Note: Linearized direct delivery claims

Status: implemented

English | [中文](2026-08-28-linearized-direct-delivery-claims.zh.md)

## Problem

The local direct-delivery client separately read an activation binding and a channel before writing a model-visible inbox item. A Team status transition could commit between those reads and the inbox write. A waking `followup()` or `steer()` could also reach the Agent loop before the target Session flush preserved the source Envelope, allowing a causally linked result to reach the channel WAL first.

## Decision

`clocky-team` defines proof-only `claimChannelDelivery()`. A local Link or authenticated WebSocket listener passes the proof from its private activation-proof lease with only `channelId` and `envelopeId`. `clocky-team-hub` takes the Team queue before the channel queue, resolves and revalidates the exact running or idle binding, derives the Team, activation, Session, recipient, and pending delivery, then returns an immutable ephemeral claim. The claim writes no journal or checkpoint record, reserves no model turn, and has no later settlement operation.

`claimTaskAttemptStart()` uses the same Link-held proof. Its JSON input contains only task, attempt, assignment-revision, channel, and Envelope identities. Under the Team/channel queues, the Hub derives the Team, Participant, activation, and Session from the revalidated binding, then validates the assigned lease and durable assignment Envelope before it starts the attempt.

When the recipient already has a receipt, the Hub returns no claim. When the same recipient already posted a same-channel Envelope whose `causationId` names the pending Envelope, the Hub appends the durable receipt in that critical section and returns no claim. The pending-minus-receipt WAL projection remains the durable delivery source of truth.

`clocky-team-agent-client` makes its activation-bound Link claim the final awaited authorization before direct inbox admission. A missing claim produces no inbox write or wake. For `turn` and `steer`, it installs an Envelope-specific `agent/pre-step` barrier before the public waking call. The barrier permits the proposed model step only after `ctx.sessions.flush()` succeeds; a flush failure rejects the step and leaves the receipt pending.

## Alternatives considered

**Recheck activation immediately before inbox insertion.** Rejected because another Team status transition can still commit after that read and before the inbox operation.

**Make channel WAL, Team journal, and Session flush one transaction.** Rejected because the three streams have independent durable owners. Ordered facts and idempotent replay remain the reliability model.

**Use the recipient high-water cursor as causal proof.** Rejected because out-of-order receipts may advance the cursor past an older pending Envelope.

## Consequences

The Hub establishes one linearization point for local direct delivery: a claim wins before a stopping/offline transition or fails after it. The implementation preserves at-least-once notification and idempotent durable admission; it does not claim exactly-once model execution or tool effects. A causal reply suppresses a replayed source turn only when it belongs to the same channel and recipient.

Claims are local ephemeral facts. Local Links and authenticated WebSocket listeners retain their proof leases privately, so no proof crosses a wire or durable boundary. The [local Team Link recovery decision](2026-08-28-cancellable-local-team-link-recovery.md) owns local authenticated post/receipt operations, pending-delivery paging, and reconnect behavior; the [WebSocket Team Link transport decision](2026-08-29-websocket-team-link-transport.md) owns authenticated remote framing and cross-process delivery. The [durable activation binding decision](2026-08-28-durable-local-activation-binding.md) remains the authority for activation ownership. The [Team actor proof control-plane proposal](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) owns the remaining Team write-operation migration, while the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed while scheduling, workspace, and product phases are unfinished.

The same Link-held proof lease also authorizes proof-only recipient receipt, task-attempt heartbeat, and settlement. Receipt input contains only channel, Envelope, and observed-cursor identities, and the Hub derives the current recipient after binding revalidation; `team-run` uses its separate source-scoped proof only for its exact default-topology coordinator final. Their task input contains task, attempt, and observed revision, with a typed settlement outcome; under the Team lock the Hub revalidates the binding and derives the current lease owner. Ordinary Link post and review operations retain their own request contracts. This decision continues to own delivery claims and task-attempt start; the [Team actor proof control-plane proposal](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) owns receipt and the remaining write-operation migration.

## Verification

Core tests validate the strict proof-only claim inputs and abstract runtime surface. Hub tests cover exact proof-derived Team/participant/activation/Session matching, pending and receipt behavior, task-assignment delivery validation, dispatch policy, causal reply suppression, JSON/SQLite recovery, and detached claims. Local and WebSocket Link tests cover forwarding their private lease proof without caller-selected identity fields. Local client tests cover claim no-ops and mismatches, source flush before waking model requests, flush failure, repeated notifications, causal-reply replay without a target turn, and bounded teardown.
