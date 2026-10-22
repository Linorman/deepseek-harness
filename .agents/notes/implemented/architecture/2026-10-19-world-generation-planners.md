# Agent Note: Isolated generation and director-owned planner selection

Status: implemented

English | [中文](2026-10-19-world-generation-planners.zh.md)

## Problem

Generation must not inherit hidden director context or become another world writer. Lost model responses must not silently trigger another paid attempt.

## Decision

[Generation contracts](../../../../packages/simulation/simulation/src/world-generation.ts) retain actual disclosed bytes and immutable audience/scope. A dedicated canonical Session receives one tool-free request, independently of director history. Native owns job acceptance, original identity, unknown responsibility and shared token charges; Session owns exact input and raw output events. Output flush precedes Native validation. Recovery reuses the original Session result and never silently regenerates. Generation job and planner assignment IDs are branded internally while retaining their original string wire representation. Checkpoint, restore and retry share exact Native-to-Session input/output validation; a dispatched job cannot become an unmaterialized Session when its file disappears. Unknown attempts without output retain their original responsibility. Quiescent archive capture refuses active helper inference.

Planner assignments bind an existing domain request. Native freezes its actual read-set at acceptance; effect and disclosure scope, single attempt, depth, children and total parent budget are bounded. Admission checks the current assignment’s subtree and every ancestor, so a child overrun blocks its root planner’s next inference without discarding accepted responsibility. The director receives validated output in its actual context and explicitly selects its generation ID. Native verifies that exact consumed result, payload and read-set before retaining the ordinary director plan. The single original mutation queue retains stale and successor history. Ready plans are served by acceptance sequence; blocked plans keep their responsibility without preventing unrelated ready work.

## Alternatives considered

Reusing director history would permit hidden input leakage even if a later prompt requested privacy. Dedicated Sessions reject prior cognition history and cross-scope reuse. Direct helper mutation would create another authority source; selection therefore remains an actual director decision. The Product bridge submits through A2 preview and authenticated draft acceptance, retaining generation provenance and the exact draft revision/hash. It does not bypass finite-template review rules. Host authorization supplies disclosure policy and helper identity preparation; there is no automatic per-role helper allocation or production-provider performance claim.

## Consequences

The original Native and Session logs jointly preserve input, output, cost and selection provenance. Helpers remain opt-in and do not bypass the existing domain authority or finite Persona review.

## Verification

[Native tests](../../../../packages/simulation/simulation-local/tests/world-generation.spec.ts), [Team tests](../../../../packages/simulation/simulation-team/tests/generation.spec.ts) and [planner tests](../../../../packages/simulation/simulation-local/tests/world-planners.spec.ts) exercise both JSON and SQLite. They cover scope and canary isolation, shared accounting, revocation, output response loss, no regeneration, unload responsibility, actual director consumption and conflicting read-sets. A fixed-delay external-provider fixture measures two independent requests in parallel versus serial execution; the evidence describes this bounded mechanism rather than real-model throughput. Stream 100 rejects older Native journals; Session format remains zero with required typed events.
