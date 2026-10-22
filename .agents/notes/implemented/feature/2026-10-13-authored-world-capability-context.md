# Agent Note: Authored capabilities determine compiler and actor context

Status: implemented

English | [中文](2026-10-13-authored-world-capability-context.zh.md)

## Problem

A portable definition must supply every relation rule required by its installed effects. A mediated representative uses `represents` even when the definition installs only external operation version3. An actor proposing a committee decision also needs the original rule and quorum in its recorded context; a hidden test constant cannot substitute for the authored institution.

## Decision

The [v1 compiler](../../../../packages/simulation/simulation-scenario/src/v1-compiler.ts) installs the `person → organization` scoped `represents` rule for the actor operation, or for mediation explicitly permitting `representative-preparation-plan`. Failure-only mediation installs no representative capability. Compiler7 retains the deterministic rule set in the resolved commitment and rejects earlier compiled records.

The [Native committee projection](../../../../packages/simulation/simulation-local/src/world-norm-bootstrap.ts) exposes rule/quorum only after the original bootstrap has applied and through the requesting actor's exact live proposal-operation grant. Scope, committee target, relation, operation and interval must match. A foreign actor, another operation, ended/replaced grant or uninitialized world receives no policy material. The projection retains the original bootstrap sequence and definition hash, and excludes other committees and private documents.

Both proposal and single-hire approval goals include that material. The original `simulation/context-view` and actual Agent model input retain it. Native admission still checks the frozen author rule, quorum and membership independently; readable material does not grant permission or authorize a vote.

The [portable company](../../../../examples/simulation-company/scenarios/world-company-v1.json), [laboratory](../../../../examples/simulation-company/scenarios/world-laboratory-v1.json) and [association](../../../../examples/simulation-company/scenarios/world-association-v1.json) definitions use one [driver workflow](../../../../examples/simulation-company/tests/complete-world.snapshot.ts). Company/laboratory use new hiring, original fees, governance enactment, representative contact and personnel changes. The association uses an authored institution, threshold voting, an eligible existing volunteer, finite position calendars and failure-only external mediation with unknown inventory. The external keyless model receives only actual recorded inputs; the test owner verifies receipts and state separately.

## Alternatives considered

**Install all effect rules unconditionally.** This would advertise representative capability for definitions that permit only failure. The compiler derives the required fixed rule from the exact installed operation and allowed outcome.

**Let the model infer committee thresholds from a scenario name.** Names do not establish policy. The actor consumes the original Native projection, and different institutions use the same adapter.

## Consequences

Authored capabilities remain executable without rewriting resolved inputs after compilation. Changing defaults, capabilities or the original rule set changes the reviewed commitment. Cold recovery uses original persisted data and remains paused. Keyless workflows prove protocol composition; real-model quality, full browser execution, nonempty handoff and new charged-hire process-loss boundaries require their separate checklist evidence.
