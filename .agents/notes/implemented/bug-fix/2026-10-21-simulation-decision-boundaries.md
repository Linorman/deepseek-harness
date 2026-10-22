# Agent Note: Explicit Simulation decision boundaries

Status: implemented

English | [中文](2026-10-21-simulation-decision-boundaries.zh.md)

## Problem

A resumed actor retains earlier tool results. A generic wake can be interpreted as a request to summarize its previous submission, leaving the new decision unsubmitted until its deadline. Repeated acknowledgements can also generate more wakes without advancing the work. Meanwhile, a settled idle driver and a budget-stalled run need different explanations from a driver that has never been observed working. Opaque union-validation errors can also make a model repeatedly guess the missing field until its decision expires. A quotation without requester-authorized dimensions needs a distinguishable correction from a mismatched unit or currency.

## Decision

The [decision input](../../../../packages/simulation/simulation-team/src/input.ts) names the current input identity and explicitly requires observation and submission for that decision. Earlier submissions do not satisfy it; choosing no effects still requires an empty staged proposal list. The input remains a persisted user message, so the additional instruction is reconstructable from the Session. Retry validation continues comparing exact message content.

The [World preset](../../../../apps/cli/config/agent-presets/simulation-world/agent.cordis.yml) asks actors to communicate new information, necessary questions or changed proposals rather than acknowledge acknowledgements. It does not choose business outcomes or synthesize empty submissions.

The [status component](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx) explains a nonworking driver using its observed stop reason when available. The [workspace](../../../../packages/client/ui-simulation/src/client/Workspace.tsx) exposes stalled and failed runs in its attention strip even when the driver returned a waiting result rather than throwing.

The [staging preflight](../../../../packages/simulation/simulation-team/src/preflight.ts) expands the sole matching `kind` branch into bounded nested field diagnostics. Ambiguous unions retain their original diagnostic. Only schema paths, types and declared allowed values appear; proposed text is never echoed. Missing quotation authorization identifies `request.input.quoteScope` and an available non-quotation outcome rather than inviting currency guesses. Neither diagnostic changes Native admission or repairs a proposal.

## Alternatives considered

**Accept a final prose response as an empty decision.** This would invent model intent and conceal omitted notification or business effects.

**Increase budgets to absorb repetitive conversations.** Larger allowances do not distinguish new work from repeated acknowledgements.

**Treat every nonworking driver as unobserved.** Idle after settled work and budget exhaustion are observed states, not missing evidence.

**Return only the outer union failure.** The model cannot identify a missing field in its selected operation variant, and unrelated alternatives consume its decision deadline.

## Consequences

Instructions improve the distinction between decisions without weakening Native submission, deadline or budget enforcement. They do not guarantee model compliance. The exact control-message contract changes; previously consumed inputs are not rewritten or silently reinterpreted.

## Verification

Model-observation and recovery tests pin the message and its exact retry identity. The keyless World driver scenario exercises company and laboratory decisions, newborn participation and cold recovery. Status and workspace component tests cover idle reasons and stalled/failed attention. Live WebUI tests use `llmapi/deepseek-flash`; a standalone case requires its own compatible environment integration and acceptance evidence.

Resolution staging also compares the action request ID with the prepared resolve context. Prior requests may remain in Session history, so mismatches are correctable tool errors before submission rather than preventable permanent Native submission refusals. Native continues checking the complete accepted decision. The World tests exercise correction and submission on both backends.

Each synchronous outgoing-request authority check uses one detached Native snapshot for its scope, task and report checks. Checks after asynchronous work still obtain a fresh snapshot. This avoids repeatedly copying the entire long-run history during one unchanged admission check without changing the detached snapshot API.

Driver exceptions invalidate the preceding successful batch result. Company and World owners clear that result so a provider failure cannot inherit an earlier `work-limit` stop or retry deadline. Recovery remains explicit, and provider diagnostics are not exposed through public controls. Owner tests cover a successful bounded batch followed by failure.

The mediated `report-preflight` runnable scenario rejects an incomplete quotation, checks the actual model-visible field diagnostic, submits the corrected replacement and verifies cold recovery on JSON and SQLite. Unit tests cover expanded limits, ambiguous unions and missing quotation authorization.
