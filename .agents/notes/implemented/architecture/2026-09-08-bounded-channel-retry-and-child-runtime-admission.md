# Agent Note: Bounded channel retry and child runtime admission

Status: implemented

English | [中文](2026-09-08-bounded-channel-retry-and-child-runtime-admission.zh.md)

## Problem

An authenticated high-level channel input can outlive the response that reports its accepted Envelope. Rechecking the live protocol turn before the durable Hub idempotency lookup rejects a valid retry after a consult response, discussion bound, or direct channel close. Placement also needs to distinguish a child-Team task from a Participant task, and restart discovery must not scan every Team in one pulse.

## Decision

The Host and SDK principal admission Consumers retain the caller's channel post key while reconstructing the canonical consult or discussion draft from immutable membership and the retained request anchor. They continue to require the current acknowledged human invitation and let the locked Hub lookup decide whether the key returns its original Envelope or reaches current phase, cursor, adapter, and policy validation. Equivalent null and exact-peer audiences normalize to one draft; changed canonical fields remain conflicts. Host RPC maps that conflict to `team-channel-idempotency-conflict`.

`team-placement-default` admits only `participant` tasks to Participant activation. When a workspace registry is mounted, placement asks the selected provider's optional `preflight()` to reject routes whose compatibility is knowable before activation, then checks the returned activation with `eligible()` and disposes an incompatible activation before retaining the placement lease. Providers without preflight retain the post-activation check.

`team-delegation` discovers Teams through `listTeamsPage`, retaining the provider-order continuation cursor between bounded pulses. Event-driven requests still wake the affected Team and its parent, while restart discovery rebuilds the cursor from `-1`.

After a TeamRun persists a complete finalization intent, the Hub permits bounded pending-delivery reads for that exact final channel while the Team is quiescing. Other channels and cancellation paths retain their active-state checks.

The shared workspace provider exposes an opt-in periodic observation pulse. Each pulse visits only live provider allocations up to its configured bound, records the explicit `periodic` observation stage through the existing Team proof and WAL path, serializes with release/publish scans, and waits for an accepted pulse during disposal. The default interval is disabled.

## Alternatives considered

**Add a high-level channel receipt lookup.** Rejected because the existing sender/key WAL projection already retains the canonical Envelope, survives JSON and SQLite restart, and is checked under the Hub channel lock.

**Let placement treat every ready task as a Participant task.** Rejected because child-Team execution owns its own topology and must not acquire a Participant activation lease.

**Keep full `listTeams()` discovery and rely on the per-Team operation bound.** Rejected because a pulse could still perform unbounded Team discovery and starve event-driven work before the operation bound applies.

## Consequences

Keyed high-level retries remain subject to current authenticated membership and invitation acknowledgement; a new key cannot bypass the active phase or expected speaker checks enforced by the Hub. Attachment admission may still repeat provider-side content-addressed lookup before the Hub returns the retained Envelope. Workspace providers may reject route compatibility before activation through `preflight()`; providers without that capability remain protected by the post-activation `eligible()` check. Periodic observation is opt-in and never represents a filesystem lock or a writer identity.

The Team detail projection overlays a selected Team's newer task facts onto rows already loaded by a bounded task page when the task id and revision match. This preserves the page bound while preventing a stale row from hiding child-Team navigation or current result state; it does not expose tasks outside the loaded page.

The bounded task collection also keeps an explicit refresh action available after its first page is loaded, so a user can reconcile a durable child or task mutation even when its notification does not carry a newer marker. The refresh remains cursor-bounded and preserves the existing row fallback on failure.

During normal completion quiescence, human-owned outboxes may continue bounded pending reads from their participating active or closed channels so ordinary responses can drain; activation-bound model delivery remains restricted to active Teams and channels, and the final channel keeps its separate completion admission.

## Verification

### Current candidate addendum (2026-09-09)

The Python SDK runtime default composition now mounts the Team workspace registry and shared provider alongside `team_task_delegate`. The `sdk-child-team` smoke through `python/sdk-runtime/node_modules/.bin/clocky-jsonrpc-agent` passed, covering parent delegation, child completion, result admission, and parent final acceptance. The independent Loader crash snapshot now passes across thirteen WAL windows on both SQLite and JSON backends: child creation, child-run binding, child response, parent result admission, child result admission, child response receipt, child closure, child terminal phase, parent charge pending, parent charge accepted, parent charge settled, parent settlement, and child cancellation. SIGKILL preserves durable result/cancellation intent without model re-entry; pre-terminal windows return the named `ACTIVATION_TERMINATION_UNCONFIRMED` stall for the in-process provider, while child-terminal and parent-settled windows leave the parent task completed and the parent Team active awaiting coordinator finalization. Charge-window append races may retain the parent result before or after the selected charge record, but both backends preserve no duplicate and no model re-entry. A later full-repository run after this configuration change recorded 16,022 passing, 1 failing, and 116 skipped tests; the failure was an existing Team Agent Client link-lifecycle timing case. The isolated file passed 80/80 on the second run after a different timing failure on the first run, so this lane is retained as flaky evidence rather than a full green result.

The Hub terminal recovery path now retains an in-flight Team stream while validating a child result, allowing `assertParentResultStored()` to reuse the existing parent stream instead of reopening it. This closes the JSON `parent-settled` restart failure that previously surfaced an `already-open` storage error as malformed completed-child evidence. The focused nine-file child matrix remains 258/258 after this change.

The client Team runtime now consumes the existing bounded member/task/artifact page APIs into independent collection state. TeamPage renders those rows and explicit continuation controls, fences late reads by selection generation, and falls back to the authoritative snapshot when a page fails. The Host artifact page filters private and ambiguous references before exposure. The runtime Team-task suite passes 33/33, including a stale collection response after selection change, artifact continuation, failed-page retention, non-advancing cursor rejection, and `hasNewer` marking; the TypeScript SDK focused suite passes 98/98, the Python SDK client suite passes 45/45, and the complete Team UI suite passes 7 files/61 tests; full browser race coverage remains open.

TeamPage also renders a read-only workflow plan projection from the authoritative Team snapshot: lifecycle phase, bounds, ordered template rows, task bindings, dependency links, result count, and failure reason. It does not author or mutate plans; `team_workflow_*` remains the tool owner. The complete Team UI suite passes 7 files/61 tests; a bounded workflow-plan read API and browser race coverage remain open.

The Host now exposes bounded `team.workflow.plan.list`, and the client runtime loads it as an independent workflow-plan collection cursor. TypeScript SDK protocol/client/server tests pass 98/98 and Python SDK client tests pass 25/25 for the synchronized read helper; stale-read races and browser coverage remain open.

Focused source tests cover AgentRuntime, basic/direct channel adapters, bounded delegation discovery, child-only placement, preflight rejection, immediate workspace-ineligible activation cleanup, shared-root compatibility, bounded periodic observation (21 workspace tests), SDK consult replay after close, Host consult/direct input replay after close, JSON/SQLite envelope admission/recovery (42 tests), terminal-channel recovery across JSON/SQLite (32 tests), TeamRun finalization reads after completion intent, and child/delegation/result/usage slices (134 tests), including normalized audience replay and canonical conflict mapping. The combined runtime/channel candidate slice is 16 files with 316 passing tests and 1 platform-skipped test; the activation recovery/ACP/controller slice is 8 files with 134 passing tests, including closure recovery across JSON/SQLite. The extended transport, client, tool, and human-outbox channel slice is 8 files with 196/196 passing tests. ACP bridge/lifecycle passes 23/23, ACP demo composition passes 13/13, and SDK plugin composition passes 6/6. Additional channel fixture slices cover channel-open cleanup (32/32), retained implementations (9/9), replay properties (2/2), all edge cases (37/37), and interrupt/invariant authority (7/7); workflow selection recovery passes 6/6; child reservation lineage edge cases pass 2/2 and team-hub restart/nested-usage/pending-charge child slices pass 5/5. The changed package TypeScript project references compile together; `doc-typecheck` and `verify-config-catalog` pass for the current source/catalog candidate. The full Hub directory passes: 50 files and 780 tests pass on the current candidate. The same-candidate full-repository lane covers 1,009 test-result files and has 16,139 tests with 16,023 passing, 0 failing, and 116 skipped. T-01 is confirmed by these two same-candidate suites; T-03 remains unverified because the child cross-log kill-point matrix is separate required evidence.

The Team detail surface now projects child-Team phase/failure, the admitted result text, non-private child artifact references, and a read-only `openTeam(childTeamId)` action. The overlay dismisses the parent detail before opening the child and never resumes the child. The focused UI TypeScript face and complete Team UI suite pass (7 files, 59/59), strict frontend design audit reports zero findings, and `doc-typecheck` passes; full browser/GIF coverage and bounded collection pagination remain separate T-06/F-UI-01 work.

### Follow-up candidate addendum (2026-09-09)

The bounded client collection runtime now keeps provider-owned artifact pages independent from task-page completion. A task response cannot replace an artifact page that completed first, and a Team cursor advance marks the workflow-plan collection as newer alongside members, tasks, and artifacts. The runtime regression covers the reversed completion order and passes 34/34.

The child-delegation Consumer rejects a non-advancing channel continuation with `TEAM_CHANNEL_CURSOR_CONFLICT` instead of spinning its recovery drive. Team discovery applies the corresponding non-advancing page check and reports the named cursor conflict; channel-admission recovery applies the same check to its bounded Team page. The delegation focused suite passes 9/9, the admission/scheduler composition suite passes 64/64, and the invitation/local/WebSocket channel suite passes 71/71. Client, delegation, and admission TypeScript project references compile with exit 0. These checks do not expand the separate browser, multi-host, coverage, or release claims.

The current AgentRuntime SDK provider and ACP lifecycle compatibility slice passes 40/40 with one platform-conditional skip, covering local recovery fencing, remote Link recovery, and ACP child lifecycle. It does not claim ACP independent-host recovery.

The Hub now propagates terminal dependencies to ordinary unstarted child tasks as a durable cancelled outcome. The parent task retains `blockedByOutcome` with the blocker identity and its terminal revision/phase, while the requested child reservation is cancelled without creating a child Team or Participant lease. The real SQLite edge case passes with the Hub directory at 50 files and 781 tests; this closes the shared-workspace dependency outcome slice but leaves model-facing blockedBy authoring and deferred child combinations outside scope.

The subsequent invitation property and SQLite child-reservation additions leave the current Hub directory at 50 files and 783 tests; the earlier 781-test count remains the preceding candidate slice.

Durable ranking replay and the complete failed/cancelled/deleted child dependency matrix subsequently raise the current Hub directory to 50 files and 787 tests; the 785-test count is the preceding candidate slice.

Team-level recovery now validates the cursor returned by every local and WebSocket Team Link journal watch before rereading Team state; repeated or rewound `changed` results fail the Link closed. Workspace release recovery applies the same fail-closed rule to bounded Team-list continuations and reports `TEAM_CURSOR_CONFLICT` before it can rescan a repeated page. The three recovery regressions pass with the workspace-recovery suite at 28/28 and the local/WebSocket/workspace focused slice at 96/96; the changed Link and recovery TypeScript faces and targeted lint pass. Channel cursor validation and the separate multi-host/browser/release boundaries are unchanged.

TeamRun now applies the same Team-watch progress check to quiescence waits, workflow-plan waits, child-task waits, completion waits, channel final waits, and default-worker task watches. A repeated or rewound `changed` result produces `TEAM_RUN_NOT_QUIESCENT` or `TEAM_CHANNEL_CURSOR_CONFLICT` according to the owning wait. The TeamRun suite passes 93/93 and its TypeScript face passes; the package-wide lint command still reports unrelated pre-existing findings outside this change.

SDK activation recovery now reports the same `TEAM_CURSOR_CONFLICT` code when a bounded Team-list continuation repeats or rewinds. The real startup recovery suite passes 22/22 and its TypeScript face passes; this closes only the local recovery continuation classification and does not expand ACP or separate-host evidence.

The Hub test suite now has a fixed-seed child-reservation model companion covering create/retry, bind, stall, cancellation, child terminal outcome, settlement, concurrency usage, and checkpoint parsing across 100 generated action sequences. The property passes with seed `20260912`; live JSON/SQLite interleavings and the complete T-08 matrix remain separate evidence.

The live reservation matrix now runs create→bind→parent cancellation on both JSON and SQLite, rejects settlement until the child is terminal, then drives child cancellation through closure continuation and settles the parent. The task-delegation suite passes 7/7; broader child interleavings remain separate.

The Hub lifecycle fixture now also cancels an idle channel watch through AbortSignal before disposing the SQLite Hub, while retaining the startup/first-page/enumeration/RSS/shutdown reference metrics. This 2/2 slice adds same-process macOS lifecycle evidence only; fresh-process, Linux, and CI performance budgets remain open.

Channel admission now rejects a non-advancing `watchChannel()` result with `TEAM_CHANNEL_CURSOR_CONFLICT`. Its focused service regression passes 1/1 with the admission TypeScript face and targeted lint; this closes the local wait continuation safety only.

The local artifact retention Consumer now classifies a repeated Team-list continuation as `TEAM_CURSOR_CONFLICT` instead of a generic failure. Its provider suite passes 7/7 with TypeScript and targeted lint; cross-host artifact retention remains outside scope.

The principal human-inbox Consumer now applies named cursor guards to both its startup Team-list delivery scan and its durable storage row iterator. Its JSON/SQLite inbox suite passes 16/16 with TypeScript and targeted lint; distributed inbox retention remains outside scope.

The closure-driver discovery Consumer now rejects a repeated Team-list continuation with `TEAM_CURSOR_CONFLICT` before its bounded scan can reuse the cursor. Its selected discovery regressions pass 3/3 with TypeScript and targeted lint; broader closure-driver and multi-host evidence remain separate.

ACP same-host recovery now has an explicit `acp-local-cold-replace` record containing the runtime profile, workspace cwd, and exact child process identity. The ACP provider registers a matching local fencer only when recovery is configured and exact process identity is available; activation controller cold replacement restores the persisted cwd and resume Session. The startup recovery Consumer selects the record kind explicitly, defaulting to SDK recovery. The ACP lifecycle/schema/recovery slice passes 23/23 plus one macOS identity-dependent skip; cross-host ACP supervision remains outside scope.

The bounded Team collection runtime now retains `hasNewer` when a member, task, workflow-plan, or artifact read began before the selected Team cursor advanced. A late first-page response can therefore not hide a newer marker emitted by the authoritative Team refresh; continuation reads retain an existing marker until an explicit newer refresh succeeds. The workflow-plan stale-read regression passes with the Team-task runtime suite at 36/36.

TeamRun now accepts optional JSON-friendly `placementDefaults` in its frozen product template. Hub task admission resolves that default exactly once for participant tasks that omit `placement`; explicit task placement remains authoritative, and the resolved restriction is persisted with the task for retry and restart stability. The focused Hub and TeamRun placement/template tests pass.

The authenticated HTTP supervisor now reads its configured credential for every request on both the client and endpoint. An existing client/listener therefore accepts a rotated environment value without recreation, while an empty post-startup value fails closed as `SUPERVISOR_UNAVAILABLE` or HTTP 503. The endpoint suite passes 7 tests with 1 Linux-only skip; its TypeScript face and targeted lint pass.

The same-session Goal, subagent and model-authored workflow families live in private `packages/compat/` packages named `@clocky/clocky-compat-*`. Their model tools use `legacy_*` names; configurable names are checked before registration so compatibility cannot occupy a Team tool name. Explicit examples retain their consumers. Product Host clients expose Team goal methods; the same-session Goal RPC and its unused UI are excluded. Product tool/config catalogs exclude these packages. The cutover gate rejects public dependency or peer-dependency edges into compatibility, including the same-Session Goal stack, and checks disabled default entries as well as active ones. Session `parentSession` alone identifies fork lineage; subagent discovery requires its owned descriptor.

Local cold replacement now persists a typed Team stall when the AgentRuntime provider is retired, its local stale-epoch fencer is missing, or that fencer cannot terminate the owned epoch. The codes are `AGENT_RUNTIME_PROVIDER_UNAVAILABLE`, `AGENT_RUNTIME_FENCER_UNAVAILABLE`, and `AGENT_RUNTIME_FENCE_FAILED`; the recovery scope may omit a supervisor descriptor for these local-owner cases, while supervisor-owned recovery retains exact descriptor and generation checks. The focused controller/schema slice passes 29 tests.

Team cancellation cleanup now retains its structured reason on each cancelled workflow-plan projection. TeamRun and `team_workflow_wait` carry that reason, and TeamPage renders it beside the cancelled phase; JSON/SQLite workflow replay and the generated tool catalog use the same optional field.

Workflow-plan collection paging now slices at the Hub provider boundary through `listWorkflowPlansPage()`. Host and SDK consumers pass the durable cursor and limit directly, so a large plan history is not first materialized as an unbounded source collection before the wire page is formed.

The old unbounded Core `TeamRuntime.listWorkflowPlans()` method is removed; the source contract now exposes only the provider-bounded page method, and the Cordis API/catalog region records that bounded seam.

The old unbounded Core/Hub `listTasks()` method is also removed. TeamRun finalization now scans task pages with cursor-progress checks, so the remaining internal task read follows the same bounded source contract as Host and SDK collection reads.

The Team DAG scheduler's all-Team pulse now discovers through bounded `listTeamsPage()` continuation with explicit `teamPageSize`. Repeated or rewound discovery cursors fail closed, and disposal stops the page scan before it schedules another Team drive.

The Core/Hub unbounded `listTeams()` contract is now removed. Scheduler, recovery, workspace, human-client, and ACP fixtures use `listTeamsPage()`; the SDK's public `listTeams()` remains only as a bounded transport facade that loops over pages.

The current child-row authority follow-up passes the focused UI Team browser suite at 38/38, the client Team/channel runtime suites at 57/57, both client TypeScript faces, and the current 197-artifact build. The selected Team projection overlays a newer task revision onto an already loaded bounded row, and the runtime performs a targeted selected-Team refresh after a task-change event. Active-child browser navigation and separate-host transport remain unverified.

The parent cancellation boundary now uses an optional effect-scoped `TeamDelegationDriver` registry owned by `team-run` and registered by `team-delegation`. After TeamRun durably accepts parent cancellation, it awaits the existing coalesced delegation drive before releasing local ownership or reporting cancellation; a composition without the delegation Consumer keeps its prior behavior. The TeamRun and TeamDelegation focused lane passes 104/104, the real child-delegation cancel Loader snapshot passes 1/1 with one sibling scenario skipped, the current channel browser lane passes 4/4, and the current build emits 197 client artifacts. This closes the local parent-cancel/child-saga timing gap only; remote, multi-host, and active-child browser evidence remain open.
