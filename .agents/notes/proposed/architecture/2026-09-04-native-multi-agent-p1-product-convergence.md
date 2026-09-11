# Agent Note: Native multi-agent P1 product convergence

Status: proposed

English | [中文](2026-09-04-native-multi-agent-p1-product-convergence.zh.md)

## Problem

The [native multi-agent work-system proposal](2026-08-27-native-multi-agent-work-system.md) has broad local implementation, but the shipped product still exposes a fixed local coordinator/worker topology rather than the complete Team model. Child-Team delegation has no Consumer, direct channels remain single-recipient or exactly two-party, channel invitations are not durable, product task creation resolves only a local worker pool, shared work does not record undeclared filesystem changes, remote recovery is same-host, the Team page is mostly read-only, legacy orchestration remains in public catalogs, and final browser, performance, distributed, SDK, and release evidence is incomplete.

The [P0 safety-closure specification](2026-09-04-native-multi-agent-p0-safety-closure.md) makes human mutations, lifecycle recovery, channel implementations, and model-visible channel views safe. P1 must build the remaining product behavior on those P0 guarantees without introducing a second orchestration path or weakening fail-closed remote cancellation.

## Proposal

Land one dependency-ordered P1 stack that turns the stable Team spine into the only complete shipped work model. P1 adds child-Team delegation, direct multicast and channel admission, generalized task placement and cancellation, shared-workspace observation, multi-host supervision and human delivery, authenticated Team UI mutations, literal legacy cutover, measurable performance budgets, and the final promotion evidence.

P1 owns the following stable requirement ids:

| Requirement | Outcome |
|---|---|
| `P1-CHILD` | A coordinator or authorized human can delegate a parent task to a bounded child Team whose authority, budget, result, and cancellation remain linked durably. |
| `P1-DIRECT` | The shipped direct protocol supports explicit nonempty recipient subsets and `null` broadcast without automatic replies; `final` remains exact two-party communication. |
| `P1-ADMISSION` | Channel invitation, acknowledgement, activation, expiry, and failure are durable protocol facts rather than an immediate `opened -> active` shortcut. |
| `P1-SCHEDULE` | The default scheduler and placement Consumer select local or remote participants deterministically from the full authorized roster and support durable running-task cancellation. |
| `P1-WORKSPACE` | Shared work records bounded declared and undeclared change observations without claiming a filesystem lock or actor attribution it cannot prove. |
| `P1-REMOTE` | Cross-host activation recovery, external fencing, remote human delivery, and sandbox-loss settlement converge through one authoritative Hub. |
| `P1-UI` | The Team page exposes authenticated participant, channel, task, review, artifact, human-action, lifecycle, and pagination operations. |
| `P1-LEGACY` | Legacy same-Session Goal, direct subagent, fork, and script-workflow product controls are absent from shipped catalogs, bundles, snapshots, and release artifacts. |
| `P1-BROWSER` | Real-server browser scenarios and optimized GIFs cover the complete Team management and human-action flows. |
| `P1-PERF` | Reference-runner latency, memory, pagination, queue, and shutdown budgets turn bounded design claims into measured release gates. |
| `P1-PROMOTION` | Distributed fault, keyed model, SDK, coverage, documentation, packed-consumer, and platform-release evidence close every parent acceptance criterion. |

### Scope and non-goals

P1 retains one authoritative Hub and the existing Agent/Session/agent-loop execution primitive. It does not introduce multi-Hub consensus, leader election, transparent federation, exactly-once model or tool execution, a distributed filesystem lock, automatic Git integration, or an LLM-selected core scheduler.

Remote hard termination is available only when a configured provider can prove external fencing. A cooperative endpoint without such a provider remains durably stalled on cancellation. P1 never reports success merely because a transport disconnected.

### Dependency on P0

P1 implementation begins only after `P0-AUTH`, `P0-LIFE`, `P0-LEASE`, and `P0-VIEW` pass their cutover gate. P1 channel work acquires retained implementation leases; UI and SDK writes use authenticated human proofs; child and remote lifecycle reuse the restart-safe closure driver; every protocol turn uses durable model-view admission.

```text
P0 safety closure
  ├─> direct + channel admission
  ├─> scheduler + placement ─> child Teams
  ├─> workspace observation
  ├─> remote supervision + human delivery
  └─> authenticated Team UI
all P1 capabilities ─> legacy cutover ─> final evidence and promotion
```

### Package and contract changes

| Package | Required change |
|---|---|
| `packages/core/team` and `packages/team/team-hub` | Add task execution kind, delegation bindings, running-task cancellation facts, channel invitation/ack records, direct-v4 manifests, shared-change observations, remote settlement facts, and corresponding proof scopes. |
| `packages/team/team-delegation` | Own the parent-task/child-Team saga, source-scoped child creation, result projection, parent charging, cancellation propagation, and recovery. |
| `packages/team/team-channel-direct` | Register direct v4 with subset/broadcast delivery, text/image messages, and exact two-party final restrictions. |
| `packages/team/team-channel-admission` | Invite participants, collect authenticated acknowledgements, activate or expire pending channels, and recover unfinished admission. |
| `packages/team/team-placement-default` | Provision or resume eligible local/SDK/ACP participants from durable task requirements without embedding provider logic in the scheduler. |
| `packages/team/team-scheduler-dag` | Rank complete eligible rosters, use deterministic observed-outcome inputs, dispatch cancellation, and preserve shared-scope serialization. |
| Workspace providers and `team-agent-client` | Record shared change observations, consume generalized placement/allocation, publish artifacts, and settle cancellation. |
| `packages/core/activation-supervisor` | Define named cross-host fence/health providers at `ctx.activationSupervisors`. |
| AgentRuntime and supervisor providers | Declare termination mode, durable recovery descriptor, external fence capability, and exact terminal proof. |
| `packages/team/team-human-client` | Persist principal-bound human deliveries and acknowledge them independently from process-local `TeamRun`. |
| Host, SDK, Client runtime, and `ui-team` | Expose authenticated paged mutations and render the complete Team interaction model. |
| Legacy goal/subagent/workflow groups | Move retained compatibility code behind private, renamed explicit compositions or delete it after parity; remove product catalog and release reachability. |

### Child-Team delegation

#### Durable task model

`TeamTaskSnapshot` gains one immutable execution discriminator selected at creation:

```text
TeamTaskExecution =
  | { kind: 'participant' }
  | {
      kind: 'child-team'
      templateId: string
      templateVersion: number
      authorityGrant: TeamAuthorityGrant
      budget: TeamResourceBudget
    }
```

A child-Team task also retains a delegation projection with `requested`, `creating`, `active`, `settling`, or terminal `completed | failed | cancelled | stalled` phase; its idempotency key, optional `childTeamId`, observed parent and child cursors, result Envelope/artifact references, and exact failure or stall reason are durable. Participant tasks keep their current lease path and never receive a child-Team binding.

The child authority grant and budget must be subsets of the parent task, remaining parent Team grant, and human authority. `maxTeamDepth`, total child count, live Activation, token, turn, wall-time, cost, retry, concurrency, and artifact limits are checked before child creation. A pending parent charge blocks new child work as it does for existing child usage accounting.

The child template provisions a service Participant representing the exact parent delegation. Child completion requires a coordinator result Envelope addressed only to that service Participant and a durable service receipt; it does not fabricate a human recipient. The root Team remains the sole owner of the final human-addressed answer.

#### Delegation saga

`team-delegation` owns a restart-safe cross-stream saga because a parent Team journal and child Team journal cannot commit atomically:

1. Commit the parent task and a `delegation/requested` fact under task CAS.
2. Mint one `TeamSystemChildCreationProof` bound to the parent Team, task, observed parent cursor, complete child payload, and retry key.
3. Create or recover the child Team; child creation uses the retry key to return the same `TeamId`.
4. Bind that child id to the parent task under a new parent revision.
5. Start the child template and project only its explicit parent-service result, terminal failure, artifacts, and usage into the parent settlement.
6. Settle the parent task after the child Team reaches a terminal phase and all parent charges commit.

Recovery repairs request-without-child, child-without-binding, binding-without-start, terminal-child-without-parent-settlement, and parent-cancel-with-live-child states. It never discovers ownership from hierarchy alone or creates a second child for one delegation key.

The coordinator tool owner adds `team_task_delegate`; an authenticated human uses the same Host/SDK task-create schema with `execution.kind: 'child-team'`. The model supplies task intent, bounded requested grant/budget, and template selection but never supplies a parent actor, depth, child id, or proof.

Parent cancellation records an intent, requests child cancellation through the closure driver, and waits for confirmed child settlement or a durable remote stall. A child cannot outlive an archived parent, and parent archival rejects while any child delegation remains nonterminal.

### Direct v4 and channel admission

#### Direct v4

Direct v4 accepts at least two distinct active Participants. A message audience is either `null`, meaning every other manifest participant, or a duplicate-free nonempty subset that excludes the sender. The Hub expands broadcast to immutable per-recipient delivery intents at commit time. Each recipient claims and acknowledges independently; one slow or failed recipient cannot manufacture another recipient's receipt.

Messages use direct-v3 ordered text/image content and preserve the caller-selected `context | turn | steer` intent subject to policy. Direct v4 has no automatic reply, speaker selection, or transcript sharing. A `final` is legal only on an exact two-party product channel, must address solely the authorized human peer, uses `turn`, and never broadcasts.

Shipped Team templates move to direct v4 in one pre-release cutover. Direct v1-v3 are not widened. If compatibility packages retain them, they use explicit adapter versions outside shipped templates and product catalogs.

#### Durable admission

Opening a channel appends `channel/opened`, `channel/phase pending`, and one `channel/invitation` per required participant in one WAL batch. Each invitation snapshots role, visibility, required/optional status, acknowledgement deadline, and endpoint expectation. A Participant may acknowledge only through its activation proof, authenticated human proof, or service-owned system proof.

The Hub appends `channel/acknowledged` after the endpoint proves it can receive the manifest version. It appends `channel/phase active` only when every required acknowledgement is durable and every retained implementation lease remains valid. Sends reject while pending. Optional participants that miss their deadline are removed through an adapter-authorized transition; a missing required participant appends `expired` or `failed` with a structured reason.

The admission Consumer replays pending channels on startup, reissues only unacknowledged invitations, and applies configured bounded deadlines. Acknowledgement means endpoint admission, not model execution. Channel close or Team cancellation terminates pending invitations before releasing implementation leases.

### Generalized scheduling, placement, and task cancellation

#### Placement Consumer

`team-placement-default` separates participant provisioning from deterministic assignment. It consumes ready tasks that have no eligible live Activation, filters authorized Participant descriptors and configured templates by task capability, workspace mode, provider/model route, preset, and budget, then asks `ctx.teamActivations` to start or resume the selected Participant. It records no task lease. The scheduler assigns only after a durable idle binding exists.

Task creation may constrain allowed Participant ids, roles, AgentRuntime providers, model routes, presets, and workspace modes, but every constraint must be a subset of the creator's grant. Omitted placement constraints mean the Team template's frozen defaults, resolved once at task creation rather than hidden inside provider execution.

Workflow role resolution uses the same roster query and placement path and does not hardcode the local default coordinator, worker, or reviewer. Multiple workers and reviewers may be active concurrently within Team and workflow bounds.

#### Deterministic ranking

The scheduler selects tasks in priority and creation order, then ranks eligible owners by this immutable tuple:

1. exact explicit owner proposal;
2. smallest capability surplus;
3. lowest current assigned/running load;
4. highest completed-attempt count minus failed, expired, released, and cancelled attempts for the same capability set;
5. lowest bounded median task latency bucket;
6. lowest frozen cost-rate bucket when a task has a cost ceiling;
7. stable `ParticipantId` lexical order.

Observed outcomes come only from Hub-derived durable stats. Missing history sorts after an equal proven outcome but before a negative outcome, preventing an unused Participant from being permanently starved. Ranking uses integer counts and configured buckets rather than floating-point scores. Team rules snapshot the ranking-policy name and version so replay and restart select the same owner.

#### Running-task cancellation

`cancelTask()` accepts pending, assigned, running, or review tasks through an authenticated actor. Pending and review tasks become `cancelled` immediately when no provider work is live. Assigned or running tasks append a cancellation request containing actor attribution, reason, task revision, attempt id, and activation epoch; the task remains nonterminal until the owner reports `cancelled`, the provider proves termination, or lease expiry records the exact failed cancellation attempt.

The task-assignment Link delivers a cancellation command fenced by task, attempt, activation, and Session. Stale acknowledgements cannot cancel a replacement attempt. A failed or offline endpoint follows retry/reassignment or Team stall policy; cancellation never silently returns a running task to pending.

### Shared-workspace change observations

The shared provider records a bounded baseline version when an allocation materializes and a final version on publish, release request, integration proposal, or configured observation pulse. It classifies changed paths as declared when they fall under the task's `writeScopes`, undeclared when they fall outside those scopes, and external-window when they changed while no matching attempt owned the allocation. It does not claim which process or person wrote a path.

Each observation becomes a Team-journal `workspace/observed` fact containing allocation, task, attempt, base/final content version, sorted bounded path summaries, truncation counts, and observation time. The audit projection derives warnings from that source record; audit failure cannot roll back the observation. File contents stay in the workspace or artifact provider rather than the journal.

Configuration bounds scanned files, hashed bytes, recorded paths, observation duration, and optional pulse frequency. Exceeding a bound records a truncated warning and may block integration according to policy, but it does not claim the checkout is unchanged. Shared write-scope serialization remains a scheduler rule, not a filesystem lock.

Tests cover declared Bash and generator writes, undeclared writes, changes between attempts, symlinks, deletions, oversized trees, concurrent observation, restart, stale baseline, audit repair, and target integration fences.

### Multi-host supervision and human delivery

#### Activation supervision

Each AgentRuntime provider declares one termination mode: `owned-process`, `externally-fenced`, or `cooperative`. A durable recovery descriptor records provider, supervisor name/version, host identity, endpoint identity, process or sandbox creation identity when available, and non-secret fence generation. Secrets and live filesystem roots remain provider state.

`ctx.activationSupervisors` resolves named health and fence providers. A supervisor can validate a descriptor without side effects, report `reachable | unreachable | terminated | unknown`, and fence one exact generation. It returns success only after the endpoint cannot send, receive, heartbeat, settle, or integrate Team work under that Activation. Provider or supervisor removal blocks new operations but lets admitted fences settle.

`team-activation-recovery` pages unfinished Activations across all configured hosts, selects the durable supervisor version, validates its descriptor, and either cold-resumes the same Participant/Session under a new epoch or records an exact stall. `unknown` never becomes `offline`. E2B sandbox loss records the allocation and attempt as unavailable, publishes any retained artifacts, then follows retry or stall policy without reconstructing an expired sandbox.

#### Human delivery

`team-human-client` binds an authenticated product principal to its active human Participants without creating an Activation or Session. It persists a bounded `principal-inbox/<ProductPrincipalId>` stream containing final Envelopes, approval/question requests, review requests assigned to humans, and lifecycle notices with exact Team/channel/task provenance and rendered content. The stream has its own monotonic version, idempotency keys, and display cursor. After that inbox append flushes, the Consumer writes the channel receipt. Browser or SDK display is downstream of durable Host admission.

Reconnect lists pending principal inbox pages after the last client cursor; an explicit client acknowledgement advances the display cursor but is not required to prove Team delivery durability. A final Team result therefore survives Host restart without depending on `TeamRun` to retain a process-local final-receipt proof. Visibility and Team membership are revalidated before each page. Retention removes only entries below the durable display, Team-audit, and channel-replay watermarks; deleting or revoking a principal blocks reads without rewriting historical Team attribution.

The same provider routes authenticated human responses through P0 one-shot proofs. A response carries only action id, cursor, and typed answer; it never accepts caller-selected Participant, Session, task, or reviewer authority.

### Complete Team product UI

The Team page remains a projection of Team, channel, task, artifact, audit, and principal-inbox owners. It does not scrape Session transcripts and does not maintain an optimistic business-state copy.

The page adds:

- participant invitation, activation, removal, and interrupt controls with grant-aware disabled states;
- channel create, participant/audience selection, post, close, pending-invitation, and delivery status views;
- task create/edit, dependency and workspace selection, owner proposal, cancellation, attempt history, and child-Team navigation;
- reviewer accept/rework controls for human-reviewed tasks;
- approval and question response controls routed through the authenticated human-action owner;
- artifact preview/download and explicit integration proposal/result views;
- lifecycle resume, cancel, archive, stall diagnostics, budget use, and remote termination status;
- bounded `Load more` controls for Teams, members, tasks, channels, channel records, audit entries, artifacts, and principal inbox records.

Every mutation sends the current cursor or revision and an idempotency key. A conflict refreshes the authoritative projection, preserves unsent form input, and explains the changed subject. Cancellation aborts only the local request unless the mutation already committed. Loading, empty, denied, stale, offline, partial, retryable, terminal, and provider-unavailable states receive explicit UI coverage.

Participant selection opens a descendant Session only when one exists. Human, service, and offline remote Participants remain inspectable without fabricating a Session. Accessibility tests cover names, focus restoration, keyboard operation, live status announcements, error association, reduced motion, and non-color state distinctions.

Real-server Playwright scenarios cover the default Team, multiple workers, participant review, child delegation, broadcast delivery, remote disconnect, approval/question response, pagination, artifact read, cancellation stall, resume, and archive. Every product-visible flow records the required optimized GIF from the real server and model/replay path.

### Legacy product cutover

P1 applies the literal cutover required by the parent proposal. The default bundles, generated tool/config catalogs, app snapshots, SDK runtime carriers, packed Clocky release, and public product docs contain no same-Session Goal scheduler, direct subagent/fork tool, private child report/control tool, or model-written JavaScript workflow tool.

Before removal, source and built-artifact scanners enumerate every import, config row, generated entry, snapshot, package dependency, and runtime tool name. Replacement Team snapshots cover every behavior still promised by the product.

Compatibility code with a current explicit consumer moves to a private `packages/compat/` group, receives `@clocky/clocky-compat-*` package names and `legacy_*` tool names, and is excluded from release-family discovery and generated product catalogs. Examples opt in through their own `cordis.yml`. Code with no current consumer is deleted. Compatibility packages cannot register a shipped Team tool name or mutate Team authority.

After the last direct subagent consumer moves, `origin: 'subagent'` and `delegationDepth` leave the core product Session header. A retained compatibility implementation stores its lineage classification and depth in its own versioned descriptor event; `parentSession` remains only fork-seed lineage. Old pre-release Session headers reject under the existing format-zero policy.

The package map, architecture extension table, subsystem references, user docs, generated catalogs, examples, and active Agent Notes update together. Implemented subagent, workflow, and same-Session Goal notes remain active while their rationale still constrains compatibility code; the archive workflow classifies them only after the cutover diff proves their production reachability is gone.

### Performance and release evidence

#### Reference budgets

The SQLite reference lane runs on the dedicated Linux x64 release runner with `recoveryPageSize: 32` and `checkpointEvery: 32`. It executes three samples and gates the median while retaining individual diagnostics.

| Scenario | Budget |
|---|---|
| 4,096-record default WAL restart to first 32-record page | at most 5 seconds and 128 MiB RSS growth |
| Complete ordered enumeration of the 4,096-record WAL | at most 30 seconds |
| 16,384-record release WAL restart to first page | at most 10 seconds and 384 MiB RSS growth |
| Complete ordered enumeration of the 16,384-record WAL | at most 180 seconds |
| 10,000 pending deliveries, 64 active Activations, and 1,000 tasks | no page above its configured limit and no queue above its configured high-water mark |
| Cancellation and shutdown of the large Team after all test providers acknowledge | at most 10 seconds |

A wall-time budget is evaluated only on the reference runner; deterministic page, checkpoint, queue, retained-object, and allocation counters run on every platform. A regression exceeding a budget fails the release lane rather than silently updating a baseline. Changing a budget requires a new decision or an update to this proposal with measurements and the resource trade-off.

#### Promotion evidence

The final promotion run includes:

- keyless assembled Headless, Web, ACP, and JSON-RPC snapshots for direct, review, workflow, child, cancellation, and recovery paths;
- keyed local coordinator/worker/reviewer and workflow fan-out/fan-in runs with filesystem and artifact assertions;
- SDK, ACP, WebSocket, E2B, and human-client remote runs with restart, duplicate, out-of-order, slow-consumer, revoked credential, and cancellation faults;
- real-browser Team management scenarios and attached optimized GIFs;
- TypeScript and Python SDK contract, expected-output, bundled-runtime, and shutdown suites;
- JSON/SQLite storage conformance, model-based state machines, property tests, race/fault suites, and performance budgets;
- build, typecheck, lint, duplication, coverage, hygiene, snapshots, `doc-sync`, website build, release verification, pack, and isolated consumer installation;
- Linux, macOS, and Windows release workflow results for the canonical Clocky, vendor, native, and Python artifacts.

The parent proposal moves to `implemented/` only after each acceptance criterion names its owning test, workflow, or generated artifact and the complete outgoing diff passes the repository's pre-push policy.

### Durable and wire migration

P1 advances Team journal/checkpoint versions for task execution, delegation, cancellation, workspace observations, supervisor descriptors, and principal inbox references. Channel WAL/checkpoint versions advance for invitations, acknowledgements, direct v4, and human delivery receipts. Link frames advance only for new cancellation, invitation, or human-delivery operations that cross that transport.

Host Remotes, generated Typert schemas, TypeScript SDK models, Python models, browser runtime contracts, fixtures, and expected outputs update atomically with each owning format. Old pre-release streams fail loudly; no converter, dual reader, or hidden legacy mode ships.

### Delivery plan

| Item | Depends on | Deliverables | Exit condition |
|---|---|---|---|
| `P1-0` Contract lock | P0 complete | Failing direct/admission, placement, child, workspace, remote, UI, legacy, and performance fixtures | Every P1 acceptance path has a named initial failure and owner. |
| `P1-1` Direct and admission | `P1-0` | Direct v4, invitations/acks, pending recovery, per-recipient delivery, template cutover | Broadcast and pending-channel restart pass without automatic reply or lost receipt. |
| `P1-2` Placement and cancellation | `P1-0` | Default placement Consumer, full roster filters, deterministic outcome ranking, running cancellation | Local/SDK/ACP multi-worker tasks assign and cancel under identical task semantics. |
| `P1-3` Child Teams | `P1-2` | Task execution union, delegation Consumer/saga, child result/charge/cancel recovery, tools and APIs | Kill-point tests settle one child per delegation key and one parent result. |
| `P1-4` Workspace observation | `P1-0` | Baseline/final versions, `workspace/observed`, audit warnings, integration policy | Declared, undeclared, truncated, restart, and audit-repair cases are durable and bounded. |
| `P1-5` Multi-host runtime | `P1-1`, `P1-2`, `P1-3` | Supervisor seam/providers, cross-host recovery, human client, E2B loss, external fencer | Remote work terminates, resumes, retries, or stalls with exact evidence; disconnect alone never settles it. |
| `P1-6` Team UI | `P1-1`–`P1-5` | Authenticated mutation panes, human actions, pagination, nested/remote states, accessibility | Real-server browser tests complete every Team management flow. |
| `P1-7` Legacy cutover | `P1-3`, `P1-6` | Source/artifact inventory, private renamed compatibility or deletion, catalog/bundle/docs cleanup | Shipped source, catalogs, snapshots, and packed artifacts contain no legacy product control. |
| `P1-8` Performance and promotion | `P1-1`–`P1-7` | Reference budgets, keyed/distributed/browser/GIF/SDK/release evidence, final docs | Every parent acceptance criterion has passing named evidence and the parent Note can move to `implemented/`. |

### Verification matrix

| Area | Required evidence |
|---|---|
| Direct and admission | Multi-recipient subset, broadcast, final restriction, independent receipts, pending invite replay, optional/required timeout, cancellation, HMR lease retention. |
| Scheduling | Full roster filters, explicit proposal, capabilities, load, outcomes, latency/cost buckets, stable ties, concurrent fan-out/fan-in, shared conflicts, remote placement. |
| Task cancellation | Pending/review immediate cancel, assigned/running request, stale epoch, owner acknowledgement, lease expiry, reassignment policy, Team cancellation race. |
| Child Teams | Grant/budget/depth denial, every saga kill point, duplicate retry, parent/child restart, usage charge repair, result/artifact projection, cancellation and archive fences. |
| Workspace | Declared and undeclared paths, no-owner window, bounds, symlink/delete, concurrent scan, restart, audit failure/repair, policy-denied integration. |
| Remote | Two-host-capable transport, supervisor validation/fence, cooperative stall, hard termination, credential rotation, Hub restart, sandbox expiry, slow consumer, duplicate/out-of-order frames. |
| Human and UI | Principal inbox durability, final receipt, approval/question/review response, every mutation state, pagination, accessibility, real-server screenshots and GIF. |
| Legacy | Source, config, catalog, snapshot, dependency, generated output, package, and packed-artifact absence scans plus explicit compatibility composition smoke. |
| Performance and release | Reference budgets, per-file coverage, both SDK carriers, all repository gates, platform release workflows, isolated consumer installs, final acceptance map. |

### Decision ownership and supersession

The parent native multi-agent proposal remains the product architecture owner. P0 owns its safety closure; this Note owns later product convergence. The [Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.md), implemented closure, channel, scheduler, workspace, artifact, telemetry, and remote-placement notes remain active foundations and are not superseded by this plan.

No implemented Note qualifies for archival at proposal time. Legacy goal, subagent, and workflow notes receive a new classification only after `P1-7` proves whether their code remains as private compatibility or disappears completely. Archived records remain frozen.

## Alternatives considered

**Keep the fixed local coordinator/worker template as the complete product.** Rejected because it cannot expose first-class remote Participants, multiple workers, human reviewers, child Teams, or task-specific execution worlds without adding special paths beside the Team model.

**Use discussion channels for every broadcast and leave direct unchanged.** Rejected because direct addressing is the common peer-message contract and the parent proposal explicitly requires subset and broadcast semantics without speaker scheduling. Discussion remains a bounded conversation protocol.

**Let the coordinator spawn child Agents privately and summarize the result into a task.** Rejected because the child would lack Team identity, grant and budget inheritance, channel receipts, restart recovery, human visibility, and parent cancellation authority.

**Put placement inside the scheduler.** Rejected because provider process creation, Session materialization, credential use, and fencing evolve independently from deterministic task selection. The placement Consumer creates an eligible idle binding; the scheduler owns assignment CAS.

**Treat every changed shared-workspace path as proof of an external writer.** Rejected because Bash, generators, editors, and unrelated processes are not distinguishable from filesystem state alone. P1 records declared, undeclared, and no-owner-window observations without inventing actor attribution.

**Mark a disconnected remote endpoint offline.** Rejected because transport loss does not prove process or tool termination. A provider supplies an exact fence or the Team remains stalled.

**Leave legacy packages public but disabled in default bundles.** Rejected because generated catalogs and release artifacts still present a second product orchestration model, contradicting the single Team product invariant. Retained compatibility must be private, renamed, and explicitly composed.

**Treat browser, performance, and release checks as deployment evidence.** Rejected because the proposal changes shipped UI, persistence, remote lifecycle, SDKs, and packages. Repository-owned acceptance requires reproducible evidence before the architecture record becomes implemented.

## Acceptance criteria

- P0 acceptance remains green, and no P1 path bypasses authenticated human proofs, restart-safe closure, implementation leases, or durable channel views.
- Child-Team delegation creates at most one child per parent task/idempotency key, enforces depth/grant/budget subsets, propagates cancellation, repairs every cross-stream kill point, and settles one durable parent result.
- Direct v4 supports explicit recipient subsets and `null` broadcast with independent receipts; final remains exact two-party and non-broadcast.
- Every channel starts pending with durable invitations, becomes active only after required acknowledgements, and reaches expired, failed, closing, or closed through durable records.
- The default placement Consumer and scheduler use the complete authorized local/remote roster, deterministic versioned ranking, workspace eligibility, budgets, and exact activation fences.
- Pending, assigned, running, and review tasks have explicit cancellation behavior; a stale or disconnected owner cannot settle a newer attempt.
- Shared allocations record bounded declared, undeclared, and no-owner-window change observations; audit warnings are rebuildable and never claim a filesystem lock or unprovable actor.
- Cross-host Agent execution and human delivery survive Hub/Host restart, replay pending work, and terminate, resume, retry, or durably stall under exact provider evidence.
- The Team UI exposes the complete authenticated Participant/Channel/Task/review/artifact/human-action/lifecycle model with bounded pagination and accessible conflict/error states.
- Shipped source regions, generated catalogs, default bundles, SDK carriers, snapshots, and packed artifacts expose no standalone Session creation, legacy Goal scheduler, direct subagent/fork controls, or script-workflow child ownership.
- The reference performance budgets pass without skipped release cases, and all measured structures remain bounded by configuration.
- Keyless, keyed-model, distributed fault, real-browser/GIF, both SDK, property/race, coverage, build, hygiene, documentation, website, packed-consumer, and platform release evidence passes and names every parent acceptance criterion.
- The parent Note is reconciled to shipped reality, its supersession classifications are complete, and it moves to `implemented/` only after all preceding criteria pass.

## Risks

- Child-Team cross-stream settlement can diverge after a crash. The parent request, child creation key, binding, child terminal fact, and parent settlement are independently idempotent and recovery handles every prefix.
- Direct broadcast can multiply token use and pending deliveries. Team/channel limits, explicit audience policy, durable per-recipient receipts, view bounds, and no automatic reply cap amplification.
- Outcome-aware ranking can reinforce early noise. Versioned integer buckets, bounded history, neutral treatment for missing history, explicit owner proposals, and deterministic ties keep it inspectable.
- A placement Consumer can start expensive remote capacity before assignment. It reserves Team concurrency and cost budgets before activation and releases an unassigned epoch through the activation controller.
- Shared-work observations may report legitimate undeclared changes. They are warnings and integration inputs, not locks or proof of misconduct; exact path bounds keep them reviewable.
- External fencing widens the deployment security boundary. Supervisor credentials remain provider-owned, every descriptor and generation is exact, and an unavailable fence stalls instead of guessing termination.
- A complete Team UI creates many mutation races. Every action is cursor/revision-fenced, state remains server-owned, and unsent user input survives conflict refresh.
- Literal legacy cutover may break custom compositions. Renamed private compatibility packages preserve current explicit consumers, while the pre-release product intentionally provides no public compatibility promise.
- Fixed performance budgets may expose slow reference hardware or genuine regressions. Only the declared reference runner gates wall time; deterministic bounds run everywhere, and budget changes require measured review.
