# Agent Note: Bound the original World acceptance append

Status: implemented

English | [中文](2026-10-13-world-acceptance-envelope-budget.zh.md)

## Problem

A World request or plan can fit its inner business-record allowance while the accepted append exceeds it. Run/revision wrappers, expanded operations and causal scheduler records are retained output too. Checking only a partial expansion leaves a path around the declared byte ceiling.

## Decision

The [Native commit owner](../../../../packages/simulation/simulation-local/src/run.ts) measures the final `JSON.stringify(batch)` UTF-8 bytes after all hiring-resource scheduler additions and before publication. Each newly accepted expanded `world/request` uses its frozen `maxBytesPerRequest`; `world/resolve` uses `maxBytesPerPlan`. The actual batch includes run/revision wrappers, serial decision completion, expanded operation intents and queued, deadline, timed or scenario records when present. Oversize acceptance raises `SIM_WORLD_LIMIT/bytes` without appending any part of that batch.

Window decision finished/submitted records belong to separate appends; this rule measures only the actual acceptance append. An already accepted exact retry adds no append and receives no new byte charge. Native stream 85 refuses earlier streams; compiler 8, strict payload parsers and SDK schemas remain unchanged.

A window proposal may already have successful Session stage/submit evidence and a retained inference finish when final Native acceptance rejects its bytes. `commitWindow()` records the supported World refusal as `worldSubmissionBlock` with the original submission hash, cancels that slot while retaining its submission, and closes the window in the same refusal append when every slot is terminal. Earlier accepted slots remain committed. The driver reports `stalled`/`world-byte-limit`; checkpoint validation correlates the actual successful Session stage/submit with the Native refusal rather than inventing a failed tool result.

Projection validation continues checking inner business records. Historical replay does not reconstruct or remeasure the complete original acceptance batch. The quota is an admission check on the original append, not a new batch-size replay invariant.

## Alternatives considered

**Check each generated business record.** Each record can fit while their aggregate and wrappers exceed the original allowance.

**Check expansion before common commit.** Final funding scheduler records can extend that batch afterward; the durable append owner has the complete output.

**Include every window preparation append.** Separate finished/submitted records are not part of the acceptance append. Combining them would define a different quota and invent a batch that storage never receives.

## Consequences

The same payload can require a larger explicit byte allowance because its durable envelopes and generated effects count. A rejected acceptance batch contributes no accepted effect; its subsequent durable refusal records the cancelled slot and stop. Earlier accepted window slots are not rolled back. [Native tests](../../../../packages/simulation/simulation-local/tests/world-acceptance-budget.spec.ts) cover exact UTF-8 request/plan boundaries, window admission, expanded counts, append refusal and original retries. [Real Loader tests](../../../../examples/simulation-company/tests/world-acceptance-bytes.snapshot.ts) calibrate the actual append, accept its exact allowance and reject one byte less across both backends and source/lib, with two cold restores. The recorded matrix also preserves external reservation/commit byte-fault boundaries without increasing their budgets; 40 cases and 120 processes retain original journal and Session evidence. This does not complete the full World or real-provider acceptance.
