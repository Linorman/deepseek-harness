# Clocky Python SDK

Coordinator transcripts strictly validate `compaction/assessment` estimates and `compaction/end.noGain` hashes, counters and non-shrinking evidence; malformed or successful no-gain endings refuse before entering typed events.

`archive_raw_simulation()` preserves original source versions through strictly parsed, authorized raw text pages. The result always states that Native validation was not performed; SQLite logical frame preservation is explicitly separate from a physical database copy. The SDK never resumes, restores or fetches every page automatically.

Retention preview requires an already paused, quiescent source and does not retire actors. Execute keeps one original command, revision and plan hash; read reconciles its retained outcome. The first archive copies and verifies complete owner history without deleting originals or reclaiming historical capacity. Archive record pages require independent whole-record read authority; owning the run or its archive command does not grant access to Session or Channel bodies.

Generation request, read, execute, transition and Persona-draft methods retain the original job identity. Only explicit execution invokes a model. Product inputs must be user-authored; the Host stamps actual principal provenance and restricts runtime, scope and audience. Persona incorporation uses the existing A2 preview and submission path and retains the resulting draft revision/hash. Reads and retries never create replacement jobs; unknown output remains an original reconciliation responsibility. Results are private and rechecked against current authority.

`simulation/generation-input` and `simulation/generation-output` are required helper events. Transcript reads validate the exact input message identity, scope/audience, model/policy versions, raw output and optional token counters. Extra fields, malformed request bytes and ignorable markers reject; missing usage remains unknown.

English | [中文](https://github.com/Linorman/clocky/blob/master/python/sdk/README.zh.md)

`read_simulation_world_management_fields`, `preview_simulation_world_management` and `submit_simulation_world_management` are available on both clients. Strict models retain every original form choice, including inactive effective-time input, and bind preview/run/person revisions and hashes. Read-only previews do not restore or infer; submit preserves one command for query and exact retry. Original authenticated-user cases have no simulated requester or Operation. Cancellation requires its actual allowed preview revision/hash; callback confirmation and business outcome remain separate observations.

Case execution `observation` strictly parses the original plan, callback mode, Native sequence/update count, simulated time and fixed reason vocabulary. Unknown callbacks and blocked prerequisites are distinct. `settled` requires an explicit null reason, preserved by wire serialization; missing, extended or inconsistent observations reject. Callback uncertainty never replaces an existing committed business result.

Execution detail `responsibilities` strictly distinguish personnel, representative and contact states, retaining original ownership and ordered revisions. Shared representative preparation may reference an earlier intent; contacts and personnel must belong to the selected case. Unknown statuses, duplicate kinds, private fields and reversed sequences reject.

`preflight_simulation_world`, `create_simulation_world`, `prepare_simulation_world` and `export_simulation_world_definition` are available on `HarnessClient` and `Clocky`. Strict `WorldScenario` input carries symbolic installed references and declared quotas; preview/export responses reject private Native fields and unknown required protocol variants. Creation/preparation preserve original commands and remain paused; explicit management and restore own execution. Export is a portable creation definition, not a run backup. Unknown required Session events raise `SdkProtocolError`; unknown events with `ignorable: true` remain raw notifications but `validated_coordinator_event()` returns `None`, so they never enter the known typed transcript.

`limits.world.maxRequestsPerActorPerInterval` is an optional positive safe integer in authoring inputs and required in resolved previews. Native counts accepted requests by actor and the source decision’s simulated `budgetInterval`; cancellation or later rejection does not refund admission, and exact business retries do not consume another request.

`limits.world.maxBirthsPerInterval` and `maxExternalExpansionsPerInterval` accept nonnegative safe integers; zero disables dynamic births or external expansion. `maxPendingMutations` accepts only `1`, freezing structural mutation concurrency. All three fields may be omitted from authoring inputs but are mandatory in resolved previews.

v1 `organization.hiringFees` carries only explicitly authored one-time hiring terms: a fixed policy, hiring operation, position, distinct existing debit/credit accounts, unit, positive decimal quantity, distinct grant references and a positive simulated reservation period. Omission remains undeclared; no fee or payment default is inserted. Missing/malformed fields and unknown properties reject. Control and operational DTOs preserve the closed `resource-capacity`, `resource-history-limit` and `resource-reservation-expired` stops. The Host/Native owns account resolution, authorization, debit and recovery; the SDK introduces no payment mutation API or private compilerVersion field.

World Native allowances include `maxResourceReservationHistory`: resolved limits require a positive safe integer, while scenario inputs may request a bounded positive override. It caps all retained resource reservation history; cancellation or simulated expiry does not return history capacity. Reservation, commit and cancellation remain observable through existing operation metadata and authorized original journal text. The SDK exposes no Native transaction mutation API; missing required fields, unknown structural fields and unauthorized bodies still reject.

`WorldScenarioV1` and `WorldDefinition` accept the complete explicitly tagged v1 authoring groups. `SimulationWorldPreflightV1Ready` returns the actual paused initialization, domain pins, temporal permissions, committee rules, institution metadata and source counts. All nested fields and diagnostic kinds remain closed. Required null interval ends survive `model_dump(exclude_none=True)` in definitions, requests, previews and exports; omitted optional fields stay omitted. Director declarations require a strict positive `maxRequests`, separate from world quotas; the Host compiler checks its finite calendar bound and installed capability, refusing unsupported declarations.

Both clients expose `list_simulation_world_cases`, `inspect_simulation_world_case` and `cancel_simulation_world_case`. Their strict `SimulationWorldCasesInput`/`Page`, `SimulationWorldCaseInput`/`Inspection` and `SimulationWorldCaseCancelInput` retain the original selection and reject unrelated result identities. The four detail sections distinguish planning, execution and notification; a completed wake does not establish a delivered message. Case prose and Persona have separate disclosure states. Cancellation queries retain `worldCancellation`; uncertain transport requires querying and explicitly retrying the same command, with no implicit inference or scheduling. Case summaries require `clocky.world-case/v4`, domain/operation/version and `targetEntityId`; old position-only summaries reject. Only exact hiring apply plans admit Persona and hiring reservations. Required `request: null`, `predecessor: null` and JSON `payload: null` survive optional-field wire dumps. Required lifecycle tracks separate request, plan, callback/business and notification from the same Native prefix; contradictory details, missing tracks and v1 responses reject.

Case results separate the common terminal `outcome` from required JSON `payload`. A committed outcome is `{ "kind": "committed" }`; hiring `entityId` and `relationId` belong to `payload` and must match an original hiring reservation when present. Other domains can return committed JSON payloads without a hiring reservation. Parsers reject the former outcome identity fields, missing payloads and non-JSON values. Product methods accept actor-free selectors; Native intent creation remains a trusted-owner capability.

The control response exposes at most 32 authorized ingress targets from the complete installed topology; each ingress command still selects one entity.

`list_simulation_requests(SimulationRequestsInput(...))` discovers one bounded original receipt page without private command inputs. `retry_simulation_request(SimulationRetryRequestInput(...))` accepts only the run and retained command identity; backend-retained input is replayed only for accepted commands, and terminal receipts stay unchanged. Both clients validate run, command, requested revision and page size, never traverse pages or retry automatically, and reject private or substituted results.

`preflight_simulation(SimulationPreflightInput(...))` on both public clients returns current readiness without a command identity or resource reservation. `SimulationLimitsInput` permits only optional deployment-allowlisted run allowances; `SimulationPreflightResult` requires either resolved configuration or bounded field issues. Catalog configuration includes defaults and editable keys. Exact decimal `maxTime` remains a string; creation independently rechecks and retains its original command.

`SimulationCheckpointDiagnostic` carries only finite public stage/code values, exact canonical subject identities and optional unconfirmed cleanup. Both receipts and checkpoint detail models refuse diagnoses on successful or unrelated operations and forbid provider messages, paths and arbitrary causes.

`retry_simulation_operation(SimulationOperationRetryInput(...))` submits one exact existing outbox-budget grant through both public clients. The strict input normalizes reason once and rejects changed identity whitespace or unsafe/nonpositive attempt counts. Original queries retain `retryOperation`; a different payload cannot reuse its command, and `not-found` never authorizes a fresh identity. Grant/query remain separate from explicit scheduling and target reconciliation.

`get_simulation_run_statuses(SimulationRunStatusesInput(...))` reads one exact ordered authorized batch through both public clients. Strict native metrics preserve canonical decimal intervals and charged unknown attempts; `modelPool` reports real-time Host permit/queue occupancy separately from run budgets. Scenario versions come only from the original trusted template. Missing/unavailable observations stay explicit, and provided private or substituted fields reject.

`list_simulation_task_reviews()` and `resolve_simulation_task_review()` share strict `SimulationTaskReview*` models and the installed scene authority. Clients correlate the exact owned run, revision/page or original review command. `get_simulation_request()` retains the original `review` input; cold writes require explicit restore. Review never grants ordinary Team mutation or body access.

`inspect_simulation_source(SimulationSourceInput(...))` returns a strict `SimulationSourceInspection`. Continue searching with the opaque cursor, then continue found text with that cursor and `envelope.sequence`. Selection/revision/position mismatches and bodies on redacted results are rejected.

Knowledge inputs accept an exact decision `reference`; strict models and client correlation refuse substituted versions and source fields. Current audience and Host content grants still govern every returned text part.

`watch_simulation(SimulationWatchInput(...))` performs one bounded real-time metadata wait. Exact run checks and strict DTOs reject substituted or private results; reset discards prior policy/body responses. Repeating a watch is caller-owned and never resumes a model.

`Clocky` and `HarnessClient` provide Simulation product metadata, creation/preparation, `get_simulation_control()`, `manage_simulation()`, `get_simulation_management()`, `checkpoint_simulation()`, `restore_simulation()`, `ingress_simulation()` and `get_simulation_ingress()` when the selected runtime mounts the product services. Public `Simulation*Input` models reject execution configuration and invalid collection/section filters; response models preserve exact decimal time strings and reject bodies when the Host marks them withheld. `inspect_simulation_object()` supports separately paged entity relationships and frozen decision context. Only an explicit Host context grant discloses recorded plain text; source references grant no Team/Session body access, and this view is not the complete model request. Clients check selection/revision, command kind, restore target, original scheduling phase and ingress target/time. Retain the original command, management or ingress ID and payload after disconnect; `not-found` does not establish failure. Creation prepares a paused run without inference; old scheduling retries retain their original result without undoing later pause. Checkpoint/restore leave the run paused, restore validates the current suffix without rollback or inference, and input assignment remains separate from consumption. These methods never automatically retry commands or traverse pages.

Retain `commandId` and original fields in `update_team_task()` or `Team.update_task()`. Acceptance returns original `value.receipt` and current `value.task`. `get_team_task_update_result()` and `Team.update_result()` read applied, terminal rejected or currently missing outcomes without writing. Strict models validate refusal reasons and original revision comparisons, and clients check exact command identity. `not-found` leaves a delayed request unresolved.

`list_teams()` returns only safe metadata readable by the authenticated principal, without physical scan counts or authority grants. Encrypted `nextCursor` is valid only for that principal generation; an expired cursor requires an explicit first-page request. Team reads require current membership and never start model execution.

Python subprocess SDK for driving Clocky over JSON-RPC stdio. The
runtime inherits the environment named by the selected Cordis composition, so
callers can use real model endpoints directly or point those variables at a
local proxy.

Install the `clocky-sdk` distribution from PyPI; the import module remains `clocky`:

```sh
python -m pip install clocky-sdk
```

Installing `clocky-sdk` installs the exact same-version `clocky-runtime-bin` platform wheel. The normal entry point therefore needs no executable argument:

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="test-provider", model="test-model") as harness:
    result = harness.run("Say hi.")
```

`Clocky` keeps its lazily started runtime subprocess for reuse across calls. Use it as a context manager, as above, or call `close()` explicitly when finished.

By default, the SDK launches the bundled single-file `clocky-jsonrpc-agent` executable from the `clocky-runtime-bin` package and injects that package's default configuration (the stdio JSON-RPC server, agent core, a dormant generic provider route, JSONL session persistence, and the local Team Hub/Link/Agent Client/TeamRun stack) via `CLOCKY_CORDIS_CONFIG`. To run a plugin composition of your own, keep the `@clocky/clocky-sdk-jsonrpc-server` entry in the config and pass the Cordis config path.

```py
from clocky import Clocky

with Clocky(
    provider="test-provider",
    model="test-model",
    credential="product-credential",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`credential` is an opaque product credential supplied directly to `Clocky`. The SDK sends it only in the initialization handshake, never in later Team requests, the runtime environment, or launch arguments. For the bundled default configuration, the parent supplies only its SHA-256 digest as `CLOCKY_PRODUCT_CREDENTIAL_SHA256` after credential scrubbing. `provider` selects a provider route registered by the chosen Cordis composition; `model` is the model id resolved by that adapter. `max_tokens` is an optional positive output-token cap for each SDK-created Team coordinator request; omission leaves the provider default in control. Compaction summaries keep the separate limit configured by their compaction plugin. The bundled default composition registers the inert `test-provider` route for keyless boot and scripted verification. A custom composition can mount `llm-pi-ai`, configure provider-specific credentials/endpoints there, and select any provider/model present in pi-ai's installed catalog.

The [Python SDK tutorial](https://github.com/Linorman/clocky/blob/master/docs/user/guide/python-sdk.md) provides an ordered installation and first-run path without the Web UI. The [`jsonrpc-agent` example](https://github.com/Linorman/clocky/blob/master/examples/jsonrpc-agent/README.md) owns the complete standalone Cordis file used there.

The bundled runtime also includes an explicit `local-vllm` route for the canonical local OpenAI-compatible server at `http://127.0.0.1:18000/v1`. Select it without a custom Cordis file by setting `CLOCKY_LOCAL_MODEL_ID` and `CLOCKY_LOCAL_MODEL_API_KEY` (use `EMPTY` for the supplied unauthenticated endpoint), then pass the route and model to `Clocky`; `CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high` is translated to the tested Qwen endpoint's `xhigh` spelling. A different base URL belongs in an explicit Cordis config supplied through `CLOCKY_CORDIS_CONFIG`.

```sh
CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high
```

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="local-vllm", model="Qwen3.8-27B-AWQ-4bit") as harness:
    result = harness.run("Make the requested code change.")
```

`Clocky.create_team(input, objective=...)` creates the default human/coordinator/worker Team and returns a `Team` handle with `id` and `coordinator_session_id`. `Clocky.resume_team(team_id)` and `Team.resume()` read the current durable Team cursor before sending an authenticated actor-free resume request; pass `expected_cursor=` to use an explicit observed fence, or use `HarnessClient.resume_team(TeamResumeRequest(...))` at the low-level boundary. A stale cursor remains a `JsonRpcError`, so reread state before retrying. Strings become one direct-v3 text block; explicit input preserves ordered direct-v3 text/image blocks. A string supplies the objective by default, while image-only input requires `objective`.

`Clocky.list_teams()` and `Clocky.get_team(team_id)` expose durable Team projections without activating a coordinator. `Team.state()` reads its latest projection; lifecycle changes use typed Team operations rather than a generic phase mutation.

`Clocky.list_teams()`, `Clocky.list_team_members()`, `Clocky.list_team_tasks()`, and `Team.channel()` return bounded pages. Pass `after_cursor` and `limit` to continue from `nextCursor`; the SDK forwards these fields unchanged over the shared JSON-RPC protocol, and omitting them uses the runtime's bounded default.

`Clocky.team_metrics()` (or `Team.metrics()`) returns process-local Team operational counters and gauges, including active admissions, checkpoint/compaction counts, audit-projection repair/failure counts, and cumulative task/receipt latency histograms, for dashboards and alerts.

`HarnessClient.read_team_artifact()` and `Team.read_artifact()` read one visible provider-backed artifact by its durable id and return the exact reference, byte count, and base64 data. Private, ambiguous, provider-less, missing, and oversized artifacts remain unavailable through this SDK surface.

`Team.wait_for_final()` returns `TeamFinalReceipt(team_id, channel_id, envelope_id, text)` only while the runtime still owns that TeamRun, after the coordinator's explicit `team_final` Envelope has a human receipt and the local topology settles. `Team.cancel()` has the same ownership condition and returns after the terminal Team phase settles. `Team.archive()` binds a terminal Team and cursor to the authenticated active human proof, so it also works for detached or restarted Teams; an active Team is rejected and a repeated archive remains idempotent. `Clocky.run()` returns `RunResult(team_id, final_response, final, events, notifications)`, where `final_response` equals `final.text` and `events` and `notifications` contain coordinator session facts in wire order.

`HarnessClient` retains generic notification subscriptions and low-level authenticated Team methods including `create_team()`, `resume_team()`, `wait_for_team_final()`, `cancel_team()`, `archive_team()`, member, channel, goal, and task mutations. Closing a notification subscription drops queued items and wakes every parked `next()` with `TransportClosedError`; runtime failure remains observable through the same subscription. `HarnessError`, `JsonRpcError`, `SdkProtocolError`, `TransportClosedError`, and `NotificationSubscription` are exported from the `clocky` package for callers that need typed handling. Resume derives the active human from the initialized credential and requires its explicit cursor fence; a stale fence returns `JsonRpcError` rather than being retried with a fabricated cursor. Team ids, cursors, and participant ids do not prove authority, and all mutation payloads remain actor- and proof-free. The runtime derives the active human from the initialized credential and enforces its immutable grant, revision or cursor fence, and review policy. Bounded list/read/watch, quiescence, audit, and metrics remain available. Sessions remain transcript sources and are not product run targets. Malformed Team receipts or coordinator events raise `SdkProtocolError`. The [authenticated product-principal Team control note](../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.md) records the connection binding; the [Team actor-proof control-plane proposal](../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) remains the broader proof owner.

The same behavior can be selected for the runtime subprocess with `CLOCKY_CORDIS_CONFIG`. `HarnessClient.initialize()` launches the child only after receiving its credential, so the low-level client's default launch gets it too: when the launch resolves to the bundled runtime and neither `cordis` nor a non-empty `CLOCKY_CORDIS_CONFIG` is set (the runtime treats an empty value as absent, and so does the injection check), the bundled default configuration is used; an explicit `runtime_bin`, `bridge_bin`, or `launch_args_override` disables the injection entirely. See the [sdk-runtime README](https://github.com/Linorman/clocky/blob/master/python/sdk-runtime/README.md) for the runtime carriers (production exe vs dev-only node closure) and how to obtain them.

`cwd` and `runtime_cwd` are resolved to absolute paths before subprocess launch, environment injection, and the wire handshake. The public API exposes only applied options: deployment persona and persistence belong in `cordis.yml`, while `session_root` remains the high-level convenience that sets `CLOCKY_SESSION_ROOT`.


`Clocky` and `HarnessClient` expose `inbox_read(after_cursor=None, limit=None)`, `inbox_watch(...)`, and `inbox_acknowledge(through_cursor)`. Reads return `TeamHumanInboxPage`; acknowledgement returns `TeamHumanInboxAcknowledgement`. These exported models preserve exact final provenance and the shared durable display cursor. The initialized principal selects the inbox, and display acknowledgement remains independent of channel receipts. The [inbox Consumer](../../packages/team/team-human-client/README.md) defines permissions, pagination, restart behavior, and current limitations.

Team-list `nextCursor` values are opaque strings; `after_cursor=-1` begins a fresh scan. Continue empty pages when a cursor is present and use `scanned` for work accounting. An expired discovery cursor requires restarting. Other collection cursors remain numeric.

`inspect_team_task(team_id, task_id, "record")` returns current fields and history counts. Use `"attempts"` or `"reviews"` with `after_cursor`, `limit`, and `expected_revision` for a bounded history page. Replies are checked against the selected Team, task, section, revision and window. A stale revision requires refreshing the record; private artifact references are omitted.


`list_simulation_tasks()` reads bounded canonical run-owned controls. `cancel_simulation_task()` retains the source operation, task revision, original command and exact attempt; required nullable `expectedAttemptId` preserves explicit `None` as JSON `null`, requiring no active lease. The SDK checks run/command/receipt family and rejects missing fences, actor fields and invalid hints. `get_simulation_request()` exposes original `cancellation` only with its matching `cancel-task` receipt; queries do not retry or infer.

Catalog and preflight DTOs require strict `readiness` variants. Create requires `expectedModel` from the observed `ready.model`; `name` is the provider-owned model ID. Missing model configuration keeps installed templates readable and cannot be passed as a ready route. No client automatically changes routes or retries creation.

`readSimulationWorldDomain` (`read_simulation_world_domain` in Python) uses the shared `simulation/world-domain-read` method. Its strict `clocky.world-read/v1` result binds the complete original selector and independently bounded coverage; unknown fields and substituted identities, versions, sections or coverage reject. Continue with the returned cursor and original revision/readVersion. Unknown residency and nullable obligation counts remain unknown, while simulated times and norm/proposal versions remain canonical decimal strings. Reads do not restore, attach or infer; body grants never imply Session authority.

`read_simulation_draft` and `save_simulation_draft` use strict `ScenarioDraftRead`/`ScenarioDraftSave` models. Save retries preserve the original ID and complete payload, including the explicit null parent for creation. Responses are correlated to that exact draft/revision or original save. Conflicts return both definitions without overwriting either; these operations do not invoke models.

## Single-task cancellation

`HarnessClient.cancel_team_task()` and `Team.cancel_task()` accept `teamId`, `taskId`, `expectedRevision`, and optional `reason` (the Team helper supplies its own Team id). `value.cancellation` retains the exact intent; assigned or running phases mean termination is pending. Observe the task until cancelled while the Team continues. [Cancellation ownership](../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).

`read_simulation_records(SimulationRecordsInput(...))` returns a strict `SimulationRecordsPage` with exact run/filter/mode correlation. Metadata never includes raw JSON text. Original text requires a separate whole-run historical-content grant, uses ordered Unicode-safe parts and carries the revision and policy version needed for consistent reconstruction.

`preview_simulation_world_calendar` quotes a paused schedule edit; `submit_simulation_world_calendar` retains that exact quote before execution. `read_simulation_world_calendar_command` retrieves the author-scoped original after restart, while `cancel_simulation_world_calendar` preserves an already applied racing receipt. `WorldCivilCalendar` retains explicit IANA data version, UTC origin, weekdays and DST disambiguation; conversion belongs to the Host. Proposal domain reads with `section="impact"` accept `SimulationNormImpactInput` and return a read-only complete future-calendar/obligation report subject to independent disclosure permissions.

## Private backup export

`client.backup_export(SimulationBackupExportInput(...))` reads an original completed private bundle. Strict result validation verifies the SHA-256 of the exact UTF-8 bundle bytes, and the client checks the original run/command identities. Export requires a separate private-record disclosure grant and never starts inference or restores a run. Full branch exports additionally require current ancestor disclosure grants or an explicit exact-branch `includeProvenance: true` grant; branch-only permission does not disclose ancestor bytes.

## Immutable experiment cuts

`branch_world`, `read_world_branch`, `query_world_causal`, and `compare_worlds` accept strict experiment models. Retain the original branch UUID across timeouts; a read never creates another branch. Clients verify the selected original cuts and complete causal-response byte/node bounds. Branches use an explicit memory policy and separate start; comparisons include actual budgets and stop differences and do not infer quality, cost, or causal effects.
