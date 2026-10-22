# Agent Note: Original World request receipts avoid repeat admission

Status: implemented

English | [中文](2026-10-13-original-world-request-receipts.zh.md)

## Problem

Preparing an original request context after existing-person hiring repeats candidate eligibility checks. The original successful hire itself creates an assignment, so its requester cannot consume the original receipt through that context. The command and ordinary goal paths remain idempotent, but the dedicated request path incorrectly behaves as a new hire.

## Decision

The [Native context owner](../../../../packages/simulation/simulation-local/src/world.ts) distinguishes a not-yet-accepted intent from its already accepted request. The latter requires the original requester, pin, request/intent relationship, payload fingerprint and source operation. It records the immutable proposal, current receipt status and original journal references, with an empty execution read-set. It does not call domain admission or planning projection. Only the exact original request can be submitted; changed payloads, another intent or another actor still reject. The existing expansion and settlement owners suppress a second notification and business effect.

Unaccepted intents and new goal requests retain current authorization, eligibility and dependency checks. A prepared request context becomes a receipt context only when its original request already existed at that preparation revision. Domain implementation admission and writer/context consumption checks remain in force.

Native stream 83 rejects older streams because context preparation is reconstructed during replay. The original field shapes remain unchanged; SQLite schema, Session format and scenario compiler versions do not change with this context-selection fix. Historical views are not reconstructed under different semantics without the stream boundary.

## Alternatives considered

**Ignore candidate conflicts during new hiring admission.** That would allow genuinely new hiring requests to bypass assignment eligibility instead of distinguishing a receipt retry.

**Reuse the director's previous plan as retry context.** A requester needs its own original proposal and receipt, not another actor's rationale or an executable plan.

## Consequences

[Paid owner tests](../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts) cover both context paths, original and changed payloads, independent decisions, actor isolation and Native handle reopen. The [Loader booking workflow](../../../../examples/simulation-company/tests/world-booking.snapshot.ts) records the generic receipt in the real Agent Session, uses the three model tools, preserves one booking and restores the same view in a new process. Receipt text remains subject to the existing required-context budget. This fix grants no new operation permission, target IO or automatic restart.
