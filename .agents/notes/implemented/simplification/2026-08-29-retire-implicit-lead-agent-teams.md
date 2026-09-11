# Agent Note: Retire implicit-Lead Agent Teams

Status: implemented

English | [中文](2026-08-29-retire-implicit-lead-agent-teams.zh.md)

## Problem

The private Agent Teams packages preserved an implicit Team identity in a Lead Session, direct-child authority, and a separate set of model tools. Stable Team packages own independent Team identity, durable journals, channel delivery, activation bindings, and explicit final output. Keeping both implementations preserved incompatible authority, event, catalog, and snapshot surfaces without a shipped product composition using the private packages.

## Decision

The repository removes `@clocky/clocky-experimental-agent-team` and `@clocky/clocky-experimental-tool-agent-team`, their Headless fixture, test-only legacy importer, Session-event reference page, tool/catalog registrations, workspace references, and inventory entry. `ctx.teams` and its stable providers are the only Team coordination implementation in source and generated catalogs.

The removal does not delete `ctx.sessions`, `ctx.agents`, or direct subagent infrastructure. AgentRuntime continues to use those trusted primitives to create and resume a Team Participant's local transcript. Same-Session goal, workflow, direct-subagent, and Web Session entry paths retain their current owners until their Team replacements are shipped.

The former implementation's decision records are archived as historical evidence. The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains active for the uncompleted product cutover and distributed-link work.

## Verification

Workspace typechecking, the direct-entrypoint inventory verifier, Team Hub tests, Headless snapshots, generated Cordis/tool/persistence/module documentation, and packed-artifact probes cover the removal. The generated catalogs contain no `ctx.agentTeams`, experimental Team package, legacy Team Session event, or implicit-Lead Team tool entry.

## Alternatives considered

**Keep the packages as a test-only migration oracle.** Rejected because stable Team contract, restart, delivery, and product snapshots exercise the maintained semantics directly. A second executable Team implementation would keep obsolete Session identity and model tools available to future callers.

**Provide a compatibility adapter for old Team Session records.** Rejected under the pre-release format policy. Stable Team journals use independent branded identities and reject unsupported durable formats instead of guessing Lead-Session records into a new authority domain.

**Remove direct Session orchestration in the same change.** Rejected because Web task-first entry, Team task-control, workflow compilation, and Team-native fork semantics remain separate owned work. Removing those paths without replacements would remove supported product behavior.

## Consequences

The repository loses the opt-in implicit-Lead Team simulation and its ten model-visible coordination tools. Stable Team packages keep the durable collaboration mechanics and product-oriented topology already used by headless, ACP, JSON-RPC, and both SDKs. Future product work has one Team implementation to extend and one historical archive to consult when an older rationale is relevant.
