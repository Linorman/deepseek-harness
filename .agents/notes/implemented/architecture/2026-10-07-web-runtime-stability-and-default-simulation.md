# Agent Note: Web runtime stability and default Simulation

Status: implemented

English | [中文](2026-10-07-web-runtime-stability-and-default-simulation.zh.md)

## Problem

Native view capture suppresses rendering before its update callback. Waiting for animation frames there caused four-second navigation timeouts; deferring the logical route to capture also let a late callback overwrite browser Back. Settings inside the sidebar inherited its stacking context. Continuous ambient motion imposed idle work, while authentication refusal incorrectly fanned out successful-reconnect refreshes. A default Simulation deployment also needs installed templates to survive an absent model configuration.

## Decision

The standard Web bundle installs a real Simulation product beside Team. Boot and browsing allocate no world or writer and perform no inference. Explicit creation prepares a paused world with a complete initial checkpoint. Explicit Start admits model work; cold restoration requires confirmation and leaves the world paused. [Bundle configuration](../../../../packages/bundle/web-app/README.md) owns the stable group, production template, actor preset, resource bounds and custom-deployment takeover procedure. Native Simulation definitions belong to that preset; ordinary agents retain an empty process-global catalog. Each joined actor restricts inherited capabilities to the three native operations.

### Presentation and authentication

[Navigation](../../../../packages/client/ui-viz/src/motion/view-transition.ts) commits React presentation synchronously before returning. Native callbacks share an idempotent commit and cannot reapply an intent after Back/Forward. Optional capture may observe the already committed view, so old/new element morphing is not guaranteed. The instant timing token bounds the visual lifetime; fresh pointer/key input and document hiding retire it. Promise rejection cleans only its owning transition. React remains in presentation code.

Settings uses the shared body-portaled native Modal, preserves its slots and external section requests, and contains focus with stable fallback controls. At least 720px uses a section rail; narrower windows use a labeled category selector and full-width fields. Menu, HoverCard and Popover portals stay inside the active native ancestor; inner Escape does not cancel that ancestor. Automatic Swarm layout persistence does not cancel exact target authorization or member/Session validation. Ambient glows and empty/settled rings remain static; live motion requires activity, exposure and permission to animate.

Only a successful authenticated handshake publishes `connection/reset`. The separate `connection/authorization-cleared` signal retires principal-scoped projections and outstanding reads once per authorization generation. Protected readers stop until the user renews access and explicitly rechecks; one recheck permits one handshake, and another denial stays terminal. Ordinary network failure retains backoff, and domain forbidden does not log out the whole client. Credentials stay out of URLs, logs and localStorage.

### Installed readiness and immutable acceptance

Installed templates contain either an explicit route or an `agent-default` selector. [Model resolution](../../../../packages/simulation/simulation-product/src/template-model.ts) reads the current existing Agent default at preflight and acceptance, maps its `model` to driver `name`, and resolves metadata without inference. Structural errors still reject load. Catalog/preflight expose strict `ready`, `needs-model` or `unavailable` readiness independently of field validity. The company driver accepts provider-default reasoning; unsupported explicit reasoning is reported instead of dropped.

Creation carries `expectedModel` for the route the user confirmed. Admission rechecks model, principal and capacity at the durable queue position; changed routing rejects with `simulation-product-model-changed` before allocation. Accepted work freezes the complete driver/spec/template and original command. Same-command retries reconcile that retained result before current readiness. The route confirmation is redundant in durable data and is reconstructed from the frozen driver; the command journal remains format 2, with no selector, implicit migration or compatibility shim. TypeScript and Python contracts share these strict DTOs.

The empty directory displays installed templates and creation. Missing templates report deployment configuration; missing capability deep links return to Team. The shared `settings.model-setup` slot suspends the creator, preserves its bounded private draft, opens Models, and refreshes readiness on return. Default provider/model choices are explicit. Returning only preflights; it does not submit. Unauthorized replacement clears private drafts and exact-original state according to their existing owners.

### Decision ownership and verification

[Product registration](2026-09-29-simulation-product-directory.md) and [durable creation](2026-09-29-persistent-company-creation.md) retain their authorization, redaction, immutable identity and ownership rationale. This decision partially supersedes default deployment and template readiness. [Web layout](../../proposed/feature/2026-10-02-web-ui-redesign.md) and [visualization](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.md) retain their independent scope. None is fully obsolete or archived. The [development record](../../../plans/2026-10-07-web-runtime-stability-and-default-simulation/development-plan.md) and [checklist](../../../plans/2026-10-07-web-runtime-stability-and-default-simulation/checklist.md) own exact commands, results and evidence boundaries.

## Alternatives considered

**Capture-owned logical navigation.** Even a synchronous render callback arrives after capture. Logical history commits immediately; optional visual capture can lose morphing fidelity without changing the target.

**Higher Settings z-index or deleted sidebar transition names.** These do not establish native focus/inert ownership across ancestor contexts. Shared native modal ownership provides that boundary.

**A button-only Simulation default, fixture deployment or fake model.** These provide neither a production template nor honest model readiness and may introduce accelerated timers or inference on boot. The shipped group uses the native owners and production defaults.

**Rewriting all profiles or automatically starting a sample.** Bundle installation reaches initialized standard profiles while preserving user patches. Paused creation and explicit restoration/Start preserve execution and billing ownership.

## Consequences

The optional visual transition cannot delay routing, and idle decoration causes no recurring animation/layout. The default group adds roughly 500KB transferred to usable boot and about 0.8MB browser heap in controlled empty-page measurements. SwiftShader and real Apple M4 Pro Metal samples are reported separately; their startup/idle differences stay below the 10% investigation threshold. Headless metrics do not represent device FPS.

Provider metadata readiness does not prove remote credentials valid; the first explicit real request can still fail. No-model deterministic offline execution, automatic migration, automatic recovery and a replacement engine remain outside this decision. Existing custom roots and journals are preserved, with explicit default-group disable before takeover. Existing running processes load the new composition on a normal restart; read-only smoke does not silently restart user work or authenticate another browser. Replay adapters replace only external model behavior, and evidence is labeled accordingly.
