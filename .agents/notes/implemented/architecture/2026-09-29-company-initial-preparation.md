# Agent Note: Company preparation before the initial checkpoint

Status: implemented

English | [中文](2026-09-29-company-initial-preparation.zh.md)

## Problem

Company initialization must survive a target commit whose response is lost before the initial complete checkpoint. Recreating entities or resetting balances duplicates or destroys durable facts. Restoring a checkpoint cannot reconcile preparation when no complete manifest exists.

## Decision

The [production preparation module](../../../../packages/simulation/simulation-product/src/company-preparation.ts) reconciles the version 1 buyer/supplier procurement topology on a caller-owned paused run. Its strict trusted settings define names, original stock, participant route, canonical Team objective and checkpoint collector bounds. The caller retains settings with its creation intent and drains preparation before closing the run. Native bootstrap and the temporary Team connection own their existing exclusive retirement registration; preparation adds no competing retirement owner.

Before writes, preparation refuses progressed scheduling, decisions, inputs, altered profiles/balances and unrelated topology. It fills absent entities and resources without resetting retained values. Root, participant, Session and channel identities come from the native durable reservations. Identical in-flight requests share one operation; changed requests cannot replace it. Checkpoint collection publishes the initial complete manifest, then drains the temporary connection before returning. No actor is activated and no model is called. A failed checkpoint remains terminal under its original identity; an explicit new checkpoint request can collect a later complete cut.

The [runnable company example](../../../../examples/simulation-company/tests/product-preparation-scenario.ts) consumes this production implementation. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) remains active for scheduling ownership, administrative control and automatic execution. The [durable coordination proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md) retains its independent execution, scheduling and recovery rationale; neither proposal is fully superseded.

The [persistent creation decision](2026-09-29-persistent-company-creation.md) owns public allocation, original request outcomes and paused preparation handles; this note retains its independent rules.

Installed deterministic workflows extend the foundation through a bounded trusted topology: at most 32 actors and 32 channels including buyer/supplier/purchase. One resolver validates unique identities, complete channel membership and report routes, then supplies preparation, capacity admission and single-target ingress. All actors inherit the existing in-process placement and empty capabilities; channels use empty limits. Creation retains matching topology in preparation and driver settings, independently of later template edits. Partial extra-actor/channel commits reconcile their original reservations, and initial/maintenance checkpoints include all Session/channel references. Additional actors never inherit stock controllers or ordinary Team tool authority.

## Alternatives considered

**Blindly repeat every create.** Entity/resource create rejects existing identities and cannot establish that existing facts still match the requested preparation.

**Use normal restore before a manifest exists.** It skips unresolved creation responsibility and cannot validate cross-owner sources against a complete cut.

**Activate actors during preparation.** It permits inference before initial cross-owner persistence is verified and consumes residency without a scheduling command.

## Consequences

The module requires exclusive caller ownership and an unstarted company topology. It is a Host preparation capability, without a public creation catalog or browser-supplied storage selection. It does not allocate product run/command identities, implement a scenario driver, or enable automatic tasks. Discovery remains read-only and opt-in. Failed preparation preserves partial native history for explicit reconciliation.

The [procurement driver](2026-09-29-company-procurement-driver.md) owns post-preparation control batches. It does not replace topology reconciliation or initial checkpoint obligations.

## Verification

Real JSON/SQLite owner tests cover exact retries, shared pending work, changed retained facts, invitation response loss and terminal checkpoint failure. Keyless Loader snapshots kill the process after Team, entity, participant, channel, resource and checkpoint commits, then reconcile the same run. They check canonical identities, exactly two participants, complete unmaterialized Session references, zero actors/model calls, write-free completed retry, and validation/restoration of the initial manifest to paused state.

The [topology regressions](../../../../packages/simulation/simulation-product/tests/topology.spec.ts) exercise an independent third reviewer and exact second-channel delivery on JSON/SQLite, checkpoint/cold restore under changed deployment metadata, zero inference, unchanged resource balances, same-source distinct tasks and authorized third-actor ingress. Preparation tests reconcile a lost extra-participant invitation using its original identity and complete unmaterialized Session/channel references.
