# @clocky/clocky-team-channel-basic

English | [中文](README.zh.md)

`@clocky/clocky-team-channel-basic` registers version-one `consult` and `discussion` channel adapters on `ctx.teams`. Consult accepts one initiator request and one respondent response, then asks the Hub to close the channel atomically. Discussion accepts text messages for at least two participants under an explicit `round-robin` or `free-form` policy and a required `maxTurns` bound.

The adapters validate immutable membership and limits, fold only JSON-safe state, derive recipient delivery intents, and never execute model turns or transport work. Discussion broadcast uses `audience: null`; explicit audiences must be distinct channel members other than the sender.

## Model Experience

### Basic channel protocols

#### What the model sees

This package owns no prompt or tool. A Team delivery Consumer decides how a validated `Envelope` becomes a logged model input.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model request prefix is owned by this package.

## Known Limitations and Deferred Work

- **No delivery execution** — the adapters return protocol-derived intents; the Link and Agent Client layers admit and acknowledge recipient inputs.
- **No workflow graph** — conditional transitions beyond consult and discussion belong to the separate workflow adapter.
