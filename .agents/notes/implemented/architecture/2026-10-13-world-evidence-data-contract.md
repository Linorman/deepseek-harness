# Agent Note: World evidence data contract

Status: implemented

English | [中文](2026-10-13-world-evidence-data-contract.zh.md)

## Problem

Same-case clarification needs an immutable record format before Native can retain questions, answers and later planning inputs. Arbitrary JSON patches could rewrite accepted request fields, while mutable domain field descriptions could change the meaning of an outstanding question under its original schema identity.

## Decision

The [evidence schemas](../../../../packages/simulation/simulation/src/world-evidence.ts) define branded challenge, revision and field identities; distinct requested fields; attributed text answers with scoped context references; canonical simulated deadlines; safe integer revisions and attempt bounds; and terminal challenge settlement. Model ask/answer bodies omit actor, binding and responder authority. Retained records have separate Native source fields. Answered challenges reference their one accepted revision, and every terminal settlement follows challenge creation.

The [shared reference parser](../../../../packages/simulation/simulation/src/context-reference.ts) preserves the existing run-event/team-envelope source rules without importing aggregate World/context modules. Existing context requests and new evidence answers use it, preventing independent provenance vocabularies.

Domain definitions may declare a finite evidence field vocabulary. The [registry](../../../../packages/simulation/simulation/src/world-domain-registry.ts) copies and freezes field records and rejects empty, duplicate or extended field definitions. Its schema tombstone retains both parser identities and field definitions; renaming, rewriting or removing fields requires a new schemaRef after disposal too.

## Alternatives considered

**Generic JSON answer patches.** These would combine clarification with mutation authority. This contract accepts attributed text and source references; Native business payloads remain separately validated.

**Copy source-reference unions into each feature.** An added variant or changed rule could diverge. One leaf parser owns both consumers without a runtime import cycle.

**Trust a mutable provider array after registration.** Later edits could change outstanding questions without a new artifact identity. Registration retains its own frozen copy.

## Consequences

Strict parser and registry tests cover field/source shape, forged identity fields, duplicate codes/responders, state/sequence consistency, detached registration copies and changed schema tombstones. Context regression tests preserve existing materialization behavior. The package exports browser-safe schema and type entries for subsequent Native and SDK work.

Native retains questions and answers in separate `run/world-evidence` records within their originating acceptance batch. Actual private Channel consumption binds each response to the original requester, question and input revision. Later director planning consumes the revision notification and includes the immutable input hash in its read set. A question requires remaining planning capacity and cannot interrupt original structural or financial obligations. The original request and every earlier plan remain unchanged.

Prepared response decisions consume the frozen per-case allowance even when declined or cancelled. Same-decision retries retain their original expansion. Actual deadline consumption or the last closed answer attempt produces one insufficient-information rejection with its honest event or decision source. Case cancellation closes pending question/revision wakes and deadlines. Projection checks reject altered declarations, answer sources, revision chains and terminal evidence. Native stream 94 and compiler 9 reject older retained formats; no migration synthesizes evidence.

The driver selects evidence contexts from actual deliveries; execution handlers accept only apply plans. TypeScript/Python case projections expose bounded current evidence and preserve existing body permissions. UI displays the retained state without offering an unsupported administrative answer path. The Native/Team tests cover exchange, hiring, cancellation, expiration, exhaustion, malformed inputs and cold replay; the Loader scenario exercises the model-facing tool schema and independent cold processes.
