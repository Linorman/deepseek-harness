# Agent Note: WebSocket Team Link transport

Status: implemented

English | [中文](2026-08-29-websocket-team-link-transport.zh.md)

## Problem

Local Team Links cannot deliver an activation-bound channel connection across processes. A remote client must not choose a sender, participant, Session, or activation through mutable frame fields, and a live WebSocket cannot replace the channel WAL or recipient receipt as delivery authority.

## Decision

`@clocky/clocky-team-link` owns a strict versioned frame vocabulary for attach, subscribe, bound operations, nack, responses, and notifications. `@clocky/clocky-team-link-websocket` is a Link provider that reads an opaque capability from a configured environment variable, attaches one immutable activation identity, and validates response ordering and frame sizes. Its terminal Link state lets an existing Consumer reconnect the same current binding.

The v4 frame vocabulary adds a Hub-originated `cancel` request and an endpoint `cancelled` result. A `TeamLinkConnectRequest` may retain an `onTerminate` callback; the WebSocket client awaits that callback before acknowledging cooperative stop, and the Hub closes the socket after the response or its bounded close timeout. The transport does not claim process termination; the owning AgentRuntime provider still proves or stalls hard disposal.

`@clocky/clocky-team-link-websocket-hub` registers an HTTP upgrade endpoint and an enrollment issuer. Static configuration can map an environment capability to one immutable activation identity. Dynamic enrollment owns a provider-namespaced durable ledger containing only binding, credential hash, generation, and issuance/revocation times; the [durable enrollment ledger decision](2026-09-01-durable-websocket-enrollment-ledger.md) owns its recovery and rotation mechanics. A configured connection cap and attach/subscribe deadline bound unauthenticated sockets; heartbeat ownership starts only after subscription. Attach compares the capability in constant time, re-reads the durable activation, and requires an exact active binding before a connection exists. Post, claim, receipt, and task operations derive authority from that bound identity; the Hub never trusts authority values from request input.

After subscription, the Hub discovers durable pending recipient deliveries and target-exact soft interrupts through the Team runtime, then sends bounded notifications. A receipt clears a matching outstanding notification; a retryable nack releases it for a configured delayed fresh claim. Each interrupt wake marks one serial replay drain dirty, so a command accepted while a preceding durable query is pending is queried before the drain settles. Each Link post carries a sender-scoped opaque idempotency key. The Team channel WAL and checkpoint retain that key with the accepted Envelope, so a matching retry survives Hub restart and stale cursors while conflicting key reuse fails. The client bounds every attach, subscribe, and operation response; the Hub configures its backpressure retry advice and ping/pong half-open deadline. Reconnect replays from durable pending state rather than connection memory. Both sides bound frame size, requests, queues, and notification retention. TLS is selected by the HTTP server deployment (`wss:` client endpoint or terminating proxy), not by a second transport protocol.

## Alternatives considered

**Make WebSocket frames the delivery source of truth.** Rejected because disconnects, duplicate frames, and Hub restart would lose the durable append → Session flush → receipt ordering.

**Accept a client-provided participant or sender on every operation.** Rejected because a leaked connection could then impersonate another Team member. The capability selects one immutable binding and the Hub derives all operation ownership.

**Hide reconnection inside a permanent socket object.** Rejected because a stale activation must not silently resume. Consumers already know when their durable binding remains current and reconnect through the Link registry.

## Consequences

Remote processes can use the same Team Link operations as local Consumers without shared Session storage. The [Team Link registry decision](2026-08-28-team-link-registry.md) owns the shared API, the [local Team Link recovery decision](2026-08-28-cancellable-local-team-link-recovery.md) owns the local provider, the [SDK post-bind Team Link enrollment decision](2026-08-29-sdk-post-bind-team-link-enrollment.md) owns SDK child delivery, and the [durable participant soft-interrupt decision](2026-08-29-durable-participant-soft-interrupt.md) owns command authority. A single Team Hub remains authoritative; multi-Hub consensus and hard participant cancellation remain separate work. Cooperative Hub-to-endpoint termination now stops Link-owned admission and current model work before credential rotation, revocation, or provider retirement closes the transport. A shared local/WebSocket contract covers notification, reconnect replay, claim, explicit receipt, and cooperative termination; focused protocol tests cover malformed, duplicate, out-of-order, oversized, unauthorized, disconnected, slow-consumer, nack, response-loss retry, interrupt acknowledgement, cancellation acknowledgement, bounded no-ack close, dynamic generation rotation, full Hub restart recovery, and durable-replay paths. A spawned SDK child receives a direct Envelope through a dynamic credential and writes its receipt without shared Hub state; the same child-process fixture proves a v4 cancellation request reaches the endpoint before dynamic revocation closes its socket.
