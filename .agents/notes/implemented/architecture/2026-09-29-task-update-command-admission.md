# Agent Note: Task update command admission

Status: implemented

English | [中文](2026-09-29-task-update-command-admission.zh.md)

## Problem

A lost task-edit response leaves the browser unable to distinguish accepted changes from an uncommitted request. Retrying against a new revision can apply a second edit, while replacing the original command after later typing loses the submitted operation's identity.

## Decision

Task-detail updates require a caller-owned branded command ID. The Hub retains normalized editable input, exact human or coordinator author, original expected/applied revisions and acceptance time atomically in the task journal record. Identical current-author retries return immutable original acceptance plus the explicitly current task without appending. Changed author or payload rejects; current proof and policy remain required. `maxTaskUpdateCommandsPerTeam` bounds all terminal outcomes without eviction, and `maxSelectionBytes` bounds each private outcome. Team journal/checkpoint formats are 38; old formats reject.

After authority and policy pass, a deterministic task mutation fold identifies stale revision, workflow ownership, active execution or invalid edit. The Hub commits `task/update-rejected` before emitting `TeamTaskUpdateRejectedError`; generic parser, authorization, capacity and storage failures do not establish a terminal refusal. Exact refused retries remain refused after conditions change. Refusals update only the Team cursor and command ledger, never task fields or revision. Journal replay verifies the reason and diagnostic against the observed task; checkpoints preserve historical outcomes rather than recomputing them from advanced state.

Journal and checkpoint validation bind receipts to retained Team, task, author and activation facts. New journal admissions require active authority and exact submitted changes; checkpoint ownership remains historical after departure or activation retirement. Accepted metadata contains neither submitted instructions nor proof material.

Exact read lookup returns `applied`, `rejected` or `not-found`. Host and SDK readers check direct or canonical parent authority before and after provider IO, including failure. Host definitive error responses carry original refusal metadata. Runtime checks its command identity and withholds both results and diagnostics after cancellation, Team replacement or authorization replacement. Observed outcome revisions advance the inspector's minimum revision; failed rereads keep older fields stale. Lookup does not execute a command, and absence cannot prove rejection or cancel a delayed request.

The viewing store retains original payload and ID before sending. Fresh submission stays disabled until the original outcome is confirmed or the user explicitly discards the draft. Explicit lookup/retry uses that original input despite later typing. Acceptance preserves later edits and requires current-revision review before a new command. Refusal preserves entered fields and the resolved submitted input; changing fields or explicitly reviewing a newer task revision enables a new ID. Closing and navigation preserve input under existing quotas, without copying server facts into the viewing store.

## Alternatives considered

**Retry with the latest revision.** It creates another mutation instead of confirming the submitted operation.

**Retain only an in-memory ID.** Reloaded Hub state cannot distinguish a replay from a new update.

**Treat absence as failure.** A delayed original request can still reach serialized admission.

## Consequences

Bounded admission may fail without retaining an outcome. Such failures remain unresolved until lookup or exact retry confirms one. Explicit discard does not cancel a submitted update. Original terminal metadata survives task advancement and checkpoint recovery; historical retries still require current write authority. The complete authorization and visual matrix remains separate validation work.

## Verification

JSON and SQLite tests prove atomic terminal outcomes, unchanged tasks on refusal, exact retry, changed-payload refusal, advanced conditions and recovery. Append failure yields no definitive refusal; checkpoint failure preserves a committed refusal. Parsed durable-input tests reject invented reasons and mismatched identity, time, author, activation or fields. Core/Hub helpers and draft comparison have complete targeted coverage. Host and runtime tests validate original identities and withhold retired responses. TS/Python clients parse all three lookup outcomes. Component and real-Host keyless flows cover direct refusal, lost refusal responses, original retry before acceptance, closing and corrected new submissions.
