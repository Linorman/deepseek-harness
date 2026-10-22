# Agent Note: Simulation idle residency selection

Status: implemented

English | [中文](2026-10-19-simulation-idle-residency.zh.md)

## Problem

Fixed eviction lists ignore recent simulated activity and repeatedly select actors with accepted responsibilities. A wall-clock timer cannot prove that a writer has stopped or that its Session is durable.

## Decision

The [Team residency owner](../../../../packages/simulation/simulation-team/src/residency.ts) applies an optional [versioned idle policy](../../../../packages/simulation/simulation-team/src/residency-policy.ts) inside the existing demanded-residency operation. It derives last activity from original decisions and received messages at one Native revision, excludes pending responsibility, orders by age and identity, and bounds the candidate count. Every asynchronous retirement is followed by a fresh eligibility check. The canonical hibernation controller remains responsible for admission closure, Session flush and confirmed writer release.

The deployment policy defaults to disabled. Company and task scenarios may retain an explicit policy in their immutable driver configuration. Unknown epochs take precedence over ordinary eligibility and return recovery-required without another retirement attempt. Neither policy selection nor resume invokes a model. Actual writer transitions remain in the existing Native/Team journals.

## Alternatives considered

**Wall-clock eviction.** Real elapsed time is not simulated inactivity and cannot safely release a live writer. The policy uses canonical simulated activity instead.

**New residency lifecycle.** A second cancellation or disposal state machine would duplicate the controller’s durable ownership. Selection only calls the existing hibernation path.

## Consequences

Selection scans retained decisions, operations and responsibilities; it does not claim an index-backed complexity improvement. Capacity refusal is expected when all candidates are protected. The feature neither downgrades representation nor changes cognition, assets, historical Team capacity or Session identity. Local structural mutation remains independently gated.

The [two-backend tests](../../../../packages/simulation/simulation-team/tests/residency-policy.spec.ts) cover idle thresholds, pending wakes, malformed policies, same-Session resume and unknown retirement retry. The [Loader scenario](../../../../examples/simulation-company/tests/product-driver.snapshot.ts) exercises automatic placement through the production driver with one resident slot.
