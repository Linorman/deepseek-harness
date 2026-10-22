# Agent Note: Bound durable test scheduling and observe terminal receipts

Status: implemented

English | [中文](2026-10-16-durable-test-scheduling.zh.md)

## Problem

Simulation tests compose real Native, Team and Session journals. CPU-count process fan-out competes for host execution and durable IO; a delayed callback is not by itself a deadlock. Product commands also return acceptance before asynchronous preparation finishes. A default one-second polling helper incorrectly treats legal preparation latency as a business failure, and a fixture that fails before returning can strand its cleanup responsibility.

## Decision

The ordinary [Vitest configuration](../../../../vitest.config.ts) limits file workers to four. Explicit CI and coverage worker budgets retain precedence. In-test concurrency, selected files, five-second default test deadlines, existing explicit deadlines, retries, assertions and coverage thresholds remain unchanged. This bounds runner demand rather than weakening durability or suppressing slow tests.

World replanning tests observe the exact command journal terminal after its durable append and store fold, then assert the completed receipt. Lost-publication tests wait for the exact injected publication attempt before disposing and reopening the owner. These barriers remain subject to the test's original deadline; neither a successful initiation nor another command's completion satisfies them. The replanning fixture registers idempotent cleanup before subsequent initialization, so failed setup also releases its owners.

## Verification

The [investigation evidence](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/timeout-root-cause-proof-20261016.md) separates natural failures, injected latency and current validation. Delaying terminal publication by 1.2 seconds makes the original JSON/SQLite polling tests fail and the event-based versions pass under unchanged test deadlines. A separate fsync-delay experiment diagnoses serial IO accumulation; its split diagnostic phases never replace the original test or count as acceptance.

## Alternatives considered

**Raise deadlines or add retries.** Rejected: this hides unexplained stalls and changes the acceptance conditions.

**Skip fsync or replace durable owners with memory fixtures.** Rejected: the tests must preserve crash-durability and original identity behavior.

**Infer success from a rerun or call every slow callback a disk fault.** Rejected: scheduler stalls can delay filesystem callbacks too. Preserve timelines and failed assertions, and distinguish verified fixture defects from unresolved host causes.

## Consequences

The worker bound can lengthen CPU-only suites and remains overridable for measured CI capacity. It is not a production throughput guarantee or a claim that every historical timeout has one cause. [Parallel gate scheduling](../process/2026-07-06-parallel-pre-push-gates.md) still owns aggregate concurrency, and [partitioned coverage](../process/2026-08-18-in-job-partitioned-coverage.md) still owns coverage partitioning; neither is superseded. Overall MVP acceptance additionally requires current-input integration evidence.
