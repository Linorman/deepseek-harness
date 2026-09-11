# Agent Note: Generalize the agent harness by removing first-party product coupling

Status: proposed

English | [中文](2026-08-26-generalize-agent-harness.zh.md)

## Problem

The repository is architecturally capable of serving as a general agent harness, but its product identity, default composition, provider integrations, browser presentation, storage names, release system, SDKs, and documentation still encode one first-party product. The coupling is not confined to visible copy. It includes npm scopes and package prefixes, CLI and environment names, plugin manifest keys, browser globals, session-reference URIs, a SQLite application id, SDK wire identities, Python distributions and modules, build profiles, Git tags and refs, CSS design-token prefixes, request headers, default provider routes, official telemetry, brand assets, generated catalogs, tests, snapshots, and paired documentation.

At the time of the audit, excluding `vendor/`, build output, dependencies, and frozen archived Agent Notes, branded candidate patterns appeared in 3,784 of 5,527 files. `@deepseek-ai` alone appeared in 3,222 files, and the `dsh` abbreviation appeared in 3,507 files. The browser design layer carried 405 distinct `--dsw-*` or `--dsh-*` custom-property names across 150 files. These are discovery measurements rather than standing inventory; a text replacement still cannot distinguish product identity from the DeepSeek model provider, update binary assets, or decide which durable or wire identifiers must break.

Five packages are direct removal candidates: `packages/llm/llm-deepseek`, `packages/web/web-search-deepseek`, `packages/client/ui-brand-official`, `packages/skill/skill-badge`, and `packages/identity/anonymous-user-id`. Together they carry about 11,000 tracked text lines before their cross-repository consumers, generated references, fixtures, and snapshots. The direct model adapter also makes the generic SDK server and shipped compositions special-case one provider, while the Web settings package contains a dedicated DeepSeek onboarding step and direct-adapter editor.

The repository does not currently contain an official plugin marketplace. [`apps/cli/src/plugin.ts`](../../../../apps/cli/src/plugin.ts) forwards an explicit package, Git, file, or link specification to pnpm; [`ui-settings-plugin-inventory`](../../../../packages/client/ui-settings-plugin-inventory/README.md) reads the local Loader tree; and [`ui-settings-plugins`](../../../../packages/client/ui-settings-plugins/README.md) edits settings namespaces registered by mounted plugins. The only `marketplace` references disable Claude Code's own official marketplace autoinstall in product-integration tests. Deleting these local mechanisms would remove plugin functionality rather than an official store.

Absolute textual absence also conflicts with three records that are not active product branding. The MIT license requires preservation of the original copyright notice, DeepSeek must remain a named supported model provider, and frozen archived Agent Notes are immutable historical records under the current repository policy. This proposal therefore defines a narrow allowlist and an explicit archive exclusion instead of pretending that every occurrence of the word has the same meaning.

## Proposal

Adopt a provider-neutral product identity and remove every DeepSeek-specific product integration. DeepSeek remains supported only as the `deepseek` provider profile of the generic `llm-pi-ai` adapter. It is not the shipped default, does not own a dedicated onboarding panel, search API, model-settings family, request-identity header, telemetry path, or SDK fallback, and does not determine the product's name or visual design.

### Clocky replacement identities

The owner selected Clocky as the product name and approved Clocky-derived local technical identifiers. npm/PyPI publication ownership and the final public repository URL remain external release inputs; this checkout does not claim them.

| Surface | Current value | Required target |
|---|---|---|
| Human product name | `DeepSeek Harness` | `Clocky` |
| npm organization and package prefix | `@deepseek-ai/dsh-*` | `@clocky/clocky-*`; publication ownership remains a release input |
| CLI executable and root script | `dsh` | `clocky` |
| Environment and filesystem identity | `DSH_*`, `~/.dsh` | `CLOCKY_*`, `~/.clocky` |
| Plugin manifest namespace | `dsh.profile`, `dsh.bundle`, `dsh.client` | `clocky.profile`, `clocky.bundle`, `clocky.client` |
| Browser and protocol identity | `__DSH_BOOT__`, `dsh-session:`, `deepseek-harness-sdk-runtime` | `__CLOCKY_BOOT__`, `clocky-session:`, `clocky-sdk-runtime` |
| Python distributions, modules, and public classes | `deepseek-harness-*`, `deepseek_harness*`, `DeepSeekHarness*` | `clocky-*`, `clocky*`, `Clocky*`, with no aliases |
| Repository and release identity | DeepSeek GitHub URLs, `clocky-v*`, `build:official`, DSH refs and artifact names | owner-supplied repository URL; `clocky-v*`, `build:clocky`, and Clocky refs/artifacts |
| Persistent visual identity seats | Fish/whale marks, wordmarks, favicons, PWA icon, and remote badges | one robot SVG fallback family rendered until a deployment supplies its own brand |

Prefer semantic names over replacing one abbreviation with another. Generic concepts should use names such as `agent harness`, `profile bundle`, `client boot manifest`, `session reference`, and `release build`; only externally owned product identifiers need the selected product token.

### Define the permitted DeepSeek provider surface

The permitted set is limited to provider configuration and verification: provider id and display name `deepseek`/`DeepSeek`, DeepSeek model ids, `DEEPSEEK_API_KEY`, an optional provider endpoint such as `DEEPSEEK_BASE_URL`, pi-ai's `thinkingFormat: deepseek` and other provider wire values, provider documentation, and focused mock or real-API tests. The original copyright notice in [`LICENSE`](../../../../LICENSE) remains unless the copyright holder authorizes another legally valid notice.

The forbidden set includes `DeepSeek Harness`, `DSH`, `dsh` product/package prefixes, `@deepseek-ai`, `deepseek-harness`, `deepseek-official`, `x-deepseek-harness-*`, the DeepSeek whale and wordmark, DeepSeek-branded color or CSS-token names, DeepSeek community and telemetry endpoints, and any DeepSeek reference in generic fixtures or product copy. The new removal decision itself may quote forbidden identifiers to define and verify their absence.

The target is active tracked source and documentation plus newly built or packed artifacts. Frozen archived Agent Notes, Git history, already published registry versions, and external issue or discussion history are not rewritten by this proposal. Removing or deprecating external artifacts is a separate owner-operated release task, and the result must describe the archive exception instead of claiming literal absence from every historical file.

### Delete dedicated first-party integrations

Delete `packages/llm/llm-deepseek/`. Remove its direct HTTP/SSE translator, Files API client, upload index and quota cleanup, inline fallback, V4 catalog defaults, `deepseek-official` route, custom reasoning and continuation behavior, app/request identity headers, package tests, and key-gated e2e. Remove every dependency, config row, SDK fallback import, settings branch, generated-catalog entry, example, fixture, and snapshot that exists only for this package.

Delete `packages/web/web-search-deepseek/`. Remove the Anthropic-compatible DeepSeek Messages search call, `DEEPSEEK_SEARCH_BASE_URL`, `web/deepseek-search-llm-request`, the default `web_search` mount, the dedicated Web-search settings card and credential controller, and the assembled browser scenario. Keep the provider-neutral `ctx.web` capability, `tool-web`, HTTP fetch, Exa, and Perplexity packages as opt-in building blocks; ship no default outbound Web provider.

Delete `packages/client/ui-brand-official/`, `packages/skill/skill-badge/`, `BrandWordmark.tsx`, `FishLogo.tsx`, both branded favicon copies, the website wordmark, `BRAND_GUIDELINES.*`, badge assets and snapshots, community QR/image links, and official-brand rows in the base and Web bundles. Keep the generic browser brand slots so a deployment plugin can supply its own mark and name. Every persistent image seat receives the rendered robot fallback defined below; no image seat falls back to blank content, a broken URL, or text alone.

Delete the DeepSeek-specific onboarding and product notice from `ui-settings-models`: `DeepSeekOnboardingDialog`, `WelcomeNotice`, their copy and presentation files, the `deepseek-official` readiness projection, and the direct-adapter branch of `ProviderEditor`. Retain the generic Models section and pi-ai provider editor. A provider-neutral empty state may link to Models when no usable route and default selection exist; it must not choose a vendor.

Delete `packages/identity/anonymous-user-id/` after removing its three consumers. The DeepSeek adapter no longer sends `x-deepseek-harness-user-id`, `x-deepseek-harness-session-id`, or `x-deepseek-harness-compact`; `/feedback` no longer creates or displays a cross-service anonymous id; and generic OpenTelemetry exports carry no repository-created `user.id`. Existing `.anonymous-user-id` and direct-adapter upload-index files become inert user data and are not deleted automatically.

Remove the shipped collector `https://harness-telemetry.deepseeksvc.com/v1/logs` and the feedback-gated official upload path. Keep the generic OpenTelemetry backend only as an optional deployment plugin with an explicitly configured endpoint and no first-party destination. Keep local command feedback and per-message feedback storage independent of remote export.

### Replace every persistent visual identity seat with rendered robot artwork

Deleting brand art must not leave an empty slot, broken image, transparent pixel, or text-only substitute in a location designed for imagery. Add one robot SVG fallback family owned by the client primitive layer: a square `BrandPlaceholderMark`, a horizontal `BrandPlaceholderWordmark`, and a compact `BrandPlaceholderBadge`. The geometry must be visibly non-empty, use stable view boxes, work in light and dark themes, preserve the host-provided size and class, and avoid DeepSeek geometry, letterforms, names, and brand-specific palette tokens. Static Web and documentation-site copies derive from the same reviewed geometry rather than drifting independently.

| Persistent seat | Current source | Required replacement | Observable proof |
|---|---|---|---|
| Expanded sidebar mark | `SidebarRoot.tsx`, `sidebar.brand.mark`, 24 px | `BrandPlaceholderMark` at the same 24 px seat | visible in the expanded real Web shell |
| Collapsed sidebar rail mark | `SidebarRoot.tsx`, `sidebar.brand.mark`, 24 px | the same mark, visible at rest while the existing panel icon still owns hover | visible before hover in the collapsed real Web shell |
| Expanded sidebar name art | `SidebarRoot.tsx`, `sidebar.brand.name`, 24 px high | `BrandPlaceholderWordmark`, with build revision remaining separate | non-zero width and height without clipping |
| Empty-conversation hero mark | `EmptyHero.tsx`, `conversation.hero.brand.mark`, 34 px | `BrandPlaceholderMark` at 34 px; rename fish-specific CSS and remove fish animation | visible beside the hero headline |
| Browser tab and installed Web app | `apps/web/public/favicon.svg` and `manifest.webmanifest` | local square robot SVG used by both favicon and PWA icon | asset decodes, manifest resolves it, light/dark screenshots show it |
| Documentation navigation title | `website/public/wordmark.svg` and VitePress `siteTitle` | local horizontal robot wordmark SVG | visible in both documentation locales and themes |
| Documentation favicon | `website/public/favicon.svg` | local square robot SVG | documentation build serves a decodable non-empty image |
| Tutorial and attribution badge seats | remote Shields badges in `docs/cordis-tutorial/*.md` and packaged badge references | local `BrandPlaceholderBadge` rendered at the existing 121 × 20 seat | every projected page loads the local image with no network dependency |

The three browser brand slots remain replaceable. When no deployment occupant is registered, their fallback always renders the robot artwork; when an occupant is registered, it replaces exactly that fallback without changing sidebar or hero geometry. Decorative marks remain `aria-hidden` only when adjacent accessible text already names the product; a meaningful standalone robot mark has an explicit accessible name.

Remove an obsolete content block together with its layout when its action no longer exists. The DeepSeek community QR table, survey link, and deleted badge-skill catalog entry therefore receive no fake QR code or dead card: a robot fallback there would imply a usable destination. Persistent brand/image seats stay and render robot artwork; retired features and links disappear as complete units.

Component tests assert that every fallback produces SVG geometry and honors requested dimensions. Real-browser acceptance covers expanded sidebar, collapsed rail, empty hero, Web favicon/PWA, and both documentation themes; it checks computed visibility and non-zero bounding boxes or decoded image dimensions, and records screenshots or the repository-required GUI demonstration so an ARIA-only snapshot cannot miss invisible artwork.

### Preserve DeepSeek through the generic provider path

`llm-pi-ai` already declares a `deepseek` provider profile, discovers its catalog, resolves `DEEPSEEK_API_KEY` through the shared credentials capability, accepts endpoint and model overrides, projects images through the provider-neutral attachment path, and has mock coverage for dynamic DeepSeek configuration. The provider guide will document a focused DeepSeek profile beside other providers, and a key-gated real-API smoke will prove streaming, tool follow-up, reasoning, and any retained image capability through this path.

The removal knowingly gives up the direct adapter's Files API lifecycle, 1,000,000-token and V4 model defaults, arbitrary unlisted-model pass-through, direct `stop` support, provider-specific reasoning serialization and passback, custom stale-file recovery, and its independent design-verification twin. A pi-ai capability is advertised only when its catalog/configuration and tests prove it. Reintroducing a dedicated DeepSeek adapter requires a new provider-only proposal and must not restore product branding, defaults, official panels, telemetry, search, or SDK fallbacks.

### Make OpenAI-compatible custom providers a supported path

Do not add a second adapter package. The hand-declared route already owned by `llm-pi-ai` is the supported OpenAI-compatible provider path, so catalog providers, private gateways, self-hosted servers, and future vendors share the same `ctx.llm` registration, settings namespace, credentials capability, model selector, replay behavior, retry policy, and attachment projection. A separate `llm-openai-compatible` package would duplicate these owners and create route-registration collisions.

The public route configuration is `providers.<route>` with a stable route id, optional `displayName`, credential reference `apiKeyEnv`, absolute HTTP(S) `baseURL`, `api: openai-completions | openai-responses`, and at least one declared model when the installed catalog cannot supply one. Model entries carry an id plus optional display name, context capacity, output capacity, modalities, reasoning declarations, and per-model compatibility overrides. The minimal deployment form is:

```yaml
llm-pi-ai:
  providers:
    acme-gateway:
      displayName: Acme Gateway
      apiKeyEnv: ACME_GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: acme-chat
          contextWindow: 128000
          maxTokens: 8192
```

The Web Models page keeps one provider-neutral flow: **Add a custom provider** asks for the route id, display name, base URL, protocol, API key, and model rows; editing may change every field except the route id, while renaming is delete-and-add because sessions and credential references persist the id. **Fetch available models** performs a bounded, cancellable OpenAI-compatible `GET /models` probe with the unsaved endpoint and key, stages the returned rows without committing them, and leaves manual entry available when a gateway has no listing endpoint.

Configuration stores only `apiKeyEnv`; the secret is write-only through `ctx.credentials`, resolved once per request, and absent from settings descriptions, logs, session events, RPC responses, and provider discovery results. Plain `headers` remain for non-secret routing metadata, but configuration validation rejects `Authorization`, `Proxy-Authorization`, `api-key`, `x-api-key`, and other documented credential header names there; a provider requiring non-Bearer secret headers needs a credential-backed mapping rather than a literal value. Product attribution headers retain their reserved-name precedence.

OpenAI compatibility is treated as a protocol family, not a capability promise. Unknown routes fail at configuration time if the protocol, endpoint, or model set is incomplete; a missing referenced credential fails the request as `MISSING_CREDENTIAL`; an unavailable model fails as `UNKNOWN_MODEL`; and unsupported stop, image, reasoning, or replay behavior stays refused unless that model declaration and mock coverage prove it. Route- and model-level `compat` switches cover gateway differences such as the developer role, `max_tokens` versus `max_completion_tokens`, strict tools, usage streaming, cache controls, and reasoning serialization without adding vendor branches to the agent loop.

### Make shipped composition provider-neutral

Change `agent-default-model` so a deployment may have no selected provider/model. The base profile mounts `llm-pi-ai` with no active routes, and the Models page can declare any catalog or custom route and save the default. Web refuses to start a model turn with an actionable provider-not-configured result; headless and SDK entry points require an explicit selection or saved deployment default. No entry point guesses DeepSeek, OpenAI, or another provider.

Remove DeepSeek defaults from `sdk/server`, the TypeScript SDK, the Python SDK, subagent SDK configuration, ACP/headless/JSON-RPC examples, title generation, and common test fixtures. The SDK server never mounts an adapter during `initialize`; the surrounding Cordis composition owns adapters. Generic snapshots use a scripted `test-provider`/`test-model`; only DeepSeek provider tests use DeepSeek ids and credentials.

Keep the local `/api` Host gateway, Typert Remotes, Web BFF, browser connection transport, and Models API. These are provider-neutral application interfaces, not DeepSeek official APIs. Package-scope and product-name rewrites apply to them, but their behavior remains.

### Preserve plugin capability without a store

Keep profile bundles, the Loader, dynamic Cordis plugins, the CLI's explicit pnpm forwarding, package/Git/file/link installation, plugin settings namespaces and cards, the local plugin inventory Remote and tab, client bundle loading, HMR disposal, skills, and MCP composition. Rename their package scopes, CLI text, manifest namespace, GitHub topic, browser boot global, and documentation to the selected neutral identity without changing their ownership model.

Do not add a curated catalog, recommendation feed, store endpoint, package allowlist, account requirement, or silent autoinstall. Add an acceptance test that installs a local fixture bundle by explicit file specification, reconciles the renamed bundle declaration, boots it, and observes it in the local inventory. Keep `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`; it prevents a third-party product from autoinstalling its marketplace and is not a harness store.

### Rewrite technical identity without compatibility aliases

Apply one reviewed, deterministic rename map to package manifests and dependencies, imports and declaration merges, package JSDoc, `tsconfig` paths and project references, tsdown/Vite/client-bundle regexes, Cordis rows, package invariants, generated-catalog sources, Python metadata and modules, executable names, environment keys, CSS variables and keyframes, browser globals, URI schemes, SQLite ownership ids, SDK/ACP identities, Git config keys and refs, CI variables, release families and tags, artifact names, repository URLs, docs, tests, and snapshots.

The vendored Cordis packages must also leave `@deepseek-ai`. Update the existing deterministic rescope mapping and reapply it through the vendoring procedure to the selected neutral scope; do not hand-edit vendored files or publish them under upstream names. Rename the native Landlock package family and trusted-publishing configuration to the same neutral publisher scope.

Change wire and durable identifiers atomically. The renamed client boot global has one spelling on Host and browser; the renamed session-reference scheme has no decoder alias; the SDK server reports one new name; the SQLite backend uses a newly allocated application id and rejects old databases; the managed child environment exposes only the new prefix; plugin packages declare only the new manifest key. The pre-release policy retains no old parser, environment fallback, package alias, re-export, dual header, or profile migration.

### Update source owners before derivative material

Edit package manifests, owning TypeScript/Python source, handwritten configuration, and generator inputs first. Then regenerate `pnpm-lock.yaml`, composition graphs, module/capability graphs, Cordis/config/tool/persistence catalogs, third-party notices, client slot catalogs, snapshots, website projections, and translation-pair records. Do not hand-edit generated English catalogs.

Update all active bilingual documentation and active Agent Notes to the new current names. Fully removed feature notes are consolidated into the implemented removal decision and deleted only when their unique rationale, alternatives, consequences, verification, and reintroduction conditions have been preserved. Generic decisions remain active and receive factual name/path updates.

Frozen archived Agent Notes remain byte-for-byte unchanged and stay outside prose maintenance and the residue verifier. Active documentation and active Agent Notes use the new current identity; the archive is reported as historical evidence rather than current authority. Rewriting, deleting, or resetting the sealed archive requires an explicit repository-policy change outside this proposal and is not part of the implementation.

### Land in dependency order

Use one coordinated pre-release change or an official stack whose intermediate branches each compile. The practical order is: identity reservation and residue verifier; provider-neutral default selection; direct DeepSeek adapter and search removal; official UI/telemetry/badge deletion; technical rename of source owners; vendor/native/Python/release rename; generated artifacts and paired docs; packed-artifact and real-provider verification. Do not publish or merge an intermediate state that mixes old and new package scopes or plugin manifest keys.

## Compatibility and data impact

No compatibility layer is retained. Existing npm and PyPI import names, CLI commands, `DSH_*` variables, `~/.dsh`, profile manifests, plugin bundles, Python imports, SDK server names, browser globals, session-reference URIs, and SQLite databases do not work under the renamed product. Old data is left untouched and may be moved or converted by an owner-operated one-shot tool outside the runtime; the application neither reads it implicitly nor deletes it.

Persisted sessions whose provider is `deepseek-official` are not rewritten to `deepseek`. A supported DeepSeek session under the new product is created through the pi-ai `deepseek` profile and records that route. Removing the dedicated search event and changing branded wire identifiers must update every checked-in fixture and both SDK projections in the same implementation.

Published artifacts and Git history continue to show their historical identities. The new release family publishes only the new package names. Registry deprecation, repository transfer, issue migration, tag cleanup, and domain redirects require separate external authority and are reported rather than inferred.

## Existing decision impact

This proposal remains proposed because the publication account and public repository URL are unresolved. The shipped integration removal and Clocky-derived local identity are recorded in the [implemented removal decision](../../implemented/simplification/2026-08-27-remove-first-party-integrations.md); its scoped supersession audit archived the fully replaced implementation records below. Publication and remote repository changes remain separate owner-operated release work.

| Decision group | Classification after implementation | Required treatment |
|---|---|---|
| [Twin LLM adapters](../../archived/architecture/2026-06-13-twin-llm-adapters.md), direct-adapter reasoning/files fixes, [DeepSeek request identity](../../archived/feature/2026-08-11-deepseek-request-user-id-header.md) | Fully superseded | The implemented removal decision preserves the direct twin's reason and the capabilities relinquished here; the obsolete triplets are frozen as historical records |
| [Default DeepSeek Web search](../../archived/feature/2026-07-31-web-default-search.md), [DeepSeek onboarding](../../archived/feature/2026-07-30-deepseek-onboarding-credential-setup.md), [bundled DSH badge](../../archived/feature/2026-08-06-bundled-dsh-badge-skill.md) | Fully superseded | The implemented removal decision preserves removal rationale and verification; obsolete feature triplets are frozen as historical records |
| [Provider-routed adapters](../../implemented/architecture/2026-07-14-provider-routed-llm-adapters.md), pi-ai catalog/configuration, generic model settings and attachment decisions | Partially superseded | Retain provider-neutral mechanisms; replace only direct-adapter/default/fallback facts and cross-link this decision |
| [Client build environment](../../implemented/architecture/2026-08-18-client-build-environment.md), [profile bundles](../../implemented/architecture/2026-08-05-profile-plugin-bundles.md), [single harness home](../../implemented/architecture/2026-07-24-single-harness-home-resolver.md), repository naming, vendor rescope, native and npm release decisions | Partially superseded | Keep mechanisms and rationale; update product/package/path/release facts to the selected identity and cross-link this decision |
| [Repository plugin removal](../../implemented/simplification/2026-08-09-remove-repository-plugin.md), plugin settings tabs and plugin-owned settings | Not superseded | Preserve the one explicit package-manager distribution path and local settings/inventory behavior; rename identifiers only |
| API gateway, Web client, Cordis Loader, skill/MCP, and capability-seam decisions | Not superseded | Keep the generic architecture and update only branded factual references |

## Alternatives considered

**Keep `llm-deepseek` as an isolated optional provider package.** This preserves its Files API, V4 defaults, and independent adapter implementation, and stripping its app headers/default mounts would remove much product coupling. It still leaves more than 8,000 lines of first-party DeepSeek API implementation and a dedicated settings family in a repository whose goal is provider neutrality. The generic pi-ai path already supports DeepSeek, so the dedicated implementation loses for this reduction.

**Perform only a textual rebrand.** This keeps behavior but replaces one name with another across thousands of files. It would leave the dedicated official search, onboarding, telemetry, badge, provider fallback, model default, and identity correlation intact under a new label. That is a rename, not the requested generalization.

**Remove every DeepSeek occurrence, including model support.** This produces the smallest allowlist but contradicts the requirement to retain DeepSeek as a model provider. Provider configuration, model ids, credentials, wire values, documentation, and tests remain where they are necessary to prove support.

**Delete the Plugins settings pages and CLI plugin command as the official store.** They perform no catalog discovery or official service call. Deleting them would remove local inspection, configuration, and explicit installation while leaving no store to remove. They are retained and renamed.

**Create a standalone `llm-openai-compatible` adapter.** This would give the feature a conspicuous package name, but `llm-pi-ai` already owns the OpenAI Chat Completions and Responses protocol factories, declared provider routes, model discovery, credentials, replay, and settings integration. A second adapter would duplicate behavior and make route ownership ambiguous, so the generic adapter exposes the supported configuration instead.

**Keep old package, environment, profile, and wire aliases for migration.** The repository is pre-release, and aliases would permanently double the public vocabulary, keep forbidden brand fields alive, and make the residue verifier meaningless. A one-shot external conversion tool is preferable if migration becomes necessary.

**Rewrite or delete frozen archived design records.** This would make a current-tree text search closer to literal zero, but it violates the repository's append-only archive rule and destroys the content seals that make those records trustworthy. Active records are updated or consolidated; frozen archives and Git history remain explicit historical exceptions.

## Acceptance criteria

- A committed identity manifest resolves every placeholder and is consumed by validation or generation where practical; no source owner repeats organization, product, CLI, home, repository, or release identity as an unrelated constant.
- A top-level residue verifier scans active tracked paths and text, generated outputs, packed npm tarballs, Python wheels, and known binary asset hashes. Outside `LICENSE`, frozen archived Agent Notes, the implemented removal decision, and focused DeepSeek provider files, it rejects `DeepSeek Harness`, `DSH`, `dsh`, `@deepseek-ai`, `deepseek-harness`, `deepseek-official`, `x-deepseek-harness-*`, old URLs, old CSS prefixes, old wire names, and deleted brand assets.
- The five removal-candidate packages and every official brand, badge, onboarding, DeepSeek search, anonymous-correlation, and hardcoded DeepSeek telemetry artifact are absent from the workspace, dependency graph, generated catalogs, runtime closure, lockfile, and release set.
- The shipped base contains no active model provider, provider/model default, provider credential prompt, outbound Web provider, telemetry destination, or provider-specific adapter fallback. Missing configuration fails with an actionable provider-neutral diagnostic.
- `llm-pi-ai` configures provider `deepseek`, resolves a DeepSeek credential, lists models, completes streaming and tool follow-up against mock infrastructure, and passes a key-gated real DeepSeek smoke. Provider-specific documentation names the supported and intentionally lost capabilities.
- A user can create, edit, select, and delete custom `openai-completions` and `openai-responses` routes through Settings or `settings.yaml` using an arbitrary absolute HTTP(S) base URL, credential reference, and model list. Mock endpoints verify URL construction, bearer authentication, Chat Completions and Responses streaming, tool follow-up, bounded/cancellable model discovery, compatibility switches, hot reload, and secret redaction; invalid URLs, protocols, duplicate routes, missing models, missing credentials, and secret-bearing plain headers fail with actionable diagnostics.
- The local Host `/api`, Web Models page, ACP/SDK protocols, and generic capability seams remain functional under the new identity and contain no DeepSeek product defaults.
- An explicit local fixture plugin installs through the renamed CLI and manifest key, boots from a profile bundle, appears in the local inventory, exposes its settings card, and unloads cleanly. No harness marketplace, recommendation endpoint, curated catalog, account check, or autoinstall path exists.
- The old CLI, npm/PyPI names, Python imports, environment prefix, home path, plugin manifest keys, browser global, session URI, SQLite application id, SDK identity, headers, and release tags have no alias or fallback in the new runtime.
- Every persistent visual identity seat in the replacement table renders decoded, non-empty robot SVG artwork at non-zero dimensions before any deployment brand plugin loads; registered slot occupants still replace it. Browser and documentation screenshots show no whale, DeepSeek wordmark, branded badge, official DeepSeek credential panel, product testing notice, or DeepSeek-specific default model/search. The PWA manifest, document title, website chrome, favicons, tutorial badges, and social/community copy use the selected neutral identity.
- Source-plane typecheck, focused unit/e2e tests, keyless ACP/headless/Web snapshots, both SDK projections, Python runtime smokes, build, hygiene, package/runtime closure, release pack and installed-artifact probes, `doc-sync`, website build, lint, translation pairing, the residue verifier, and `git diff --check` pass. Commands actually run are reported.

## Risks

The recommended provider reduction trades proven DeepSeek-specific behavior for a generic library dependency. A pi-ai upgrade can change its DeepSeek catalog or wire behavior, and the direct adapter no longer supplies an independent conformance twin. Focused mock and real-API tests become the support boundary.

Provider-neutral first run is less automatic. A user must select and configure a provider before the first model turn, and non-Web entry points must receive a model selection and composition explicitly. The error and Models-page path must be clear enough that neutrality does not become an unusable blank state.

“OpenAI-compatible” endpoints implement an uneven subset of two evolving protocols. A successful `GET /models` or authenticated connection does not prove tool calling, reasoning, images, replay, usage streaming, strict schemas, or token-field spelling. The configuration keeps these claims explicit, tests both protocol families against mock servers, and documents manual compatibility switches instead of inferring capabilities from a provider name or URL.

The technical rename is repository-wide and touches durable, wire, CSS, packaging, documentation, and release identities. Partial branches are likely to be unbuildable, and ordinary search-and-replace can corrupt provider references or third-party attribution. A deterministic map, source-owner order, generated-output discipline, and packed-artifact residue scan are required.

The no-compatibility stance intentionally strands existing homes, profiles, sessions, SQLite databases, plugins, SDK clients, and Python imports. Even before a tagged release, repository owners may have valuable local data; the handoff must name what becomes inert and how to preserve it outside the runtime.

Robot fallback artwork can accidentally become a de-facto brand, disappear in one theme, shift layout, or pass an accessibility-tree snapshot while painting nothing. One geometry owner, fixed aspect ratios, decoded-image checks, computed-visibility assertions, and real screenshots constrain that risk; the robot fallback remains explicitly replaceable by a deployment brand plugin.

The MIT copyright notice cannot be deleted as branding, and archived Agent Notes cannot be rewritten under the current process. Both remain explicit exceptions. Claiming literal absence from every historical file would be inaccurate; the enforceable claim covers active source, active documentation, and shipped artifacts.

Package and repository names must exist before the implementation can finish. npm/PyPI scopes, GitHub organization, trusted publishers, domains, and redirects are external state, and the source tree cannot reserve or transfer them by itself.
