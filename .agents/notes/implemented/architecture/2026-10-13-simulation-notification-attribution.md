# Agent Note: Simulation notification attribution

Status: implemented

English | [中文](2026-10-13-simulation-notification-attribution.zh.md)

## Problem

The direct renderer intentionally selects model-visible content from a Team Envelope. Equal rendered messages therefore do not establish equal publication attribution: audience, trace and accepted-operation correlation may differ. A checkpoint must prove the same cross-owner source as live recipient admission.

## Decision

[One source validator](../../../../packages/simulation/simulation-team/src/accepted-envelope.ts) compares the retained Native publication receipt, accepted decision, canonical bindings and complete original draft fields with the actual Team Envelope. Live delivery invokes it before admitting recipient input. Checkpoint and writable restore invoke it while validating the retained Channel prefix. Unsupported causation, task and lifetime metadata reject; Hub-resolved priority and acceptance time remain Hub-owned.

Session consumption remains a separate proof. The selected notification must enter the canonical Session exactly once, alongside the exact prepared context and control input, and be flushed before Native accepts the proof. A later evidence revision selects its own notification: consumption of the original request cannot substitute for consumption of that revision. Receipt, inbox admission and consumption remain distinct.

## Alternatives considered

**Compare rendered text alone.** Rendering deliberately omits transport metadata and cannot establish publication attribution.

**Rely only on publication-time Hub proof.** That proof controls the original append, while delivery and recovery must verify the retained cross-owner reference they actually read.

**Separate live and recovery comparisons.** Independent field lists allow one path to silently omit a newly relevant field.

## Consequences

Malformed retained attribution refuses live input or writable recovery before model execution. This tightens validation of existing publication fields without inventing new events or migrating history. Dual-backend tests alter Envelope metadata, reject copied request indices and missing consumption, and then permit the exact original retry. The real evidence flow also proves that a queued revision notice cannot authorize a new plan, while consuming and flushing that same original notice permits the retained submission.
