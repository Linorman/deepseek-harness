# Agent Note: Memoryless external representation switches

Status: implemented

English | [中文](2026-10-19-memoryless-representation-switch.zh.md)

## Problem

Changing an external simulation implementation must preserve the original business identity and facts. An actor cannot be replaced by a rule merely by changing a prompt or dropping its Session.

## Decision

The [representation domain](../../../../packages/simulation/simulation-local/src/world-representation-domain.ts) supports only rule and director-mediated subjects without actor representative history. It records consecutive generations, original identity sequence, source revision, simulated time and an explicit absence of representation-owned memory and pending IO. Existing resources, contracts, facts and identity records remain under their original subject. Actor-to-rule downgrade is unsupported; [idle residency](2026-10-19-simulation-idle-residency.md) preserves the canonical Session instead.

Accepting a switch closes new interaction admission for that identity. Unfinished cases and scheduled or blocked external events prevent acceptance; the final Native queue rechecks these duties and the subject revision. The exact registered handler commits one mutation. Ordinary entity creation and profile replacement cannot inject or erase history. A failed callback retains its original Native request and unknown execution observation; reconciliation precedes another execution attempt. Exact mutation retry returns its original result.

## Alternatives considered

**Replace the original identity.** Reassigning the identity would detach prior facts and resource ownership from their source. The transition changes only an independent generation record.

**Summarize an actor into a rule.** No implemented memory-equivalence proof justifies this downgrade. The operation rejects all actor representative history, including retired representatives.

## Consequences

The supported transition is deliberately finite and creates no Person, Session, asset or model call. It does not establish arbitrary actor upgrades or cross-owner hot mutation. Original operation versions continue to describe historical results; current admission consults the retained generation independently.

[Two-backend tests](../../../../packages/simulation/simulation-local/tests/world-representation.spec.ts) exercise actual canonical decisions, the execution registry, source preservation, interrupted callback reconciliation, exact retry, forbidden overwrite and reopen replay. The [runnable snapshot](../../../../examples/simulation-company/tests/world-representation.snapshot.ts) freezes the real Loader flow's observable result.
