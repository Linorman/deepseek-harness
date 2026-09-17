# @clocky/clocky-team-link-local

English | [中文](README.zh.md)

`@clocky/clocky-team-link-local` registers the `local` provider for `ctx.teamLinks`. It exposes one local `TeamLink` for an exact durable activation binding and delegates Team authority to `ctx.teams`; it imports neither an Agent client nor a transport protocol.

`onInvitation()` starts the same channel discovery/watch cycle as Envelope subscriptions and replays only the bound participant’s pending invitation. A pending channel remains watched until acknowledgement or terminal admission. `acknowledgeChannelInvitation()` passes the exact fingerprint, revision, and retry key with the Link’s private activation proof; notification or registry availability does not imply consent.

## Provider contract

At connection time the provider reads the activation from `ctx.teams`, requires its activation id, Team, Participant, Session, and AgentRuntime-provider fields to equal the request, and accepts only an `idle` or `running` current status. Residency status is not a Link identity, so an idle-to-running update during connection remains valid. The returned Link freezes the request binding. Provider unload blocks new connections but does not revoke already returned Links.

The returned Link also retains a private revocable `TeamActorProof` lease issued from that verified current binding. Provider unload blocks new connections and closes its issuer to new leases but does not revoke already returned Links; Link close revokes its own lease.

Its public binding is the verified current binding, rather than a mutable caller object or the request's transient residency status.

`post({ expectedCursor, idempotencyKey, draft })` derives `senderId`, activation id, and Session from the bound Participant. The nonempty sender-scoped key identifies a retryable post and reaches the durable Team Hub unchanged. `claim(channelId, envelopeId)` passes the proof from its private lease with only those two identities; under the Team/channel serializers, the Hub resolves and revalidates the binding, then derives the Team, activation, Session, recipient, and delivery intent. `claimTaskAttemptStart()` passes that proof with only task, attempt, assignment-revision, channel, and Envelope identities; the Hub derives the Team, participant, activation, and Session before it validates the assignment delivery. `acknowledge(channelId, envelopeId, expectedCursor)` passes only those receipt-selection fields with the private proof, so the Hub revalidates the binding and derives the recipient instead of accepting a Link-supplied recipient, activation id, or Session. Channel operations first confirm that the channel belongs to the bound Team; heartbeat and settlement have no channel target, so the Link checks its lifecycle before it passes its private proof to `ctx.teams`. Ordinary `post` retains its binding-derived request form. `resolveTaskReview()` passes the same private activation proof with only task/revision/decision fields, so no caller supplies a Team or reviewer identity.

`postDirectFinal()` passes only that private proof plus channel, retry key, and text, so no final sender, activation, or Session value crosses the Link API.

The first `onNotify()` subscriber starts local Team and channel cursor watches before pending-delivery recovery. The Link reads each attached channel manifest and watches only channels that name its bound recipient; it enumerates those channels through `listChannelPendingDeliveries()` using `pageSize` and awaits each listener handoff before it reads the next page item. A closed channel ends only its local watcher. Notifications are at-least-once wake-ups, so duplicates are permitted and a consumer claims before delivering. Listener throws and rejections are logged without interrupting other listeners; only the failed subscriber and Envelope retry after `notificationRetryDelayMs`, except that a final Hub rejection drops an invalidated delivery. The first `onInterrupt()` subscriber independently watches the Team journal, lists pending commands for its exact activation and Session, and retains one Link-local delivery id per command until acknowledgement. `acknowledgeInterrupt()` derives the exact binding and rejects an unknown or mismatched delivery id. Removing the final subscriber cancels local recovery, watches, and delayed retries; a later subscriber starts a new recovery cycle. A failed replay/watch rejects `done`, later operations, and `close()`.

`providerName` defaults to `local`; `pageSize` defaults to `128`; `notificationRetryDelayMs` defaults to `100`; and `disposalTimeoutMs` defaults to `5000`. `pageSize` must not exceed the mounted Team provider's pending-delivery page limit. Link close cancels its local waits and delayed retries, stops notification admission, and awaits already accepted replay and notification work up to `disposalTimeoutMs`.

The first pending-delivery scan uses the channel's durable `replayWatermark` when the provider exposes it. This avoids replaying an acknowledged prefix while retaining every still-pending Envelope for claim and receipt recovery. A repeated or rewound Team or channel watch cursor fails the Link closed instead of retrying the same continuation.

`heartbeatTaskAttempt()` passes its private lease proof with only `taskId`, `attemptId`, and `expectedRevision`; `settleTaskAttempt()` adds the Link-permitted `released`, `failed`, or `completed` outcome; `integrateTask()` passes the same task/attempt fence to the Team workspace registry, which derives source artifacts and target facts from the durable integration task. The Hub resolves the proof to select the Team queue, revalidates the binding while that lock is held, and derives the Team, Participant, activation, Session, and exact lease owner before renewal, integration, or settlement. Ordinary `post()` retains its separate binding-derived contract; `resolveTaskReview()` uses the same proof-only path and none of these operations grants Team-closure authority.

## Model Experience

### Local Team Link provider

#### What the model sees

`ctx.teamLinks` registers no prompt section, tool, model input, or model output. In the local composition, `clocky-team-agent-client` consumes these notifications and decides whether a claimed direct Envelope enters an Agent.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This provider owns no model request prefix.

## Known Limitations and Deferred Work

- **No embedded Agent delivery** — this provider never imports Agent or Session code; `clocky-team-agent-client` separately claims, starts, durably admits, and acknowledges local direct and task-assignment Envelopes.
- **No remote transport** — WebSocket authentication, reconnect replay, backpressure protocol frames, and cross-process Link providers remain separate work.

### Single-task cancellation

Task cancellation subscribers watch the Team journal and replay only intents selecting this binding’s current attempt. Acknowledgement revalidates the durable intent and binding before submitting the owner’s cancelled outcome. [Cancellation ownership](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
