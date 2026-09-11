# @clocky/clocky-team-link

English | [中文](README.zh.md)

`@clocky/clocky-team-link` defines the named `ctx.teamLinks` registry for activation-bound Team channel and soft-interrupt clients. It accepts the durable `ActivationBindingSnapshot` selected by Team and AgentRuntime ownership, but imports neither a Team Hub implementation, Agent client, transport, nor model loop. [`clocky-team-link-local`](../../team/team-link-local/README.md) and [`clocky-team-link-websocket`](../../team/team-link-websocket/README.md) provide local and remote implementations.

Frame v7 carries `invitation` notifications and the `invitation-ack` operation. `onInvitation()` receives the exact manifest plus the bound participant’s invitation; the endpoint explicitly confirms protocol support through `acknowledgeChannelInvitation()`. Invitation confirmation is separate from Envelope receipt and from task cancellation acknowledgement. Transport Consumers preserve the existing claim and Session-flush ordering.


`getChannel(channelId)` uses the current activation proof to read only a member channel’s manifest, phase and cursors, including while admission is pending. Frame v7 maps it to `channel-get`; messages, summaries and adapter state are excluded.

## Provider contract

A `TeamLinkProvider` registers under one non-empty name and receives that name, one activation/Session/AgentRuntime-provider snapshot, and optional connection cancellation. Activation id, Team, Participant, Session, and placement provider identify the connection; residency status is mutable and the provider rechecks it before publication. Its `connect()` call returns a `TeamLink` only after it has published the provider-owned connection. The returned Link retains the requested provider name and binding identity; `TeamLinkRegistry.connect()` validates both and closes a mismatched Link before rejecting it. Removing a registration prevents future connections but does not revoke Links already returned to callers.

An enrollment provider registers separately through `registerEnrollmentProvider()`. A trusted activation owner calls `reserveEnrollment({ provider, binding })` only after the exact durable binding exists. The provider returns an endpoint, Link-provider name, opaque credential, and `revoke()`; the credential must not enter durable state or diagnostics. The registry rejects an invalid issuer result and attempts its revocation. Enrollment-provider add/remove events let a current owner renew after same-process issuer HMR.

`post({ expectedCursor, idempotencyKey, draft })` accepts no sender field: the Link derives the authenticated participant, activation, and Session from its binding. `postDirectFinal({ channelId, idempotencyKey, text })` likewise derives peer and current cursor inside the Team provider's channel lock, so a remote caller cannot race a channel read. The sender-scoped opaque key identifies one retryable post; the same key and draft return the original accepted Envelope before cursor comparison, while a different draft is rejected. `claim(channelId, envelopeId)` contains only those two client-provided identities; a local Link or authenticated WebSocket listener supplies its private activation proof. Under the Team/channel serializers, the Hub resolves and revalidates the binding, then derives the Team, recipient, and delivery intent. `acknowledge(channelId, envelopeId, expectedCursor)` contains only receipt-selection fields; the trusted Link side supplies its private activation proof, so the Hub derives the current recipient and accepts no client-selected participant, activation, or Session. `claimTaskAttemptStart()` contains only task, attempt, assignment-revision, channel, and Envelope identities; the same trusted Link side supplies the private proof, and the Hub derives the Team, participant, activation, and Session before it validates the assignment delivery. `integrateTask()` contains only task, attempt, expected revision, and optional verification; the Link proof supplies the current owner while the Team workspace registry derives the source artifact manifest, provider, target, and mode from the durable task. Repeating one current successful claim returns the running task without another task transition. The following heartbeat, integration, and settlement contracts use the same private proof lease. Providers map these operations to an authoritative Team provider or a remote protocol; this package owns strict remote frames but no connection lifecycle or storage.

`heartbeatTaskAttempt()` accepts only `taskId`, `attemptId`, and `expectedRevision`; `settleTaskAttempt()` accepts those identities plus a Link-permitted `released`, `failed`, or `completed` outcome; `integrateTask()` accepts the task/attempt fence and optional verification. The Link retains the proof from its private activation-proof lease and supplies it only to the runtime request. After the proof selects the Team, the Hub holds the Team lock, revalidates the exact binding, and derives the Team, Participant, activation, Session, and task-attempt owner before it renews, integrates, or settles a lease. Together with `postDirectFinal()`, `claim()`, `acknowledge()`, and `claimTaskAttemptStart()`, these are proof-only operations. Ordinary `post()` retains its separately typed binding-derived request. `resolveTaskReview()` also carries the private activation proof and only JSON task/revision/decision fields, so no Link caller selects a Team or reviewer identity; none of these operations grants Team-closure authority.

`onNotify()` subscribes to accepted Envelope wake-ups visible to the binding. `onInterrupt()` receives only pending soft-interrupt commands whose Team, participant, activation, Session, and provider equal the binding; its listener calls `acknowledgeInterrupt(deliveryId, interruptId)` only after issuing local cancellation. A connection can also retain an `onTerminate` callback for v7 Hub requests that ask the endpoint to stop Link-owned admission and current model work. The provider checks that live delivery correlation and durable command identity together, so a listener failure leaves the command pending for replay. A Link implementation contains listener throws and rejections so one subscriber cannot interrupt later notifications. `done` resolves on an orderly terminal state and rejects on a provider-owned lifecycle failure, allowing a consumer to reconnect its still-current binding. Connection and lifecycle errors from `connect()`, `post()`, `postDirectFinal()`, `claim()`, `claimTaskAttemptStart()`, `settleTaskAttempt()`, `acknowledge()`, `acknowledgeInterrupt()`, and `close()` remain observable to callers. `close()` stops notification admission and reaches the provider's Link-local terminal state. This package owns strict v7 remote frame parsers; client and Hub providers own WebSocket lifecycle and capability validation.

## Model Experience

### Team Link registry

#### What the model sees

`ctx.teamLinks` registers no prompt section, tool, model input, or model output. A Link provider and its consumer own any Team Envelope projected into an Agent.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no model request prefix.

## Known Limitations and Deferred Work

- **One authoritative Hub** — the framed WebSocket provider reconnects to one Hub; multi-Hub consensus and credential re-enrollment after a complete Hub process restart remain outside this package.
- **No model-facing channel API** — the registry itself does not project notifications into an Agent or expose Team operations to a model; the local Agent client separately consumes a Link for direct and task-assignment inbox delivery.

### Single-task cancellation

`onTaskCancellation()` replays exact Task intents for the bound activation. `acknowledgeTaskCancellation()` settles only the selected attempt after work and allocation cleanup. Link frame version 7 carries these notifications and acknowledgements separately from whole-Link termination. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
