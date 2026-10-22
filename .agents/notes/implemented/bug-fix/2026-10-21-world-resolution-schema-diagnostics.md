# Agent Note: World resolution schema and planning exhaustion

Status: implemented

English | [中文](2026-10-21-world-resolution-schema-diagnostics.zh.md)

## Problem

Director context exposes an operation identity and its business facts, but those facts do not define the accepted apply payload. A model can repeatedly submit invalid hiring selections without learning the missing fields. Timeouts then consume the remaining planning attempts while the persisted run phase still reads running.

## Decision

The [World driver](../../../../packages/simulation/simulation-world/src/driver.ts) captures a required `world-resolution-schema` block containing `planSchema` from the original installed handler in each new resolution context request. Native journals those sections before model dispatch, for both Channel-delivered and scenario-directed cases. The schema participates in the complete context allowance and ordinary Session replay. Replay never regenerates schemas inside old views: doing so would change their hashes and invalidate original consumption receipts.

Strict parser errors retain their category and complete cause while exposing at most eight bounded field diagnostics. Rejected payloads remain correctable within the same decision and cannot commit business effects. The [browser status owner](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx) exposes planning exhaustion in the summary; scheduling explains the charged evidence/timeout attempts and the unchanged limit after restart or checkpoint restoration.

## Alternatives considered

Increasing limits or deadlines only postpones an unspecified-payload failure. Rewriting old views or removing charged attempts would change retained model input or bypass the original budget. A new corrected run preserves both the history and its frozen allowance.

## Consequences

Resolution requests carry additional schema tokens. Oversized contexts retain their existing refusal rather than silently omitting the schema. Runtime and journal formats are unchanged. Existing exhausted cases cannot resume merely because the software now supplies better instructions.

## Verification

The [keyless driver scenario](../../../../examples/simulation-company/tests/world-driver.snapshot.ts) submits an invalid hiring selection, consumes the field error, corrects it and commits one hire on JSON and SQLite, then restores in a fresh process without inference. Parser tests cover nested missing fields, unexpected keys and bounded diagnostics. Browser component tests cover visible exhaustion and disabled scheduling in the existing status/control owners.
