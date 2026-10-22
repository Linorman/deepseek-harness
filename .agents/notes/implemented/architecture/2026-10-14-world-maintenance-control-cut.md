# Agent Note: New control intent invalidates a maintenance cut

Status: implemented

English | [中文](2026-10-14-world-maintenance-control-cut.zh.md)

## Problem

Structural maintenance retires writers and collects canonical Team/Session evidence outside the Native queue. Its sealed Native cut nevertheless rejected new pause/cancel writes during those reads. A product cancellation could already be durable while Native had no cancellation record; automatic continuation then saw unchanged control history.

## Decision

Native admits only pause and case cancellation through a private control queue mode while a cut is draining or sealed. Production writes and running admission remain closed. Control commits change the durable revision; the old cut retains its original reference and cannot publish the changed prefix. Native pause also coexists with an in-progress checkpoint, while new running requests still refuse. Native stream 94 rejects earlier fold interpretations.

Canonical reads classify `SimulationRevisionConflictError` as source movement. Maintenance owns one original `maxAttempts` allowance: each attempt collects one fresh candidate. Team/Session movement may retry; Native movement retries only when durable management or cancellation history changed. Missing evidence, unrelated Native movement and exhausted attempts still fail with the original maintenance retained. Every failed candidate releases its barriers before another cut is collected.

The [authenticated scenario](../../../../examples/simulation-company/tests/world-maintenance-intent.snapshot.ts) holds real retirement IO, a Team persistence-reference response under a sealed cut, or the final automatic `setPhase` call. It uses actual generated hiring, mediated representative preparation, transfer and departure. New control must enter Native before held IO is released. Without new intent the adapter resumes; with new intent it stays paused. Cold restoration and the same command retry preserve that result.

## Alternatives considered

**Wait for IO before recording control.** That can lose a newly accepted user intent to automatic continuation.

**Release the production barrier for control.** That admits unrelated business writes and weakens checkpoint publication.

**Retry inside and outside each old cut.** That multiplies the frozen allowance and rereads a permanently invalid Native reference.

## Consequences

Existing adapter revision CAS still protects the final resume window. The driver also rereads phase after awaited resident IO and nomination before allocating a window, so a subsequent legitimate pause returns paused rather than failing admission. Unrelated provider IO errors still propagate. This decision fixes admission during external collection IO rather than replacing that CAS. No new DTO, Session event, compatibility shim or model generation is added. Product public-checkpoint management serialization is separate from Native pause admission; the structural-maintenance probes do not claim that every public checkpoint API call is immediately interruptible.
