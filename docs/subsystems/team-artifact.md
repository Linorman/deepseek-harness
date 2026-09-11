# Team Artifacts

English | [中文](team-artifact.zh.md)

`@clocky/clocky-team-artifact` defines `ctx.teamArtifacts`, the provider registry for Team-produced files, patches, logs, screenshots, and reports. The Team Hub stores only a `TeamArtifactReference` in a task result; the selected artifact provider owns bytes, bounded collection, and read verification, while a Team-aware Consumer owns reachability and grace policy.

## Ownership

The registry owns effect-scoped provider names and dispatch. A provider validates size and provenance, persists bytes, returns a content reference, and verifies the content hash on reads. Artifact references do not grant access by themselves: API and UI Consumers still apply Team visibility and authorization before calling `read()`.

The local provider [`team-artifact-local`](../../packages/team/team-artifact-local/README.md) stores SHA-256-addressed regular files below an owner-only root. It returns the named provider with each provider-backed reference, uses exclusive creation, reuses an object only when bytes match, rejects symlinks and path escapes, and optionally mounts a Team-aware retention owner that traces non-archived task results and drives bounded provider collection after grace.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamartifacts--teamartifactstore"></a>

### `ctx.teamArtifacts` — `TeamArtifactStore`

Named artifact-provider registry at `ctx.teamArtifacts`.

```ts cordis-catalog
/**
 * Register one artifact provider under a unique name.
 * @param provider - provider that persists and verifies artifact bytes.
 * @returns an effect-scoped disposer.
 */
registerProvider(provider: TeamArtifactProvider): () => void

/**
 * Resolve one provider by name.
 * @param name - provider identity.
 * @returns provider or undefined.
 */
getProvider(name: string): TeamArtifactProvider | undefined

/**
 * List registered provider identities.
 * @returns detached provider refs.
 */
listProviders(): TeamArtifactProviderRef[]

/**
 * Save through one named provider.
 * @param provider - provider name.
 * @param request - write facts.
 * @returns immutable reference.
 */
async save(provider: string, request: TeamArtifactWriteRequest): Promise<TeamArtifactReference>

/**
 * Read through one named provider.
 * @param provider - provider name.
 * @param request - read facts.
 * @returns verified bytes.
 */
async read(provider: string, request: TeamArtifactReadRequest): Promise<Uint8Array>

/**
 * Delete through one named provider.
 * @param provider - provider name.
 * @param request - delete facts.
 * @returns completion after deletion.
 */
async delete(provider: string, request: TeamArtifactDeleteRequest): Promise<void>

/**
 * Sweep one bounded provider page after a reachability owner has approved
 * exact object ids for reclamation.
 * @param provider - provider name.
 * @param request - current references, approved ids, cursor, and page bound.
 * @returns provider-owned scan and cleanup observations.
 */
async collect(provider: string, request: TeamArtifactCollectRequest): Promise<TeamArtifactCollectResult>
```

Types: [TeamArtifactReference](team.md)

Source: [`packages/core/team-artifact/src/index.ts`](../../packages/core/team-artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->
