# Agent Note: Complete World checkpoint responsibility references

Status: implemented

English | [中文](2026-10-14-world-checkpoint-reference-coverage.zh.md)

## Problem

A full World projection fingerprint can bind data that has no individually inspectable checkpoint responsibility reference. Missing-evidence rounds and external adjudication/delayed-event duties need explicit references so their original source, disposition and retained notification can be checked without disclosing their private bodies.

## Decision

[Checkpoint World summaries](../../../../packages/simulation/simulation/src/checkpoint.ts) enumerate all original intent/request/plan/result/mutation/reservation/cancellation, fact/institution versions, governance, external registry and personnel records. Evidence challenges and immutable answer revisions have their own record kinds. External adjudications and delayed event responsibilities also have their own kinds; an event reference uses its original adjudication sequence, while its content fingerprint binds scheduled/blocked/consumed disposition, block history and actual consumption. Answer references retain the original input-revision ordinal.

The definition fingerprint binds every original template and policy; the World projection fingerprint binds the complete World and bootstrap. The run-prefix fingerprint and full original journal include all initial/generated/representative Entity profiles and Persona data, resources, commitments, operations, context/notification responsibility and canonical cleanup evidence. Materialized Session references bind the original delivered context and model/tool history; an unmaterialized Session cannot replace actual execution history. Summaries expose identities, versions, sequences and hashes, not copied private bodies.

Publication compares the complete derived summary with the candidate at its sealed Native cut. A missing or altered individual record refuses publication even when the full projection hash is unchanged. Writable replay checks the same relationship. Checkpoint manifest 8 and Native stream 98 reject earlier formats; no fallback synthesizes omitted references from a current deployment. Compiler 9 and the generic SQLite/Session formats remain unchanged.

## Alternatives considered

**Use only the full projection hash.** It protects complete replay content but cannot identify each original missing-evidence or delayed duty in the responsibility index.

**Copy every private body into the manifest.** This creates a second disclosure surface and duplicates the original retained journal. References and content commitments preserve one authoritative body.

**Accept old manifests and fill references during replay.** That silently changes the accepted checkpoint contract and hides incomplete source evidence. The pre-release backend rejects old formats explicitly.

## Consequences

The [real checkpoint probe](../../../../examples/simulation-company/tests/checkpoint-world-coverage.ts) compares each recorded reference to its owning Native table, verifies whole-definition/projection commitments, and submits missing/fingerprint/sequence mutations at a live sealed cut. Rejections leave the revision and business state unchanged; the correct complete vector publishes. [Missing-evidence hiring](../../../../examples/simulation-company/tests/world-evidence.snapshot.ts), [delayed and blocked adjudication](../../../../examples/simulation-company/tests/world-external-mediated.snapshot.ts), and [three portable workflows](../../../../examples/simulation-company/tests/complete-world.snapshot.ts) supply actual Agent/Session/Channel history and cold-process replay on both backends.

This owns the reference-completeness contract. [Public failure attribution](2026-10-01-simulation-checkpoint-failure-diagnostics.md) and [checkpoint-gated Team history compaction](2026-09-01-checkpoint-gated-team-wal-compaction.md) retain their independent error/privacy and retention contracts; neither is superseded. Cross-owner corruption and crash-boundary acceptance still require their own tests rather than a World hash alone.
