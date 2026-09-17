# @clocky/clocky-team-placement-default

English | [中文](README.zh.md)

`ctx.teamPlacement.prepare(teamId)` starts explicitly routed active Agent participants for ready tasks before the DAG scheduler assigns leases. Calls for the same Team coalesce; the activation controller owns participant/session uniqueness and durable publication. Cancelled or deleted work cannot retain an otherwise unused activation published during its startup.

`ctx.teamPlacement.prepareRoles(teamId, roles)` prepares authorized workflow roles before any task is ready. Every role must identify one active member; agent roles without a resident epoch require one configured route. The complete batch is validated against `maxActivationsPerDrive` before startup. Stopping or unquiesced epochs reject with `TEAM_ACTIVATION_RECOVERY_CONFLICT`; placement never treats disconnection as termination. Recovered roles reuse their Session, and task workspace eligibility remains mandatory at assignment.

## Configuration

`routes` contains complete runtime provider, roles, preset, `modelProvider`, `modelId`, `model` (`provider/model`), `cwd` and `maxTokens` choices. A participant must declare the matching provider, preset and model. Missing or ambiguous routes never fall back to ambient Agent defaults. An empty route list leaves provisioning to other explicit owners. `maxActivationsPerDrive` and `maxCursorRetries` bound each preparation.

Task `placement` restricts participant ids, roles, providers, presets and models. Omitted sets add no restriction; empty sets admit no candidate. Child-Team tasks are delegated to `team-delegation` and never start a Participant activation. When a workspace registry is mounted, an optional provider preflight can reject an incompatible route before activation; placement still checks the returned activation against the provider's eligibility predicate and releases it immediately when the route cannot execute the task. The Hub checks the actual activation selection during assignment, and replay rejects a changed task restriction or mismatched attempt. Unsettled old epochs are left to activation recovery, never silently replaced by a new Session. Admitted activations remain owned through workspace eligibility checks. If rejection cleanup fails, placement unload retries termination and awaits controller-confirmed quiescence. Concurrent `close()` calls share cleanup; after failure, a later call retries only unsettled leases while new preparation remains closed.

## Model Experience

### Task-driven activation

#### What the model sees

This Consumer emits no model input. `ctx.teamPlacement.prepare(teamId)` only starts explicitly routed activations; the existing task-assignment delivery Consumer owns the durable task input after assignment.

#### Token effect

No direct model tokens are consumed by placement.

#### KV Cache effect

Placement does not rewrite a Session transcript or request prefix.

## Known Limitations and Deferred Work

- Placement uses explicitly configured active participant descriptors. Template creation and membership provisioning belong to their product owners.
- Activation recovery owns fencing of an unquiesced prior epoch. A missing route or pending fence cannot grant execution authority.
