# Agent Note: ACP activation Team Link bridge

Status: implemented

English | [中文](2026-08-31-acp-team-link-bridge.zh.md)

## Problem

An ACP placement activation has no local Clocky `Agent`, so the ordinary local Agent Client cannot consume Team channel notifications. Leaving ACP children without a Team delivery path made the remote Participant lifecycle usable only for out-of-band callers.

## Decision

`agent-runtime-acp` accepts an optional `teamLinkEnrollmentProvider`. After the AgentRuntime controller commits the exact activation binding, the provider reserves an ephemeral enrollment, registers a capability-scoped WebSocket Link provider, and connects it with the same Team, Participant, activation, Session, and placement-provider identity. The Link is owned by the ACP activation handle and is revoked before child-process teardown.

Claimed Team Envelopes are serialized into ACP `session/prompt` requests with Team/channel/Envelope/sender/kind provenance and JSON payload text. Before the request, the provider appends the exact rendered input to a durable Clocky proxy Session under the Team-resolved `SessionId` and waits for `ctx.sessions.flush()`. A non-cancelled response appends a completion fact and a completed turn, flushes both, and only then acknowledges the source Envelope; failed or cancelled prompts remain unacknowledged for Link replay. On resume, a completed proxy fact lets the provider acknowledge the source without another prompt, while an admitted incomplete turn remains replayable. Targeted soft interrupts cancel the ACP session before the Link interrupt acknowledgement. A failed Link re-enrolls after revoking the old credential while the activation remains current. ACP assistant output is private and is never posted to a Team channel automatically.

The enrollment issuer and WebSocket Hub remain optional deployment capabilities. Without the option, ACP placement preserves its lifecycle-only behavior. The provider records only the Team-derived prompt admission and completion ledger in the Clocky proxy Session; it does not copy the child transcript or expose enrollment credentials to model content.

ACP child disposal proves the whole process tree after EOF, then escalates through the subprocess provider's termination rung. The post-escalation observation window includes that provider-owned SIGTERM-to-SIGKILL grace, so a child is not reported as unconfirmed at the exact escalation boundary; if the tree still cannot be proven stopped, the activation remains stopping and returns the typed unconfirmed-termination error.

ACP disposal and reconnect delays reject values beyond Node's safe timer range, and the post-escalation termination wait clamps its doubled interval to that same range.

## Alternatives considered

**Treat ACP assistant output as an implicit Team message.** Rejected because it bypasses channel audience, causation, receipt, and explicit-send policy and would make private reasoning broadcast by default.

**Write the enrollment credential into the ACP prompt.** Rejected because the credential would become model-visible and could be retained in the child transcript; the bridge keeps it in the activation-owned Link provider closure.

**Require every ACP child to implement Clocky's WebSocket Link protocol.** Rejected because ACP is an independent interoperability protocol; the provider adapts the durable Link into the standard ACP `session/prompt` operation while retaining the Hub's receipt authority.

**Keep prompt admission only in the remote ACP transcript.** Rejected because the child transcript is not a Clocky persistence source and cannot fence a Team receipt across provider restart. A small local proxy Session records the exact input and completion fact without making the child transcript part of Team authority.

## Consequences

ACP placement now consumes Team input when an enrollment issuer and WebSocket Hub are mounted, with bounded prompt serialization and reconnect. A child that rejects the standard ACP prompt flow cannot consume Team Envelopes through this provider. Remote child transcript persistence and automatic output publication remain outside the bridge; the proxy Session is a durable admission ledger, not a second model transcript.

## Verification

The provider typechecks and lint-checks with the Team Link/WebSocket and Session-persistence dependencies; the persistence catalog includes the completion fact. Keyless provider lifecycle tests run a real ACP child through concurrent activation, EOF-driven flush, and trapped-SIGTERM escalation, while the termination unit tests retain the unconfirmed branch and timer-overflow clamp. Configuration tests reject unsafe timer values. Existing ACP lifecycle and WebSocket Link suites remain green. The bridge uses the same claim/acknowledge contract as local and SDK remote delivery, flushes proxy admission before acknowledgement, and keeps credential values out of durable records and diagnostics.
