# @clocky/clocky-agent-default-model

English | [中文](README.zh.md)

The deployment default used when a trusted owner activates an Agent without an explicit model selection. `AgentDefaultModelConfig` provides `ctx.agentDefaultModel`; [`TeamRun`](../../team/team-run/README.md) reads it as the coordinator fallback, and custom/internal Agent owners use the same service instead of owning parallel provider/model defaults.

The plugin config accepts an optional `{ provider, model }`. An empty composition and an incomplete settings section produce no default; a mounted settings provider layers a complete user's choice over the composition entry and changes are visible on the next `currentSelection()` read. `reasoningEffort` belongs to the Settings section but deliberately not to plugin config: a complete saved selection can clear an effort when the next selected model has none, while a composition value would be inherited again.

- `ctx.agentDefaultModel.currentSelection()` returns a detached `{ provider, model, reasoningEffort? }` selection for an Agent activation without an explicit selection, or `undefined` when no complete selection exists.
- `ctx.agentDefaultModel.saveSelection(selection)` saves the complete user selection. Without a settings provider it is a no-op and the composition entry remains current.

The service does not validate catalog membership. A provider route may serve an unadvertised model, and the consumer that actually opens a model request owns availability diagnostics.

## Model Experience

Indirectly, through the provider/model selection that TeamRun or a custom/internal Agent owner supplies; request assembly and adapters own the model-visible request.

#### KV Cache effect

Changing the default affects only Agent activations that subsequently resolve from it. An existing participant Session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

- The service owns one process-wide optional default; per-activation selection remains the Team or custom/internal owner’s responsibility.
- Without a settings provider, `saveSelection()` cannot retain a selection for a later Agent.
