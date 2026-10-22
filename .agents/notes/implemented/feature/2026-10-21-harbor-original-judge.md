# Agent Note: Harbor original-judge integration

Status: implemented

English | [中文](2026-10-21-harbor-original-judge.zh.md)

## Problem

The standalone Harbor judge cannot be imported as a World definition. Its private role views, independent identities and original journal must survive integration and recovery without replacing autonomous actions.

## Decision

The optional [Harbor provider](../../../../packages/simulation/simulation-world/src/harbor.ts) registers the original standalone case judge through existing Native domain and World execution extension points. It verifies the pinned source manifest and isolates each run's judge journal. Independent original-role Sessions choose business actions; the initiating Session chooses experiment controls. The technical director must preserve the submitted payload and the Host supplies canonical Team/Session provenance.

The adapter records public observations and separately scoped role views before model consumption. Transactions settle serially before another role is admitted, because the original judge's view identity is revision-specific. Initial opportunities and subsequent reactions expose current information without selecting actions. An explicit wake batch settles all requested roles before another initiator opportunity; otherwise a partial batch can be mistaken for completed follow-up. Alternating other reactions with initiator opportunities prevents conversational traffic from indefinitely starving date and checkpoint decisions. Initiator wakes ask for bounded multi-day planning and evidence-based follow-up instead of default daily polling; the model still chooses every date and role. Progress counts come from recorded accepted receipts, while the original audit alone determines mechanical completion.

## Alternatives considered

**Fixed event calendar.** Converting the case into a fixed event calendar would replace autonomous choices with scripted history.

**Single shared actor.** Sending all private views to one Session would invalidate independent identity and information restrictions.

**Synthetic resolution proof.** Automatically resolving through a fabricated model-consumption proof would bypass Native authority. The provider instead uses ordinary observed and submitted model decisions for all fourteen original technical and case roles.

## Consequences

The unchanged original CLI owns business validity and conservation. Native records the typed receipt, including judge rejection; committed receipt storage does not itself imply business acceptance. Cached execution identities reconcile interruptions, and an existing Native observation requires its original case journal. Uncertain outcomes retain reconciliation responsibility. Neither recovery nor invalid model submissions authorize editing the original history.

New case actors remain represented by their founder's Session; there is no claim of independently generated cognition for them. Source files and provider credentials are never model-selected, and case subprocesses receive no provider credentials. Deployments must preserve the case directory together with Native and Team storage.

The annual installation supplies finite long-run allowances (100 million tokens per seven-day interval and the legacy 2-billion model-output ceiling per Team). The initiating deployment must permit the same Team ceiling. The initial live trial consumed over six million charged tokens by day 1, including cached reads; a short-scenario allowance would stop the experiment before meaningful cross-period coverage. The per-request allowance is explicitly 262,144 tokens; the original 65,536-token default refused a day-2 request even after successful compaction. The case instructions favor the bounded observation receipt over duplicating the current view. Team envelopes and plan bytes also accommodate the original request plus its routing metadata. These are admission ceilings, not requested model output or a completion promise. Existing runs retain their original frozen limits.

The original judge prefixes offer IDs with `order-` or `loan-`, so generated references can exceed the input identity bound. Version 2 permits those exact references in commands and audit receipts. Version 1 keeps its original parser objects and serialized schema hashes for retained context proofs; the provider registers both exact versions and new authoring selects version 3. Directly replacing a v1 schema invalidates already-consumed Native context hashes even when past values fit both bounds.

Version 3 separates the actor request from the director plan: an apply plan carries only `{forwardOriginal:true}`, while its Native request identity binds the complete original actor payload. The real director still observes and submits a model decision, including its rationale; no consumption proof or business action is synthesized. The executor reads the bound request and the original judge remains authoritative. Earlier copy-based versions remain exact for retained evidence. The live copy-based trial repeatedly changed long request text, so requiring literal model transcription prevented progress despite valid original actions.

## Verification

The [runnable Loader scenario](../../../../examples/simulation-company/tests/harbor.snapshot.ts) exercises five material decisions from four independent roles, fresh post-advance views, complete multi-role wake batches, multiple transaction recipients, all fourteen bound Sessions, idle settlement and fresh-process recovery on JSON and SQLite. Case unit tests cover pinned integrity, idempotency, absent original journals, private-role authority, plugin disposal, maximum-length generated references and immutable v1 schema hashes. Live WebUI completion is a separate acceptance requirement: these short tests do not establish 365-day coverage or successful final audit.
