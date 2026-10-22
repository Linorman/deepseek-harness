# Agent Note: Private author revisions and independently accepted offers

Status: implemented

English | [中文](2026-10-17-world-author-revisions-and-offers.zh.md)

## Problem

A portable definition is not a running world, and local editor history cannot safely arbitrate concurrent saves. Likewise, delivering an offer or reviewing a Persona does not prove that the candidate accepted its terms. Reusing these projections as authorization would overwrite work or hire a person without their independent decision.

## Decision

The Product owner keeps private author revisions in a dedicated versioned log. Saves retain the original save ID, authenticated author, parent revision and complete definition. One serialized queue compares the parent and appends before publication; conflicts return both documents. Exact retries recover the original save. Ambiguous append failures fence the owner until replay, and bounded immutable ancestry is never silently evicted. Missing and foreign document IDs have the same read response.

Graph and equivalent keyboard controls stage closed commands against the same v1 compiler as source imports. The Host validates references, cycles, finite template choices and capacity before the editor adopts a candidate. Every view shares the complete definition; layout and view selection never become Native facts. Undo changes only local draft state, while submitted creation remains locked. Read-only authoring and preflight allocate neither models nor running identities. Existing runtime edits use separately reviewed original commands.

Persona drafts, vacancies, applications and offer revisions use committed Native domain results as their durable owner. Finite Persona revisions retain their source, hash and review state; edits invalidate prior review, and accepted content is immutable. Authenticated user review records a user source rather than impersonating an actor. Candidate applications and responses require the actual canonical Decision/Session, explicit market scope and matching terms hash. Delivery alone never commits acceptance.

Each vacancy freezes whether its original position and one-time fee are reserved on proposal or acceptance; the corresponding transition reserves them in the same Native append. Existing hire execution must consume that exact accepted offer; competing offers, stale revisions and mismatched terms cannot replace it. Unknown preparation retains the original identity and obligation. Cancellation and expiry do not release accepted responsibility or repeat fees. Recurring salary is unsupported and cannot be inferred from the one-time amount. Product projections separately authorize case and Persona content, and private full detail is bounded by the complete response allowance.

## Alternatives considered

Last-write-wins would silently lose a concurrent definition. Browser storage of private bodies would extend their lifetime beyond credential revocation; explicit Host saves and in-memory edits retain the existing privacy boundary. Arbitrary JSON patches against a run bypass domain validation and cannot represent compensation. Treating offer delivery or a Host fixture as candidate consent would fabricate the independent actor decision. Separate mutable market tables would duplicate the existing Native result history.

## Consequences

Draft history has its own format version and retention allowance; exhaustion requires an explicit owner decision, not hidden deletion. The graph displays bounded windows and never claims that an incomplete window is the entire world. Saved drafts can be reopened by ID after browser refresh. Unknown saves and calendar submissions retain their original payloads for exact retry.

The [keyboard-control decision](2026-10-15-world-authoring-keyboard-controls.md) still owns focus, reference suggestions and source-editor behavior; it is not superseded. The broader [visual-layer proposal](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.md) remains applicable to other visual modules. [Finite calendars and composite governance](2026-10-16-world-calendar-review-routes.md) owns calendar, proxy and ReviewRoute persistence.

## Testing

[Draft store tests](../../../../packages/simulation/simulation-product/tests/draft-store.spec.ts) use real JSON/SQLite journals for concurrent CAS, cold retry, ambiguous append recovery, privacy and bounds. [Graph commands](../../../../packages/simulation/simulation-scenario/tests/draft-commands.spec.ts) use the shared compiler. [Component tests](../../../../packages/client/ui-simulation/tests/world-post-mvp-author.client.spec.tsx) retain local edits through uncertain saves and explicit conflict resolution; [browser tests](../../../../apps/web/tests/world-post-mvp-author.snapshot.ts) exercise actual HTTP and two independent tabs. Work-package commands and original artifacts are registered in the [existing checklist](../../../plans/2026-10-16-world-post-mvp/checklist.md).

The F0 [baseline recorder](../../../../scripts/world-post-mvp-baseline.py) freezes inputs before each sequential workload and retains failed processes alongside successful samples. The [acceptance collector](../../../../scripts/world-post-mvp-acceptance.py) validates the complete company/laboratory/association JSON/SQLite warm/cold matrix against raw streams and current input hashes. Separate batches keep their own manifests; a changed file can be excluded from another scene's evidence only through the explicit byte-level reconstruction for that scene-independent change. Missing rounds, failed cold recovery or unexplained source drift cannot become a completed baseline. Reusing proven independent samples avoids repeating unrelated long workloads without concealing their distinct provenance.

Author log version 2 retains presentation coordinates and inert template metadata separately from the definition in each original CAS save. Layout never enters compilation or Native facts. Conflict comparison bounds display to 128 changed paths and 160 characters per value, reports omitted differences, and retains both complete documents. Graph windows report capture time and omitted relationships.

`clocky.world-template/v1` packages retain a complete definition, explicit license/notice and attribution, exact domain implementation generations, runtime/template references and policy version. Unknown executable fields and incomplete inventories reject. Product checks installed pins at preflight and creation. Explicitly detaching pins starts a new template without rewriting the original package.
