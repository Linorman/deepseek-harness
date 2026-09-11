# @clocky/clocky-team-link-websocket-hub

English | [中文](README.zh.md)

`@clocky/clocky-team-link-websocket-hub` mounts one exact `ctx.webServer` upgrade route for remote Team Link clients. It is a Hub listener, not a `ctx.teamLinks` provider: a remote provider connects to this route and exposes the same local `TeamLink` contract to its Agent client.

The v7 socket replays only its bound participant’s unacknowledged channel invitation, including the immutable manifest and fingerprint. Invitation revisions share the outstanding-delivery bound. `invitation-ack` adds the socket’s private activation proof outside JSON, and terminal updates clear pending notification state. Pending channel watches continue until acknowledgement or terminal admission; ordinary Envelope replay starts only after active.

## Configuration and authentication

After a credential-authenticated `attach` revalidates its durable binding, the listener mints one private runtime `TeamActorProof` lease. The proof never enters a frame, log, or diagnostic and is revoked when that socket finishes.

Static `bindings` entries name one `capabilityEnv` and one immutable `(activationId, teamId, participantId, sessionId, provider)` tuple. The listener reads each environment variable while it loads, retains only its SHA-256 digest, and rejects empty, duplicated, or missing entries. Dynamic enrollment uses the configured public `endpoint` and `enrollmentProviderName`: before exposing either its issuer or upgrade route, the listener recovers a provider-namespaced `storageLog` ledger that retains only binding, SHA-256 digest, monotonic generation, and issuance/revocation times. `reserve()` accepts only a current exact `idle` or `running` durable binding, mints a 32-byte base64url credential, and returns a caller-owned revoker. Reserving an active binding rotates its generation, invalidates the old credential, and closes its attached socket; a revoker affects only its exact current generation. A client must send the same tuple in `attach`; the listener compares the supplied digest with `timingSafeEqual`, then re-reads `ctx.teams.getActivation()` and requires the current durable binding to match. One immutable binding owns one live socket; the listener releases it only when that socket closes. It rechecks the durable binding before each pending-delivery page and each `notify`, closing an offline or replaced binding without recording a receipt. Capability plaintext never enters a diagnostic, wire response, retained configuration object, or durable ledger.

`path` defaults to `/team-link`. `pageSize` bounds each pending-delivery query. `maxConnections` and `handshakeTimeoutMs` bound accepted sockets before authentication; an attached client must subscribe before its deadline. `maxFrameBytes`, `maxPendingRequests`, `maxQueuedBytes`, `maxOutstandingDeliveries`, `requestWindowMs`, `maxRequestsPerWindow`, and `closeTimeoutMs` bound untrusted input, replay, rate, outbound buffering, and shutdown. After subscription, `heartbeatIntervalMs` and the shorter `heartbeatTimeoutMs` close a half-open socket that does not pong. `maxOutstandingDeliveries` is one combined cap for Envelope deliveries, unacknowledged interrupt commands, and retained idempotent interrupt acknowledgements; a new live delivery evicts the oldest cached acknowledgement before overflow closes the socket. `retryableNackDelayMs` defaults to `100` and delays a retryable nack replay; `backpressureRetryAfterMs` defaults to `100` and is returned with a backpressure rejection. A queued-byte or retained-live-delivery overflow closes the socket without recording a receipt.

The route accepts only version 7 frames from [`@clocky/clocky-team-link`](../../core/team-link/README.md); earlier frames close as invalid. `attach` returns `attached`. `subscribe` returns `{ subscribed: true }`, then rechecks target-exact soft interrupts and replays Envelope deliveries as `notify`. The first pending-delivery page starts at the durable `ChannelSnapshot.replayWatermark`; later pages use their returned cursor. Team-journal changes mark interrupt replay dirty; one serial drain repeats the durable query until it has observed every wake. Replay loads each Team channel manifest and skips channels whose roster excludes the bound Participant. `post`, `direct-final`, `claim`, `task-start`, `task-settle`, `task-heartbeat`, `receipt`, and `interrupt-ack` receive only caller-controlled operation fields. `claim` carries only channel and Envelope identities; `task-start` carries only task, attempt, assignment-revision, channel, and Envelope identities; `receipt` carries only channel, Envelope, and observed-cursor identities; `task-heartbeat` carries only task, attempt, and observed revision; and `task-settle` adds its typed outcome. For `direct-final`, `claim`, `task-start`, `receipt`, `task-heartbeat`, and `task-settle`, the listener passes the proof from the attached socket's private lease outside the frame. Under the Team/channel queues, the Hub resolves and revalidates that binding, derives the current recipient for a receipt and the recipient and delivery intent for a claim, and derives the Team, Participant, activation, and Session for task-start admission. For heartbeat and settlement, it selects the Team from the proof, revalidates the binding inside the Team lock, and derives the exact current task-attempt owner before a mutation. Ordinary `post` retains its separately typed request path. `task-review` carries only task/revision/decision fields, while the listener supplies the attached socket's private activation proof; receipt admission is proof-only and neither path grants Team-closure authority.

`post` requires a nonempty opaque `idempotencyKey` beside its cursor and draft. The Hub persists the sender/key pair with the accepted Envelope, returns that original Envelope for a matching retry before it evaluates a stale cursor, and rejects a key reused with a different semantic draft. `direct-final` needs only channel id, text, and key; the Hub derives peer and current cursor inside the channel lock. `receipt` alone advances durable recipient admission, and the attached socket's proof derives that recipient before the Hub evaluates the pending delivery or cursor. A `nack` never writes a receipt or cursor: a retryable nack waits `retryableNackDelayMs`, rechecks the durable binding, then reclaims and reissues the pending delivery; its timer clears when the socket closes. Duplicate, stale, or non-retryable nacks leave durable pending state unchanged. An accepted `post` whose `causationId` identifies an outstanding notification releases that socket-local delivery slot only after the Hub commits the reply.
A repeated or rewound Team or channel watch cursor closes the Link instead of replaying the same continuation.

`direct-final` passes that private proof with only its channel id, text, and key, so the Hub derives the sender, peer, and current cursor under the channel lock rather than accepting any caller identity.

An `interrupt` frame carries one Hub-committed soft command with a Link-issued `deliveryId`. The client may only send `request { op: 'interrupt-ack', input: { deliveryId, interruptId } }`; it cannot request an interrupt for any peer. The listener requires the retained delivery, interrupt id, and every target binding field to match, then records the exact-target acknowledgement through `ctx.teams`. Repeating a retained acknowledgement returns the same durable interrupt. A listener or connection failure leaves the command unacknowledged for target-exact replay after reconnect. Credential rotation, credential revocation, and future provider-owned retirement first send a v7 `cancel` frame with a structured reason; an endpoint that registered `onTerminate` may stop Link-owned admission and current model work, then returns `cancelled { accepted: true }`. The Hub closes the transport after the response or its bounded timeout, and the owning AgentRuntime provider remains responsible for proving process termination.

The host process or reverse proxy owns TLS termination. Static environment credentials rotate through configuration reload; dynamic credentials rotate through a later `reserve()` for the same binding.

An attached socket retains its `TeamActorProof` lease privately. Its strict `receipt` frame contains only `channelId`, `envelopeId`, and `expectedCursor`; `task-heartbeat` contains only `taskId`, `attemptId`, and `expectedRevision`; `task-settle` adds its typed outcome. The listener adds the proof outside every one of those frames. The Hub revalidates the binding inside the Team/channel queues to derive the receipt recipient, and uses it to select the Team queue and derive the exact task-attempt owner before a renewal or settlement. Ordinary `post` retains its separately typed contract. The `task-review` frame carries only task/revision/decision fields and receives the private proof outside the frame; Team closure is outside this transport authority.

`task-integrate` carries only the integration task id, attempt id, expected revision, and optional verification. The listener supplies the attached socket's private proof; the Hub derives the source task, source attempt artifacts, workspace provider, target, and mode from the durable integration task, then settles the provider result into that attempt. A provider may return a proposal, integrated target version, or conflict paths; the source allocation need not remain live.

## Model Experience

### Remote Team Link listener

#### What the model sees

`ctx.webServer` receives no prompt section, tool, model input, or model output from this listener.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This listener owns no model request prefix.

## Known Limitations and Deferred Work

- **Single authoritative Hub** — this listener assumes every remote client reaches one `ctx.teams` authority; Hub federation and consensus are outside its contract.
- **Remote task outcomes require child composition** — an SDK child can admit direct and task-assignment input and use the borrowed-Link `tool-team` report/final consumers when its runtime mounts them; this listener itself only authenticates transport and never owns model tools.
- **Transport termination** — TLS certificates, reverse-proxy policy, network ACLs, and environment-variable rotation are deployment-owned controls.
- **No hard remote process cancellation** — the listener can request cooperative endpoint termination and bounds the acknowledgement wait, but it never force-kills an Agent or process; the owning AgentRuntime provider must prove termination or retain its Team in a stalled state.

### Single-task cancellation

Frame version 7 replays pending Task cancellation to its exact capability-bound activation. These notifications share `maxOutstandingDeliveries`; acknowledgement rechecks the selected attempt and uses the retained activation proof. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
