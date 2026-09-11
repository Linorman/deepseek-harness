# Agent Note: Native multi-agent work system

Status: proposed

English | [中文](2026-08-27-native-multi-agent-work-system.zh.md)

## Problem

Clocky has three substantial multi-agent foundations: the continuable [subagent capability](../../../../docs/subsystems/subagent.md), script-driven [dynamic workflows](../../implemented/feature/2026-07-05-dynamic-workflows.md), and the archived [implicit-Lead Agent Teams implementation](../../archived/feature/2026-08-05-agent-teams.md). The archived implementation demonstrated a durable flat roster, enqueue-before-delivery peer mail, target-Session de-duplication, a compare-and-set task DAG, bounded lifecycle settlement, and model-facing coordination tools. This is a stronger starting point than importing a new framework.

The remaining product architecture is still single-agent-first in several user-facing paths. A user-facing run is a `Session` driven by one `Agent`; direct subagents remain continuable children; and the shipped base bundle exposes direct subagent and workflow tools. Those paths cannot represent humans or remote peers as first-class Team participants, support protocol-specific conversations, or coordinate multiple harness processes. Product clients also do not yet manage Team as their only top-level object.

Adding AgentScope's historical `MsgHub` or AG2 Classic's `GroupChat` directly would not close these gaps. Their useful ideas are message sharing, dynamic participation, speaker selection, handoffs, and bounded conversation patterns; their in-process shared-thread forms do not supply Clocky's durability, authorization, plugin, lifecycle, and replay requirements. Both upstreams have also moved toward stronger network designs: AgentScope 2 separates live message transport from persistent storage, and AG2 1.0 replaces classic GroupChat/swarm/nested-chat orchestration with an authoritative Hub, durable channel WALs, typed adapters, receipts, governance, and pluggable transports.

The system needs one native multi-agent product spine rather than a stable single-agent path plus optional coordination features. `Agent` and `Session` remain the execution and transcript primitives for one model participant, but they must become internal members of a Team-owned work system instead of the user-facing unit of work.

## Proposal

### Recommendation

Do not add AgentScope or AG2 as a runtime dependency and do not port their Python classes. Build native TypeScript/Cordis Team capabilities from the retained Team, subagent, and Session foundations, using AG2 Network as the main structural reference and AgentScope 2's persistence/transport separation as the live-delivery reference.

Every shipped user task will create or resume a `Team`. The Team is the product-level identity, persistence root, authorization domain, budget owner, and UI/SDK object. Each LLM participant may own a `Session`, but a Session is no longer a standalone product run. The shipped default Team template starts a `coordinator` and an inactive `worker`; a review policy provisions or activates a `reviewer` for mutating work. Deployments may configure other templates, including a one-agent Team for cost-sensitive use, but there is no separate direct-Session mode or alternate single-agent control path.

The first implementation remains a single authoritative Hub process with in-process agents. The design includes the link and receipt contracts from the beginning, then adds a WebSocket provider after the local contract passes restart and fault-injection tests. Multi-Hub consensus and transparent federation remain outside this proposal; cross-process agents connect to one Hub.

### Evidence from upstream and current code

The upstream audit used exact source revisions: AgentScope v1.0.21 at `b840fa927ad409aeddb9df359631ed586f2ae830`, AgentScope main/2.0.7 at `9983e76d1ee70052d31c01d224a477c5788cbe33`, AG2 Classic v0.9.10 at `ac380f5c7962ad875f77c4f8310e3c1167bceeb7`, and AG2 main/1.0.2 at `90f490a1b72b27ab4c219dd3586e94d42383a016`.

| Source | Useful mechanism | Limit or rejected default | Clocky decision |
|---|---|---|---|
| [AgentScope MsgHub v1.0.21](https://github.com/agentscope-ai/agentscope/blob/b840fa927ad409aeddb9df359631ed586f2ae830/src/agentscope/pipeline/_msghub.py) | Context-managed participation, announcement, manual broadcast, automatic broadcast, dynamic add/delete | Direct object subscriptions, no durable identity, receipt, replay, policy, task state, or distributed recovery; automatic broadcast duplicates context and amplifies tokens | Keep announcement, explicit broadcast, and dynamic membership ergonomics as Hub operations; reject automatic broadcast as the default |
| [AgentScope 2 message bus](https://github.com/agentscope-ai/agentscope/blob/9983e76d1ee70052d31c01d224a477c5788cbe33/src/agentscope/app/message_bus/_base.py) and [TeamSay](https://github.com/agentscope-ai/agentscope/blob/9983e76d1ee70052d31c01d224a477c5788cbe33/src/agentscope/app/_tool/_team_say.py) | Persistent records are separate from live transport; drain queues, replay logs, transient publish/subscribe, locks, local/Redis providers, direct or broadcast addressing | Ack-on-read queues cannot prove model inbox admission; transport payloads are not the business source of truth | Separate authoritative journals from wake-up transport; fan out durable messages per recipient and acknowledge only after target durability |
| [AG2 Classic GroupChat](https://github.com/ag2ai/ag2/blob/ac380f5c7962ad875f77c4f8310e3c1167bceeb7/autogen/agentchat/groupchat.py) and swarm handoffs | Round-robin/random/manual/LLM speaker choice, transition constraints, handoff targets, bounded rounds, nested patterns | One shared thread, manager-centric execution, optional extra LLM choice per turn, mostly in-process mutable orchestration | Preserve declarative transitions and handoff vocabulary as versioned channel adapters; an LLM manager is optional policy, never the core scheduler |
| [AG2 Network](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/website/docs/user-guide/network/overview.mdx), [Envelope](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/ag2/network/envelope.py), and [ChannelAdapter](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/ag2/network/adapters/base.py) | Authoritative Hub, named registry, per-channel WAL, audience and causation, pure adapter folds, manifest versioning, receipts/cursors, views, governance, local/WebSocket links | Opt-in standalone agents remain a second product path; its Python store and handler APIs do not fit Cordis or Session reconstruction | Adopt the topology and reliability semantics through native Cordis services and events; make Team the only shipped entry path |
| Archived Clocky [Agent Teams](../../archived/feature/2026-08-05-agent-teams.md) | Event-sourced roster/tasks/mail, exact Agent authority, flush checkpoints, recovery, CAS task DAG, continuable children, bounded teardown | Implicit Lead identity, Lead-log persistence, flat local children, process-local retry, advisory-only write scopes, no product control plane | Preserve tested algorithms in stable Team packages and generalize identity, placement, scheduling, and transport |

### Product invariant: Team is the top-level unit

The product hierarchy becomes `Team > Participant > Session > Turn > Step`. A Team represents one durable user objective and its complete collaboration state. A Participant is a human, local agent, remote agent, or system service. A local agent Participant may have one durable Session and many live Activation epochs; remote and human Participants need no local Session.

Every Web, headless, ACP, JSON-RPC, TypeScript SDK, and Python SDK start operation addresses a `TeamId`. Team creation records the user objective, registers the human/system initiator, applies a Team template, provisions the coordinator and worker identities, opens the user/coordinator channel, and only then admits the first user envelope. A final answer is a Team envelope addressed to the human participant; Team completion is a separate durable transition after the completion policy accepts that answer and the Team reaches quiescence.

Direct `AgentRegistry.create()` and Session creation remain trusted internal APIs for providers, tests, and recovery. Shipped clients no longer expose them as the unit users create, list, resume, cancel, or archive. A cardinality-one Team uses exactly the same Hub, journal, policy, channel, scheduler, and UI paths as a larger Team.

### Target architecture

```text
User / Web / ACP / SDK
          |
          v
  TeamRuntime (ctx.teams)  <---- policy waterfalls / observers
    |       |       |
    |       |       +---- Task scheduler + Team budgets
    |       +------------ Channel adapters + view policies
    +-------------------- Team journal + channel WALs
          |                         |
          v                         v
  AgentRuntime registry       Link providers
  local / ACP / SDK           local / WebSocket
          |
          v
  Agent + Session + existing agent-loop
```

The Team layer does not become a second model loop. It owns identities, collaboration state, protocol admission, dispatch, scheduling, policy, and recovery. The existing `@clocky/clocky-agent-loop` continues to drive one Agent's turns and tools. Team behavior reaches an Agent through its public inbox operations and scoped Cordis context; new multi-agent behavior does not depend on or import the concrete loop.

### Identity and lifecycle

All cross-package identities are branded and independent. Converting between them requires an owning resolver; no constructor rebrands a `SessionId` into a `TeamId`.

| Identity | Meaning | Lifetime and owner |
|---|---|---|
| `TeamId` | One user-visible work system and authorization domain | Minted by TeamRuntime; persists through restart until archived or deleted |
| `ParticipantId` | One logical human, local agent, remote agent, or system member | Minted or admitted by the Hub; independent of process and Session residency |
| `SessionId` | One local Agent's model-visible event log | Owned by Session; optional on a Participant and never used as Team identity |
| `ActivationId` | One live residency epoch of an agent Participant | Owned by the selected AgentRuntime provider; changes on cold resume |
| `ChannelId` | One bounded protocol conversation inside a Team | Owned by TeamRuntime and one versioned adapter manifest |
| `EnvelopeId` | One accepted channel event | Hub-stamped, globally unique, and stable across retry/replay |
| `TeamTaskId` | One Team-local unit in the work DAG | Owned by the Team task store; revisions and attempts are separate |
| `TaskAttemptId` | One lease-backed execution attempt | Minted when the scheduler assigns a task; terminal or expired exactly once |

Team lifecycle is `provisioning -> active -> quiescing -> completed | failed | cancelled`. Participant membership is `invited | provisioning | active | left | failed`; live Activation status is separately `starting | running | idle | offline | stopping`. Channel lifecycle is `pending -> active -> closing -> closed | expired | failed`. Task lifecycle is defined below. Durable lifecycle transitions are monotonic and replay-validated; live reachability never rewrites durable membership.

### Package topology and dependency direction

The exact package split follows the repository's Service Definition / Service Provider / Consumer rule.

| Package | Role | Main contract |
|---|---|---|
| `packages/core/team` (`@clocky/clocky-team`) | Service Definition | Brands, closed core records, `TeamRuntime` at `ctx.teams`, Team/channel live events, adapter and policy registration |
| `packages/storage/storage-log` (`@clocky/clocky-storage-log`) | Reusable data form | `ctx.storage.log`; atomic expected-sequence append, batch append, range read, stream listing, snapshot checkpoint, and close |
| `packages/storage/storage-json` and `storage-sqlite` | Service Providers | Add the log facet beside their KV facet; JSON is single-Hub development storage, SQLite is the durable default |
| `packages/core/agent-runtime` (`@clocky/clocky-agent-runtime`) | Service Definition | Named activation-provider registry for Team-resolved Participant epochs and immutable activation observation |
| `packages/agent-runtime/agent-runtime-in-process` (`@clocky/clocky-agent-runtime-in-process`) | Service Provider | In-process fresh/fork/resume placement with durable opaque Session provenance, fork lineage, health, interruption, and handle-owned disposal |
| `packages/agent-runtime/agent-runtime-sdk` (`@clocky/clocky-agent-runtime-sdk`) | Service Provider | SDK remote-agent fresh/resume placement with exact lifecycle status protocol and child-process ownership |
| `packages/agent-runtime/agent-runtime-acp` | Service Provider | ACP placement with exact lifecycle status, bounded process-tree teardown, and optional activation-bound Team Link bridge |
| `packages/core/team-link` (`@clocky/clocky-team-link`) | Service Definition | Named activation-bound Link registry; a Link derives sender/recipient facts, forwards post/claim/acknowledgement and delivery-bound task-start operations, and reports terminal lifecycle |
| `packages/team/team-link-local` (`@clocky/clocky-team-link-local`) | Service Provider | Local activation-bound replay/watch provider with bounded pending-page handoff, cancellable cursors, and failed-notification retry |
| `packages/core/team-workspace` (`@clocky/clocky-team-workspace`) | Service Definition | Mode-resolved Team task execution-root provider registry at `ctx.teamWorkspaces` |
| `packages/core/team-artifact` (`@clocky/clocky-team-artifact`) | Service Definition | Provider-independent content-addressed artifact reference and verified-read registry at `ctx.teamArtifacts` |
| `packages/team/team-workspace-shared` | Service Provider | Canonical shared-root provider for exact local-Agent Session cwd and current lease identity, with opt-in portable target integration |
| `packages/team/team-workspace-worktree` | Service Provider | Explicit-config detached Git-worktree allocation, bounded change manifests, and opt-in policy/CAS integration authority for an exact current local-Agent task attempt |
| `packages/team/team-artifact-local` | Service Provider | Owner-only content-addressed bytes for files, patches, logs, screenshots, and reports |
| `packages/team/team-link-websocket` and `team-link-websocket-hub` | Service Providers | Authenticated remote framing, receipt/nack delivery, reconnect replay, and dynamic activation enrollment over the same Link API |
| `packages/team/team-hub` (`@clocky/clocky-team-hub`) | Service Provider | Local authoritative `ctx.teams`: Team journal, bounded root-or-child hierarchy, channel WAL, roster/task/activation projections, policy dispatch, recovery, receipts, ephemeral delivery claims, pending pages, and cursor watches |
| `packages/team/team-activation-controller` | Consumer/binder | Binds a published AgentRuntime handle to a durable Participant epoch, mirrors health, and owns handle release |
| `packages/team/team-agent-client` | Consumer/binder | Uses an activation-bound Link claim before projecting direct or task-assignment channel input to a durable-bound local Agent, starts only the delivery-bound task attempt, flushes the source before a waking model step, acknowledges durable admission, and reconnects its current binding |
| `packages/team/team-channel-task-assignment` | Adapter provider | Single-assignee persistent assignment turn with task/attempt/revision and activation/Session fences |
| `packages/team/team-channel-basic` and `team-channel-workflow` | Adapter providers | Consult, discussion, and declarative workflow protocols plus view policies |
| `packages/team/team-scheduler-dag` (`@clocky/clocky-team-scheduler-dag`) | Scheduler Consumer | Bounded deterministic shared-work lease assignment, workspace eligibility, task-assignment channel/WAL dispatch recovery, and explicit lease expiry through `ctx.teams` |
| `packages/team/command-team-goal` | Human-facing Consumer | Scoped `/goal` status and mutation control derived from the current Team-bound Agent Session |
| `packages/team/tool-team` | Model-facing Consumer | Scoped task-attempt outcome reporting through a binding-derived Link; one tool name has one owner |
| `packages/client/ui-team` plus Host/API/SDK owners | Product Consumers | Team management, event projection, graph/channel views, human participation, and both SDK projections |

`team-hub` depends on `clocky-team` and `storage-log`, not `agent-runtime`; its local durable authority is recorded by the [local Team Hub decision](../../implemented/architecture/2026-08-27-local-team-hub-durable-authority.md). The [AgentRuntime service-definition decision](../../implemented/architecture/2026-08-27-agent-runtime-service-definition.md) records the separate activation registry. Adapters and tools depend on `clocky-team`, never on `team-hub`; agent-runtime providers depend on `clocky-agent` and Session capabilities, never on Team tools. Stable packages retain no dependency on the archived experimental packages.

### Durable state and storage

#### Stream ownership

Each fact has one authoritative stream.

| Stream | Owns | Does not own |
|---|---|---|
| `team/<TeamId>` journal | Team lifecycle, objective, participant registry, rules/budgets, task snapshots, leases, template version | Model messages, tool calls, or channel transcript text |
| `channel/<ChannelId>` WAL | Manifest snapshot, invitation/ack lifecycle, accepted Envelopes, delivery receipts, adapter transitions, close reason | Private Agent reasoning, tools, or mutable runtime references |
| `session/<SessionId>` log | Exact model-visible inputs, assistant output, tool execution, Agent turn/step lifecycle | Team registry, shared task truth, or delivery authority |
| Audit projection | Post-commit governance and operational records referencing authoritative ids/sequences | Business truth; it is rebuildable and cannot repair or veto an already committed fact |

`storage-log` appends an event batch only when `expectedSequence` matches the durable tail. The JSON provider serializes one writer per stream and refuses distributed mode. The SQLite provider uses a transaction to assert the tail and append the complete batch. A Hub serializes each Team and Channel in process; every command still carries an expected revision or idempotency key so retry cannot silently duplicate a mutation.

The Team and channel formats have independent monotonic versions. Pre-release loaders reject unsupported versions; the implementation does not convert old Lead-Session Team events. Checked-in fixtures and snapshots are re-recorded at the cutover, and user-owned pre-release data remains untouched rather than being guessed into the new model.

#### Runtime validation and projections

The core Team event envelope, `TeamEnvelope`, manifest, receipt, task, rule, and link frame are runtime-validated at every file, queue, process, and network boundary. Each channel adapter registers the schemas for the event kinds and knobs it accepts. A channel snapshots `(adapterType, adapterVersion, viewPolicyType, viewPolicyVersion)` at creation; resume fails loudly when any required implementation is absent.

Adapters are stateless. Their fold is a pure deterministic function of the prior state and one WAL record. TeamRuntime maintains an incremental in-memory projection and periodically stores a rebuildable checkpoint with the source sequence; it never re-folds a complete Lead Session per operation. Recovery validates the checkpoint watermark, replays the suffix, and falls back to the complete WAL if the checkpoint is absent or corrupt.

### Communication protocol

#### Envelope

All participant communication uses one Hub-stamped record. A client supplies a draft without `id`, `sequence`, `senderId`, or `createdAt`; the authenticated link determines the sender.

```text
interface TeamEnvelope {
  readonly id: EnvelopeId
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly sequence: number
  readonly senderId: ParticipantId
  readonly audience: readonly ParticipantId[] | null
  readonly kind: string
  readonly payload: JsonObject
  readonly delivery: 'context' | 'turn' | 'steer'
  readonly causationId?: EnvelopeId
  readonly correlationId?: string
  readonly taskId?: TeamTaskId
  readonly traceId?: string
  readonly priority: 'background' | 'normal' | 'urgent'
  readonly createdAt: number
  readonly ttlMs?: number
}
```

`audience: null` means every other visible channel participant; a list means an explicit subset. Sender visibility is retained for replay. `causationId` threads a reply or handoff to the triggering envelope. `correlationId` groups a higher-level operation, and `taskId` binds communication to shared work. `delivery` is protocol intent rather than a claim that execution has happened: the adapter and Hub policy may reject or narrow it.

Private Agent output never broadcasts merely because the Agent produced it. An Agent posts a report, handoff, task result, or explicit message through a Team tool or adapter-owned action. This preserves MsgHub's convenient explicit broadcast without inheriting its automatic context amplification.

#### Channel adapters

A channel manifest is data and an adapter is code. The manifest snapshots participant roles and bounds, allowed event schemas, configurable knobs, default view policy, expectations, TTL, and turn/task caps. The adapter supplies `validateCreate`, `initialState`, `validateSend`, `fold`, `afterAccept`, `expectedNext`, `deliveryPlan`, and `projectView`; all state methods are synchronous and pure.

The first stable adapters are:

- `direct`: two or more participants, explicit subset or broadcast addressing, no automatic reply, and caller-selected `context`/`turn` intent subject to policy;
- `consult`: one request, one respondent turn, one response, then automatic close;
- `discussion`: multi-party free-form or deterministic round-robin conversation with a hard turn cap;
- `workflow`: a JSON-serializable `TransitionGraph` with ordered conditions and targets such as participant, round-robin, stay, return-to-initiator, and terminate.

Transition conditions and targets register by versioned name through Cordis effects. Graph validation rejects missing participants, unknown implementations, invalid defaults, unreachable terminal paths when a finite workflow is required, and a cycle without a turn/task/wall-time cap. An optional LLM coordinator may post an explicit handoff Envelope; the Hub records and validates that decision rather than running an invisible speaker-selection request.

#### Admission, delivery, acknowledgement, and recovery

1. A bound client submits a draft. The Hub resolves the sender from the link, validates JSON and size limits, checks Team/channel membership, runs access and budget policies, and calls the adapter under the per-channel serializer.
2. The Hub stamps the Envelope, atomically appends it with any adapter lifecycle records, advances the cached fold, and returns the durable id. Listener or dispatch failure cannot roll back the WAL.
3. The adapter's delivery plan expands broadcast at commit time into recipient intents. Per-recipient pending delivery is derived from accepted Envelopes minus durable receipts; the live bus is only a wake-up optimization.
4. A local or remote Link receives a notify frame. Each client de-duplicates by `(channelId, envelopeId)` before starting model work. `context`, `turn`, and `steer` map through the Agent Client into the existing inbox operations only after protocol authorization.
5. A local Agent Client persists the exact inbox item or Session surface event and awaits `ctx.sessions.flush()` before returning an `accepted` receipt. This receipt means durable target admission, not task completion or successful model execution.
6. The Hub appends a monotonic recipient cursor/receipt. A nack or disconnect leaves the cursor unchanged; reconnect replays every visible unacknowledged Envelope after the cursor. Out-of-order old receipts cannot move a cursor backward.
7. A reply uses the triggering `EnvelopeId` as `causationId`. Before rerunning a redelivered turn, the Agent Client checks whether the same sender already posted a result for that causation id; if so it acknowledges without another model call.

The advertised guarantee is at-least-once notification with idempotent durable admission. The system does not claim exactly-once model execution or external side effects. Tool and workspace operations require their own idempotency or compare-and-set behavior.

Read operations return a Team or channel cursor. `watchTeam(afterCursor)` and `watchChannel(afterCursor)` first compare the durable cursor and return immediately when the caller is behind, then register a waiter without an await gap. The model-facing wait tool always supplies the cursor returned by the last list/read operation, eliminating the current edge-only lost-wakeup behavior.

#### Model-visible context

Every Team-derived input obeys the existing model-visible-means-logged rule. Direct delivery retains `TeamEnvelopeSource { teamId, channelId, envelopeId, senderId, delivery, causationId? }` in the durable inbox item and eventual `user/message`; Host queue projection uses the retained delivery intent to distinguish pending steering from non-waking Team context. A scheduled channel turn uses a `team/channel-view` Session surface event containing the exact rendered content, ordered source Envelope ids, adapter/view versions, and triggering id. It does not reconstruct hidden mutable channel state at request time.

View policies are versioned, pure projections: directed-only, full transcript, recent window, and summarized window. A summary is its own durable channel event with the exact covered sequence range and provenance; it cannot silently replace WAL history. Tool schemas and Team guidance remain Agent-scoped, so a role or permission change affects only later assemblies and is reconstructable through the Participant/Session binding and logged Team inputs.

### Agent placement and execution

The current continuable-subagent manager supplies valuable activation, cold-resume, cancellation, concurrent-start, publication, and child-first disposal algorithms. Extract those algorithms behind `ctx.agentRuntimes` and remove parent/child Team semantics from the provider contract.

`AgentRuntimeProvider` receives a Hub-resolved Participant descriptor, Team and Session ids, Agent preset, context seed mode, authority grant, workspace allocation, and cancellation signal. It returns an `ActivationHandle` only after the local Agent/Session or remote endpoint is published and its Participant binding is durable. The handle exposes `activationId`, optional exact local `Agent`, result/health promises, message admission, interrupt, and quiescent `dispose()`.

The Hub owns stable Participant identity and membership. A provider owns only one Activation epoch. Provider removal blocks new Activations but does not revoke accepted handles. Distinct operations must isolate cancellation and mutable state. A Session header records its `teamId`, `participantId`, preset, and workspace allocation; `parentSession` remains fork-seed lineage rather than authorization. `origin: 'subagent'` and delegation depth leave the product model after all direct subagent consumers are removed; Team budgets and task/channel ancestry enforce recursion and fan-out.

The in-process fresh/fork providers land first. ACP and SDK providers adapt the existing out-of-process backends. A remote already registered through a WebSocket Link is a Participant endpoint rather than a child spawned by a local parent. Nested work creates a child Team linked by `parentTeamId`, `parentTaskId`, and a bounded Team-depth policy; it does not reinterpret a Session child tree as a Team hierarchy.

### Shared task graph and scheduler

#### Task lifecycle

The current complete-snapshot, task-local revision, DAG, tombstone, and compare-and-set rules remain. The task record includes parent task, required capabilities, priority, read/write scopes, workspace mode, budget, review policy, bounded attempt history, minimal result/failure facts, and one optional lease. Artifact references are durable task-result facts; a workspace or artifact provider owns their bytes, ids, content hashes, and provenance.

Task lifecycle is `pending -> assigned -> running -> completed` for a no-review task and `pending -> assigned -> running -> review -> completed` for a participant-reviewed task, with terminal `failed | cancelled | deleted`; release or an expired retryable attempt returns an assigned/running task to `pending` under a new revision. Readiness remains derived from dependencies and terminal blockers. Each assignment creates a `TaskAttemptId` and bounded lease. Heartbeats renew only that attempt; stale heartbeats and terminal writes fail their expected revision/attempt precondition. Lease expiry records an explicit attempt failure before retry, reassignment, or Team stall policy runs.

`writeScopes` become scheduler constraints in a shared checkout rather than claimed filesystem locks. The scheduler will not run overlapping mutating scopes concurrently under the shared workspace provider unless a human or policy explicitly overrides the conflict. Worktree or sandbox providers may run them concurrently because they supply separate allocation identities.

#### Scheduling and quiescence

The default scheduler is deterministic. It selects ready tasks in priority/creation order, filters Participants by Hub authorization, claimed capabilities, role, workspace access, availability, and budget, then ranks explicit assignment, capability match, current load, observed task outcomes, and stable Participant id. The scheduler commits assignment and lease through task CAS before waking the owner on a task channel. A coordinator may propose an owner or handoff, but the Hub validates it through the same path.

The shipped task snapshot now freezes either a no-review route or one explicit reviewer and retains the reviewer's accepted or rework decision with its reason. Completion may later require a reviewer or evaluator task. The worker posts a structured result with summary, evidence, artifacts, changed paths, and verification; a review Consumer routes a participant-reviewed task to its eligible reviewer. Only an accepted review or configured no-review policy enters `completed`. Failed review creates an explicit revision and rework dependency rather than private conversational feedback.

A Team is quiescent only when no Hub admission or delivery is in flight, no Activation is starting/running/stopping, no ready/assigned/running/review task exists, no channel expects a speaker, and no human question or approval is pending. Incomplete work with no possible producer becomes durable `stalled` diagnostics, not completion and not an infinite wait. The completion policy then verifies terminal task state and a final human-addressed answer before committing `team/completed`.

The current same-Session Goal becomes the Team objective. Goal identity, revision, phase, blocker, and budgets move to the Team journal; `/goal` and its tools address `TeamId`. The goal-round driver is replaced by the scheduler/quiescence policy: it may wake the coordinator when the Team is idle but unfinished, without adding automatic prompts to every Participant. Dynamic workflow scripts become a Consumer that creates or mutates a versioned Team task/transition graph; they no longer start private subagents outside the Hub.

### Governance, resource management, and observability

Each Participant has an immutable identity descriptor and mutable capability/status projection. The descriptor names kind (`human | local-agent | remote-agent | service`), display name, owner, preset, provider/model hints, declared capabilities, role, and credential/auth scheme. Observed task counts, outcomes, latency, and cost are Hub-derived records and never overwrite declared claims.

Authorization is enforced inside TeamRuntime through typed Cordis waterfalls for register, invite, activate, channel open, send, dispatch, task mutate/assign, interrupt, workspace allocate, and Team close. Policy listeners call `next()` to compose; any deny is durable with a structured reason. Prompt text may explain policy but never supplies authority. A child Team or Participant grant must be a subset of the creating Team and human authority.

Team config resolves all limits at creation and snapshots them: maximum Participants, live Activations, tasks, open channels, pending deliveries, envelope bytes, delegation depth, turns, model tokens, wall time, cost, retry count, and per-Participant inbox/rate caps. The Hub rejects over-limit operations before durable acceptance except post-accept delivery pressure, which records an explicit backpressure event and retry schedule. No plugin hardcodes a deployment-varying limit.

Post-commit `team/*`, `channel/*`, `delivery/*`, `task/*`, and `activation/*` observers receive immutable snapshots with listener failures contained. Traces correlate `TeamId`, `ParticipantId`, `ChannelId`, `EnvelopeId`, `TeamTaskId`, `TaskAttemptId`, `SessionId`, and tool/model spans. Metrics cover queue depth, replay lag, active Activations, task latency/retries, token/cost budgets, stalled Teams, receipt latency, adapter failures, and workspace conflicts.

Team cancellation closes admission synchronously, persists the cancellation intent, cancels Activations, drains accepted message/task operations, closes channels, releases workspace allocations, and awaits quiescence. Cleanup continues across branch failures and reports an aggregate after every owned resource settles. HMR unregisters providers first, blocks new operations, and retains accepted handles/adapters until their owned work reaches a defined terminal state.

### Workspace and artifact coordination

`core/team-workspace` resolves immutable task workspace modes to providers without changing Team task state. `core/team-artifact` resolves provider-independent artifact references to byte stores. The `team-workspace-shared` provider canonicalizes one configured existing root, accepts only an active local Agent whose durable Session header already equals that root, rereads the current lease and activation before logical allocation, and never claims a filesystem lock; its optional artifact/integration configuration publishes a portable change set to a separate target directory. The `team-workspace-worktree` provider validates explicit Git roots and a base commit, then creates a hash-derived detached checkout only after revalidating an exact current local-Agent lease and policy decision; it can persist bounded file and patch bytes through `ctx.teamArtifacts`. The scheduler uses provider eligibility before ranking a shared-work candidate and never allocates a root.

Add sandbox/remote providers and task-Agent allocation consumption that return the exact filesystem and process authority to the Agent preset, record changed paths/artifacts, and release resources only after integration or cancellation settles. The worktree provider already supplies the explicit local integration authority; sandbox/remote integration remains provider-specific.

The shared provider preserves today's same-checkout behavior but makes its limit enforceable: overlapping declared mutating scopes serialize, filesystem stale-version checks remain active, and unknown writes from Bash/generators appear as audit warnings rather than false lock guarantees. With an explicit separate integration root and artifact provider, it also publishes a portable change set and applies it only to a provider-owned target directory under policy and an expected content-version fence. The worktree provider creates only a detached checkout at the resolved base commit and never force-removes dirty work. Its opt-in integration authority creates an isolated source commit, performs conflict-aware detached merges, and updates an unoccupied target ref with compare-and-set; it never force-pushes, silently commits user changes, or merges without Team policy. Sandbox and remote providers retain their own integration authority.

Artifacts are referenced by durable ids and provenance rather than embedded into messages. A task result may publish patches, files, logs, screenshots, or reports; the Hub records ownership, content hash, source attempt, and visibility. Channel views carry summaries and references, preventing large tool outputs from being broadcast into every model context.

### Product APIs, SDKs, and UI

The Host exposes Team-oriented Remotes: `team.create/get/list/cancel/archive`, `team.member.list/invite/remove/interrupt`, `team.channel.open/post/read/close/watch`, `team.task.create/get/list/update/watch`, and `team.audit.read`. Methods use branded ids, cursor pagination, AbortSignals, structured errors, and lossless JSON. Agent-bound methods resolve the authenticated Participant rather than accepting a caller-supplied sender id.

The TypeScript and Python SDKs project Team, Participant, Channel, Envelope, Task, receipt, Activation, and budget events. A prompt/run call returns Team completion state and final human-visible output while event streaming remains available. Session APIs remain for transcript inspection and internal diagnostics, not top-level run creation.

The Web sidebar lists Teams. A Team page shows objective/budget status, roster and reachability, the task DAG, open channels, pending human actions, artifacts, and an audit timeline. Selecting a Participant opens its Session transcript; selecting a Channel opens its WAL-derived view. Human input posts an Envelope as a first-class Participant. Approval and `ask_user_question` requests retain originating Participant/Session/task ids and route to authorized humans without giving teammates UI authority by implication.

Product-visible GUI changes add real-server browser tests and the required recorded GIF. Keyless snapshots cover the assembled Team transcript and durable streams; UI projections never derive Team truth by scraping multiple Session transcripts.

### Gap-closure implementation specification

The existing stable packages remain the foundation. Completion work changes their contracts only where the current behavior cannot satisfy the acceptance criteria; it does not add a second Team provider, another model loop, or a compatibility path for pre-release durable formats.

#### Lifecycle, completion, and cancellation authority

`TeamRuntime` adds provider-owned `completeTeam()`, `failTeam()`, and `cancelTeam()` commands. Product Host and SDK APIs remove the generic `team.phase` mutation; `transitionTeamPhase()` remains a trusted provider/test primitive. Every closure command carries an authenticated actor, expected Team cursor, idempotency key, and structured reason. Completion additionally names the final channel and Envelope.

`completeTeam()` locks the Team and final channel, verifies that the Envelope is a `final` from the configured coordinator to an authorized human, and requires its human receipt. An active goal becomes `complete` in the same Team-journal command that records the completion intent; paused or blocked goals reject completion. The command moves the Team to `quiescing`, then a restart-safe closure driver commits `completed` only when no nonterminal task, deliverable Activation, protocol-expected speaker, pending delivery, pending human action, live workspace allocation, or provider-admitted operation remains.

`cancelTeam()` closes new admission before releasing resources and records one durable cancellation intent. Pending and review tasks become `cancelled`; assigned or running attempts retain a cancellation request until the owner reports cancellation, its owned provider terminates, or a fencer proves the epoch offline. The activation controller releases attempts and workspaces before channels close. Cleanup continues across branch failures and reports an aggregate only after every accepted branch settles. A remote endpoint whose provider cannot prove termination leaves the Team durably stalled with `REMOTE_CANCELLATION_UNCONFIRMED`; it is never reported as cancelled.

A coordinator turn that ends without an accepted final records `FINAL_ANSWER_MISSING` as stalled; an infrastructure or model failure records `failed` with the exact terminal error. Explicit resume is the only operation that returns a stalled Team to `active`. Wall-time and budget expiry request the same durable stall path instead of waiting for another arbitrary mutation.

#### Governance and budget enforcement

`clocky-team` defines a closed `TeamAuthorityGrant` for allowed operations, Participant and child-Team delegation, workspace modes and scopes, provider/model routes, and typed resource ceilings. The Team template snapshots the root human/system grant; each Participant and child Team stores an immutable subset. Hub structural checks enforce identity, active membership, grant subset, task ownership, and workspace scope before the extensible policy waterfall runs. Optional policy listeners may narrow authority but cannot restore an operation rejected by the Hub.

Every product or wire mutation carries a `TeamActorProof` derived from a Host-authenticated human, an activation-bound Link, or a trusted system provider. APIs never accept a sender, reviewer, or interrupt authority as an unverified identifier. Shipped composition fails at load when its root grant or mandatory policy provider is absent. Sender, audience, task, interrupt, phase, workspace, integration, and artifact-read tests exercise both structural denial and policy denial.

Team and task budgets use typed token, turn, wall-time, cost, retry, concurrency, and artifact-byte fields plus a namespaced extension object. A task budget must be a subset of its Team remainder. `TeamUsageSample` adds optional task and attempt provenance, so admission reserves and charges the correct ledger before another model step. Child usage commits to the child journal first, then an idempotent parent charge; pending parent charges block further child work and recovery repairs them before admission. Unknown pricing never counts as zero when a cost ceiling exists: the route must supply a frozen rate or the model request is denied.

#### Review and model-facing task orchestration

Review delivery logs a `TeamReviewAssignmentSource` containing task, completed attempt, exact review revision, result evidence, artifacts, reviewer, channel, and triggering Envelope. `team_task_review` removes its model-supplied revision argument and derives the fence from exactly one current source. The tool posts a consult response carrying `accepted` or `rework` plus the reason; the adapter closes the consult channel atomically with that response.

The scheduler treats the response Envelope as the review outbox. It applies the task transition idempotently after the channel commit and repairs a response-without-task-update crash on its next drive. Acceptance completes the task. Rework records the reviewed attempt and reason, advances the revision, returns the task to `pending`, and requires a new attempt; the prior result remains immutable.

The shipped coordinator gains task list, bounded progress watch, cancel, and optional owner-proposal operations beside start and wait. Owner proposals name a Participant but confer no authority; the scheduler still validates grants, capabilities, load, workspace eligibility, and budgets. Multiple eligible workers permit fan-out and fan-in through ordinary DAG dependencies. The one-worker template remains the default cardinality, not a separate task protocol.

#### Workspace and artifact execution authority

Each attempt records a `TeamWorkspaceAllocationSnapshot` with provider, allocation id, mode, base version, lifecycle, and integration status. Provider filesystem roots and process credentials remain live handle data, not durable authority. Allocation binding is a Team mutation fenced by task, attempt, activation, Session, and provider; recovery reopens or explicitly preserves a provider-owned allocation rather than guessing from a directory name.

`resolveAgentWorkspaceRoot()` becomes the only workspace-root resolver for shell, filesystem, search, instruction, file-reference, skill, sandbox-policy, and subprocess consumers. Sandbox confinement uses the allocation root before the Session cwd. A static gate rejects direct `session.header.cwd` reads in registered workspace-sensitive consumers, and assembled tests prove Bash, read/write/edit, search, instructions, and subprocesses observe the same worktree or remote root.

The shared provider records a baseline and final version, serializes overlapping declared writes, and emits durable audit warnings for unknown external changes without claiming a lock. Its opt-in artifact path retains a bounded source baseline and applies a provenance-checked portable change set only to a separate target directory under policy and an expected content-version fence. The shipped shared and worktree providers already mint root-free metadata, reserve it before materialization, restore exact active allocations, and reconcile `release-requested` cleanup without a durable root catalog. Sandbox and remote providers return exact filesystem and process authority through the same registry. Integration is an explicit human- or policy-authorized Team task whose expected target version, proposal, conflict result, verification, and final artifact manifest are durable.

Model task reports may reference only artifact ids already minted for the current Team/attempt. `ctx.teamArtifacts` verifies ownership, content hash, source attempt, and visibility before the Hub records the reference; provider publication supplies changed paths and artifact ids. Local retention traces references from non-expired Teams and applies a configurable grace before deleting unreachable objects. Remote/object-store providers and cross-host replication remain replaceable implementations of the same service definition.

#### Channel views, protocol lifecycle, and workflow convergence

A claimed non-direct delivery returns an exact rendered `TeamChannelViewSource`: adapter and view-policy versions, triggering Envelope, ordered source Envelope ids, and rendered content. The Agent Client appends a `team/channel-view` Session surface event and flushes it before acknowledgement. Direct unicast may retain its existing identified `user/message` source because that record already contains the exact rendered content and one Envelope provenance.

Summarization is an explicit channel command that appends a durable summary record with covered sequence range, source Envelope ids, exact text, policy version, and idempotency key. Its runtime-only `TeamSystemChannelSummaryProof` binds the whole payload; the shipped composition fails closed because no summary consumer yet owns the canonical source. A Hub re-resolves that proof before channel load, under the channel serializer, and after reading the source range before append. View policies may select the resulting record but never synthesize replacement history at read time. Channel reads, Team/member/task lists, and audit reads take `limit` and return `nextCursor`; no product call materializes an unbounded WAL. TTL expiry is an explicit scheduler/Hub drive that appends delivery expiry or terminal channel records before removing pending work.

The cutover direct protocol accepts at least two Participants, an explicit nonempty audience subset or `null` broadcast, and no automatic reply. A `final` remains legal only in an exact two-party product channel and never broadcasts. The text/image payload and explicit delivery intent remain versioned adapter data; old pre-release direct versions are not silently widened.

Adapter and workflow-extension registration returns a lease. Unregistration blocks new channels or graphs while active channels retain the exact implementation until closure; restart fails loud if the referenced version is unavailable. Workflow condition and target extensions expose versioned validation plus pure evaluation/resolution, and the graph stores their exact refs and JSON configuration instead of a closed built-in-only union.

The existing script/value isolation remains under `clocky-workflow` for explicit custom compositions. Shipped Team workflows instead accept a JSON-serializable `TeamWorkflowPlan`: task templates, ordered fan-out/fan-in dependencies, versioned conditions and targets, bounds, and a result projection. A compiler Consumer validates the whole plan before creating durable Team tasks and workflow-channel records; restart derives remaining work from those records rather than rerunning model-written code. Legacy non-journaled JavaScript workflow execution remains available only to explicit custom compositions under a distinct tool name and cannot mutate shipped Team authority.

#### Remote admission and termination

Dynamic WebSocket enrollment persists only a credential digest, generation, binding, and revocation state in a provider-owned storage-log stream. A Hub restart reloads the current generation; rotation appends a replacement and closes the prior socket. Link frame versioning adds cancellation request/result and pagination fields while preserving binding-derived identity, bounded queues, nack retry, and at-least-once notification.

ACP placement materializes a proxy Clocky Session for its declared `SessionId`. Before `session/prompt`, the provider appends and flushes the exact Team-derived input; after a non-cancelled response it appends a completion fact, flushes, and acknowledges the Envelope. Recovery acknowledges an already completed source without another prompt and replays an admitted-but-incomplete prompt. ACP output remains private unless an explicit Team operation posts it.

Each AgentRuntime provider declares `cooperative` or `owned-process` termination. Owned-process providers must prove bounded process-tree exit before the activation becomes offline; cooperative endpoints require an external fencer or leave cancellation stalled. Static and dynamic credentials pass the same forced-disconnect, full-Hub-restart, duplicate/out-of-order, slow-consumer, and cancellation suite.

#### Product, UI, storage default, and compatibility

Headless and Web select SQLite for Team journals by default; JSON remains an explicit single-Hub development/test backend. Team task tools and every Host/SDK operation use the same authenticated commands and cursor pages. The Web Team page provides Participant transcript selection, channel views, DAG/task detail and cancellation, review decisions, artifact reads subject to visibility, human-action routing, and a real audit timeline. Summary cards never scrape Session transcripts to derive Team state.

Session create/fork product routes and shipped legacy orchestration tools remain absent. Compatibility packages may be loaded only by explicit custom compositions and cannot share a shipped tool name. Source, generated catalogs, snapshots, packed artifacts, and both SDK expected outputs are scanned together before the proposal moves to implemented.

#### Durable and wire versioning

Closure, grants, typed budgets, review sources, allocation state, summaries, and parent charges advance the Team journal/checkpoint and channel WAL/checkpoint versions. Durable source-specific audit projections use their own format version and remain rebuildable from those business streams. Link cancellation and enrollment recovery advance the frame version. Host and both SDK schemas update atomically. The new Session surface event follows the existing `SESSION_FORMAT_VERSION = 0` pre-release policy and is required on read unless its complete model-visible meaning can be safely ignored. Old pre-release streams fail loud; no converter or compatibility reader ships.

#### Observability, retention, and performance

Team metrics add pending delivery and admission gauges, active Activation/workspace counts, replay lag, task and receipt latency, retry/nack totals, budget use, stalled Teams, adapter failures, compaction/checkpoint failures, and workspace conflicts. The current local implementation exposes active-admission, compaction, checkpoint-failure, and audit-projection repair/failure counters through the existing metrics route. A Team telemetry Consumer correlates every record with Team, Participant, Channel, Envelope, task, attempt, Session, and model/tool spans, then delegates export to a deployment provider. Metrics are operational projections and never business authority.

The Hub writes a separate paged `audit/<TeamId>` projection after business commits. Entries reference the authoritative stream and cursor and cover policy decisions, delivery retry/backpressure, Link lifecycle, external workspace changes, integration, retention, and cleanup failures. Audit append failure is observable and retryable but cannot roll back, repair, or veto the referenced business fact. Recovery rebuilds missing rebuildable entries before the audit cursor advances; Host and SDK audit reads never reinterpret raw Team or channel records as the audit model.

Retention compacts only streams whose adapter, receipt, audit, and replay watermarks prove the removed prefix unnecessary. Active channels retain every unacknowledged or causation-reachable Envelope; terminal Team and channel streams retain a verified checkpoint, durable summaries where applicable, and configured audit tail. An optional scheduler retention drive supplies a bounded terminal-stream tail and invokes the Hub's Team-journal/channel-WAL watermark-gated compaction commands; omitted retention fields leave compaction explicit-only. Artifact collection follows the reachability/grace rule above. The deployment guide specifies alert thresholds for queue pressure, replay lag, receipt latency, stalled Teams, repeated retries, checkpoint failure, and cleanup failure.

### Migration and delivery plan

The remaining work lands as one official stack. Each stack item builds, owns its new Agent Note or updates the existing decision owner, and carries the narrow tests required by its contract. A later item never weakens an earlier item's durable or security guarantee.

The remaining stack is governed by two executable specifications: [P0 safety closure](2026-09-04-native-multi-agent-p0-safety-closure.md) owns authenticated human authority, restart-safe lifecycle settlement, retained protocol implementations, and durable channel views; [P1 product convergence](2026-09-04-native-multi-agent-p1-product-convergence.md) depends on P0 and owns child Teams, channel and scheduler expansion, remote supervision, complete UI, legacy cutover, performance budgets, and final promotion evidence.

The [development handoff plan](../../../plans/2026-09-05-native-multi-agent/overview.md) assigns the remaining work to independently reviewable programmer work packages, with shared-interface ownership, integration dependencies, and a 33-item acceptance map. It uses the 2026-09-05 working-tree audit as a planning baseline; its task descriptions and historical test results do not establish P0 completion or release readiness.

| Stack item | Depends on | Deliverables | Exit gate |
|---|---|---|---|
| S0 — Contract lock | Current stable Team packages | Add failing contract/property fixtures for closure, review, grants, budgets, workspace roots, channel views, remote restart, and pagination; record every current public bypass | Every later behavior has a red replacement test and the source/artifact entry inventory is current |
| S1 — Closure and cancellation authority | S0 | Add typed completion/failure/cancellation commands, closure intent and quiescence projection, full task cancellation, failure/stall settlement, and remove product `team.phase` | No path commits `completed` without final receipt and full quiescence; cancellation settles or stalls every owned branch |
| S2 — Grants and budget ledger | S1 | Add actor proofs, immutable grants, parent-subset validation, typed Team/task budgets, task usage provenance, parent charging, and mandatory shipped policy composition | Unauthorized and over-budget operations fail before durable acceptance or another model step across root and child Teams |
| S3 — Review and task orchestration | S1, S2 | Add review-assignment sources, response-driven review repair, model task list/watch/cancel/owner proposal, multiple-worker DAG scenarios, and cancellation races | Assembled accept and rework runs close their channels, retain reasons, and reach deterministic task outcomes |
| S4 — Workspace and artifact authority | S2, S3 | Extend the shipped durable allocation binding and release recovery with common root resolution, sandbox/remote providers, external-write audit, verified artifacts, integration tasks, and retention | Every workspace-sensitive tool uses one provider root; conflicts, dirty trees, restart, cancellation, and artifact visibility are proven |
| S5 — Channel and workflow completion | S2, S3 | Add logged channel views, adapter/extension leases, versioned extension execution, and Team workflow compilation/replay; local control-plane cursor pagination, durable TTL delivery expiry, and durable channel summaries are implemented and separately verified | Conditional handoff and workflow restart replay without private child ownership or unlogged model input |
| S6 — Remote reliability | S1, S2, S5 | Add durable dynamic enrollment, ACP proxy Session admission, termination modes, Link cancellation frames, and full-restart recovery | Local, SDK, ACP, and WebSocket deliveries share receipt semantics; remote cancellation terminates or durably stalls |
| S7 — Product and UI convergence | S3–S6 | Switch shipped Team logs to SQLite, expose the complete authenticated paged control plane, implement Team detail interactions, and remove stale documentation claims | Web, Headless, ACP, JSON-RPC, TypeScript SDK, and Python SDK expose one Team product model with descendant Session inspection |
| S8 — Observability and retention | S4–S7 | Add Team telemetry, complete gauges/counters/latencies, WAL and artifact retention, operational alerts, and large-state benchmarks; local content-addressed artifact reachability/grace collection, durable source-specific audit projections, and checkpoint-gated terminal-channel/audit prefix compaction are implemented and separately verified | Bounded-memory, queue-pressure, checkpoint, compaction, and shutdown thresholds pass on JSON and SQLite where supported |
| S9 — Final evidence and promotion | S0–S8 | Run keyless assembled snapshots, keyed multi-agent e2e, distributed fault tests, real-browser/GIF acceptance, full repository gates, packed probes, and documentation reconciliation | Every acceptance criterion has named evidence; this Note can be rewritten as current reality and moved to `implemented/` |

### Testing strategy

| Surface | Required evidence |
|---|---|
| Durable stores | Shared JSON/SQLite contracts, differential replay, torn-write/restart tests, property-generated event streams, expected-sequence races |
| Team/channel/task state machines | Pure fold tests, invariant companions, model-based transition tests, invalid durable/wire payload rejection |
| Lifecycle and concurrency | Deterministic fake-clock tests for admission cutoff, duplicate start, cancel, lease expiry, HMR, listener failure, quiescent disposal, and aggregate cleanup |
| Delivery | Fault injection at append/notify/inbox-flush/receipt boundaries; duplicate, missing, stale, and out-of-order frames; reconnect and causation de-duplication |
| Product composition | Keyless headless/ACP snapshots through real bundles; with-key multi-agent e2e for task decomposition, tool use, peer report, review, and final synthesis |
| SDK/API/UI | TypeScript and Python expected outputs, Remote schema tests, replay/navigation tests, real browser screenshots and GIF for GUI changes |
| Security and policy | Sender spoofing, unauthorized audience/task/interrupt, parent-grant escalation, malformed/oversized payload, rate/inbox cap, remote auth failure |
| Performance | Bounded Hub memory, incremental-fold and checkpoint benchmarks, WAL pagination, high-water backpressure, large Team shutdown |

Each PR runs the smallest checks covering its outgoing diff under the repository's pre-push policy. The final cutover runs the irreducible repository-wide build, typecheck, hygiene, coverage, snapshots, SDK projections, `doc-sync`, website build, and packed-artifact probes; CI still owns the full platform matrix.

### Existing decision impact and supersession audit

Current implemented notes remain the authority for shipped behavior. Historical records move to the archive only after their rationale has a stable owner or remains useful solely as historical context.

| Existing decision | Classification after full implementation | Treatment |
|---|---|---|
| [Durable Agent Teams](../../archived/feature/2026-08-05-agent-teams.md) | Superseded in source | The archived record preserves the original rationale; stable Team decisions own durable delivery, tasks, activation, and product topology |
| [Experimental Team packages](../../archived/architecture/2026-08-18-experimental-agent-teams-packages.md) | Fully superseded | Archived after stable packages replaced the private package pair |
| [Subagent capability](../../implemented/feature/2026-06-21-subagent-capability-seam.md) and continuable lifecycle notes | Partially superseded | Keep provider concurrency, cold resume, publication, cancellation, and quiescence rationale under AgentRuntime; retire direct-parent Team authority and model tools |
| [Dynamic workflows](../../implemented/feature/2026-07-05-dynamic-workflows.md) | Partially superseded | Keep isolated script/value-boundary rationale; route orchestration through durable Team graphs and remove private direct child ownership |
| [Persisted same-Session Goal](../../implemented/feature/2026-07-19-persisted-same-session-goal-domain.md) and round driver | Fully superseded in shipped products | Consolidate objective/CAS/blocker/budget rationale into Team Goal and delete same-Session scheduling after all clients migrate |
| [Parallel subagent delegations](../../implemented/feature/2026-08-09-parallel-subagent-delegations.md) | Fully superseded when tools disappear | Preserve the need for overlapping independent work and workspace-conflict honesty in scheduler/provider contracts |
| [Event-sourced Sessions](../../implemented/architecture/2026-06-11-event-sourced-sessions.md), [microkernel events](../../implemented/architecture/2026-06-11-microkernel-event-taxonomy.md), and capability seams | Not superseded | Remain foundational; Team adds a higher-level event-sourced capability and continues using Agent/Session/loop extension points |

## Alternatives considered

**Import AgentScope or AG2 as the multi-agent runtime.** Rejected because the production system is TypeScript/Cordis, already owns stronger Session/subagent lifecycle mechanisms, and would need adapters for persistence, tools, permissions, UI, SDKs, cancellation, and HMR around a second framework. The proposal adopts documented semantics and implements them natively; it copies no upstream source.

**Port AgentScope MsgHub and add persistence later.** Rejected because automatic object subscription has no stable recipient identity, admission receipt, policy checkpoint, restart cursor, or protocol lifecycle. Adding those pieces turns MsgHub into the Hub/channel design while retaining an unsafe automatic-broadcast default.

**Only add more methods to the current experimental TeamService.** Rejected because its Team identity, transaction owner, recovery, authorization, and membership all depend on one live Lead Session and direct-child lineage. Channels, humans, remote agents, independent Team lifetime, and cross-process delivery require a new persistence and identity root rather than more façade methods.

**Keep standalone Session mode and make Team opt-in.** Rejected because every product, SDK, UI, policy, snapshot, and tool would retain two orchestration spines with different lifecycle and durability semantics. A one-member Team already supplies the low-cost case without a second mode.

**Use a classic GroupChatManager as the core scheduler.** Rejected because an extra LLM speaker-selection call is nondeterministic, costly, and difficult to reconstruct as authority. LLM handoffs remain explicit durable inputs to a deterministic Hub policy; deployments may register an LLM scheduling policy without making it foundational.

**Keep model-written JavaScript as the shipped Team workflow authority.** Rejected because arbitrary control flow, clock and randomness access, and Node escape cannot be validated as a deterministic durable graph. Shipped workflows use `TeamWorkflowPlan` data; the existing script engine remains an explicit custom-composition capability.

**Use a pure peer-to-peer actor mesh with no authoritative Hub.** Rejected because membership, ordering, task CAS, receipts, budgets, audit, and recovery would require distributed consensus or conflicting replicas. One Hub provides a clear initial consistency domain; link providers still distribute Agent execution.

**Store collaboration only by copying messages into every Participant Session.** Rejected because no Session can authoritatively answer channel order, membership, visibility, task state, or whether every intended recipient durably accepted a message. The channel WAL is the outbox and protocol truth; Session records only the exact model input it received.

**Force a worktree for every Participant.** Rejected because research-only, remote-sandbox, and intentionally shared tasks need different execution worlds, while worktree creation/merge has repository-specific failure modes. A workspace provider makes isolation explicit; shared mode serializes conflicting declared writes and never pretends to be a lock.

## Current implementation baseline

The shipped Headless and Web bundles use the stable local Team spine, and ACP, JSON-RPC, TypeScript SDK, and Python SDK product runs create Team-owned coordinator Sessions. JSON and SQLite logs, Team/channel/task/activation projections, typed closure and cancellation, immutable grants and typed budgets, child-to-parent usage charges, review sources, direct/consult/discussion/workflow adapters, local and WebSocket Links, local receipt-backed delivery, deterministic task assignment, Team Goal state, shared/worktree providers, artifact storage, control-plane Remotes, SDK projections, and the Team detail UI have focused implementation evidence. Legacy subagent, workflow, and same-Session Goal packages remain available only to explicit custom or internal compositions and are absent from shipped Team presets.

Ordinary Envelope admission takes runtime-only actor proofs rather than caller-selected sender fields: Links derive activation senders, TeamRun derives its exact human input, and the scheduler derives only current assignment/review Envelopes or one validated closed review-response recovery. The baseline now satisfies the local implementation slices for typed lifecycle authority, review revision/source delivery, participant/task grant and budget enforcement, common workspace-root consumption, versioned workflow extensions, ACP proxy-Session admission, child usage propagation, Team detail reads, bounded Team/member/task/channel page reads, durable TTL delivery expiry, durable channel summaries, coordinator task list/watch/cancel/owner-proposal controls, configurable local worker-pool fan-out, the compiled shipped `TeamWorkflowPlan` Consumer, local content-addressed artifact reachability/grace collection, durable source-specific audit projections, audit repair/failure counters in the Team metrics route, checkpoint-gated terminal-channel/audit prefix compaction, terminal Team-journal compaction, an opt-in bounded scheduler retention drive for terminal Team and channel prefixes, a typed live `TeamTelemetryCoordinator`, an explicit OTLP Team telemetry provider with configurable threshold alerts, complete Team operational gauges and cumulative task/receipt latency histograms, Team-aware model-directory reads/selections for the coordinator Session, v4 cooperative WebSocket endpoint termination, dynamic WebSocket enrollment Hub restart, pure channel replay/watermark property coverage, generated Task lifecycle fold property coverage, artifact-sourced integration-task execution through local and WebSocket Links, bounded portable change-set integration for local shared, sandbox, and E2B remote workspace providers, the default 4,096-record SQLite WAL page/restart load coverage, and an opt-in 16,384-record SQLite load benchmark. The page contract keeps provider-owned full reads for scheduler/recovery and uses exclusive cursors plus bounded look-ahead for product transports; Host, TypeScript SDK, Python SDK, and Web refreshes all preserve the continuation cursor. TTL expiry is an explicit Hub drive that appends replayable per-recipient expiry records without advancing receipt high-water. Channel summary admission validates a bounded WAL range and exact source Envelope provenance before appending a policy-selected durable summary; summarized views no longer synthesize history at read time. The plan compiler validates the whole JSON graph before durable task/channel work, recovers task/template/channel bindings from the Team journal, and keeps legacy JavaScript workflow execution in explicit custom compositions. The local artifact owner pages non-archived Team task results, applies a restart-conservative grace ledger, and drives provider collection through bounded object cursors. The Hub now repairs independent Team and channel audit streams before `readAudit()` returns, while business commits remain authoritative when the rebuildable audit append fails. Terminal stream retention requires a current checkpoint, an authorized maintenance actor, and a configured audit tail; channel retention additionally requires zero pending delivery. Compacted channel snapshots and audit pages disclose their first retained cursor, and the storage layer preserves original cursors and reports compacted old cursors explicitly. The [compiled Team workflow-plan decision](../../implemented/architecture/2026-08-31-compiled-team-workflow-plan-consumer.md) records that boundary. The local keyed Team real-model e2e now covers coordinator-to-worker assignment, worker evidence, and final output; the remaining implementation and evidence gap is multi-host/distributed restart, real-browser/GIF, load performance budgets beyond the opt-in benchmark, provider per-file coverage beyond the now-complete activation-recovery suite, and full release evidence.

The local OpenAI-compatible route now also drives the existing headless real-model file-edit, bash, todo, Code Mode, compaction, and resume suites: the local Qwen run passed 13/13 tests. The default bounded SQLite Team load path passed its opt-in 16,384-record replay/restart run in about 136 seconds with 32-record pages; a production performance budget remains deployment evidence rather than a host-specific timing assertion.

The same local route now drives the text ACP real prompt and sandbox approval/rejection suites, which passed 6/6 tests. Its local profile maps canonical `high` reasoning to the tested Qwen endpoint's accepted `xhigh` spelling; image-specific and provider-specific ACP overlays retain their own model contracts.

The TypeScript SDK now has grouped contract coverage for every low-level Team request wrapper and every `HarnessTeam` inspection, channel, task, member, lifecycle, and archive forwarder. The suite asserts malformed result rejection at the wire-facing layer and stable Team/cursor identity forwarding at the high-level layer; authenticated generic Team writes remain intentionally fail-closed under the actor-proof proposal. The Python SDK now gives notification subscription closure the same bounded teardown behavior: queued notifications are dropped and every parked `next()` is woken with a typed transport-closed failure.

The bundled Python runtime carrier now includes the explicit local `local-vllm` route alongside its inert `test-provider`. Python SDK callers can select the Qwen-compatible route with the same local environment variables, including canonical `high` reasoning mapped to the tested endpoint's `xhigh` spelling, without supplying a custom Cordis file.

The owned SDK remote path now treats an explicit remote `offline` response or a confirmed child-process exit as termination proof. If neither is available during cancellation, the activation remains `stopping` and the controller records `REMOTE_CANCELLATION_UNCONFIRMED` as a durable Team stall. WebSocket v4 now delivers a bounded cooperative endpoint-termination request before credential rotation, revocation, or provider retirement closes an attached socket; real child-process transport and remote `task-integrate` dispatch tests cover these paths. The ACP provider now races initialize/session startup against activation cancellation, waits for in-flight enrollment cleanup before child quiescence, de-duplicates completed Envelope delivery, and proves EOF and trapped-SIGTERM child termination through real local processes. Hard termination of an external cooperative endpoint and distributed restart evidence remain open work.

Provider-backed artifact references retain their named provider, and `team.artifact.read` now carries exact non-private references through Host, client runtime, and Team detail UI reads with bounded base64, provider verification, inline text preview, download, cancellation, and metadata-only fallback for provider-less references.

The SDK server now exposes the same visibility-checked read as `team/artifact-read`; the TypeScript and Python Team handles return the exact provider-backed reference, byte count, and canonical base64 data while mapping private, ambiguous, missing, provider-less, and oversized artifacts to typed errors.

The task/channel property suite now generates retries, heartbeats, assignment/report Envelopes, receipt interleavings, and checkpoint round trips together, checking that task-attempt provenance and channel pending/replay watermarks remain aligned across the two fold owners.

The existing artifact/pricing, worktree integration, shared target-directory integration, and SQLite handoff mechanisms remain valid foundations under the [artifact and pricing decision](../../implemented/architecture/2026-08-31-team-artifact-storage-and-pricing.md), [worktree integration decision](../../implemented/architecture/2026-08-31-team-worktree-integration-authority.md), and [projection reconciliation decision](../../implemented/architecture/2026-08-31-multi-hub-projection-reconciliation.md). Their current package-local guarantees still do not substitute for a complete Team-journal watermark policy or the release-tier evidence above.

The local `sandbox` workspace provider now owns isolated roots, optional source seeding, external allocation manifests, bounded changed-file publication, fail-closed release/recovery, and an opt-in portable change-set integration target with expected-version fencing and retry markers. The opt-in E2B `remote` provider owns isolated roots and manifests inside the already mounted E2B execution world, normalizes and fences its remote roots, publishes bounded remote files, and can apply its own portable change sets to an explicit live remote target with an expected-version fence. Neither provider infers Git integration authority or a distributed lock; target-directory replacement remains provider-specific.

The official local release path now proves `build:clocky`, the complete Clocky/vendor pack, the native Landlock entry pack, and an isolated consumer install that starts `@clocky/clocky` and reports its packed version. `release.yml` also defines a Linux/macOS/Windows packed-consumer matrix over those canonical tarballs. The standalone Landlock workflows already build and test each supported Linux architecture on its matching runner, assemble the complete native package family, and verify its packed install; the Clocky composite release consumes the entry tarball and verifies consumer degradation or native resolution per host. Leader election, automatic multi-Hub failover, and federation remain outside this proposal. The local keyed real-model Team e2e now covers coordinator-to-worker assignment, worker evidence, and final output; hard remote cancellation, multi-host-capable transport tests, browser/GIF acceptance, and complete release-run evidence remain required verification for this proposal rather than deployment-owned substitutes for repository evidence.

Closure authority now follows the same boundary: JSON-only complete/fail/cancel inputs carry an opaque runtime proof; the Hub resolves an active activation proof to a participant or a `team-run` proof to one closed completion, cancellation, or creation-failure scope under its serializers. The durable closure and cancellation records retain only the resulting participant or `team-run` system attribution, never a proof or raw caller-supplied actor. Goal update and phase-transition inputs likewise use an activation proof; TeamRun issues it only for its exact coordinator and trusted human-turn capability. Scheduler maintenance compaction and phase recovery remain separate authority work.

Root Team creation is proof-only too: TeamRun binds one complete root payload to `TeamSystemRootCreationProof` before any Team identity exists, and the Hub revalidates it after register policy and stream opening before its first record append. The first record retains only derived `createdBy` system provenance, which folds into Team snapshots and checkpoints. Nested Team creation now requires a separate `TeamSystemChildCreationProof` containing the full child payload and an observed parent cursor. The Hub admits only its canonical `team-child-delegation` source and revalidates it before parent repair, under the parent serializer, after register policy, and after child-stream opening. No shipped product mounts that source before a parent-task delegation consumer owns it, so the former raw child path fails closed rather than treating the parent Team or task as authority.

Terminal archive is now proof-only too: after TeamRun itself completes or cancels a Team, it retains an in-memory owner and issues one `TeamSystemArchiveProof` for the exact Team/cursor archive call. The Hub verifies the canonical `team-run` scope before loading, under the Team serializer even for an idempotent archive read, and after close policy before it appends the existing `team/archived` marker. Host delegates only to this local owner; an SDK server retains only its own terminal run record until it archives. The owner and proof vanish on TeamRun disposal, and no Team id, snapshot, provenance, roster, detached product client, or restart recreates them.

The generic lifecycle command is proof-only as well: `team-scheduler-dag` can prove only an active-to-stalled transition with its exact reason, and `team-run` can prove only a stalled-to-active resume or an accepted final's active-to-quiescing admission fence. That fence binds the final channel, Envelope, default topology, and Team cursor before it blocks new channel work. Scheduler maintenance compaction remains a separate authority gap.

Scheduler terminal retention now binds each destructive Team-journal or channel-WAL prefix to a one-shot maintenance proof containing its exact cursor and `throughSequence`. The Hub revalidates that proof before policy, audit, checkpoint, or storage compaction, so a durable system attribution cannot be reused as compaction authority.

Soft interrupt authority is proof-only too: ACP delegates one current-run human-to-coordinator request to TeamRun, while target Links use their activation proofs for discovery and acknowledgement. No requester, target, activation, Session, or provider identity crosses an interrupt command boundary from a caller.

Usage recording is proof-only: `team-agent-client` retains an activation-proof lease for each exact current binding and passes only JSON provider/model facts to the Hub. The Hub revalidates the binding before parent-charge repair, duplicate replay, policy, or append and derives Team, Participant, Session, and timestamp; parent-charge propagation remains internal settlement with that durable provenance.

Activation lifecycle authority is proof-only: the controller retains one exact bind/status/fence/quiesce proof for its owned epoch, while startup recovery retains only a locally quiesced wake-cleanup retry. The Hub resolves each proof before Team selection and again under its serializer, so an identity copied from an old binding cannot reach policy, lease cleanup, or a journal append.

Host approval/question actions are proof-only: the API proxy retains each verified pending action only after its durable admission and mints a new cursor-bound resolution proof for every retry. The Hub derives durable action and policy facts from that scope; after a Host restart, an absent verified entry logs and fails closed instead of reconstructing raw authority.

Scheduler task assignment and lease expiry are proof-only: `team-scheduler-dag` retains one exact assignment or elapsed-attempt proof per Hub call. The Hub validates that proof before parent-charge repair and under its Team/wake-channel serializers, while an assignment failure closes the newly opened wake channel instead of leaving an orphan.

Scheduler review consult and wake channel lifecycle are proof-only: `TeamSystemSchedulerChannelProof` scopes one exact review attempt/reviewer binding, pending task/assignee activation, or failed-assignment wake channel. The Hub derives the fixed channel manifest, revalidates it before and after repair and after policy, and never closes a wake channel referenced by a current lease.

Scheduler TTL delivery expiry uses the same proof family: one scope selects the active Team, attached channel, observed cursors, clock observation, and bounded batch. The Hub preserves the policy-free expiry drive, revalidates immediately before WAL append, and permits a terminal attached channel to drain pending deliveries.

Coordinator task creation and workflow-plan admission are proof-only: TeamRun issues a fresh current-coordinator activation proof for each retry, and the Hub derives durable creator or plan-actor attribution before repair, policy, replay, or append. Every newly written Task snapshot retains the derived creator command, and journal or checkpoint parsing rejects missing provenance. The remaining workflow compiler channel/binding/phase operations stay outside this narrower admission boundary.

Workflow compiler channel open, plan bindings, and phases are proof-only: TeamRun retains an exact `TeamSystemWorkflowProof` for one compiler mutation, while the Hub validates the plan revision and payload under its Team/channel serializers. An attached workflow channel can be closed only by the scoped orphan cleanup before the compiling plan binds it.

Current-coordinator default-worker owner proposal and cancellation require `TeamSystemTaskControlProof`. TeamRun scopes the durable creator, task revision and selected payload; the Hub verifies that creator and revalidates the proof after policy before append. Owner proposals require a pending nonworkflow task. The [single-task cancellation decision](../../implemented/architecture/2026-09-06-exact-single-task-cancellation.md) owns cancellation admission and exact-work settlement. Post-release cleanup retains its separate authority lifetime; `cancelTask()` has no actor-free path.

Participant topology is proof-only: `TeamSystemTopologyProof` covers only TeamRun bootstrap participant/phase/direct-channel mutations before run publication, then declared-worker activation and reviewer provisioning mutations for the retained run. The Hub resolves each exact scope before participant policy and under its Team serializer before durable mutation; raw participant ingress fails closed while scheduler structural channel opens remain independently owned.

Post-release cleanup is split by lifecycle evidence: `TeamSystemCancellationCleanupProof` binds one durable cancellation identity and its exact pending task or active channel, while `TeamSystemFinalizationCleanupProof` binds a human-receipted final, default topology, and exact active channel. The Hub rejects stale cancellation scopes before parent-charge repair and revalidates both proof families before policy or durable cleanup; neither can authorize generic channel closure.

## Acceptance criteria

- Every shipped user task is created, listed, resumed, cancelled, completed, and archived by `TeamId`; no Web, CLI, ACP, JSON-RPC, or SDK path exposes standalone Session creation as a product operation.
- The default shipped Team template contains a coordinator and worker identity, uses the same runtime for cardinality-one configurations, and permits policy-driven reviewer provisioning without changing product mode.
- `TeamId`, `ParticipantId`, `SessionId`, `ActivationId`, `ChannelId`, `EnvelopeId`, `TeamTaskId`, and `TaskAttemptId` remain separately branded and cannot be rebranded across package boundaries without an owner lookup.
- Team journal, channel WAL, Session log, and audit projection have the ownership split stated above; Team truth does not depend on a live Lead or copied Session transcript.
- JSON and SQLite log providers pass one conformance suite; unsupported format/adapter/view versions fail loudly, and Hub restart reconstructs equivalent Team/channel/task projections.
- Direct, consult, discussion, and workflow adapters enforce manifest versions, participant roles, turn/termination rules, delivery plans, and pure replay; graph extensions register and dispose through Cordis effects.
- Local and WebSocket Links expose the same client contract. Accepted Envelopes survive Hub restart, unacknowledged delivery replays after reconnect, old receipts cannot rewind cursors, and duplicate causation does not repeat a model turn.
- Every Team-derived model input is reconstructable from its Session log with Team/channel/envelope provenance and exact rendered content; automatic output broadcast is absent.
- Task mutations use revision and attempt CAS, dependencies stay acyclic, leases expire explicitly, retry/review/stall transitions are durable, and Team completion requires quiescence plus a final human-addressed answer.
- Hub policies enforce identity, membership, access, grants, budgets, rate/inbox limits, interrupts, task assignment, and workspace allocation independently of prompt compliance.
- Concurrent mutating tasks either receive isolated workspace allocations or are serialized for conflicting declared scopes; integration and artifact provenance are durable and user changes are preserved.
- Team cancellation and plugin/process teardown close admission, settle accepted work, release Activations/links/workspaces child-first where required, contain listener failures, and report aggregate cleanup failures only after quiescence.
- Web UI, Host Remotes, TypeScript SDK, and Python SDK expose the Team/Participant/Channel/Task model and update their expected outputs together; Participant Session transcripts remain inspectable as descendants.
- The experimental Team packages, legacy Team Session events, direct model-visible subagent/fork controls, and workflow-owned private child starts are absent from shipped source/catalog regions, default bundles, snapshots, and packed artifacts after cutover; compatibility packages remain only for explicit custom/internal compositions.
- Unit, contract, property, race/fault, keyless snapshot, real-model e2e, distributed link, browser/GIF, both SDK, build, typecheck, coverage, hygiene, documentation, and package-consumer evidence pass at their owning phases and final cutover.

## Risks

- **Three durable streams can diverge if ordering is vague.** The channel WAL commits before dispatch, the target Session flushes before receipt, and the receipt commits after target durability. Recovery always derives pending work from those ordered facts; no cross-store atomicity is claimed.
- **The Hub is an initial single point of failure and throughput ceiling.** Durable restart, incremental projections, checkpoints, bounded queues, and SQLite reduce impact. Multi-Hub consensus/federation requires a separate proposal after one-Hub semantics and measurements are stable.
- **At-least-once delivery can repeat model or tool effects.** Envelope/causation de-dup prevents known duplicate turns, while external tools require idempotency/CAS. Documentation and APIs must never say exactly once.
- **Multi-agent context can grow faster than useful work.** Explicit send/report, audience filtering, bounded channels, view policies, summaries with provenance, task artifacts, and no automatic broadcast control token cost.
- **More agents increase spend, latency, and failure probability.** Team budgets, inactive provisioned workers, concurrency caps, deterministic scheduling, task leases, and observable cost make the trade-off configurable; the default template must be benchmarked against a one-member Team.
- **Shared filesystem work can still conflict with undeclared or external writes.** Scheduler serialization and worktree providers reduce risk but cannot infer every Bash/generator effect. The integration boundary remains final diff/artifact review plus tests.
- **The refactor crosses persistence, Agent lifecycle, tools, goal, workflow, API, SDK, and UI.** The dependency-ordered stack keeps every branch buildable, ports replacement evidence before deletion, and uses the pre-release no-shim stance only at the final cutover.
- **Versioned adapter/plugin removal can strand active channels.** Accepted channels retain their adapter lease through closure; restart fails loudly without the exact version. Retention and deployment checks must prevent removing versions still referenced by active durable channels.
- **Remote links widen the security boundary.** The Hub stamps sender identity, validates every frame/payload, enforces auth/access/size/rate limits, and never accepts client-supplied authority. TLS, credential rotation, and deployment isolation remain operator responsibilities.
- **LLM coordinators can create poor task graphs or handoffs.** The Hub validates graph structure, budgets, capabilities, policy, and lifecycle, while deterministic fallback/stall behavior prevents an invalid model decision from becoming unbounded execution. Semantic task quality still requires review or evaluator policy.
