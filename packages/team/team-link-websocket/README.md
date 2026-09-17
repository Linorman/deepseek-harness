# @clocky/clocky-team-link-websocket

English | [中文](README.zh.md)

`@clocky/clocky-team-link-websocket` registers one remote provider on `ctx.teamLinks`. It opens a WebSocket to an authoritative Team Link Hub, authenticates one immutable activation binding with an opaque capability, and exposes the ordinary `TeamLink` API without importing a Hub, Agent client, or Session store.

V6 invitation notifications share the bounded notification capacity and dispatch independently per channel. Exact acknowledgement results remove their retained entry; terminal invitation updates also clear it. A null-audience Envelope for another sender may reach claim, whose Hub-verified manifest and fixed recipient intent remain the final delivery authority. This permits v4 broadcasts without granting late members historical deliveries.

Explicit remote `unauthorized` rejection, missing capability, invalid configuration, binding mismatch, malformed frames/results, and unexpected or out-of-order protocol frames are non-retryable connection failures. Transport timeouts and disconnects remain retryable. Remote request rejection alone is not classified as permanent because the remote reason may describe transient admission state.

## Provider contract

`providerName` defaults to `websocket`. `endpoint` is a complete `ws:` or `wss:` Hub URL; it cannot contain URL credentials or a fragment. `capabilityEnv` is a required POSIX environment-variable name. The provider reads that variable only when `connect()` begins, sends its value only in the literal v7 `attach` frame, and never logs or stores it. `connectTimeoutMs` defaults to `5000` and bounds socket opening, attach, and subscribe. `responseTimeoutMs` defaults to `30000` and bounds each attach, subscribe, and operation response. `maxFrameBytes` defaults to `1048576`; `maxPendingRequests` and `maxBufferedNotifications` default to `64` each. The latter bounds queued Envelope notifications and every interrupt delivery retained until its acknowledgement succeeds.

`createCapabilityWebSocketTeamLinkProvider(config, capability)` creates the same provider for one dynamically enrolled activation. It keeps the credential in the returned provider's closure rather than an environment variable, so concurrent SDK activations cannot read one another's credential. Its endpoint and limits use `CapabilityProviderConfig`; the caller registers the returned provider only in the activation-local child context.

The client sends the request binding's activation id, Team, Participant, Session, and AgentRuntime provider exactly in `attach`; it accepts `attached` only when the returned identity matches. It then requires a successful `subscribe` response with exactly `{ "subscribed": true }` before publishing the Link. Each post, direct-final, claim, task-start, task-settle, task-integrate, and receipt request receives a unique client id and is multiplexed against its matching response. A connected endpoint may provide `onTerminate` to stop Link-owned admission and current model work when the Hub sends a v7 `cancel`; the endpoint returns a v7 `cancelled` result before the Hub closes the transport. `postDirectFinal()` relies on the Hub to atomically derive the peer and current cursor. Invalid, unknown, duplicate, or out-of-order frames terminate the Link. A missing response also terminates the Link, clears pending requests, and rejects `done`; remote operation rejections remain per-operation failures. Explicit `close()` releases the socket and resolves `done`.

Envelope notifications and interrupt notifications received before their first listener share the `maxBufferedNotifications` bound. Delivered interrupts continue to consume that bound until `acknowledgeInterrupt()` succeeds. The client terminates a Link when an Envelope names another Team, explicitly excludes its bound Participant, or broadcasts from that Participant itself. A non-self broadcast proceeds to the authoritative claim. `onInterrupt()` receives only v7 `interrupt` frames whose target exactly matches the Link binding. `acknowledgeInterrupt(deliveryId, interruptId)` sends the sole client-issued interrupt operation, `interrupt-ack`; the response must carry the same exact target and an acknowledgement time. An interrupt listener rejection terminates the Link without acknowledgement so the durable command can replay after reconnect. The client never issues an interrupt request. Listener failure for an Envelope sends a retryable `nack`; notification receipt does not acknowledge the durable Envelope. The remote Hub remains responsible for pending-delivery replay, durable receipts, and interrupt persistence. The client disables WebSocket compression, imposes both local and `ws` payload limits, and exposes no TLS-validation bypass; deployments reachable beyond a trusted local network use a certificate-validated `wss:` endpoint.

## Model Experience

### WebSocket Team Link provider

#### What the model sees

`ctx.teamLinks` receives no prompt section, tool, model input, or model output from this package. Its consumer decides whether a received Envelope enters an Agent.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This provider owns no model request prefix.

## Known Limitations and Deferred Work

- **No automatic reconnect** — a terminal Link leaves its consumer to reconnect a still-current durable binding, preserve any uncertain post's idempotency key, and receive Hub replay.
- **No Agent inbox delivery** — `clocky-team-agent-client` or another consumer owns claim, Session durability, acknowledgement, and model wake-up.
- **No hard process cancellation** — v7 supports cooperative endpoint termination through `onTerminate`, but the transport does not force-kill a remote Agent or process; the owning AgentRuntime provider must prove termination or leave its Team cancellation stalled.

### Single-task cancellation

Frame version 7 transports exact task cancellation separately from Link termination. Pending task notifications share `maxBufferedNotifications`; reconnect obtains them again from the Hub’s durable Task state. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
