# @clocky/clocky-activation-supervisor

English | [中文](README.zh.md)

`ctx.activationSupervisors` resolves exact named/versioned execution owners. Health distinguishes `reachable`, `unreachable`, `terminated`, and `unknown`; fencing accepts only a matching descriptor with `terminated`. Descriptor generation is the durable ActivationId. Registration retirement blocks future admission while an accepted operation retains its provider.

`admitOwned()` is a trusted execution-host operation used before SDK activation publication. A remote client cannot enroll process ownership. The HTTP provider persists enrollment before exposing health or fencing. The activation controller consumes supervisor results through this registry and keeps unknown execution durably stalled.

## Model Experience

### Execution supervision

#### What the model sees

No prompt or tool is registered. `Team lifecycle` diagnostics describe unavailable execution evidence.

#### Token effect

No direct model-context tokens.

#### KV Cache effect

No request-prefix changes.

## Known Limitations and Deferred Work

- **Scope** — The registry proves only what the selected execution owner establishes.
- **Deferred ownership** — It does not supply cross-host placement, credentials, sandbox restoration, or automatic recovery of stalled Teams.
