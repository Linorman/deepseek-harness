# Agent Note: Paused World replay and explicit production

Status: implemented

English | [中文](2026-10-14-world-paused-replay-probes.zh.md)

## Problem

A zero counter proves nothing when it patches a Context-bound service that an Agent's child Context does not call. Cold replay also needs to preserve accepted Persona and external outcomes, rather than merely avoiding a model request. An authenticated new start must positively demonstrate that the same observer sees production.

## Decision

The [process-local replay probe](../../../../examples/simulation-company/tests/world-replay-probe.ts) observes the actual `llm/stream` waterfall and installed domain execution methods. Before an explicit new start it refuses these calls and ambient random sampling. Scripted scenarios also refuse global fetch and socket connection attempts. These traps are test-only; UUID allocation and filesystem access retain their normal implementation.

Complete-world cold rounds restore the real original Native/Team/Session state, attempt one paused driver batch, and compare the complete state, Session events and journal again. The company's generated newcomer and external representative keep their accepted profiles; the association retains its original external adjudications. Existing real seeds can supply two new cold rounds without rerunning the accepted workflow.

The product model-pool scenario restores through the authenticated API, reads control/inspection/export without changing its revision or calling models, then submits a new management ID. Only that explicit start opens the probe's production interval. Its real waterfall count must equal the scripted provider's positive call count. Repeating the same start preserves the revision and calls. Evidence mode retains both processes, accepted input, original World and continuation proof.

## Alternatives considered

**Patch only `ctx.llm.stream`.** Cordis service binding can bypass that object; positive continuation exposed the missing observation.

**Infer safe replay from a paused flag.** State alone does not prove absence of model, execution or network effects, or preservation of accepted sources.

## Consequences

The opt-in probes exercise real Loader, driver and product paths without changing production semantics or limits. All process-local methods and the event listener are restored on disposal; disposal does not resolve services from an already-disposed Context. Complete snapshots preserve all accepted content; no sampling subsystem is added to the deterministic simulated-rule implementation. Real-provider quality, the broader crash matrix and installed SDK distribution remain separate acceptance work.
