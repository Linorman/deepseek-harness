# Agent Note: Durable participant soft interrupt

Status: implemented

English | [中文](2026-08-29-durable-participant-soft-interrupt.zh.md)

## Problem

An in-memory Agent cancellation cannot be authorized, recovered, or delivered to a remote activation after a disconnect. Treating a WebSocket peer as an interrupt authority would also let one remote participant stop another without a durable Team decision.

## Decision

`ctx.teams` owns a durable soft-interrupt command. A trusted actor requests an interrupt for one active participant; the Hub resolves its current idle or running activation and records the exact Team, participant, activation, Session, and provider target. The `interrupt` policy authorizes that request. A matching unacknowledged target returns the existing command, and only the same target binding can list or acknowledge it.

The Team journal records requested and acknowledged commands, and checkpoints retain pending commands across restart. An acknowledgement proves only that the target execution side issued `Agent.cancel({ kind: 'user' }, { keepInbox: true })`; it does not claim that a turn, task, Team, or process has ended.

`TeamLink` carries target-bound interrupt notifications and acknowledgements. The local Agent client cancels its exact live Agent before acknowledgement. WebSocket Link frames use v2: the Hub sends `interrupt`, and the client may only send `interrupt-ack` for its retained delivery and matching target. Listener failure leaves the durable command pending for replay; a peer cannot create an interrupt command.

## Alternatives considered

**Let a WebSocket peer request an interrupt.** Rejected because connection possession is delivery authority for one binding, not authority to control Team members.

**Use a task or Team cancellation as the interrupt record.** Rejected because cancelling an unleased task or Team does not identify an executing activation, preserve an acknowledgement, or distinguish a cooperative stop from lifecycle settlement.

**Make acknowledgement mean completion.** Rejected because cancellation is asynchronous: the Session turn-end event and runtime status remain the durable evidence of later execution state.

## Consequences

Local and remote execution sides can receive one recoverable, exact-target soft interrupt without shared process memory. The [WebSocket Team Link transport decision](2026-08-29-websocket-team-link-transport.md) owns framing, capability, and connection rules; this note owns the command authority and its negative guarantees.

Hard participant or Team cancellation remains separate: it must stop future admission, settle task leases and workspaces, dispose the activation, and use durable offline state as completion evidence. Multi-Hub consensus and remote process force-termination remain outside this command.
