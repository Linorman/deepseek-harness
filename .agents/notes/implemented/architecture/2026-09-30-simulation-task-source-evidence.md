# Agent Note: Simulation task source and attempt evidence

Status: implemented

English | [中文](2026-09-30-simulation-task-source-evidence.zh.md)

## Problem

A task in the same Team can belong to an unrelated creator or executor. Linking only task identity, revision and phase lets its completion fulfill another entity's accepted interaction.

## Decision

The canonical Team reader verifies immutable Simulation creator attribution, original creation key and this run's accepted task-creation receipt. Reconciliation and checkpoint target inspection share that projection. Durable evidence retains the creation operation and current or last settled attempt's participant, activation when present, attempt identity and outcome. Journal version 43 rejects earlier formats.

The native fold independently checks the accepted operation/receipt relationship and requires any observed executor to equal the interaction assignee. Completed/review task evidence requires a completed attempt. Same-revision evidence is immutable; exact retries return the original fact without another append, including while a later window is open. Only `task-completed` fulfillment derives completion; explicit approval and transfers retain their own evidence. Cancellation is not revived by later task completion.

The [automatic-execution proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) and [coordination proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md) retain execution links, scoped execution proofs and executor ownership. Neither is superseded by this observation mechanism. The [creation owner](2026-09-29-persistent-company-creation.md) retains independent administration ownership.

## Alternatives considered

**Infer a link from subject or Team membership.** Neither identifies the accepted source or authorized executor.

**Treat task phase alone as completion evidence.** It omits the attempt that produced the result and permits another participant to fulfill the commitment.

**Repeat provenance checks in checkpoint and reconciliation readers.** Independent implementations can disagree about the same creation.

## Consequences

Ordinary Team-created tasks cannot serve as Simulation completion evidence. Historical activation identities remain valid attribution after retirement; observations grant no live authority. This does not automate task assignment or prove world effects.

## Verification

JSON/SQLite unit tests reject unrelated receipts, wrong executors and changed revision facts while retaining valid evidence across restart. Real Loader knowledge/task snapshots kill processes after task creation and completion, then recover the same receipt and exact completed attempt. The example still constructs assignment and completion through test helpers; it is not production executor evidence.
