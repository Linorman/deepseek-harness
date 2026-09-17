# Team Link

[English](team-link.md) | 中文

`@clocky/clocky-team-link`定义 `ctx.teamLinks`，即 activation-bound 本地或远程 channel Link 的具名注册表。Link 是临时 transport client：它携带一个持久 activation binding、从该 binding 推导 channel 和 task-attempt owner fact、转发 channel post/claim/receipt、task-attempt start/settlement 以及 artifact-sourced integration operation、向 Consumer 通知已接收的 Envelope，并通过 `done`报告 terminal lifecycle state。其 activation id、Team、Participant、Session 和 placement provider 标识连接；可变 residency status 不标识连接。

## 所有权

注册表拥有 effect-scoped provider 注册，并验证已连接 Link 返回请求的 provider 名称和 activation binding identity。它会在拒绝连接前关闭不匹配的 Link。Link post 包含 sender-scoped 不透明 idempotency key，因此同 key retry 可以在不重新打开观测 cursor 的情况下恢复一个 accepted Envelope。provider 拥有连接 lifecycle、replay、notification backpressure、terminal failure 和 notification-listener failure 的控制。Team Hub 仍是持久 journal、WAL、claim 和 receipt 的权威；Agent client 仍拥有本地 inbox、source flush 和模型唤醒。

[`clocky-team-link-local`](../../packages/team/team-link-local/README.zh.md)验证 live 本地 activation binding，通过可取消的 watch 重放 recipient pending-delivery 和 target-bound soft interrupt，并 retry 失败的本地 listener。[`clocky-team-link-websocket`](../../packages/team/team-link-websocket/README.zh.md)使用 capability 环境变量和严格的 v4 frame（包括 cooperative endpoint termination），将同一 binding 连接到配置的 `ws:`或 `wss:` endpoint。服务端 [`clocky-team-link-websocket-hub`](../../packages/team/team-link-websocket-hub/README.zh.md)将该 capability 映射到一个配置的 binding，重新校验其 active 持久 epoch，推导 operation authority，并从 Hub 重放 pending delivery 和 interrupt。两个 provider 都不插入 Agent inbox input；这仍由 Agent client 负责。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamlinks--teamlinkregistry"></a>

### `ctx.teamLinks` — `TeamLinkRegistry`

Named Team Link provider registry at `ctx.teamLinks`. A provider owns every published Link; the registry owns provider registration and connection-time provider/binding verification.

```ts cordis-catalog
/**
 * Register one named Team Link provider. Registration is effect-scoped and
 * its disposer removes only this provider instance.
 * @param provider - local or remote Link implementation for future connections.
 * @returns HMR-safe disposer for this registration.
 */
registerProvider(provider: TeamLinkProvider): () => void

/**
 * Resolve one registered Team Link provider.
 * @param name - provider registry name.
 * @returns the live provider, or `undefined` when no matching provider remains.
 */
getProvider(name: string): TeamLinkProvider | undefined

/**
 * List registered Team Link provider identities in registration order.
 * @returns detached provider references.
 */
listProviders(): TeamLinkProviderRef[]

/**
 * Register callback-only access to one owner's existing bound Link. The
 * caller retains Link lifetime and may remove this access at any time.
 * @param owner - exact same-process owner identity that may later borrow.
 * @param borrower - callback-only accessor for the owner's current Link.
 * @returns HMR-safe disposer for this owner registration.
 */
registerBoundLinkBorrower(owner: object, borrower: TeamLinkBoundLinkBorrower): () => void

/**
 * Resolve callback-only access to an owner's existing bound Link.
 * @param owner - exact owner identity that registered the Link accessor.
 * @returns the current borrower, or `undefined` when that owner has no live Link delivery.
 */
getBoundLinkBorrower(owner: object): TeamLinkBoundLinkBorrower | undefined

/**
 * Register one remote-Link enrollment provider. Registration is effect-scoped
 * and does not expose credentials to ordinary Link consumers.
 * @param provider - issuer for exact activation-bound remote credentials.
 * @returns HMR-safe disposer for this registration.
 */
registerEnrollmentProvider(provider: TeamLinkEnrollmentProvider): () => void

/**
 * Resolve one remote-Link enrollment provider.
 * @param name - provider registry name.
 * @returns the live credential issuer, or `undefined` when no matching provider remains.
 */
getEnrollmentProvider(name: string): TeamLinkEnrollmentProvider | undefined

/**
 * List registered remote-Link enrollment provider identities in registration order.
 * @returns detached provider references.
 */
listEnrollmentProviders(): TeamLinkEnrollmentProviderRef[]

/**
 * Reserve one short-lived credential for an exact active activation binding.
 * @param request - selected enrollment provider and durable binding.
 * @returns opaque credential material owned by the caller until it is revoked.
 */
async reserveEnrollment(request: TeamLinkEnrollmentRequest): Promise<TeamLinkEnrollment>

/**
 * Connect through one registered provider. A returned Link must retain the
 * selected provider name and exact durable activation binding; otherwise the
 * registry closes it before rejecting the connection.
 * @param request - provider name, exact durable activation binding, and optional cancellation signal.
 * @returns the provider-owned Link after connection-time verification.
 */
async connect(request: TeamLinkConnectRequest): Promise<TeamLink>
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)

<a id="team-link-events"></a>

### `team-link/*` events

<a id="team-linkenrollment-provider-added--emit"></a>

#### `team-link/enrollment-provider-added` — emit

An enrollment issuer became available for new remote Link credentials.

```ts cordis-catalog
/**
 * An enrollment issuer became available for new remote Link credentials.
 * @param provider - registered issuer identity.
 * @mode emit
 */
'team-link/enrollment-provider-added'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)

<a id="team-linkenrollment-provider-removed--emit"></a>

#### `team-link/enrollment-provider-removed` — emit

An enrollment issuer stopped accepting credentials. Existing credentials may no longer attach after the issuer's transport listener is replaced.

```ts cordis-catalog
/**
 * An enrollment issuer stopped accepting credentials. Existing credentials
 * may no longer attach after the issuer's transport listener is replaced.
 * @param provider - removed issuer identity.
 * @mode emit
 */
'team-link/enrollment-provider-removed'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)

<a id="team-linkprovider-added--emit"></a>

#### `team-link/provider-added` — emit

A provider became available, including replacement after configuration changes.

```ts cordis-catalog
/**
 * A provider became available, including replacement after configuration changes.
 * @param provider - named provider available for fresh connections.
 * @mode emit
 */
'team-link/provider-added'(this: TeamLinkRegistry, provider: TeamLinkProviderRef): void
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)
<!-- END GENERATED cordis-surface -->
