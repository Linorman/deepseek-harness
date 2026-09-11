# Team Workspace

[English](team-workspace.md) | 中文

`@clocky/clocky-team-workspace`定义 `ctx.teamWorkspaces`，即把 Team task 的不可变 workspace mode 解析为 execution root 的 provider 注册表。注册表按 mode 选择 provider，并委托 eligibility 或 allocation，而不改变 Team task state。

## 所有权

注册表拥有 effect-scoped provider 名称、互斥 workspace-mode 注册，以及对 mode 或 task-attempt identity 与 allocation request 不符的结果进行拒绝和 release。provider 拥有自身的 eligibility rule、current lease revalidation、allocation resource 和 release behavior。Team provider 仍是 task attempt、activation binding 和 `workspace-allocate` policy 的 authority；scheduler 可以询问 eligibility，但不分配 root。

[`clocky-team-workspace-shared`](../../packages/team/team-workspace-shared/README.zh.md)是 `shared` provider。它只接受其 `cwd` 已经等于配置 canonical root 的确切 live 本地 Agent Session，并返回 logical allocation，而不声称 filesystem lock 或 isolated checkout。

[`clocky-team-workspace-worktree`](../../packages/team/team-workspace-worktree/README.zh.md)是 `worktree` provider。它在挂载时验证显式 canonical Git root 和已解析 base commit，随后只在准确 current local-Agent lease 获得 `workspace-allocate` policy 允许后，创建一个 hash-derived detached checkout。Team Agent Client 会把返回的 root 发布到 task Agent scope，使 shell 和 discovery tool 在该 provider-owned root 中执行。普通 Git removal 可重试，且绝不强制移除 dirty checkout；`publish()`会报告 changed path 和有界 file／patch reference，而 opt-in `integrate()` 与 `integrateSource()` authority 会创建隔离 source state、执行可检测冲突的 detached merge，并用 compare-and-set 更新未被占用的 target ref。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamworkspaces--teamworkspaceregistry"></a>

### `ctx.teamWorkspaces` — `TeamWorkspaceRegistry`

Named Team execution-root registry. Providers retain all allocation ownership.

```ts cordis-catalog
/**
 * Register one provider for one or more exact workspace modes. Registration
 * is effect-scoped; disposing it removes only this provider instance.
 * @param provider - local, worktree, sandbox, or remote execution-root provider.
 * @returns HMR-safe disposer for this registration.
 */
registerProvider(provider: TeamWorkspaceProvider): () => void

/**
 * Register one current delivery owner's exact task-allocation publisher without exposing live handles.
 * @param owner - Same-process Agent object used by the actual tool execution.
 * @param publisher - Owner that verifies Session claim, running lease and allocation identity.
 * @returns Effect-owned disposer for the exact registration.
 */
registerAllocationPublisher(owner: object, publisher: TeamWorkspaceAllocationPublisher): () => void

/**
 * Publish through the actual allocation owner before a task outcome may settle.
 * @param owner - Exact current Agent object, never an id or ambient context slot.
 * @param request - Authoritative retained allocation and active tool cancellation.
 * @returns The provider result; undefined only when a valid owner's provider does not support publication.
 */
async publishForOwner(owner: object, request: TeamWorkspaceOwnerPublicationRequest): Promise<TeamWorkspacePublishResult | undefined>

/**
 * Resolve one provider by its registered name.
 * @param name - provider registry name.
 * @returns the live provider, or `undefined` when no matching provider remains.
 */
getProvider(name: string): TeamWorkspaceProvider | undefined

/**
 * List provider identities in registration order.
 * @returns detached provider references.
 */
listProviders(): TeamWorkspaceProviderRef[]

/**
 * Resolve the sole live provider for one workspace mode.
 * @param mode - task workspace mode selected by an immutable task snapshot.
 * @returns the provider registered for the exact mode.
 * @throws {@link TeamWorkspaceError} when no provider currently owns the mode.
 */
resolve(mode: TeamTaskWorkspaceMode): TeamWorkspaceProvider

/**
 * Delegate a scheduler eligibility check to the exact selected mode provider.
 * @param mode - immutable workspace mode selected by the task.
 * @param request - current task and activation binding proposed by the scheduler.
 * @returns whether the provider can execute this task binding without allocation.
 */
async eligible(mode: TeamTaskWorkspaceMode, request: TeamWorkspaceEligibilityRequest): Promise<boolean>

/**
 * Check provider-owned route compatibility before a Participant activation exists.
 * @param mode - task workspace mode selecting the provider.
 * @param request - task, Participant, and candidate runtime route.
 * @returns the provider's compatibility result, or `true` when it exposes no preflight.
 */
async preflight(mode: TeamTaskWorkspaceMode, request: TeamWorkspacePreflightRequest): Promise<boolean>

/**
 * Reserve provider-owned metadata before a Team command durably binds it.
 * @param mode - immutable workspace mode selected by the task.
 * @param request - exact lease and activation facts the provider must revalidate.
 * @returns a root-less provider reservation.
 */
async prepare( mode: TeamTaskWorkspaceMode, request: TeamWorkspacePrepareRequest, ): Promise<TeamWorkspacePreparation>

/**
 * Materialize one metadata reservation only after its Team owner accepted it.
 * @param mode - immutable workspace mode selected by the task.
 * @param request - exact lease and activation facts captured by the reservation.
 * @param preparation - root-less provider reservation returned by {@link prepare}.
 * @returns the provider-owned live execution-root allocation.
 */
async materialize( mode: TeamTaskWorkspaceMode, request: TeamWorkspacePrepareRequest, preparation: TeamWorkspacePreparation, ): Promise<TeamWorkspaceAllocation>

/**
 * Reopen one exact durable provider allocation during local recovery.
 * @param mode - immutable workspace mode selected by the task.
 * @param request - exact current lease and activation facts.
 * @param metadata - Team-retained provider metadata without a root.
 * @returns the provider-owned live execution-root allocation.
 */
async restore( mode: TeamTaskWorkspaceMode, request: TeamWorkspacePrepareRequest, metadata: TeamWorkspaceAllocationMetadata, ): Promise<TeamWorkspaceAllocation>

/**
 * Ask the metadata-owning provider to prove physical cleanup without
 * materializing a root that a prior process already released.
 * @param mode - immutable workspace mode selected by the task.
 * @param request - exact task-attempt ownership retained by the allocation.
 * @param metadata - Team-retained provider metadata without a root.
 * @returns resolution after provider cleanup is proven or completed.
 */
async reconcileRelease( mode: TeamTaskWorkspaceMode, request: TeamWorkspacePrepareRequest, metadata: TeamWorkspaceAllocationMetadata, ): Promise<void>

/**
 * Delegate an explicit publish/integrate operation to the selected provider.
 * @param mode - task workspace mode selecting the provider.
 * @param request - exact allocation and optional integration target.
 * @returns provider-owned publish provenance.
 */
async publish( mode: TeamTaskWorkspaceMode, request: TeamWorkspacePublishRequest, ): Promise<TeamWorkspacePublishResult>

/**
 * Delegate an explicit proposal or integration operation to the selected provider.
 * @param mode - workspace mode selecting the provider.
 * @param request - exact allocation, target, and operation mode.
 * @returns provider-owned integration provenance.
 */
async integrate( mode: TeamTaskWorkspaceMode, request: TeamWorkspaceIntegrateRequest, ): Promise<TeamWorkspaceIntegrateResult>

/**
 * Delegate an integration sourced from a durable artifact manifest.
 * @param providerName - exact provider identity selected by the integration task.
 * @param request - source provenance, integration attempt, target, and operation mode.
 * @returns provider-owned integration provenance with every source identity preserved.
 */
async integrateSource( providerName: string, request: TeamWorkspaceSourceIntegrateRequest, ): Promise<TeamWorkspaceSourceIntegrateResult>
```

Types: [TeamTaskWorkspaceMode](team.zh.md)

Source: [`packages/core/team-workspace/src/index.ts`](../../packages/core/team-workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
