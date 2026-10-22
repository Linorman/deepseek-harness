# Agent Note: World workspace UI ahead of Host domain reads

Status: implemented

English | [中文](2026-10-12-world-workspace-ui.zh.md)

## Problem

The [World UI design](../../../plans/2026-10-11-world-simulation-completion/ui-design.md) specifies an authoring workbench, organization, governance and external-world modules, four-track matters and a unified management flow. The Host and Client runtime currently publish only World creation, preflight, export and hiring cases. Waiting for every domain read would leave the workspace without its structure, while rendering placeholders as data would break the rule that the UI shows only Host facts.

## Decision

`@clocky/clocky-client-ui-simulation` ships the complete World UI against a reserved, typed domain seam in `src/client/world-domain.ts`. `WorldDomainState` holds one `WorldWindow<T>` per proposed projection (templates, overview, organization, person, governance, proposal, norm, external, identity, case extensions, action fields, action preview) and `WorldDomainReads` names the bounded reads. Until the Client runtime projects them, `apply` injects `createUnpublishedWorldDomain()`, whose domain windows remain `unpublished`; modules render that as an explicit unavailable state, counts stay `FactValue` unavailable rather than zero, and management submission stays disabled.

Authoring consumes optional catalog `worldTemplates` containing only explicitly published `world.authoringTemplates`. The Host validates complete v1 definitions, counts them against the installed-template bound, and never derives public templates from private run exports. The workbench edits one canonical JSON model, decodes source text with the Host's own syntax-only decoder (`decodeScenarioInput`, now exported by `@clocky/clocky-simulation-scenario`), runs the shared compiler locally for shape errors, and sends only parsed definitions to the existing preflight. Creation reuses the retained `world-create` original. Blank definitions use `clocky.world/v1`, with every supported section editable. Compound JSON cells and nullable interval ends preserve the full authored model. Incomplete local text survives view changes; cancelled regeneration or a rejected bounded mutation restores the parent draft. Legacy `clocky.world/v0` sections that its compiler rejects remain read-only as reserved. Unknown source-only fields stay visible rather than disappearing.

All World preflight responses require `scope.source: simulated-only`, including legacy hiring previews. Unknown or omitted source markers reject at the Host/TypeScript/Python boundary rather than inventing the simulation guarantee. Preview and retained World run pages keep the same non-dismissible simulation notice visible outside collapsed details and across engine navigation/reopening. It states that external behavior uses no real network, payment or mail; unavailable domain data still stays unavailable.

World runs are identified from the retained scenario template (`clocky.world/v0/*` or `clocky.world/v1/*`), never from names. Their primary row holds the five World modules and the engine modules move into one Engine menu; other runs keep their row.

World files sit flat in `src/client/` (`World*.tsx`, `world-*.ts`) because the client domain-graph gate forbids top-level files such as `Workspace.tsx` from importing a sub-domain directory.

Client plugin bundles resolve inlined dependencies through their package's object `browser` field (`browserFieldTarget` in `packages/client/tsdown.client.ts`). `yaml`'s Node build imports `process`, which the browser module table cannot answer; its declared browser build does not.

## Alternatives considered

**Wait for the runtime projections.** It would postpone navigation, layout, accessibility and motion review until the Host work lands, and couple UI review to backend scheduling.

**Fixture-backed demo data in the shipped plugin.** It would present invented organization or vote facts as observations, violating the facts-first rule; fixtures stay in tests and the local review gallery.

**Validate drafts with a client copy of the rules.** It would drift from the Host; the shared compiler package already runs in the browser.

**Alias only `yaml` in the bundler.** A generic `browser`-field mapping fixes the class of Node-only builds without naming one package.

## Consequences

The runtime can replace the reserved source without UI changes: implement `WorldDomainSource` and inject it in `apply`. Until then, World modules other than authoring, matters and export show unavailable states in production. The proposed DTO shapes in `world-domain.ts` must be kept aligned with the eventual Host DTOs or deliberately revised together. The Simulation bundle now carries the YAML parser. Bundles that previously inlined a Node-only dependency build switch to its declared browser build.

## Verification

`pnpm exec vitest run packages/client/ui-simulation` covers the draft model round trip, component state matrices, workbench check/locate/lock flows, module observation rules, the management flow and World navigation in the assembled workspace. `scripts/client-bundle-purity.spec.ts` pins the browser-field mapping.
