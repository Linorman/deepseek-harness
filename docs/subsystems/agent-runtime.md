# Agent runtime

English | [中文](agent-runtime.zh.md)

`@clocky/clocky-agent-runtime` defines the reusable activation registry at `ctx.agentRuntimes`. A Team/Host resolves stable Participant identity, Session identity, seed mode, and Agent composition before calling it; a registered placement provider owns only the resulting live activation epoch.

## Ownership

`AgentRuntimeActivationRequest` carries a Team, complete Participant snapshot, reserved Session id, fresh/fork/resume seed mode, Agent options, an optional local execution root, and cancellation signal. A fork seed includes the source Session id and copied event prefix. `ActivationHandle` exposes its immutable `ActivationSnapshot`, optional exact local Agent, asynchronous health projection, later-status subscription, interruption, and quiescent disposal. Its returned Team and Participant ids must equal the request; the registry disposes a mismatched handle before rejection and publishes `agent-runtime/activation-changed` for initial and later valid status snapshots.

Provider registration is effect-scoped. Removing a provider prevents new activation through that name but does not revoke an accepted handle. [`clocky-agent-runtime-in-process`](../../packages/agent-runtime/agent-runtime-in-process/README.md) provides fresh/fork/resume local placement: it writes paired opaque Team/Participant Session provenance before fresh or fork publication, preserves fork lineage, and verifies the pair on resume. [`clocky-agent-runtime-sdk`](../../packages/agent-runtime/agent-runtime-sdk/README.md) provides active `remote-agent` fresh/resume lifecycle placement through the SDK lifecycle/status protocol and can enroll an activation-local fixed Link after durable bind; its handles expose no local `Agent`. [`clocky-team-activation-controller`](../../packages/team/team-activation-controller/README.md) is the Consumer that binds a returned `ActivationHandle` from any registered provider to the Team journal, mirrors health, and releases it on binding failure. The registry does not infer parent Session authority, admit Envelopes, deliver model context, schedule work, or own a concrete Agent loop; remote task reports/final output are admitted by Team Link consumers, while complete multi-host Hub restart recovery remains separate.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxactivationsupervisors--activationsupervisors"></a>

### `ctx.activationSupervisors` — `ActivationSupervisors`

Resolver of named and versioned execution health/fence providers.

```ts cordis-catalog
/** Register a provider until its owning effect retires.
 * @param provider - exact implementation and execution owner.
 * @returns idempotent registration disposer; admitted operations continue.
 */
registerProvider(provider: ActivationSupervisorProvider): () => void

/** Resolve and validate one exact durable descriptor without side effects.
 * @param binding - Team-owned epoch and recovery descriptor.
 * @returns retained provider for one admitted operation.
 */
resolve(binding: ActivationBindingSnapshot): ActivationSupervisorProvider

/** Persist an epoch produced by a trusted runtime on this execution host.
 * @param input - provider-minted process facts before activation publication.
 * @returns resolution after the selected execution owner durably accepts that epoch.
 */
async admitOwned(input: ActivationBindingSnapshot): Promise<void>

/** Observe an exact generation through its retained provider.
 * @param binding - immutable durable execution identity.
 * @param signal - observation cancellation.
 * @returns validated health; unreachable and unknown never become terminated.
 */
async health(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation>

/** Fence an exact generation through its retained provider.
 * @param binding - immutable durable execution identity.
 * @param signal - request cancellation.
 * @returns exact terminated observation; all other states reject.
 */
async fence(binding: ActivationBindingSnapshot, signal: AbortSignal): Promise<ActivationSupervisorObservation>
```

Types: [ActivationBindingSnapshot](team.md)

Source: [`packages/core/activation-supervisor/src/index.ts`](../../packages/core/activation-supervisor/src/index.ts)

<a id="ctxagentruntimes--agentruntime"></a>

### `ctx.agentRuntimes` — `AgentRuntime`

Named activation-provider registry at `ctx.agentRuntimes`. It owns provider registration and post-publication observation; a provider owns every live activation handle it returns.

```ts cordis-catalog
/**
 * Register one named activation provider. Registration is effect-scoped and
 * its disposer removes only this provider instance.
 * @param provider - placement implementation for future activation requests.
 * @returns HMR-safe disposer for this registration.
 */
registerProvider(provider: AgentRuntimeProvider): () => void

/**
 * Resolve one registered activation provider.
 * @param name - provider registry name.
 * @returns the live provider, or `undefined` when no matching provider remains.
 */
getProvider(name: string): AgentRuntimeProvider | undefined

/**
 * Register one trusted stale-epoch fencer. A fencer never starts an
 * activation; it only establishes the precondition for a cold replacement.
 * @param fencer - external owner for one runtime-provider epoch family.
 * @returns HMR-safe disposer for this fencer registration.
 */
registerFencer(fencer: AgentRuntimeFencer): () => void

/**
 * Resolve the current trusted fencer for one runtime provider.
 * @param provider - placement-provider name retained in a durable binding.
 * @returns the fencer, or `undefined` when no external owner can prove termination.
 */
getFencer(provider: string): AgentRuntimeFencer | undefined

/**
 * List registered provider identities in registration order.
 * @returns detached provider references.
 */
listProviders(): AgentRuntimeProviderRef[]

/**
 * Resolve a provider, require its returned activation to match the requested
 * Team/Participant/Session binding, then publish its first observation. A
 * handle that fails post-return validation is disposed before rejection.
 * @param request - provider name and already-resolved activation inputs.
 * @returns the provider-owned published activation handle.
 */
async activate(request: AgentRuntimeActivationRequest): Promise<ActivationHandle>
```

Source: [`packages/core/agent-runtime/src/index.ts`](../../packages/core/agent-runtime/src/index.ts)

<a id="agent-runtime-events"></a>

### `agent-runtime/*` events

<a id="agent-runtimeactivation-changed--emit"></a>

#### `agent-runtime/activation-changed` — emit

A provider published one Participant activation handle or observed a later status change for that exact epoch. Listener failure cannot revoke the accepted handle.

```ts cordis-catalog
/**
 * A provider published one Participant activation handle or observed a
 * later status change for that exact epoch.
 * Listener failure cannot revoke the accepted handle.
 * @param activation - immutable activation projection.
 * @mode emit
 */
'agent-runtime/activation-changed'(this: AgentRuntime, activation: ActivationSnapshot): void
```

Types: [ActivationSnapshot](team.md)

Source: [`packages/core/agent-runtime/src/index.ts`](../../packages/core/agent-runtime/src/index.ts)

<a id="agent-runtimeprovider-added--emit"></a>

#### `agent-runtime/provider-added` — emit

An activation provider became available for new Participant activations.

```ts cordis-catalog
/**
 * An activation provider became available for new Participant activations.
 * @param provider - registered provider identity.
 * @mode emit
 */
'agent-runtime/provider-added'(this: AgentRuntime, provider: AgentRuntimeProviderRef): void
```

Source: [`packages/core/agent-runtime/src/index.ts`](../../packages/core/agent-runtime/src/index.ts)

<a id="agent-runtimeprovider-removed--emit"></a>

#### `agent-runtime/provider-removed` — emit

An activation provider stopped accepting new activations. Existing handles remain owned by the caller that received them.

```ts cordis-catalog
/**
 * An activation provider stopped accepting new activations. Existing handles
 * remain owned by the caller that received them.
 * @param provider - removed provider identity.
 * @mode emit
 */
'agent-runtime/provider-removed'(this: AgentRuntime, provider: AgentRuntimeProviderRef): void
```

Source: [`packages/core/agent-runtime/src/index.ts`](../../packages/core/agent-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
