# Team Artifact

[English](team-artifact.md) | 中文

`@clocky/clocky-team-artifact` 定义 `ctx.teamArtifacts`，用于 Team 产出的 file、patch、log、screenshot 和 report 的 provider registry。Team Hub 只会在 task result 中保存 `TeamArtifactReference`；选定的 artifact provider 负责 bytes、有界 collection 与读取校验，而 Team-aware Consumer 负责 reachability 与 grace policy。

## 所有权

registry 拥有 effect-scoped provider name 与 dispatch。provider 负责校验大小和 provenance、保存 bytes、返回 content reference，并在读取时验证 content hash。artifact reference 本身不授予访问权；API 与 UI Consumer 仍需在调用 `read()` 前执行 Team visibility 和 authorization。

[`team-artifact-local`](../../packages/team/team-artifact-local/README.zh.md) provider 会在 owner-only root 下保存 SHA-256 寻址的 regular file，并在每个 provider-backed reference 中返回命名的 provider。它使用 exclusive creation，仅在 bytes 匹配时复用对象，拒绝 symlink 和 path escape，并可选地挂载 Team-aware retention owner，在 grace 之后追踪未归档 task result 并驱动有界 provider collection。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [TeamArtifactReference](team.zh.md)

Source: [`packages/core/team-artifact/src/index.ts`](../../packages/core/team-artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->
