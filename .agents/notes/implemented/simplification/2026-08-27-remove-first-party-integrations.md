# Agent Note: Remove first-party product integrations

Status: implemented

English | [中文](2026-08-27-remove-first-party-integrations.zh.md)

## Problem

The plugin harness carried several first-party product integrations even though its provider-routed and slot-based mechanisms already supported deployment-owned choices. A dedicated model adapter, outbound search provider, onboarding flow, telemetry identity, badge skill, brand package, product subagent transport, and external hook bridge each added code, defaults, and product assumptions to otherwise reusable paths.

## Decision

The repository removes the dedicated first-party integrations and keeps the underlying extension points:

- `llm-pi-ai` is the only shipped model adapter and retains the `deepseek` provider profile. DeepSeek remains a provider configuration and verification target, not a product default or a separate adapter package.
- The base composition has no active provider route or selected model. Web, headless, SDK, ACP, and JSON-RPC entry points receive a provider/model explicitly or report an actionable provider-neutral configuration error. The generic Models page edits provider routes without a vendor-specific first-run panel.
- The provider-neutral Web capability, HTTP fetch, Exa, and Perplexity integrations remain opt-in. The base composition mounts no outbound search provider.
- The official brand package, badge skill, community art, and dedicated onboarding assets are removed. Persistent browser and documentation image seats render shared robot fallback artwork; retired content blocks and dead actions are removed as complete units.
- Anonymous cross-service identity is removed from feedback, telemetry, and provider requests. OpenTelemetry remains an optional deployment plugin with an explicit endpoint and no repository-created `user.id`; local feedback remains local.
- SDK server initialization validates the provider owner already present in the surrounding Cordis composition. TypeScript and Python SDK callers provide provider/model selection instead of receiving a provider fallback.
- The Codex and Claude Code subagent providers and external hook bridge plugins are removed. The generic subagent service keeps its in-process, ACP, and Clocky SDK providers; typed Cordis interception points and the shared hook protocol library remain available to deployment-owned bridge implementations.

The human-facing product name is now Clocky. The technical package, CLI, environment, filesystem, wire, and repository identifiers remain unchanged in this decision. The separate technical identity reservation remains pending because replacement ownership values are external inputs; no compatibility alias or invented target name is introduced here. The owner-supplied [identity proposal](../../proposed/simplification/2026-08-26-generalize-agent-harness.md) records that remaining work and its atomicity requirements.

## Verification

The removed packages are absent from workspace references, lockfile resolution, generated catalogs, runtime closure, shipped composition rows, and product-specific fixtures. Provider-neutral behavior is covered by the Models, API, SDK, telemetry, attribution, replay, and headless tests; generic subagent and native interception coverage remains in their owning packages. Keyless snapshot replay and the JSON-RPC smoke use scripted provider fixtures; the pi-ai tests retain focused DeepSeek provider coverage. The Web shell was checked in the real in-app browser for the robot mark, document title, and generic Models page; documentation projection and local robot assets build successfully.

## Alternatives considered

**Keep the dedicated model adapter as an optional package.** Rejected because the generic pi-ai route already serves the retained provider profile, while the dedicated package preserves a second request implementation, default path, and settings family.

**Perform only a textual product rebrand.** Rejected because it would leave provider defaults, outbound search, onboarding, telemetry identity, and SDK fallback behavior coupled to the product under a different name.

**Remove DeepSeek provider support as well.** Rejected because the generic provider route and its focused tests continue to support DeepSeek without making it the harness identity.

**Leave empty or text-only replacements where brand art was deleted.** Rejected because persistent image seats would become layout or rendering regressions. The robot fallback artwork owns those seats, while retired feature blocks disappear.

**Keep product subagent transports as optional bundles.** Rejected because no shipped composition requires the native product runtimes; retaining them would preserve provider-specific process, dependency, and tool-roster ownership beside the generic subagent service.

**Keep the first-party external hook bridges.** Rejected because deployment-owned native plugins can subscribe directly to the typed interception points, while the retained protocol library does not require a bundled bridge implementation.

## Consequences

Deployments lose the dedicated Files API lifecycle, direct-adapter defaults, first-party search endpoint, vendor onboarding convenience, anonymous correlation, bundled badge, native Codex/Claude Code subagent transports, and first-party external hook configuration. They gain a smaller base composition, explicit provider selection, generic settings behavior, and a provider adapter with one ownership path. Existing dedicated-provider sessions and user data are not rewritten or deleted automatically. A future deployment may provide its own brand, optional telemetry, bridge implementation, or native product transport through the retained slots, seams, and plugins.
