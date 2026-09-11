# Agent Note: Activation-authorized Team task creation

Status: implemented

English | [中文](2026-08-29-activation-authorized-task-creation.zh.md)

## Problem

A model-facing Team task producer needs a retry identity and an authenticated creator. A caller that submits only a Team cursor cannot distinguish an accepted task creation from a lost response after another Team mutation, and a free Participant id does not prove the active Session and AgentRuntime binding that issued the command.

## Decision

`TeamTaskCreateInput` requires `createCommand`, and `TeamTaskCreateRequest` adds the runtime-only `TeamActorProof`. The command's `creator` retains the exact Team, Participant, Activation, Session, and AgentRuntime provider identity, and its branded `idempotencyKey` is scoped to that creator. Every `TeamTaskSnapshot` retains that command immutably.

The Hub validates the current active coordinator Participant and exact idle or running activation binding before it looks up a command. A matching command with the same normalized creation fields returns the original task before cursor comparison. Reusing the creator/key pair with different task fields rejects with `TEAM_TASK_IDEMPOTENCY_CONFLICT`. No provider, including an in-process producer, can create an unattributed task.

Journal parsing, folding, and checkpoint recovery require the command, validate its binding relation at creation time, preserve it across later task revisions, and reject duplicate command identities without requiring a historical creator to remain resident. Team journal format 21 and Team checkpoint format 22 reject prior pre-release task shapes.

## Alternatives considered

**Keep a process-local retry map.** Rejected because Hub restart and checkpoint recovery would lose the accepted command identity and allow duplicate tasks.

**Authorize task creation with a caller-supplied Participant id.** Rejected because a Participant id does not prove the exact current activation, Session, or provider.

**Use only expected cursor retries.** Rejected because a response can be lost after durable acceptance, making the caller's cursor stale without identifying the original task.

## Consequences

The [durable task attempts and leases decision](2026-08-28-durable-task-attempt-leases.md) remains the authority for task lifecycle and owner fences. The [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) remains the authority for journal and checkpoint recovery. A later Team Link or model tool can derive `createCommand.creator` from its bound activation without exposing arbitrary creator facts to a model.

This foundation does not install a model tool, select a worker, assign a task, or route a task result.

## Verification

Core schema tests cover branded keys, required command records, and Team/task identity relations. Hub tests cover JSON and SQLite replay after restart, stale-cursor replay, conflicting reuse, policy actor derivation, exact-binding rejection, and missing-command journal and checkpoint rejection. Focused package coverage reaches 100% for the changed core and Hub sources.
