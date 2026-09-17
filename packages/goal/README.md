# goal/ — persisted same-session goals

English | [中文](README.zh.md)

Durable objective state for an agent session, owned independently of the model-facing tools and continuation policy that consume it. Goal state is part of the owning session log; consumers depend on `clocky-compat-goal`, never on the concrete agent loop.

| Package | Role | ctx key |
|---|---|---|
| [`goal/`](../compat/goal/README.md) | Goal state and lifecycle | `ctx.goals` |
| [`goal-round-driver/`](../compat/goal-round-driver/README.md) | Same-session goal continuation | — |
| [`tool-goal/`](../compat/tool-goal/README.md) | Model-facing goal tools | — |
| [`command-goal/`](../compat/command-goal/README.md) | Human-facing goal command | — |

The subsystem reference — goal identity, lifecycle snapshots, activation, change records — is [docs/subsystems/goal.md](../../docs/subsystems/goal.md).
