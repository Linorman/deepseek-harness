# Agent Note: Bounded company procurement driver

Status: implemented

English | [中文](2026-09-29-company-procurement-driver.zh.md)

## Problem

A running management intent does not advance company procurement. Production coordination must place actors before freezing a window, process transport and notification wakes in order, distinguish submitted proposals from applied effects, and preserve original decisions across pause and recovery.

## Decision

The [company driver](../../../../packages/simulation/simulation-product/src/company-driver.ts) is a trusted version 1 consumer of the native run and canonical Team connection. Its caller owns preparation/restoration, immutable scenario settings, scheduling cadence and lifetime. Construction validates the retained model route and supported rules/policy versions. Advance batches coalesce and obey `maxControlSteps`; no browser read, constructor or paused batch starts inference. The initial complete company checkpoint must identify the canonical Team before work begins.

The procurement protocol advances request, acceptance, transfer, result and delivered-report acknowledgement. Native notification and ingress wakes use separate input decisions. Each stage retains its original accepted decision; a later duplicate cannot replace its effects. The driver selects one actor, establishes residency through safe native eviction, freezes a one-actor window and executes the real model/Session/tool path. Serial dependencies determine this window size; host-wide model permits and native run budgets remain authoritative. Current-epoch submitted windows retry recorded input without new inference; foreign windows, contexts or unconfirmed writers require recovery.

Context selects the two protocol accounts, the actor's own balance, shared account IDs/revisions and purchase/commitment facts. Supplier transfer evidence enters buyer context only at delivered-report inspection. Profiles and unrelated resources remain absent. The selected sections, versions and source cursor enter the existing required Session context event before model dispatch; the complete request also retains normal Session history and tool definitions.

The company preset supplies a complete Simulation persona and suppresses unrelated dynamic runtime context. A coding deployment persona can require a filesystem `cwd` that a Simulation actor does not own; ambient filesystem data is not a substitute for authorized world knowledge. The role filters final prompt tool schemas after cooperative assembly because actor-owned Team tools bypass inherited registry restrictions. The native model dispatcher independently rejects advertised capabilities outside its decision authority before model or token admission. Execution guards remain independent of presentation.

Pause stops later control admission. Submitted proposals retain their window for explicit resume. A model turn ending under pause without submission is durably cancelled before its wake is released and its window closes. The return identifies this interruption separately. Drain awaits admitted work; the caller must drain before checkpoint collection or closing its connection/run. Unclassified execution/storage failures remain errors with native responsibility retained. Deadline and permit cleanup continue on real time.

The [preparation decision](2026-09-29-company-initial-preparation.md) independently owns initial topology and the first checkpoint. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) retains Web/SDK controls, the remaining complete product acceptance and additional task scenes. Neither is fully superseded.

The [persistent creation decision](2026-09-29-persistent-company-creation.md) owns public allocation, original request outcomes and paused preparation handles; this note retains its independent rules.

Trusted `driver.tasks` selects a model or deterministic inventory task with explicit lease, attempt and retry policy. The transfer stage becomes one accepted `task/create` and a canonical attempt; task input, applied inventory evidence and target completion remain independently retained. The product owner installs/disposes scene policies and supplies the canonical reader. Recovery follows the [task completion decision](2026-09-30-simulation-task-completion.md): retired pre-effect work gets a new attempt, while an applied original transfer gets an empty, newly recorded continuation acknowledgement. Closed commitment facts remain unchanged, old failed attempts stay visible, and original effects cannot be proposed again. Future events advance under the same bounded driver/cadence. The catalog and Web form display the Host-selected task mode.

## Alternatives considered

**Use only phase changes.** They cannot nominate cognition, place actors or coordinate transport.

**Recreate a decision after a lost completion response.** It repeats inference and loses the original wake and window identity.

**Treat publication or automatic fulfillment as report completion.** Publication does not establish a collected recipient wake; result reporting requires its own applied operation and acknowledgement.

**Poll unfinished work without a batch bound.** It turns idle/blocked/retry states into busy loops and unbounded HTTP work.

## Consequences

The driver implements one trusted procurement protocol and exposes a bounded Host capability. Its caller supplies durable product creation and command/result APIs through the creation owner while the product administration owner supplies configured background cadence for held creations; it does not provide a public template catalog while optional task mode uses the canonical executor and scene policies. The running phase, driver stop, residency and model occupancy remain separate facts. Rejected or missing required effects block the scenario rather than guessing progress.

## Verification

Source-plane native-owner tests cover complete procurement, current/future transport retry, residency requirements, input ordering, pause before/after submission, warm response retry, foreign windows/context, absent checkpoints, rejected/missing effects, and drain timing. The driver has per-file 100% coverage. Real Loader snapshots use only a scripted external model, enforce the three scoped tools, and verify JSON/SQLite procurement, one-resident eviction, three process-interruption points, cold suffix restoration, original accepted effects and completed retry without inference. Snapshots pin the model-facing stage instructions from the admitted request.

The real product task Loader scenario covers JSON/SQLite, model/deterministic task cognition, background scheduling and nine cross-owner process exits. It confirms one task and one transfer through fresh input/epoch continuation, retained failure, target receipt reconciliation and a complete final checkpoint. The assembled Web flow displays the installed mode and produces the actual completed task without exposing general Team execution.
