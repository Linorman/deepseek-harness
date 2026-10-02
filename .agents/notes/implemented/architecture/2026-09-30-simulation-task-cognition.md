# Agent Note: Recorded task cognition and exact attempt start

Status: implemented

English | [中文](2026-09-30-simulation-task-cognition.zh.md)

## Problem

A reserved task attempt does not identify which decision or model input belongs to it. Reusing another input, starting before Session persistence, or treating submission as completion loses causal evidence and may repeat inference after response loss.

## Decision

The [task-decision producer](../../../../packages/simulation/simulation-team/src/task-decision.ts) records exact canonical instructions, decision identity, predecessor and reason before opening a decision. A run-owned index identifies its original attempt. Each association retains its writer epoch and immutable input receipt; another decision requires an accepted or cancelled predecessor and a closed window. Native journal format 45 rejects earlier formats.

Required input materialization adds the task/attempt/source identity and instructions to the existing required `simulation/context-view` Session event. The complete input content participates in the configured context budget, and replay checks its native source and exact text. No new Session event kind or loop change is required.

Input dispatch flushes the identified Session queue before retaining its native receipt. The Hub's dedicated start rechecks the runtime-only native input proof, canonical creation and current lease under its task lock around policy IO. Only then may the actor wake. Model and tool admission check the current canonical task lease and retained instructions; inference also requires the native running-task observation and exact input. An original decision retry retains its existing context and inference result.

The [assignment decision](2026-09-30-simulation-task-assignment.md) retains reservation, authority and controller-retirement ownership. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) remains active for automatic scheduling. Neither is fully superseded.

## Alternatives considered

**Reuse an unlinked ordinary decision.** It cannot establish the original task source or exact attempt.

**Wake before the task starts or queue persistence completes.** The model can enter a step without a canonical running attempt or reconstructable input.

**Complete the task when its model submits.** Submission records intent; world effects remain pending and may fail.

## Consequences

A task attempt can retain several ordered decisions in the same live epoch. Each association fixes model cognition or an exact deterministic policy generation; replay rejects substitution. Deterministic execution records the prepared context and identified consumed input under the actor maintenance lock, flushes the Session and starts the exact task before computing its pure policy. It creates no model turn or request. Task cognition uses the existing three Simulation tools and starts no additional model on an exact retry. Applied world effects remain distinct from task completion. The [task completion decision](2026-09-30-simulation-task-completion.md) owns scenario predicates and result settlement; the production automatic executor remains incomplete.

## Verification

Real JSON/SQLite Loader snapshots pin recorded task context, actual attempt start, original inference retry and inventory changes after explicit operation application. The task remains running until controller retirement. Unit tests reject missing/retired/foreign attempts, changed source selection, unprepared inputs, broken indexes and revoked start authority during policy IO. Pure-task Loader snapshots verify zero inference, recorded input, actual start, applied transfer and result settlement. Native tests reject unselected or changed cognition and preserve the selection across cold replay. This evidence does not establish an automatic executor or its full process-exit matrix.
