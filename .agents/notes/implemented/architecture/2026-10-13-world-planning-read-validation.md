# Agent Note: World planning read validation

Status: implemented

English | [中文](2026-10-13-world-planning-read-validation.zh.md)

## Problem

A prepared plan can outlive the permissions or capacity it read. A clarification question is also a planning action: asking under stale authority must not create another private message. Capacity failures during revalidation must preserve a stale predecessor rather than leave an executable accepted plan or misreport lost authorization.

## Decision

[World read validation](../../../../packages/simulation/simulation-local/src/world.ts) compares domain-owned typed dependencies and core authorization, not the global journal revision. Changed occupancy, domain conflicts and the specific position-capacity limit produce `read-set-changed`; actual authority errors produce `authority-unavailable`. Other quota and integrity failures remain their original errors. Native retains the plan proposal, reads, hash and original sequence when appending invalidation. Explicit replanning retains the predecessor through `supersedes`.

[Evidence admission](../../../../packages/simulation/simulation-local/src/world-evidence.ts) rechecks the original prepared resolve reads before expanding a new question. Rejected stale questions create no question or notification. Their prepared decision remains a charged planning attempt. Question derivation revalidates the same pre-question prefix; historical questions are never revalidated against later evidence revisions. Exact accepted retries return their retained expansion. A second question consumes the latest answer revision and still leaves one later planning slot.

## Alternatives considered

**Treat every quota refusal as stale.** History, message, byte and other finite allowances are not evidence that the original business read changed. Reclassifying them would obscure the actual stopping condition.

**Check only at business mutation.** Clarification already creates communication and an outstanding response responsibility. Its authority must remain valid before accepting those effects.

**Invalidate on every journal append.** Unrelated wakes and independent work would prevent valid plans from executing.

## Consequences

Dual-backend owner tests cover occupied positions, another original candidate hold, unchanged unrelated revisions, expired grants, two evidence rounds and retained failed planning attempts. The real company/laboratory driver records successive stale plans up to its frozen allowance and stops without further inference; cold restore preserves that history. Native stream 94 rejects earlier streams because stale reasons are verified by replay and must not be silently reinterpreted. The compiler remains version 9; no migration rewrites earlier invalidation records.
