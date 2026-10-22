# Agent Note: Recorded actor business responsibilities

Status: implemented

English | [中文](2026-10-13-recorded-actor-business-context.zh.md)

## Problem

An actor cannot accept, cancel, confirm or hand off an obligation safely from a transport message alone. The model needs original interaction and commitment identities, revisions and parties, without receiving another actor's private business or task/provider payloads.

## Decision

Native derives one complete required commitments block for the decision actor's active interactions and commitments. Terminal records enter only through its actual claimed wake and typed original business association. A canonical message can associate applied interaction effects from the same accepted Native decision as its received post; arbitrary message text does not select history or confer authority. Coverage explicitly means active/current-wake, not all retained history. Empty scope adds no block or routes.

The strict schema exposes only safe business state, fulfillment policy, evidence operation IDs and original Native-confirmed actor-member Channel routes. Route confirmation does not assert current Hub availability. Task payloads, provider configurations and a second viewer parameter are absent. Existing Native decision/context and Session context-view events retain every model-visible input; no new Session event type is introduced.

Material references the original decision snapshot. A same-prefix window fold or the sole subsequent decision/opened record has a known unchanged business projection. Other intervening Native records lack reconstructable per-object historical versions and therefore refuse this preparation instead of presenting newer state as the old claim. Original applied operation/deadline cursors also refuse later facts. Historical prepared views remain frozen when obligations later settle; replay recalculates the material at the original context record. The entire UTF-8 block, including routes and source attribution, shares the required section budget. Overflow never drops selected duties.

Native journal format91 rejects earlier streams. Compiler9 and public SDK text-block/context envelope shapes remain unchanged.

## Alternatives considered

**Let the model infer business identity or read another role's ledger.** Text and role names do not prove party membership or original revisions. Native actor-derived scope preserves that ownership.

**Include all history or truncate individual responsibilities.** Old unrelated bodies leak scope and a partial list can hide work required before personnel changes. Complete active/current-wake scope has an explicit required-budget failure.

**Treat current mutable state as the old snapshot.** Interactions have no complete per-revision projection history. Missing prefix evidence must reject rather than invent historical facts.

## Consequences

Actors can propose only against the recorded original responsibility state. Native executes and validates each business transition independently of transport acknowledgements. Focused tests cover both journals, actual canonical messages and member routes, nonparty/task-body privacy, exact UTF-8 budget, historical-view preservation and changed-prefix refusal. Whole-world nonempty handoff and cold recovery are independently verified by their Loader workflow; owning unit tests do not substitute for that evidence.
