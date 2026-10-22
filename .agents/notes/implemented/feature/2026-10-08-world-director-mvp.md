# Agent Note: Durable world simulation MVP

Status: implemented

English | [中文](2026-10-08-world-director-mvp.zh.md)

## Problem

Users need to author an organization, let independent actors request changes, and retain people, decisions and unfinished responsibilities after restart. Prompt edits, static procurement templates and organization diagrams alone cannot prove those properties. The [original staffing milestone](../../../plans/2026-10-08-world-director-mvp/development-plan.md) and [expanded completion design](../../../plans/2026-10-11-world-simulation-completion/design.md) distinguish the first vertical delivery from the completed local three-domain MVP.

## Decision

World runs retain one canonical Team, one Native commit order and a director with an independent Session. Organization units and positions are noncognitive entities; actors keep canonical Person/Participant/Session identities. Governance, personnel and simulated external interactions share the same domain driver across company, laboratory and association definitions. Existing procurement behavior remains a separate supported composition.

### Authoring and ownership

`clocky.world/v1` JSON and safe YAML use one strict, browser-safe compiler. Parsing, reference/capacity checks and explicit default resolution precede preview. Model routes, templates, domain implementations and quotas come from installed allowlists; definitions cannot supply credentials, executable code or arbitrary provider endpoints. Preflight allocates no identity and performs no inference. Creation rechecks catalog generation and hashes, retains the original definition and full resolved deployment commitments, and reserves stable identities before IO. Exact retries reuse that original; exported definitions create new worlds and are not run backups.

The `simulation` service defines durable protocols; `simulation-local` validates and folds the single authoritative journal; `simulation-scenario` compiles definitions; `simulation-world` coordinates domains and effects; `simulation-team` owns canonical identity and Session preparation; `simulation-product` owns authenticated commands, authorized reads and the execution owner. Client and SDK consumers use strict public DTOs. Orchestration uses public services and disposable registrations, not another world database or a second agent loop.

### Authority, decisions and effects

Ordinary actors and the director use recorded Agent/Session observe, stage and submit decisions. Staging does not authorize execution. Native acceptance checks the exact writer epoch, consumed context, current scope, evidence, grants, limits and implementation pins. Domain leases survive admitted callbacks, unknown IO and unfinished maintenance; unloading closes new admission rather than replacing an unresolved implementation. An authenticated user command has its own audited source and never impersonates an actor.

Planning provenance uses a base revision, while execution checks the declared read-set and current authority at the serialized commit point. Unrelated progress does not automatically invalidate a plan. Plans and generated Personas become immutable accepted originals; retries cannot regenerate them or edit their business identity. Communication, delivery, context consumption, first action and business completion remain separate facts. Trusted result projections publish committed structured facts; a model's statement is not a receipt.

Governance freezes proposal text, electorate, rules and independently sourced ballots. Native closes only eligible ballots at a settled boundary, preserves pause precedence and atomically cancels obsolete deadline work. Passing a proposal does not enact a norm: enactment needs its own authorized request. Advisory text remains distinct from validated policy. Effective, available, recorded and notified times stay distinct, and modeled time remains an exact decimal representation.

### Personnel and external scope

Hiring reserves capacity before canonical preparation; occupied plus reserved units govern admission. Repeated requests for an open hiring intent retain one business identity; a genuinely new application rechecks authority and capacity. Existing-person hiring preserves the original identity and requires current eligibility. New people and representatives become ready only after their original Persona, assignment and private Channels are confirmed. Readiness is an unavoidable gate for activation and recovery, not a prompt convention.

Transfers and departures retain temporal assignments and original handoff obligations. Revocation fences future work but does not erase Sessions or known history. Unconfirmed retirement keeps capacity and cleanup responsibility charged. Identity history is never recycled to evade quotas, and cancellation cannot release a possibly applied effect merely because a timeout elapsed.

External identities have stable keys. Rule-based responses retain actual inputs and evaluated outcomes; mediated responses retain their accepted adjudication; representatives have independent finite Personas, Sessions and caller-specific private Channels. Repeated contact reuses the canonical representative. All MVP external behavior is simulated: it cannot invent evidence-backed inventory or contracts, or invoke real network, payment or email adapters.

### Scheduling, privacy and recovery

Bounded scheduling records original triggers and decisions, preserves ordinary-role fairness and stops on declared time, request, model, token, history and residency limits. Model and Team IO stay outside the Native write queue; pure validation and append own atomic business changes. Maintenance closes admission and drains accepted IO before structural mutation. A newer pause/cancel wins over stale automatic continuation; restart restores paused state and needs an explicit new start to infer again.

Read authorization, operation permission, model input selection and product disclosure are independent. The director receives only case-scoped evidence rather than all actor histories. Lower-privilege actors never inherit its Session. Exact model inputs and selected provenance remain reconstructable from durable context/Session records. Lists expose bounded metadata; bodies, Persona, votes, contexts and Session content require their own authorization. Reads, refreshes, exports and navigation neither acquire writable ownership nor resume inference.

Native stream 97, manifest 7 and compiler 9 reject unsupported original artifacts; generic SQLite and Session format versions are unchanged. Checkpoints retain domain pins, original results, identity bindings and pending notification/cleanup responsibilities. Cross-journal preparation uses intentions and receipts instead of claiming a global transaction. Missing or changed canonical evidence refuses writable recovery. Recovery replays accepted originals without models, randomness or real external effects.

### Product contract

The workbench shares one draft between tables and JSON/YAML source, preserves unsupported fields, locates diagnostics and creates a paused run only after explicit confirmation. World navigation exposes overview, cases, organization, governance and external views; engine inspection remains separate. User management follows preview, original submission and retained receipt. Unknown outcomes are queried or explicitly retried with the same command identity. Theme, keyboard, focus, narrow layouts and reduced-motion behavior follow [DESIGN.md](../../../../DESIGN.md) and [UX-CONTRACT.md](../../../../UX-CONTRACT.md).

The [default Web composition](../../../../packages/bundle/web-app/README.md) installs the World catalog and three portable starter templates without a custom overlay. Its distinct actor preset exposes only Simulation tools. Administration resolves the saved default model during preflight and rechecks it at acceptance, then retains concrete original routes for retries and cold recovery. The shared compiler and execution owners remain independent of these Web defaults.

## Verification

The [112-item completion checklist](../../../plans/2026-10-11-world-simulation-completion/checklist.md) owns acceptance and links its original evidence. The [current UI acceptance](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/ui-current-acceptance-proof-20261016.md) verifies real Web/Loader/Agent workflows and current interaction inputs. Prior fault, SDK, history and scale evidence is reused only where its owning inputs remain applicable. The [live-model report](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/live-model-expanded-proof-20261016.md) retains all failures and bounded company/laboratory samples; it does not establish general model reliability or a full autonomous real-model storyline. The [timeout investigation](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/timeout-root-cause-proof-20261016.md) distinguishes observed resource contention and repaired polling from uninstrumented historical conditions.

## Alternatives considered

**Deliver only staffing.** This was a useful first vertical proof because identity, maintenance and cross-journal recovery dominate its risk. It does not meet the expanded acceptance scope; governance, departure and external interactions have separate contracts and evidence in the completed MVP.

**Only update policy text or branch the procurement driver.** Text cannot prove durable identity or authority; procurement-specific branches cannot establish scenario generality. The pure compiler and shared domain driver retain those responsibilities explicitly.

**Let a model mutate world state or maintain another world database.** Model assertions cannot supply authorization, deduplication or crash consistency. Native atomic facts and cross-owner intentions/receipts remain authoritative.

**Require a globally unchanged revision, or treat pause as readiness.** These shortcuts either reject unrelated progress or admit incompletely prepared identities. Explicit read-sets, current authorization and canonical readiness address the actual invariants.

**Start with multiple Teams, hot implementation replacement or unrestricted domain code.** These add unresolved ownership and recovery semantics. Installed versioned domains are extensible through the maintained capability boundary, without promising a hot-swappable durable ABI.

## Consequences

Maintenance can pause the whole local world and retain capacity after failure while ownership is uncertain. Durable history and conservative rejection cost storage and operational effort. Definition export does not replace checkpoint recovery; pre-release format rejection does not promise migration. Small live-model samples, measured workloads and passing fault cases support only their recorded scope, not unlimited scale or autonomous correctness.

## Deferred and related ownership

The [post-MVP roadmap](../../../plans/2026-10-16-world-post-mvp/design.md) retains graph authoring, deeper organizational workflows, protected archival, portable backups and migration, isolated experiments, multiple planners and optional real-world adapters/federation. The [broader evaluation design](../../../plans/2026-10-16-world-mvp-finalization/design.md) proposes more extensive live-model stories and reusable cost-ledger tooling; the bounded acceptance runner does not claim to implement every such extension.

[Durable simulation coordination](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md) remains proposed for its wider distributed scope. The [visual-layer proposal](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.md) retains its own delivery boundary. Implemented checkpoint, canonical restore, governance, authorization and polling notes remain active owners of their distinct mechanisms; none is fully superseded by this feature summary.

### Bounded model protocol

The optional retained `bounded-v1` definition pins model-visible behavior: initial institution notices use deterministic empty decisions without claiming model understanding; observation references the prepared context by default; hiring explicitly requires `expectedTime: null` and empty evidence. Logs without the marker replay their original presentation. Full-request admission and BasicCompaction share TokenMeter, retain original events and authoritative context, and refuse required content that cannot fit before a charged call. Overrun acknowledgement uses the original paused management request; actual usage, acknowledgement and necessary interval additions remain auditable without starting scheduling. Verification covers log-sized usage, JSON/SQLite cold replay, real tool-chain request refusal and the keyless default Web scenario.

### Compaction, terminal stops and original notifications

Consumption receipts preserve the original context and single entered input order. Repeated presentations require the compaction start, summary, replacement provenance and end events to prove lawful shadowing; appending identical text alone cannot manufacture consumption. Canonical consumption failures and deadlines retain explicit Native stops, cancel decisions, return wakes and close settled windows, preventing further charged model repair attempts. Historical expiry records omit the new stop flag and replay without migration. Chapter observation reduces repeated bodies; notification references resolve frozen actions through the owner and retain original result, consumption and authority checks. Regression evidence covers submission after compaction, forged-restoration and duplicate-input refusal, zero further model calls after internal failure, JSON/SQLite timeout cold replay and notification references through real tools.

### Ordinary communication identity and acceptance

Ordinary messages derive reply mappings only from confirmed deliveries and record them in required input; names never infer identities and Participant IDs are not silently converted. Staging and final acceptance share recipient/time checks. A typed queued-message rejection retains its proposal hash and attempt, returns the original wake and closes settled windows, using the original maxConflictRetries repair bound. Fresh context states that no effect occurred; persistent failure stops with an explicit message diagnostic. Storage failures remain distinct and cannot be swallowed as business rejection. Regression coverage includes same-turn ID correction, one acceptance after final rejection, exhaustion, forged rejection evidence, storage failure and JSON/SQLite cold replay; the independent Web case deliberately uses a Participant ID from the real reply mapping before model correction.
