# Agent Note: Verify the installed World domain catalog

Status: implemented

Execution factories have a separate installed catalog in [simulation-world](../../../../packages/simulation/simulation-world/src/providers.ts), shared by actual handler construction and [Team restoration](../../../../packages/simulation/simulation-team/src/index.ts). Pure Native availability cannot substitute for an execution provider. Restoration inspects original history before writable open, compares strict parser object identity and exact pins, and repeats admission after exclusive open. Generation leases cover restoration IO and always release. Product recovery performs the same admission before retiring an existing owner. The [provider tests](../../../../packages/simulation/simulation-world/tests/providers.spec.ts) cover absence, replacement, parser disagreement, closed admission, retirement between inspection and open, and paused exact recovery. The [booking process test](../../../../examples/simulation-company/tests/world-booking-version.snapshot.ts) separately changes Native and execution installations; a provider-only refusal preserves original records and never calls writable open, attachment, factory creation or models. The Loader installs the execution provider as a sibling of Team and Product; Product reloads leave its catalog unchanged.

English | [中文](2026-10-13-world-domain-catalog-admission.zh.md)

## Problem

A parser unit test can pass while the shipped provider omits an operation or installs a different generation. Domain admission must reject malformed requests before identity allocation or business execution, including nested authority fields and unavailable versions.

## Decision

The [catalog admission test](../../../../packages/simulation/simulation-local/tests/world-catalog-admission.spec.ts) boots the existing real Loader composition in a fresh process for each storage backend. Its [consumer fixture](../../../../packages/simulation/simulation-local/tests/fixtures/world-catalog-admission.ts) resolves every exported built-in pin through the provider-owned registry, acquires and releases its exact implementation, and parses valid request, plan, noncommitted result and mutation specimens. Adding a new exported pin requires a specimen before the test passes.

Every object in each specimen receives an extra field in a separate negative case. Unknown domain, operation, version, caller fields and replacement generations must retain their specific rejection categories. Storage remains empty and no `simulation/committed` event fires. After Loader disposal, every original pin rejects new admission and execution. Source and plain-Node compiled modes assert their actual resolution paths independently.

## Alternatives considered

**Construct a second registry inside the test.** That proves parser behavior but cannot catch missing production registrations. Existing unit tests own registry internals; this test consumes the shipped provider composition.

**Reject only an empty or malformed payload.** Missing required fields can hide permissive handling of unknown fields. Each negative case starts from a valid specimen, changes one object, and requires rejection.

## Consequences

The probe covers installation, strict parsing and lifecycle admission without allocating a run or invoking a model. Compiled runs require existing build artifacts. The specimen set is not an exhaustive catalog of every valid payload union branch; domain-specific tests own those branches, authorization, effect semantics and crash recovery. Empty noncommitted results do not prove committed result correctness. This test supplies no real-model, SDK distribution or GUI acceptance evidence.

Actual Native intent, request, accepted plan and mutation admission, replayed payloads and typed read sets use `parseSimulationWorldSchema`. Only structural `ZodError` becomes `SIM_WORLD_SCHEMA`, retaining its cause; business authority/conflict/quota errors and provider implementation exceptions preserve their original identity. Classification neither accepts a malformed payload nor converts a definite business refusal into uncertain execution. Raw journal envelopes retain their existing journal-integrity validation.

Execution callbacks additionally retain a Native observation bound to their original plan/request/intent and implementation pin. Admission is armed before callback IO; typed refusals are blocked observations, while missing confirmation remains unknown and forbids a second execute callback. Reconciliation uses only the original provider and its Native reservation facts. Observations do not fabricate terminal business results or physical stop receipts. Stream 95 and checkpoint manifest 5 retain and fingerprint this responsibility. Each original plan has a bounded observation history, with four fixed record slots per configured operation/plan allowance reserved for admission, disposition and one reconciliation; identical observations append nothing. Exhaustion preserves unresolved ownership rather than releasing it. Unconfirmed execution also refuses new planning contexts and new plan acceptance for the same case; exact retries of an already accepted decision still return their original contents.
