# @clocky/clocky-team-channel-workflow

English | [中文](README.zh.md)

`@clocky/clocky-team-channel-workflow` registers a version-one declarative `workflow` channel adapter on `ctx.teams`. Its manifest freezes a JSON `TransitionGraph` with an initial target, ordered conditions, optional default target, and a required `maxTurns` bound. Targets select a participant, `round-robin`, `stay`, `return-to-initiator`, or `terminate`.

The package also mounts `ctx.workflowExtensions`, an effect-scoped registry for deployment-defined versioned condition and target implementations. Existing channels retain their adapter/graph identities during HMR; removing an extension blocks only future graph admission.

The adapter validates every participant target before opening a channel, evaluates conditions against the accepted Envelope, derives recipient intents, and closes atomically at a terminal target or turn bound. It never performs model or transport work.

## Model Experience

### Workflow channel protocol

#### What the model sees

This package owns no prompt or tool. A Team delivery Consumer turns accepted workflow `Envelope` values into logged model inputs.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model request prefix is owned by this package.

## Known Limitations and Deferred Work

- **No graph authoring UI** — callers provide the versioned JSON graph and must retain the exact manifest for replay.
- **No delivery execution** — Link and Agent Client Consumers own inbox admission, receipts, and model scheduling. The extension registry validates and versions graph implementations but does not run model turns.
