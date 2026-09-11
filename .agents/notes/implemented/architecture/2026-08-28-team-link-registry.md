# Agent Note: Team Link registry

Status: implemented

English | [中文](2026-08-28-team-link-registry.zh.md)

## Problem

The Team Hub owns durable channel facts, while the local Agent client currently owns event subscription and replay directly. That leaves no named transport seam for a local Link, remote Link, authenticated sender derivation, reconnect replay, or provider lifecycle. Letting clients pass sender or recipient identities to each operation would also bypass the activation binding that defines their authority.

## Decision

`clocky-team-link` defines `ctx.teamLinks`, a named effect-scoped registry of activation-bound Link providers. A connect request names a provider and one exact durable activation binding. The registry verifies that the returned Link repeats both values and closes a mismatched Link before rejecting it.

A Link exposes notification subscription, authenticated post, delivery claim, receipt acknowledgement, and quiescent close. Its immutable binding derives sender and recipient facts for these methods; callers do not supply free participant identities. A provider owns its connection, replay, cancellation, notification backpressure, and containment of notification listener failures. The registry owns only provider selection and returned-Link identity checks.

## Alternatives considered

**Put transport methods on Team Hub.** Rejected because the Hub owns durable Team/channel state, while local and remote connection lifecycle evolves independently.

**Let Agent clients call post, claim, and acknowledgement with arbitrary participant ids.** Rejected because the client could name an identity other than its bound activation and would duplicate Link authentication logic.

**Create separate local and WebSocket client interfaces.** Rejected because replay, claims, receipts, and binding identity must have one consumer API before transports diverge.

## Consequences

`clocky-team-link-local` is the mounted local provider. It owns pending-page replay, cancellable Team/channel watches, bounded notification handoff, and retry of failed notifications while delegating direct inbox admission to `clocky-team-agent-client`. `clocky-team-link-websocket` adds framed authenticated remote connections through the same Link operations; the [WebSocket Team Link transport decision](2026-08-29-websocket-team-link-transport.md) owns its capability and replay rules.

The Team Hub remains the authority for journals, WALs, pending delivery, claims, and receipts. The [local Team Link recovery decision](2026-08-28-cancellable-local-team-link-recovery.md) owns local replay, lifecycle, and authenticated Link operation behavior. The [linearized direct delivery claim decision](2026-08-28-linearized-direct-delivery-claims.md) remains the authority for local inbox admission. The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because scheduling, workspace, and product phases are unfinished.

## Verification

Registry tests cover provider registration, duplicate and invalid names, stale disposers, missing providers, exact binding verification, rejected-Link close behavior, and contained cleanup diagnostics. Invariant tests reserve package ownership. The generated subsystem reference exposes the public registry surface under `ctx.teamLinks`.
