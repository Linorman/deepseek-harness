# Deploy a single-Hub Team Link

English | [中文](deploying-a-team-link-hub.zh.md)

Use this guide when a remote process must connect an activation-bound Team Link to one authoritative Team Hub. It assumes the Hub process already owns `ctx.teams`, `ctx.webServer`, and the durable activation selected for the remote participant.

## 1. Bind the Hub endpoint

Give the Hub process a capability environment variable, then mount the listener beside the Team Hub. The binding values must exactly match the durable activation record; never place the capability value in `cordis.yml`.

```yaml
- id: team-link-websocket-hub
  config:
    path: /team-link
    bindings:
      - capabilityEnv: TEAM_LINK_CAPABILITY
        activationId: activation-example
        teamId: team-example
        participantId: participant-example
        sessionId: session-example
        provider: remote-runtime
```

Terminate TLS at the HTTP server or its reverse proxy. Remote clients use a certificate-validated `wss:` URL; `ws:` is suitable only for a protected local network.

## 2. Mount the remote provider

Give the remote process the same capability value and register a named client provider. A Link consumer connects with the exact current activation binding, not values copied from a user request.

```yaml
- id: team-link-websocket
  config:
    providerName: remote
    endpoint: wss://hub.example.test/team-link
    capabilityEnv: TEAM_LINK_CAPABILITY
```

The listener derives sender, recipient, Team, activation, and Session authority from the attached binding. It rejects a stale binding, an unrelated channel, oversized frames, excess requests, or an overfull outbound queue.

## 3. Recover and cancel safely

After a terminal Link failure, dispose that Link and reconnect only while the durable binding remains current. The Hub reconstructs pending delivery from its channel WAL; a recipient records its receipt only after its own durable admission. A retryable post keeps its idempotency key and can recover the original accepted Envelope after a lost response.

This transport delivers Hub-authored soft interrupts only to their exact activation binding. It does not allow a peer to request an interrupt or force a participant or Team cancellation; those lifecycle actions remain Team-owner operations.

See the [Team Link reference](../subsystems/team-link.md) for the shared Link contract and the [Hub package README](../../packages/team/team-link-websocket-hub/README.md) for every operational limit.
