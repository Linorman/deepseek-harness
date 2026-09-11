# Team Workspace

English | [中文](team-workspace.zh.md)

`@clocky/clocky-team-workspace` defines `ctx.teamWorkspaces`, the registry for providers that resolve a Team task's immutable workspace mode to an execution root. The registry selects a provider by mode and delegates eligibility or allocation without changing Team task state.

## Ownership

The registry owns effect-scoped provider names, exclusive workspace-mode registration, and rejection plus release of a result whose mode or task-attempt identity differs from the allocation request. Providers own their own eligibility rules, current lease revalidation, allocation resources, and release behavior. The Team provider remains the authority for task attempts, activation bindings, and `workspace-allocate` policy; schedulers may ask eligibility but do not allocate roots.

[`clocky-team-workspace-shared`](../../packages/team/team-workspace-shared/README.md) is the `shared` provider. It accepts only an exact live local Agent Session whose `cwd` already equals its configured canonical root, and it returns a logical allocation without claiming a filesystem lock or isolated checkout.

[`clocky-team-workspace-worktree`](../../packages/team/team-workspace-worktree/README.md) is the `worktree` provider. It validates explicit canonical Git roots and a resolved base commit at mount, then creates one hash-derived detached checkout only for an exact current local-Agent lease after `workspace-allocate` policy permits it. The Team Agent Client publishes the returned root on the task Agent scope so shell and discovery tools execute in that provider-owned root. Normal Git removal is retryable and never forces a dirty checkout away; `publish()` reports changed paths and bounded file/patch references, while the opt-in `integrate()` and `integrateSource()` authorities create isolated source state, perform conflict-aware detached merges, and update an unoccupied target ref with compare-and-set.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [TeamTaskWorkspaceMode](team.md)

Source: [`packages/core/team-workspace/src/index.ts`](../../packages/core/team-workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
