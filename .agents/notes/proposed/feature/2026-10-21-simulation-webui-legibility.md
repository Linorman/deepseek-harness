# Agent Note: Simulation Web UI state trust, stop control and business legibility

Status: proposed

English | [中文](2026-10-21-simulation-webui-legibility.zh.md)

## Problem

The 2026-10-21 [UI test report](../../../../.tmp/simulation-webui-20261021/ui-issues.md) records UI-01–UI-14: the run list and the run detail contradict each other about the same run, users cannot set a stop boundary, cases and the overview show technical mechanics instead of business meaning, and judging failures, pauses, saves and recovery requires knowledge of internal components. Users cannot reliably answer "is it executing now, where will it stop, what business happened, and what should I do next".

Reading the code adds these facts and new findings (N series):

- **Structural cause of UI-01.** [RunDirectory](../../../../packages/client/ui-simulation/src/client/RunDirectory.tsx) passes the batch status to [RunStatus](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx) without `control`, so the phase comes only from Native `world.phase` (`running` means only that running was requested) while `operational.driver` is shown beside it, producing "running requested" next to "idle". The detail header prefers the management `control.phase`. When the batch read fails, `read()` in [service.ts](../../../../packages/client/runtime/src/client/simulations/service.ts) keeps the old value and only sets `stale`, so the card keeps showing the old day. The DTOs already carry `observedAt`, which the UI never shows. The server `runStatuses` performs a full observation per row, so long journals degrade to the English `Simulation observation is unavailable`.
- **N-01/N-02 wrong primary action.** While running, "Continue scheduling" stays primary and is enabled together with "Pause"; when blocked or when the scheduler failed, "Pause" becomes primary while recovery hides in the overflow menu and the reason is squeezed under the buttons.
- **N-03 unusable narrow windows.** At about 390px the sidebar does not collapse and the main area is about 160px wide.
- **N-04 unlocalized units.** `SimClock` supports `unitLabel`, but callers omit it, showing "12 day".
- **N-05/N-06/N-07 noise.** Every directory avatar is the first character of the name; the header shows both `SIMULATION` and "模拟世界" badges; diagnostic collections show `world/1/decision/0`, `world-person:<uuid>` and "decision slot".
- **N-08/N-09 hierarchy.** An empty calendar occupies the overview hero; the most used audit entry, Records, hides in the Engine menu.
- **N-10/N-11 details.** The focused case-detail title looks like an input; the four-dot status track has no legend; an all-empty "Last updated" column still takes width; pagination shows no position.
- **N-12 component structure.** [Workspace.tsx](../../../../packages/client/ui-simulation/src/client/Workspace.tsx) has about 920 lines covering routing, polling, read orchestration and layout. Interpretation of phase/driver/stop is spread across `RunStatus`, [Controls](../../../../packages/client/ui-simulation/src/client/Controls.tsx) and [WorldOverview](../../../../packages/client/ui-simulation/src/client/WorldOverview.tsx), which is why UI-01/UI-10 style inconsistencies recur.
- **N-14 no refresh outcome.** [Feedback](../../../../packages/client/ui-simulation/src/client/Feedback.tsx) expresses only loading and errors; a manual refresh reports no success, failure or timeout.

The backend is defined by the [Simulation system reliability proposal](../bug-fix/2026-10-21-simulation-system-reliability.md) as D1–D6 (stop targets, safe failure classification, domain summaries, protocol preflight, compaction and usage attribution, bounded reads), which states that the GUI is implemented separately. This proposal defines the corresponding UI design, development plan and acceptance checklist. It is based only on source, screenshots and the backend proposal; no tests were run and no code was changed.

## Proposal

### Ownership and principles

[ui-simulation](../../../../packages/client/ui-simulation/README.md) owns presentation judgments: state synthesis wording, primary-action choice, freshness degradation, layout and localization. The backend owns facts, admission and authorization: the UI does not derive business success, widen disclosure, or chain in the browser a flow the server should guarantee. The [client rules](../../../../packages/client/AGENTS.md) apply: components receive props only, business data stays in the React-free object layer, and subscriptions stay in the renderer.

1. **One fact, one wording.** The directory, header, overview and dialogs share one run-state synthesis function.
2. **Every observation carries its time.** Each state shows its sources' observation time; read failures, disconnection or an exceeded threshold degrade it to "last observed".
3. **Business first, mechanics below.** The first layer uses domain language; Native revision, writer, Participant, Activation, commandId and journal sequence move into Diagnostics and stay copyable.
4. **Controls take effect only after backend confirmation.** Stop targets, saves and recovery appear effective only once their receipts confirm them.
5. **Absence states its reason.** Stale, unknown, forbidden, not applicable, unsupported and zero are distinct.
6. **Each state has one primary action.**

### Trade-off decisions

| Trade-off | Decision | Basis |
|---|---|---|
| Where run state is synthesized | A pure presentation module `run-state.ts` in ui-simulation; not a Product contract; SDKs keep exposing raw fields | D2 keeps phase/driver/inFlight/stop/checkpoint independent with their own revision/observedAt and forbids presenting them as an atomic snapshot. Synthesis is a presentation judgment, not a new fact |
| Sources observed at different cuts | Use the conservative state "reconciling" and list each source's time in details; never pick one source as truth | D2, as above |
| Directory read source | Switch to the small control projection from W6 phase one plus D2 safe unavailability reasons instead of full observation | D6 phase one; full-read failure is one UI-01 cause |
| Stop mode | Offer both; default `drain-admitted` and show the drain budget; on budget exhaustion list remaining responsibilities | D1 defines both modes, the frozen cut and drain budgets |
| Stop-target clock | Show only the provider-declared clock (for example `harbor-day`); without a reliable mapping show the backend refusal reason instead of an input | D1 forbids browser-derived clocks and refuses unreliable mappings |
| Setting a target vs starting | Two independent commands: submit the target and wait for an `armed` receipt before "Continue" is allowed; if the browser closes, the run stays paused with the target set | D1 separates the run-control command from start; ordinary start cannot bypass a reached target |
| "Pause and save" | No combined button in the first version. After the pause completes, the banner promotes "Save checkpoint" to the primary next step; whether a target at the current time may express "pause and save" is left to the backend (see follow-up requests) | D1 defines no immediate pause-plus-save; the browser does not chain two commands |
| Domain wording | Closed enumerations (three result layers, disclosure states, failure categories, stop states) are localized by the UI; open domain vocabulary (operation, metric and actor names) comes from the projector as bounded text and is shown as is | D3 projectors return business labels under separate authorization; new domains should not change the main UI |
| Domain counts | The UI shows only counts returned by the projector with their definitions and coverage, never computing measures client-side; the generic request count is renamed "technical request status" | D3 three-layer results and evidence references |
| Generic three cards | Collapse only when D3 declares `not-applicable`; `unsupported` shows "not provided"; otherwise display normally | D3 per-field allowed/withheld/not-applicable/unknown |
| Activity strip | First version uses only existing and D1/D2/D5 fields: scheduler state and observation time, in-flight work, remaining drain set, provider retry-after, and this run's request counts by category; "who is on which step" is not inferred in the UI and is listed as a backend follow-up | The backend proposal has no activity observation; inference would fabricate progress |
| Navigation | Route module IDs stay unchanged; the "Engine" label becomes "Diagnostics"; Records becomes the first-level "History"; the business timeline is deferred | Current records reads page only in sequence order with no simulated-day or reverse reads; scanning the full journal client-side violates bounded reads |
| Freshness threshold | A new validated ui-simulation Config field whose default derives from `controlRefreshMs` | Deployment-varying choices are Config fields |
| Split | First a structural split PR with no behavior change, then behavior changes on top | The backend proposal requires independent PRs by responsibility |
| Directory form | List rows with state at the far left, sorted by recent activity, filterable by state | Higher density when comparing runs |

### Run-state synthesis

Add a pure module `ui-simulation/src/client/run-state.ts` (no React). Inputs are the Native observation, the management observation (`control` in detail, the control projection in the directory), the D1 stop target, the D2 failure, read state and connection. Output:

```ts
interface RunState<Key extends string, StopTargetView, FailureView, SourceTime> {
  kind: 'running' | 'stopping' | 'saving' | 'paused' | 'idle' | 'attention' | 'blocked' | 'failed' | 'completed' | 'reconciling' | 'unknown'
  headline: Key                       // localized entry
  simTime?: { value: string; unit: string }
  target?: StopTargetView             // D1: clock, boundary, mode, state, checkpoint
  failure?: FailureView               // D2
  primaryAction?: 'start' | 'pause' | 'save' | 'recover' | 'review' | 'edit-target' | 'refresh'
  sources: { native?: SourceTime; control?: SourceTime }   // each with revision and observedAt
  freshness: 'live' | 'aging' | 'stale' | 'unknown'
}
```

| Condition (excerpt) | kind | Primary action |
|---|---|---|
| Paused with no in-flight work | `paused` | Continue; "Edit target" when the target was reached |
| Paused with in-flight work, or target `draining` | `stopping` | None (show drain progress) |
| Checkpoint `pending` after pause | `saving` | None |
| Driver observed scheduled/advancing/checkpointing | `running` | Pause |
| Running requested, driver idle, no in-flight work, no stop reason | `idle` ("running requested, no work to advance") | Pause |
| Driver failed or recovery required | `failed` | Per D2 `actionCode` |
| Capacity, budget, context or similar stop reasons | `blocked` | Per D2 `actionCode` |
| Review, evidence, handoff or similar stop reasons | `attention` | Go handle it |
| Sources disagree in revision or observation cut | `reconciling` ("checking the latest state") | Refresh |
| Observation unavailable | `unknown` with the D2/D6 safe reason | Refresh |

Freshness: a source observed within twice the refresh interval is `live`; within `staleAfterMs` it is `aging` ("x minutes ago"); a read failure, disconnection or exceeded threshold is `stale`. When `stale`, the badge switches to a dashed outline prefixed "Last observed:", all running motion stops, the primary action becomes "Refresh", and other controls are disabled with a reason.

Display components are `RunStateChip` (shared by directory, header and dialogs; icon plus text, never color alone) and `RunStateBanner` (the line under the header: what happened, whether it still executes, next step).

### Page design

**Directory.** List rows: state chip, name, simulated time and target, observation time, overflow menu. Unobservable rows show the localized safe reason (missing, unsupported-version, history-limit, corrupt-history, owner-unavailable), with the English original only in technical details. A single-row failure in the batch affects only that row. Remove the first-character avatar; filter All/Running/Needs action/Paused/Unreadable; sort by recent activity, registration time or name.

**Run header.**

```
‹  QA-河港365日-原请求转交-Flash   [模拟世界]                            ⟳  ⋯
● 已安全暂停 · 第 12 天 / 目标第 12 天（完成已受理工作后停）· 观测于 14:43:05   [继续运行]
  无在途工作 · 检查点：第 12 天 14:43 完整保存
```

The target chip is editable. The stop process is driven by D1 states: stop accepting new work → drain admitted work (N left, budget remaining …) → save checkpoint → safely paused. Save state distinguishes complete, partial (`external-state-required`, external case state missing) and failed; on failure the run still shows as paused with "Retry save", reusing the same save identity.

**Overview.** The first screen shows, in order: the run summary (phase, simulated time and target, latest checkpoint, this run's usage summary); "Run problems needing intervention" (only run failures and pending reviews, renamed to separate it from business responsibilities); the domain business card (D3 projected metrics, open responsibilities, counts and their definitions); recent business activity (recent cases after D3 summarization); governance/people/external world (shown per D3 applicability); and a collapsed "Run management" (calendar, budget, request history). The empty calendar leaves the hero and appears as "Next event" in the run summary only when events are scheduled. Writer, Participant and Activation move to Diagnostics.

**Cases.** Columns become simulated time · actor → counterpart · business action · three-layer result. Results follow D3: submission (submitted/accepted/rejected), execution (pending/judge accepted/judge rejected/unknown), business outcome (achieved/not achieved/unknown/not applicable). `committed + ok=false` shows as "judge rejected" without success coloring. Without a projector the row says "this domain provides no business summary" instead of "unknown domain". Request hashes move into the expanded row and the detail's technical details, copyable. The status track gets a legend; all-empty columns hide.

**Disclosure.** One `DisclosedValue` component distinguishes withheld ("your identity may not view this; governed by the deployment disclosure policy"), not-applicable, unknown, unsupported and read failure. Revocation clears displayed restricted content immediately.

**Failure card.** `FailureCard` is driven by D2 fields: category, failure time and related revision, `retryDisposition`, `actionCode`. It always answers which stage failed, whether anything is still executing, whether completed results are kept, and the suggested next step. `actionCode` maps to the primary action; an unrecognized `actionCode` uses the documented default (only "View details"). "Retry" appears only when retryable and binds the original request identity. Raw diagnostics are reachable only through an authorized `failureId` correlation.

**Budget and usage.** `BudgetPanel` serves both the start dialog and run management: configured limits (per request, per interval), reserved, settled and unknown; broken down by D5 category (business choice, director ruling, result settlement, ordinary communication, compaction, unattributed) and token kind (input, output, cache read, cache write); no cost estimation; the host shared pool is labeled host-wide.

**Creation and preflight.** The new-world dialog shows installed templates and D6 preflight results: clock support, model context capacity, per-request allowance, initial context size, provider version, and whether complete backup is supported. Violations show the dimension, actual and required values; long-term consumption is labeled estimated/unknown.

**Recovery dialog.** Three layers: first, which day and checkpoint is restored, that the run stays paused, that history is not rolled back and completed model calls are not repeated, and whether the checkpoint is complete; second, coverage and verification; third, checkpoint ID, writer/owner terms and source identities, copyable.

**Navigation and history.** Route module IDs stay unchanged: the "Engine" label becomes "Diagnostics" and Records becomes first-level "History". Diagnostic collections show entity names first with IDs secondary, and "decision slot" becomes "decision number".

**Visuals, terminology and accessibility.** Lower background decoration intensity and disable it under `prefers-reduced-motion` and `prefers-reduced-transparency`; use color only for state, always with an icon and text; three type levels (body, secondary, diagnostic) with measured contrast; pass localized units to every `SimClock`; remove the `SIMULATION` badge; below 768px turn the sidebar into a drawer, compress the header to two lines and render tables as card rows; style the detail-title focus as an underline; show pagination position.

### Front-end structure

| Module | Responsibility |
|---|---|
| `run-state.ts` (new) | State synthesis, freshness, primary action; extracted from `RunStatus` and `Controls` |
| `RunStateChip.tsx` / `RunStateBanner.tsx` (new) | Shared state display and stop progress |
| `RunDetails.tsx` (from `RunStatus`) | Diagnostic fields and per-source observation times |
| `RunHeader.tsx` (new) | Merges `RunCommandBar`, header status and controls |
| `RunControls.tsx` (from `Controls`) | Primary action from `RunState`; start dialog with target and `BudgetPanel` |
| `StopTargetDialog.tsx`, `FailureCard.tsx`, `DomainSummary.tsx`, `DisclosedValue.tsx`, `BudgetPanel.tsx` (new) | D1/D2/D3/D5 counterparts |
| `DirectoryPage.tsx` / `RunPage.tsx` (new) | Split from `Workspace.tsx` |
| `useRunReads.ts` (new) | Run-page reads, polling and invalidation |
| `Workspace.tsx` | Route dispatch and dialog mounting only |

The Client runtime [simulations service](../../../../packages/client/runtime/src/client/simulations/service.ts) adds `invalidateRun(runId)`, which invalidates the run's control, run and directory row once management, checkpoint, recovery or target command receipts reach a terminal state; marks rows "last observed" individually on batch failure; and passes source observation times to components.

### Follow-up requests for the backend proposal

These UI capabilities need interfaces the backend proposal does not cover; this proposal does not implement them:

- An execution activity observation (actor, step, start and last effective progress time), derived only from lifecycle events.
- A business timeline read filtered by simulated day, actor, action and result, aggregated per request and paged newest first; plus "jump to latest" for raw records.
- Domain projector wording returned in the requested language (catalogs for zh/en declared at registration).
- Case list ordering and filtering by simulated time.
- Confirmation whether "target = current confirmed time + save policy" may express an immediate "pause and save".

## Development plan

UI work packages are ordered by backend dependency; those without one come first. Each work package ships as one or more independent PRs.

| Work package | Depends on | Main owners | Done when |
|---|---|---|---|
| U0 structural split | None | ui-simulation | Behavior and snapshots unchanged; `Workspace.tsx` only dispatches |
| U1 state and freshness | U0; existing fields first, switched once W2/W6 land | ui-simulation, client runtime | Directory and header agree; staleness explicit; one primary action; refresh reports its outcome |
| U2 stop target and pause/save | U1, W1 | ui-simulation, client runtime | Targets take effect only after receipts; stop progress and save completeness visible |
| U3 failures and unavailability | U1, W2, W6 phase one | ui-simulation | Failure card answers the four questions; directory reasons localized and per row |
| U4 domain summaries and result layers | U1, W3 | ui-simulation | Cases and overview use three-layer results and projected counts without widening access |
| U5 budget and usage | U1, W5 | ui-simulation | Reserved, settled, unknown and categories shown separately |
| U6 creation preflight and read limits | W6 | ui-simulation | Preflight dimensions and backup capability visible; pause and save still work when reads exceed limits |
| U7 navigation, recovery dialog, visuals and accessibility | U0 | ui-simulation, ui-primitives | First-level History; three-layer recovery; narrow screens and keyboard usable |

### U0: Structural split

- [x] Split `DirectoryPage`, `RunPage` and `useRunReads` out of `Workspace.tsx` without changing visible behavior, read counts or routes.
- [x] Existing component tests and `CLOCKY_SNAPSHOT=replay pnpm run test:web` pass unchanged.

### U1: State and freshness

- [x] Add `run-state.ts` with unit tests covering the whole derivation table, including `reconciling`, `stale`, disconnection and unavailable observation.
- [x] Add `RunStateChip` and `RunStateBanner`; switch the directory and header to them; remove the first layer of `RunStatus`.
- [x] Choose the primary action from `primaryAction`: no Pause while paused, no Continue while running; Recover becomes primary when failed or blocked.
- [x] Add a validated `staleAfterMs` Config field defaulting from `controlRefreshMs`, and update the README.
- [x] `invalidateRun(runId)`: invalidate control, run and directory row after a terminal command; reread that row on returning to the directory.
- [x] On batch status failure, show "last observed · current state unknown" per row, with an error and retry in the list header.
- [x] Manual refresh reports refreshed, failed or timed out while keeping selection, scroll and drafts.
- [x] Pass localized units to every `SimClock`; remove the `SIMULATION` badge.
- [x] Reproduce the "return to directory after a pause receipt" path, record the batch read error code and byte size, and write the conclusion back into this proposal.

Reproduction (2026-10-21, keyless company World, JSON storage, about 1.6k Native revisions): after the pause receipt, returning to the directory issued `simulation.runs.statuses`, which answered 200 OK with a 3,934-byte body (4,234 bytes transferred) in 206–349 ms per batch; the row showed the same "safely paused" state and simulated time as the detail from the first frame. The contradiction in the report therefore does not come from a wrong status reply on a small journal. It comes from the pre-entry batch staying on screen as current while the refreshed batch for the 10,242-record Harbor journal was slow or failed, because each row performs a full observation. The Harbor error code itself could not be re-measured without that run. The directory now shows such a row as "current state unknown · last observed" (failed batch or `invalidateRun` after the receipt), and the W6 control projection remains the backend fix for the read cost.

### U2: Stop target and pause/save

- [x] Add a stop-target section to the start dialog: provider-declared clock; mode defaulting to `drain-admitted` with the drain budget explained; an option for no target; an optional checkpoint policy.
- [x] Submit the target as its own command; disallow Continue until the receipt is `armed`; show `pending`, `outcome-unknown` and out-of-bounds refusal distinctly.
- [x] Show the target chip and D1 state in the header; once reached, the primary action is "Edit target" and ordinary Continue is disabled with a reason.
- [x] Drive stop progress from `armed → draining → paused`; when the drain budget is exhausted, list remaining responsibilities.
- [x] Show complete, partial (`external-state-required`) and failed saves; on failure offer a retry reusing the original save identity.
- [x] Disable target input for scenarios without a clock mapping and show the backend reason.
- [x] Component tests cover the 11→13 refusal message, Continue disabled after reaching the target, and the target still shown as set after a disconnect.

### U3: Failures and unavailability

- [x] Drive `FailureCard` from D2 fields; `actionCode` mapping has a documented default; Retry appears only when retryable.
- [x] Show localized D2/D6 safe unavailability reasons in the directory and header; English originals only in technical details.
- [x] Tests: 402, 429, network, context, unknown exception, save failure; an old batch failure disappears after a newer batch succeeds; tokens, paths and private bodies from redaction fixtures never reach the DOM.

### U4: Domain summaries and result layers

- [x] Change case rows to simulated time, actor, business action and three-layer result; move hashes into technical details.
- [x] Add the domain business card to the overview, rendering projector metrics, open responsibilities and count definitions; `unsupported` shows "not provided".
- [x] Show or collapse the generic three cards by applicability; remove technical binding counts from the people card.
- [x] Replace scattered restricted wording with `DisclosedValue`; clear it on revocation.
- [x] Tests: `committed + ok=false` shows judge rejected; unknown results never count as success; cross-role reads and revocation do not leak.

### U5: Budget and usage

- [x] Use `BudgetPanel` in the start dialog and run management, broken down by D5 category and token kind; unknown usage never counts as zero; no cost estimation.
- [x] Label the host shared pool separately from this run's budget.

### U6: Creation preflight and read limits

- [x] Show D6 preflight dimensions and backup capability in the new-world dialog; violations show dimension, actual and required values.
- [x] When detail reads exceed limits, header state, Pause and Save stay usable (via the W6 control projection) and the detail area explains the limit.

### U7: Navigation, recovery dialog, visuals and accessibility

- [x] Relabel "Engine" as "Diagnostics" and promote Records to first-level "History"; route IDs unchanged.
- [x] Show entity names first in diagnostic collections; rename "decision slot" to "decision number".
- [x] Layer the recovery dialog in three; the first layer states checkpoint completeness.
- [x] Move the empty calendar out of the overview hero; hide all-empty columns; add a status-track legend; show pagination position.
- [x] Narrow-screen sidebar drawer, two-line header and card-row tables; detail-title focus style.
- [x] Lower decoration intensity; honor reduced-motion and reduced-transparency.

## Alternatives considered

**Return a synthesized run state from the backend.** All clients would share one wording, but D2 requires independent sources with their own revisions, and backend synthesis would present an atomic snapshot when sources are not from the same cut. Synthesis stays in presentation and shows "reconciling" explicitly when sources disagree.

**Put the synthesis function in a shared simulation-product module for SDK reuse.** That turns a presentation judgment into a product contract, while SDK consumers need raw facts. Reconsider only when a second GUI consumer needs the same wording judgment.

**Chain "pause" and "save checkpoint" in the browser.** Closing the browser interrupts it and nothing on the server guarantees the step between; D1 already defines a checkpoint policy, so a combined action belongs to the backend.

**Per-domain front-end render plugins.** More expressive, but they require sending more raw data to the browser for client-side trimming, contrary to D3's authorize-before-read rule, and new domains would need front-end changes.

**Infer "last effective progress" and activity steps from revision changes in the browser.** The page cannot know what happened while closed, would show wrong times when reopened, and would mistake journal growth for business progress.

**Rename the whole navigation (Cases→Business, Engine→Diagnostics, plus a business timeline).** The business timeline needs a read the backend does not yet provide; relabeling and promoting Records already fixes the buried audit entry without affecting routes.

**Combine the structural split and behavior fixes in one PR.** Regressions would be hard to locate; a zero-behavior split comes first.

## Acceptance criteria

- [x] After the same pause receipt, the directory and detail eventually show the same confirmed state; on read failure or disconnection they show "current state unknown" with the last observation time, never running.
- [x] Every state has at most one primary button matching the `run-state.ts` derivation table; no Pause while paused and no Continue while running.
- [x] A stop target appears effective only after the backend receipt confirms it; reopening after closing the browser shows the same target; ordinary Continue is unavailable once the target is reached.
- [x] Complete, partial and failed saves are distinguishable; retrying after failure starts no inference.
- [x] The failure card answers the four questions without reading raw journals; raw diagnostics never appear in the ordinary DOM.
- [x] Case rows distinguish business actions from control operations without opening details; `committed + ok=false` never shows as success; without a projector the UI says "not provided" rather than zero or "unknown domain".
- [x] Forbidden, revoked, unsupported, not applicable, unknown and zero are distinguishable in the UI, and no restricted content remains after revocation.
- [x] Below 768px users can view state, pause and open a case; the keyboard reaches every control; no ambient motion under reduced-motion; contrast is measured from actual colors.
- [ ] Each PR runs the [pre-push checks](../../../skills/dsh-pre-push-checks/SKILL.md) for its actual diff: relevant component tests, `pnpm run typecheck`, `pnpm run lint`, `CLOCKY_SNAPSHOT=replay pnpm run test:web`; documentation changes run `pnpm run doc-sync`.
- [ ] Product-visible GUI changes attach a GIF of the real server flow to the PR; the bilingual [ui-simulation README](../../../../packages/client/ui-simulation/README.md) and Config documentation are updated.
- [x] Implementation updates the items in phase 6 of the [Web UI redesign proposal](2026-10-02-web-ui-redesign.md) that this proposal refines or replaces, with links both ways.

## Risks

**Backend fields land after the UI.** U1 starts with existing fields and switches once W2/W6 land; until then directory unavailability reasons stay coarse, and `reconciling` can rely only on existing revisions and observedAt.

**Synthesis misclassification.** Presentation-side synthesis may place edge combinations in the wrong state. The derivation table needs complete unit coverage, and uncovered combinations fall to `unknown` rather than any "normal" state.

**Default `drain-admitted` mistaken for an immediate stop.** The dialog and header must show the drain set and budget; users needing an immediate stop can choose `at-boundary`.

**History promoted without a business timeline.** The first History is still the raw records view, so business users' search cost drops only partly until the backend provides a timeline read.

**False freshness alarms.** A short threshold would show "last observed" too often. The default derives from the refresh interval and stays adjustable through Config.
