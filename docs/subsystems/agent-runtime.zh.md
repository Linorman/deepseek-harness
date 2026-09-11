# Agent runtime

[English](agent-runtime.md) | 中文

`@clocky/clocky-agent-runtime`定义了位于 `ctx.agentRuntimes` 的可复用 activation 注册表。Team／Host 会在调用前解析稳定 Participant 身份、Session 身份、seed 模式和 Agent 组合；已注册的 placement provider 只拥有由此得到的活动 activation epoch。

## 所有权

`AgentRuntimeActivationRequest`携带 Team、完整 Participant 快照、已保留的 Session id、fresh/fork/resume seed 模式、Agent 选项、可选本地 execution root 和取消信号。fork seed 包含源 Session id 和复制事件前缀。`ActivationHandle`公开其不可变 `ActivationSnapshot`、可选的精确本地 Agent、异步 health projection、之后的 status 订阅、中断和静默释放。其返回的 Team 与 Participant id 必须等于请求；注册表会在拒绝前释放不匹配的 handle，并为初始与之后有效的 status snapshot 发布 `agent-runtime/activation-changed`。

provider 注册由 effect 约束。移除 provider 会阻止通过该名称进行的新 activation，但不会撤销已接收的句柄。[`clocky-agent-runtime-in-process`](../../packages/agent-runtime/agent-runtime-in-process/README.zh.md)提供 fresh/fork/resume 本地 placement：它会在 fresh 或 fork 发布前写入成对 opaque Team／Participant Session provenance、保留 fork 谱系，并在 resume 时验证该对。[`clocky-agent-runtime-sdk`](../../packages/agent-runtime/agent-runtime-sdk/README.zh.md)通过 SDK 生命周期／状态协议，为活跃的 `remote-agent` Participant 提供 fresh/resume 生命周期 placement，并可在持久 bind 后 enroll activation-local 固定 Link；其 handle 不公开本地 `Agent`。[`clocky-team-activation-controller`](../../packages/team/team-activation-controller/README.zh.md)是 Consumer：它把任意已注册 provider 返回的 `ActivationHandle`绑定到 Team journal、镜像 health，并在 binding 失败时释放 handle。注册表不推断父 Session 权限、不接收 Envelope、不投递模型上下文、不调度工作，也不拥有具体 Agent loop；远程 task report/final output 由 Team Link consumer 接纳，完整多主机 Hub 进程重启恢复仍是独立工作。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [ActivationBindingSnapshot](team.zh.md)

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

Types: [ActivationSnapshot](team.zh.md)

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
