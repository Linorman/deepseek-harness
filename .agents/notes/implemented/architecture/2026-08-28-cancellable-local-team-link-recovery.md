# Agent Note: Cancellable local Team Link recovery

Status: implemented

English | [中文](2026-08-28-cancellable-local-team-link-recovery.zh.md)

## Problem

A direct Agent client that owns Hub event subscriptions, WAL replay, and transport recovery cannot share those responsibilities with a remote connection. Advancing a pending-delivery page after a listener rejects also loses a pending Envelope until an unrelated reconnect, while unbounded notification fan-out defeats page-size backpressure. An activation status is mutable, so treating its status snapshot as a Link identity rejects an otherwise valid connection during an idle-to-running transition. A stale activation-bound Link must not post or acknowledge after its epoch has stopped or been replaced.

## Decision

`clocky-team-link` identifies a Link by activation id, Team, Participant, Session, and placement provider; residency status is revalidated by the provider rather than compared as connection identity. Every Link exposes `done`, which resolves on orderly closure and rejects on provider-owned terminal failure. The local provider verifies a current idle or running binding before publication, and its bound post and receipt operations include the activation id and Session. `clocky-team-hub` validates that proof under its Team-to-channel lock before policy evaluation or a durable mutation.

`clocky-team-link-local` starts Team and channel cursor watches before it reads pending-delivery pages. It reads each immutable channel manifest and ignores channels that do not name its bound Participant, so one participant's Link cannot fail on another participant's channel. It awaits each subscriber handoff before advancing to the next page item, so `pageSize` bounds a channel's in-flight replay. A rejected listener retains only that subscriber and Envelope as a delayed retry controlled by `notificationRetryDelayMs`; it does not advance receipt state, rescan the full WAL, or interrupt other subscribers. Unsubscribe, Link failure, and Link close cancel pending retries and waits.

`FixedBindingTeamAgentLinkDelivery` accepts one exact Agent and durable binding without reading `ctx.teams` or listening to `team/changed`. It opens the configured Link, retains claim, inbox admission, source flush, receipt, soft-interrupt acknowledgement, reconnect, and close ownership. A failed connection or rejected `done` schedules a bounded delayed reconnect only while that Agent and binding remain current. It treats a Team Envelope as already admitted only when it reached `user/message`, remains live in the inbox, or completed a flush that is awaiting receipt; a rejected claimed splice is admitted again on retry. Closing, Agent disposal, and inbox discard reject outstanding source barriers so no pre-step remains blocked after its owner disappears. `TeamAgentClient` remains the local Session-provenance and Team-change discovery wrapper that creates one fixed delivery Consumer per accepted binding.

## Alternatives considered

**Keep raw channel subscriptions in the Agent client.** Rejected because local replay and remote reconnect would duplicate cursor, cancellation, and notification ownership in every consumer.

**Advance delivery cursors after any listener callback.** Rejected because a failed flush or receipt acknowledgement leaves a pending Envelope with no route back to that listener.

**Validate a Link binding with a pre-read before post or receipt.** Rejected because the activation can transition after that read and before the Hub appends an Envelope or receipt.

**Treat residency status as a Link identity field.** Rejected because an idle-to-running update changes availability without changing the activation epoch or its Session authority.

## Consequences

Local notification remains at-least-once: a replayed Envelope can reach a consumer more than once, while the Hub claim and recipient receipt establish durable admission. The design does not promise exactly-once model execution or external effects. `notificationRetryDelayMs` and `reconnectDelayMs` are deployment configuration because their values trade recovery latency against retry pressure.

The Hub remains the authority for activation availability, journals, pending deliveries, claims, and receipts. The [Team Link registry decision](2026-08-28-team-link-registry.md) remains the authority for provider registration; the [linearized direct delivery claim decision](2026-08-28-linearized-direct-delivery-claims.md) remains the authority for the inbox cutoff and causal reply suppression. The [WebSocket Team Link transport decision](2026-08-29-websocket-team-link-transport.md) applies the same Link client API, terminal signal, authenticated operations, and recipient replay rules to remote connections.

## Verification

Core registry tests cover a status change during connection identity verification. Local Link tests cover watch-before-page recovery, bounded page handoff, delayed single-Envelope retries, retry cancellation, binding-derived post and receipt facts, terminal failure, and close. Agent client tests cover failed connection and terminal-Link reconnection, transient flush and receipt recovery without a duplicate model-visible input, and cancellation of in-flight pre-step barriers. Core and Hub tests cover the optional all-or-none activation proof and its Team-to-channel locked rejection after an epoch changes. The local provider boundary suite also proves artifact integration fails closed before Team authority when no workspace provider registry is mounted.
