# Team 工作系统

[English](team.md) | 中文

`@clocky/clocky-team`定义持久 Team 词汇以及 `ctx.teams` Service Definition。[`@clocky/clocky-team-hub`](../../packages/team/team-hub/README.zh.md)是显式挂载的本地提供方：它拥有 journal、channel WAL、按 source 分离的 durable audit projection、成员／任务／activation 投影、有界 root-or-child 层级、已认证 Envelope admission、派生的 pending delivery、receipt cursor、恢复、游标 watch、临时 delivery claim、带围栏的 task attempt、带 revision 的 Team goal、持久声明式 workflow plan、进程内 metrics，以及不删除状态的终态 Team 归档。[`@clocky/clocky-team-activation-controller`](../../packages/team/team-activation-controller/README.zh.md)会在 `ctx.teamActivations`公开 bind-or-dispose owner；[`@clocky/clocky-team-channel-direct`](../../packages/team/team-channel-direct/README.zh.md)提供 带独立 recipient receipt 的产品 direct v4 multicast；[`@clocky/clocky-team-link-local`](../../packages/team/team-link-local/README.zh.md)拥有本地 pending-delivery replay；[`@clocky/clocky-team-agent-client`](../../packages/team/team-agent-client/README.zh.md)拥有本地 Agent inbox admission，并消费 provider-owned task workspace root；[`@clocky/clocky-team-scheduler-dag`](../../packages/team/team-scheduler-dag/README.zh.md)会使 lease 过期、保持 compiling workflow task dormant、作出确定性的 shared-work assignment，并可运行显式配置的 terminal-channel retention drive；[`@clocky/clocky-command-team-goal`](../../packages/team/command-team-goal/README.zh.md)将面向用户的 `/goal`控制限定在已绑定 Team participant 中；[`@clocky/clocky-team-run`](../../packages/team/team-run/README.zh.md)拥有本地默认 human/coordinator/worker topology、按配置启用的 reviewer routing、workspace outcome publish、声明式 workflow compilation 和显式 final-result receipt。本地及 WebSocket Link、Host Remote、TypeScript/Python SDK 和 Web Team page 都消费这条 spine。Worktree provider 提供可选的 policy/CAS integration authority；SQLite-backed Hub 会在读取前 reconciliation 外部追加的 projection。自动 leader election/failover、remote push authority 与 hard cancellation 仍是独立部署工作。[本地 Team Hub 决策](../../.agents/notes/implemented/architecture/2026-08-27-local-team-hub-durable-authority.zh.md)记录本地提供方的理由。

[`@clocky/clocky-team-channel-basic`](../../packages/team/team-channel-basic/README.zh.md)提供有界 consult 和 discussion 协议，[`@clocky/clocky-team-channel-workflow`](../../packages/team/team-channel-workflow/README.zh.md)提供有界声明式 workflow 转移。这些适配器只校验 manifest、折叠状态，不执行投递或模型轮次。

[`@clocky/clocky-team-workspace-sandbox`](../../packages/team/team-workspace-sandbox/README.zh.md)提供由 provider 拥有的本地 `sandbox` root、可选 source seeding、有界 changed-file publication 以及 opt-in portable target-directory integration authority。[`@clocky/clocky-team-workspace-e2b`](../../packages/e2b/team-workspace-e2b/README.zh.md)在现有 E2B execution world 内提供 opt-in `remote` root，并在该 world 存活期间提供 opt-in portable target-directory integration authority。两个 provider 都会验证准确的 allocation manifest；两者都不会进行 Git ref integration 或声明 distributed lock。

本地 Hub 的 `compactChannel()` 是 terminal channel 的显式 retention boundary：它要求 actor 已获授权、没有 pending delivery、audit projection 是 current 且 checkpoint 已存在，然后才保留配置的 audit tail 并删除旧 source record。Scheduler 的可选 retention drive 会提供 actor 和有界 source tail，但所有 watermark 检查仍由 Hub 负责。旧 cursor 会收到 typed compaction error。

## 独立身份

`TeamId`、`ParticipantId`、`ActivationId`、`ChannelId`、`EnvelopeId`、`TeamTaskId` 和 `TaskAttemptId` 是彼此独立的品牌。持久化或协议输入经对应的 Zod 解析器处理；不会把 Session 身份重标为 Team 身份。activation binding 将一个 epoch 与准确的 Session 和具名 provider 关联。Participant 会保留 offline epoch，跨 epoch 使用一个 Session，且最多一个 epoch 保持 resident。human Participant 会保留封闭且不可变的 `TeamParticipantOwner`：interactive binding 命名 product principal，unattended root 命名 system；replay 会拒绝缺失、格式错误、被变更或重复的 active principal owner。root Team 的 `depth: 0`；nested Team 携带成对的 `parentTeamId` 和 `parentTaskId`、已解析深度以及继承的 `maxTeamDepth`。Team、participant、activation、channel 和 task 的生命周期值是封闭联合。纯转换检查会在提供方追加记录前拒绝无效的初始、回退或终止后边。

Task 会冻结 ancestry、capability requirement、priority、read/write scope、workspace mode、budget fact、封闭的 review route 和 attempt limit。由 workflow plan 编译的 task 也会冻结其 plan/template provenance。task-create command 只携带 retry key 与运行时 proof。本地 Hub 会派生活跃 coordinator 的 activation binding，或只含 Team 与 Participant id 的 authenticated human creator，并在 replay 或 policy 前重新验证 proof。workflow-plan admission 保持仅限 coordinator，并派生 durable actor。当前 lease 属于一条 active `assigned` 或 `running` attempt，并记录 owner Participant，以及在适用时的 agent epoch。settled attempt history 会保留不可变 outcome summary 或 failure，且绝不复用 id 或 ordinal。`none` review route 会直接完成成功的 attempt；participant route 会进入 `review`，并保留准确 reviewer 的接受或返工决定及其 reason。`team-scheduler-dag`会在 provider 的首条 durable task-record 顺序之后，使用 capability surplus、active lease load 和 Participant id 做出有界的 shared-work assignment。workspace provider 会通过显式且不做 integration 的边界发布有界 changed-path 和 artifact manifest；worktree provider 会带 provenance 生成文件 reference，merge authority 由其可选的 policy/CAS integration path 提供，sandbox 与 E2B provider 则可以在各自的 provider-specific fence 下将 portable change set 应用到显式 target directory。Typed Team closure 与 cancellation command 携带只含 JSON 的字段以及不透明 runtime authority；Hub 会在 Team/channel lock 内派生并持久化 participant 或受限 system actor，绝不持久化 caller-selected actor 或 proof。cancellation admission 与终态 closure 分离。scheduler-owned `expireSchedulerChannelDeliveries()` command 会在移除 recipient pending delivery 前记录 TTL expiry，而且绝不会把该 record 当作 receipt。它的显式 `summarizeChannel()` command 会校验 source provenance，并追加由 summarized view policy 消费的 durable summary。

Integration task 会在同一条 Team task record 中加入不可变的 source task/attempt、provider、target、expected target revision，以及 proposal 或 merge mode。其 completed attempt 会保留匹配 target 的 integration result；成功结果含最终 target version，merge 失败结果含 conflict path；Hub 会围绕既有 task CAS append 校验 source、`workspace-integrate` policy 和 result。

`ActivationBindingSnapshot.fencedAt` 记录 provider 已确认终止、但 closure-owned allocation 尚未结算的事实；该字段不可变，不代表完整 quiescence。`quiescedAt` 仍要求 allocation 已释放且 task lease 已结算。`requireSystemClosureDriverProof()` 只解析有效的 runtime token；consumer 执行动作前还必须核对准确的持久 intent、Team cursor 与资源 epoch。Controller closure-stall scope 绑定该 intent identity 与 epoch，不允许 resume、replacement 或创建新的 closure。

`TeamTaskDependencyOutcome` 记录尚未执行的 workflow task 的终态前置任务 id、revision 及 failed/cancelled/deleted phase。`TeamRunWorkflowTaskCancelRequest` 选择所拥有的 plan/template binding；结果包含可空的 `blockedByOutcome`（null 表示不存在依赖取消）。Completed、failed 或 cancelled plan 均可保留配置选定的 task-result projection。

`ActivationReservationSnapshot` 以品牌化 `ActivationReservationId` 保留一次 provider 启动 admission。`ActivationReservationRequest` 组合 JSON `ActivationReservationInput` 与仅 runtime 可用的 controller proof。`ParticipantSnapshot.activationReservation` 在 provider 启动前持久化，`ActivationBindingSnapshot.reservationId` 只能消费该身份一次。`maxLiveActivations` 根据 Team budget 与 grant 的更严格上限，统计待启动预留、未 quiesce epoch 及委派的 child 额度。未知启动以 `ACTIVATION_STARTUP_UNCONFIRMED` 阻止关闭。

`TeamDiscoveryCursor` 是 opaque provider scan 位置，不同于数值 journal 和 collection cursor。`TeamListPage.scanned` 统计包括跳过名称在内的已检查条目；没有可见 item 的页也可能继续。`TEAM_DISCOVERY_CURSOR_EXPIRED` 要求从 `afterCursor: -1` 开始新扫描。

`TeamTaskExecution`区分 Participant attempt 与 child-Team 工作；child 分支冻结 template、authority grant 和 budget。`TeamTaskDelegationSnapshot`保留预留的 child identity、可重放的创建 payload、cursor、failure 与已接纳 result。Parent task 不持有 Participant lease。`TeamChildRunBinding`标识 service recipient、coordinator 与 consult channel；`TeamDelegationResultAdmission`把已接纳 response 绑定到 parent task。[`@clocky/clocky-team-delegation`](../../packages/team/team-delegation/README.zh.md)是驱动这些记录的 Consumer，不提供 `ctx` service，而是向 TeamRun 注册 cancellation driver。

## 提供方注册

`transitionTeamPhase()`接收只含 JSON 的 lifecycle 字段和一个由 source 持有的 `TeamSystemPhaseProof`。Hub 在 Team lock 内解析已注册 source，验证准确的 transition 与 target，并将派生出的 system identity 交给 close policy。测试所需的状态通过私有 journal helper 直接种入，而不会引入公开的通用 transition authority。

`compactTeam()`与`compactChannel()`接收只含 JSON 的 prefix 字段和 `TeamSystemMaintenanceProof`。只有 `team-scheduler-dag`可以解析一段准确的终态 Team-journal 或 channel-WAL prefix；其 scope 会在任何 policy、audit repair、checkpoint 或 storage compaction 发生前固定 Team/channel、cursor 和 `throughSequence`。

activation lifecycle command 会携带 JSON-only field 与 `TeamSystemActivationProof`。`team-activation-controller`拥有准确的 bind/status/fence/quiesce scope，`team-activation-recovery`只拥有记录为本地 quiesce 的 offline epoch 的 wake-cleanup retry。Hub 会先解析 source proof 选择 Team，再在 Team lock 内解析，然后才执行 policy、lease cleanup 或 journal acceptance；持久 activation record 只保留派生出的 binding。

Task 由 workflow plan 编译时会额外冻结 plan/template provenance。完整 JSON plan 会先校验 task DAG、bounds、result selection 和基于 role 的 workflow graph，再由 TeamRun 创建 task 与 workflow channel；Hub 将其保持为 `compiling`，scheduler 只会在 `ready` record 后调度，并强制 plan 的 parallelism 与 total-attempt bound。重试和 restart 会根据 durable plan/template binding 继续 compilation，而不是重新执行 model-written code。

`TeamRuntime`声明通用的 Team、participant、activation、task、channel、已认证 Envelope admission、recipient receipt 和 delivery claim 操作，并提供各提供方共用的注册能力。task operation 会把 lease-free detail/cancel/review/delete action 与 assignment 及 owner-fenced attempt action 分开；provider 会在其 frozen limit 和 route 下，把已报告 outcome 映射到 direct completion 或 review、retry、failure 或 cancellation。`postChannelEnvelope()`只接收运行时 actor 以及 JSON cursor/retry/draft 字段。activation proof 派生当前 sender；TeamRun、scheduler 与 delegation source proof 只派生各自 scope 内的 human-input、assignment、review 或 parent-service post。task-assignment 与 review-request draft 必须使用 scheduler source，不能使用 activation proof。`resolveTaskReview()`从 activation 或 authenticated-human runtime proof 派生配置的 reviewer，不接受 caller-selected Participant identity；scheduler 只能通过独立 source-scoped proof 修复一条准确的 closed consult response，并验证 task 和两条 Envelope record。receipt 与 delivery claim 会在 Team-to-channel lock 内从运行时 actor 派生 recipient，再执行 policy evaluation 或持久 mutation。`updateTeamGoal()`和`transitionTeamGoalPhase()`接收只含 JSON 的字段和 `TeamActorProof`；Hub 会从该 proof 解析准确当前的 Team、Participant、activation、Session 和 provider，而不是接收 caller-supplied actor identity。claim 会在一个 Hub 线性化点证明准确的 running/idle activation 与 pending recipient admission，而不会保留模型 turn 或追加 claim record。重复 receipt，或已经提交且以传入 Envelope 作为 `causationId` 的 recipient reply，都不会产生本地投递。`bindActivation()`和`updateActivationStatus()`使用 Team cursor 并返回分离的 binding；重复 activation id、Session 更换或并发 resident epoch 都会被拒绝。重复 receipt 会返回原始 record，而不会再次追加 WAL。child creation request 命名 parent Team 和 task；提供方在 parent 队列下验证该 task，并在 child journal 中快照其深度策略。channel 适配器按精确的 `(type, version)`身份注册，并由其 effect disposer 移除。channel manifest 冻结该身份及其 participant，WAL 单独记录生命周期边。策略按 Team 操作注册，并通过 `team/policy` waterfall 组合：允许操作的策略调用 `next()`，拒绝操作的策略返回结构化决定。

`requestParticipantInterrupt()`只接受 TeamRun 针对其准确当前 human-to-coordinator topology 的 source proof，在 Team/channel lock 内解析当前 idle/running coordinator target，并以派生出的 human requester 应用 `interrupt` policy。只有该 target 的 activation proof 可以列出或确认请求；确认是幂等的，不会取消 Team 或结算 turn。

Host API proxy 拥有 approval/question action proof。其公开 request 只携带 Team/cursor field，保留的 verified interaction entry 会提供完整 pending action 或 terminal outcome；Hub 会在 Team lock 内重新解析该 scope，并派生 durable action、policy actor 与 timestamp。丢失 verified entry 的 API proxy 会 fail closed，而不会在重启后重建 raw authority。绑定的 local Agent 会私有保留 activation proof，并只将最终 Session provider/model usage fact 转交给 `recordUsage()`；Hub 会重新验证 binding，并在重复 replay、policy 或持久 accounting 前派生 Team／Participant／Session／timestamp。该方法会替换重复的 turn／step observation，并维护持久 Team subtree token、turn 与 provider-cost total；child charge 会在继续 child work 前修复，typed cost ceiling 会拒绝未知 pricing，而不会按 0 计入。超过冻结上限会使 Team 进入 stalled。

scheduler 拥有 task-lease proof。`assignTask()`与`expireTaskAttempt()`只接收 JSON task/lease field 及一条准确 selected assignment 或 elapsed attempt 的 scope；Hub 会在 parent-charge 或 channel work 前检查它，并在 Team 与已附加 wake-channel lock 内再次检查。assignment 失败会关闭其刚打开的 wake channel，cleanup failure 仍可被观察到。

TeamRun 拥有 workflow compiler proof。带 `workflowPlanId`的 channel open、plan channel/task binding 与 plan phase transition 都需要为 compiling plan revision 与 payload 固定的准确 scope。Hub 会在相应的 Team/channel lock 内重新解析该 proof。compiler failure 后，独立的 scoped command 只会关闭同一 compiling plan 的 attached、active、unbound workflow channel。

TeamRun 还拥有 current-coordinator default-worker task-control proof。owner proposal 与 cancellation scope 会绑定 durable creator identity、task revision 与 selected payload；coordinator release 后，cancellation cleanup 有意使用不同 authority。

`readAudit()`会在返回前修复独立的 `audit/<TeamId>` 或 `audit/<TeamId>/channel/<ChannelId>` projection，再按 source cursor 读取有界的 audit entry；它不会将 audit projection 变为 Team 或 channel authority。

## 提交后的通知

提供方只会在持久接受后调用受保护的 Team 和 channel 通知辅助方法。观察者接收不可变的 Team 或带身份的 channel 通知；抛出或拒绝的观察者会被记录，不能改变已经提交的结果。该 Service Definition 本身不记录 Team 状态；本地 Hub 只在挂载时物化它。

## 本地产品运行

`TeamActivationRequest`选择一个 active agent Participant、其拥有的持久 Session、具名 placement provider、Agent option 和可选本地 execution root。`TeamActivationLease`会通过 `ctx.teamActivations`公开已绑定 epoch、其可选本地 Agent、health、中断和静默释放。

`TeamFinalAdmissionInput`通过 Team/channel/Envelope identity、sequence、fingerprint 与 retry key 选择准确 WAL 内容。`TeamFinalAdmissionRequest`增加运行时专用的 `TeamSystemFinalReceiptProof`；`TeamFinalAdmission`增加 sink kind、派生的 recipient 与 owner，以及 admission timestamp。封闭的 result sink 在 channel receipt 前独立记录这项事实；[Hub 契约](../../packages/team/team-hub/README.zh.md)负责 recovery 与 retention。

`ChannelSummarySelectionInput` 选择频道、预期 WAL 游标、包含两端的来源范围和幂等键。`ChannelSummarySourceRequest` 增加当前协调者或经过认证的人类证明；`ChannelSummarySource` 返回获授权的来源 Envelope 及其指纹，或已有重试结果。`ChannelSummarizeRequest` 另带规范 Consumer 输出证明。`ChannelSummaryRecord.sourceFingerprint` 绑定完整、规范、有序的来源 Envelope。[摘要 Consumer](../../packages/team/team-channel-summary/README.zh.md) 拥有抽取上限和调用者可见行为；Hub 在接纳与重放时验证来源对全频道可见。

`TeamRunCreateRequest`创建一个本地默认 Team。`TeamRunHandle`保留其 human、coordinator、已 provision worker、direct v4 channel 和 coordinator lease。`TeamRunHumanInputRequest`追加可信 text/image human content；`TeamRunFinalWaitRequest`等待 coordinator 的显式 final Envelope；`TeamRunFinal`在持久 receipt 和狭窄 topology settlement 后返回已接收的面向 human text。`TeamRunCoordinatorTaskAuthority`和 `TeamRunCoordinatorGoalAuthority`是 opaque 的 exact-coordinator capability。`TeamRunCoordinatorGoalUpdateRequest`只携带已观察 revision 和替换 objective；TeamRun 只会从当前 human direct-v4 turn 签发私有、短生命周期的 activation proof 并准入。`TeamRunDefaultWorkerTaskStartRequest`携带其 branded retry key、instructions 和 read/write scope；`TeamRunDefaultWorkerTask`标识已接收 task，并继承 `TeamRunDefaultWorkerTaskReview`；其中冻结的 `reviewPolicy` 和可为 null 的 `reviewResult` 只对应 active attempt，没有 active lease 时则对应最近结算的 attempt；`TeamRunDefaultWorkerTaskWaitRequest`提供已拥有的 task id 和本地 wait cancellation；`TeamRunDefaultWorkerTaskWatchRequest`提供最近观察的 Team cursor 和本地 watch cancellation；`TeamRunDefaultWorkerTaskCancelRequest`提供 owned task id；`TeamRunDefaultWorkerTaskOwnerProposalRequest`提供 owned task id 和可选的 preferred Participant；`TeamRunDefaultWorkerTaskList`和 `TeamRunDefaultWorkerTaskWatch`返回紧凑 task phase 和审阅事实；`TeamRunDefaultWorkerTaskOwnerProposal`返回保留的 advisory hint；`TeamRunDefaultWorkerTaskTerminal`保留其终态 result 或 attempt outcome。

`workerCount`会在新 Team 的 rules 中快照本地 worker pool。Slot zero 使用 `worker` role；后续 slot 使用 `worker-2`、`worker-3`等，每个 slot 都有独立的 activation-bound Session。Workflow channel 可以包含这些 role name，而 task assignment 仍会应用 scheduler 的 capability、load、workspace 和 plan-parallelism 检查。

`TeamRunWorkflowPlanStartRequest`接受完整 JSON `TeamWorkflowPlan` 和 lineage-derived retry key；`TeamRunWorkflowPlanWaitRequest`等待一个 owned plan；`TeamRunWorkflowPlanTerminal`包含 durable projected task result 或 terminal failure。

`TeamTaskInspectRequest`由准确的 Team/任务 id、`TeamTaskInspectionSelection`及可选版本条件组成，provider 将其解析为`TeamTaskInspectSpec`。`TeamTaskInspection`包含不带历史数组的`TeamTaskRecord`及计数，或带起点、总数、扫描数和续页游标的 attempt/review 索引页。[Core 契约](../../packages/core/team/README.zh.md)规定响应上限及私有产物过滤。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamactivations--teamactivationcontroller"></a>

### `ctx.teamActivations` — `TeamActivationController`

Team Consumer that owns the small two-system transaction from a published AgentRuntime handle to a durable Team binding. Each provider owns the execution-specific mechanism behind its handle status stream.

```ts cordis-catalog
/** Begin terminal-intent-driven release of every exact activation handle currently owned by this controller. */
start(): void

/**
 * Recover at most one epoch selected from an existing durable lifecycle intent.
 * Missing ownership records produce a durable stall; successful fencing first
 * requests allocation release and only later records complete quiescence.
 * @param input - exact closure-driver proof and its observed Team cursor.
 * @returns settlement of this bounded pass; callers reread state before issuing another proof.
 */
async recoverClosure(input: TeamClosureContinuationRequest): Promise<void>

/**
 * Activate one active agent participant and persist its binding before the
 * caller receives a lease. Concurrent callers for the same Team/participant
 * and Session join the exact accepted lease.
 * @param input - fully resolved activation inputs.
 * @returns a controller-owned durable activation lease.
 */
async activate(input: TeamActivationRequest): Promise<TeamActivationLease>

/**
 * Fence one stale external epoch, atomically release its current task leases
 * and persist it offline, then publish a new activation with the same Team
 * participant and Session under a new id.
 * @param input - exact old binding plus replacement composition selected by the recovery owner.
 * @returns a durable lease for the newly bound persisted-resume epoch.
 */
async coldReplace(input: TeamActivationColdReplaceRequest): Promise<TeamActivationLease>

/**
 * Fence one activation left running after a Host restart before a Team can be resumed.
 * @param input - Exact stale activation and recovery authorization selected by the recovery owner.
 */
async fenceStale(input: TeamActivationStaleFenceRequest): Promise<void>

/**
 * Confirm that a human-authorized coordinator recovery can reach the selected provider without mutating Team state.
 * @param input - exact durable coordinator binding and live human resume authorization.
 * @returns resolution after provider and durable binding checks pass.
 */
async preflightResume(input: TeamActivationResumePreflightRequest): Promise<void>

/** Stop admission, release every accepted handle, and await bounded settlement. */
close(): Promise<void>
```

Source: [`packages/team/team-activation-controller/src/index.ts`](../../packages/team/team-activation-controller/src/index.ts)

<a id="ctxteamchanneladmission--teamchanneladmission"></a>

### `ctx.teamChannelAdmission` — `TeamChannelAdmission`

Shared channel admission Consumer; endpoint acknowledgements remain owned by their authenticated receivers.

```ts cordis-catalog
/**
 * Replay one bounded discovery/expiry pass; acknowledged invitations are never reissued.
 * @returns settlement after this pass's accepted Hub operations finish.
 */
runOnce(): Promise<void>

/**
 * Wait for durable required endpoint consent before dispatching channel work.
 * @param request - exact channel and caller cancellation lifetime.
 * @returns an active channel snapshot; terminal admission rejects without dispatch.
 */
waitUntilActive(request: ChannelAdmissionWaitRequest): Promise<ChannelSnapshot>
```

Source: [`packages/team/team-channel-admission/src/index.ts`](../../packages/team/team-channel-admission/src/index.ts)

<a id="ctxteamchannelsummaries--teamchannelsummary"></a>

### `ctx.teamChannelSummaries` — `TeamChannelSummary`

Concrete Consumer with one ephemeral proof per exact summary commit.

```ts cordis-catalog
/** Return detached public bounds for command discovery.
 * @returns Summary policies and input/output limits of this Consumer.
 */
describe(): import('@clocky/clocky-team').ChannelSummaryCapabilities

/**
 * Generate one explicit channel-wide summary or return its committed retry result.
 * @param request - Current coordinator/human proof and exact bounded source selection.
 * @returns The durable summary with its original source fingerprint and retry identity.
 */
summarize(request: ChannelSummarySourceRequest): Promise<ChannelSummaryRecord>

/** Stop new admissions, revoke outstanding proofs and await owned operations. @returns Completion after accepted operations settle. */
async close(): Promise<void>
```

Source: [`packages/team/team-channel-summary/src/index.ts`](../../packages/team/team-channel-summary/src/index.ts)

<a id="ctxteamclosuredriver--teamclosuredriver"></a>

### `ctx.teamClosureDriver` — `TeamClosureDriver`

Provider-routed Team closure scanner with one serializer and one proof map per mounted driver.

```ts cordis-catalog
/**
 * Subscribe before scanning so notifications racing startup request a later
 * pass, then finish one bounded startup recovery drive.
 * @returns resolution after the initial bounded drive settles.
 */
async start(): Promise<void>

/**
 * Discover every eligible Team or drive one selected Team. The backend owns
 * semantic cleanup; this consumer only serializes current-state observations.
 * @param request - optional durable Team restriction.
 * @returns resolution after every pass selected by this request settles.
 */
drive(request: TeamClosureDriverDriveRequest = {}): Promise<void>

/**
 * Admit one current coordinator turn result before its product caller
 * reports the missing final or structured failure.
 * @param request - exact activation, Session, turn, and durable reason observation.
 * @returns resolution after the corresponding Team fact is accepted.
 */
recordTurnEnd(request: TeamClosureDriverTurnEndRequest): Promise<void>

/**
 * Admit one frozen budget exhaustion observation through the same
 * proof-bound Hub path used by restart recovery.
 * @param request - Team identity and exact budget reason.
 * @returns resolution after the durable stalled phase is accepted.
 */
recordBudgetStall(request: TeamClosureDriverBudgetStallRequest): Promise<void>

/**
 * Stop watches and new drives, then await already admitted backend calls
 * within the configured disposal bound while retaining their proofs.
 * @returns resolution after accepted calls settle, or their aggregate failure.
 */
close(): Promise<void>
```

Source: [`packages/team/team-closure-driver/src/index.ts`](../../packages/team/team-closure-driver/src/index.ts)

<a id="ctxteamclosuredriverhub--teamclosuredriverhub"></a>

### `ctx.teamClosureDriverHub` — `TeamClosureDriverHub`

Real Core Team backend that continues only a driver-issued durable recovery scope.

Source: [`packages/team/team-closure-driver/src/hub.ts`](../../packages/team/team-closure-driver/src/hub.ts)

<a id="ctxteamclosuredrives--teamclosuredrivebackendregistry"></a>

### `ctx.teamClosureDrives` — `TeamClosureDriveBackendRegistry`

Named registry for provider bridges that own the durable closure commands.

```ts cordis-catalog
/**
 * Register one backend bridge. Disposing the provider fiber removes it from
 * future passes without invalidating an already admitted backend call.
 * @param backend - Hub-facing implementation selected by a composition.
 * @returns HMR-safe disposer for this exact backend registration.
 */
registerBackend(backend: TeamClosureDriveBackend): () => void

/**
 * Resolve one live backend without changing its registration lifetime.
 * @param backend - configured backend identity.
 * @returns the live provider bridge, or `undefined` after removal.
 */
getBackend(backend: string): TeamClosureDriveBackend | undefined

/**
 * Resolve the exact configured bridge or reject before recovery can silently
 * skip durable closure work.
 * @param backend - configured backend identity.
 * @returns the live provider bridge.
 * @throws {@link TeamClosureDriveError} when the backend is unavailable.
 */
requireBackend(backend: string): TeamClosureDriveBackend

/**
 * List current backend identities in registration order.
 * @returns detached registered backend references.
 */
listBackends(): readonly TeamClosureDriveBackendRef[]
```

Source: [`packages/team/team-closure-driver/src/index.ts`](../../packages/team/team-closure-driver/src/index.ts)

<a id="ctxteamhumanactors--teamhumanactor"></a>

### `ctx.teamHumanActors` — `TeamHumanActor`

Effect-scoped product-principal to active-human binder.

```ts cordis-catalog
/**
 * Map one authenticated principal to exactly one active human participant and
 * hold its exact payload-bound proof only while the supplied operation runs.
 * @param call - runtime-only authenticated product call retained by its transport lease.
 * @param input - complete parsed JSON-only mutation input and observed fence.
 * @param operation - Hub call that may resolve the proof more than once before settling.
 * @returns the operation result after the proof is revoked.
 */
async withProof<T>( call: AuthenticatedProductCall, input: TeamHumanActorProofInput, operation: (proof: TeamHumanActorProof) => Promise<T>, ): Promise<T>

/** Invalidate every outstanding proof before the source leaves the Team runtime. */
close(): void
```

Types: [AuthenticatedProductCall](core.zh.md)

Source: [`packages/team/team-human-actor/src/index.ts`](../../packages/team/team-human-actor/src/index.ts)

<a id="ctxteamhumandelivery--teamhumandeliveryruntime"></a>

### `ctx.teamHumanDelivery` — `TeamHumanDeliveryRuntime`

Provider-owned principal inbox consumed by Hub admission and authenticated product APIs.

```ts cordis-catalog
/**
 * Persist the exact authorized final before Hub admission or receipt.
 * @param input - Hub-authorized exact final content.
 * @param proof - Runtime-only Hub final-admission proof.
 * @returns Durable inbox delivery.
 */
admitFinal(input: TeamHumanFinalInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxFinal>

/**
 * Persist a Hub-authorized ordinary delivery.
 * @param input - Exact Envelope and optional rendered view.
 * @param proof - Runtime-only Hub human-delivery proof.
 * @returns Durable inbox item.
 */
admitMessage(input: TeamHumanMessageInput, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage>

/**
 * Recover a receipt's existing sink.
 * @param input - Hub-validated owner and Envelope.
 * @param proof - Runtime-only Hub human-delivery proof.
 * @returns Exact admission, or undefined.
 */
getMessageAdmission(input: Pick<TeamHumanMessageInput, 'principalId' | 'teamId' | 'envelopeId'>, proof: TeamHumanSinkProof): Promise<TeamHumanInboxMessage | undefined>

/**
 * Register a live action continuation owner.
 * @param responder - Host-owned continuation resolver.
 * @returns Registration disposer.
 */
registerActionResponder(responder: TeamHumanActionResponder): () => void

/**
 * Answer one exact durable request.
 * @param call - Authenticated principal.
 * @param input - Actor-free answer and retry fence.
 * @returns Durable acceptance or unavailable result.
 */
respond(call: AuthenticatedProductCall, input: TeamHumanActionResponseInput): Promise<TeamHumanActionResponseResult>

/**
 * Read one bounded authorized page.
 * @param call - Current authenticated transport lease.
 * @param input - Actor-free pagination.
 * @returns Visible inbox page.
 */
read(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>

/**
 * Wait within the deployment timeout for a fresh page.
 * @param call - Revocable authenticated call.
 * @param input - Actor-free pagination.
 * @returns Visible page or an empty timeout result.
 */
watch(call: AuthenticatedProductCall, input: TeamHumanInboxReadInput): Promise<TeamHumanInboxPage>

/**
 * Persist a monotonic shared display position.
 * @param call - Current authenticated call.
 * @param input - Retained delivery selected by the client.
 * @returns Durable shared display cursor.
 */
acknowledge(call: AuthenticatedProductCall, input: TeamHumanInboxAcknowledgeInput): Promise<TeamHumanInboxAcknowledgement>
```

Types: [AuthenticatedProductCall](core.zh.md)

Source: [`packages/core/team/src/human-delivery-types.ts`](../../packages/core/team/src/human-delivery-types.ts)

<a id="ctxteamplacement--teamplacement"></a>

### `ctx.teamPlacement` — `TeamPlacement`

Activation owner for tasks whose participants have an explicit deployment route.

```ts cordis-catalog
/**
 * Prepare idle owners for currently ready tasks without assigning any lease.
 * @param teamId - Durable Team selected by the scheduler.
 * @param signal - First caller's cancellation, retained by all coalesced callers of that preparation.
 * @returns number of activations published by this pass.
 */
prepare(teamId: TeamId, signal?: AbortSignal): Promise<number>

/** Prepare declared workflow roles before channel admission or task publication.
 * @param teamId - Team whose active membership authorizes the roles.
 * @param roles - Unique roles already resolved by the workflow compiler.
 * @param signal - Cancellation of this compilation.
 * @returns resolution when every agent role has a resident activation; unavailable routes reject.
 */
async prepareRoles(teamId: TeamId, roles: readonly string[], signal?: AbortSignal): Promise<void>

/** Stop new preparation and cancel provider admission; failed releases remain available to a later close.
 * @returns Shared in-flight cleanup; rejects with collected failures until all owned leases settle.
 */
close(): Promise<void>
```

Source: [`packages/team/team-placement-default/src/index.ts`](../../packages/team/team-placement-default/src/index.ts)

<a id="ctxteamruns--teamrunservice"></a>

### `ctx.teamRuns` — `TeamRunService`

Owns the current local default Team topology, trusted human ingress, and explicit final-output receipt. Existing Team services retain authority for durable state, activation, Envelope admission, and Agent turns.

```ts cordis-catalog
/**
 * Resolve a named child template before the parent task reserves its durable child identity.
 * @param templateId - exact deployment template name; unavailable versions never fall back.
 * @param templateVersion - exact positive template revision selected by the parent task.
 * @returns detached JSON rules with execution configuration and an explicit coordinator model route; no workspace authority.
 */
describeChildTemplate(templateId: string, templateVersion: number): JsonObject

/**
 * Publish a reserved child Team's model residency and parent-service result endpoints.
 * The parent service owns invitation consent and the initial consult request.
 * @param request - opaque parent authorization and its exact child identity.
 * @returns durable endpoints, including an identical already-published binding on retry.
 */
async startChild(request: TeamRunChildRequest): Promise<TeamChildRunBinding>

/** Cancel a child under fresh parent authority before releasing its local execution leases.
 * @param request - exact cancellation authority and child identity.
 * @returns terminal state or explicit durable cleanup progress.
 */
async cancelChild(request: TeamRunChildRequest): Promise<TeamStateSnapshot>

/**
 * Create the default human/coordinator/worker-pool Team topology and publish
 * its local coordinator residency before any human input enters its channel.
 * @param request - objective, coordinator execution root, and optional activation cancellation.
 * @returns the durable topology and current local coordinator lease.
 */
async create(request: TeamRunCreateRequest): Promise<TeamRunHandle>

/**
 * Re-attach a durable default Team to a fresh local coordinator activation.
 * The persisted Session header and request context provide the exact identity
 * and model route; no new Team, Participant, channel, or Session is created.
 * @param request - Team identity and optional replacement coordinator choices.
 * @returns the re-owned durable topology and current coordinator lease.
 */
async resume(request: TeamRunResumeRequest): Promise<TeamRunHandle>

/**
 * Wait for durable Team quiescence without assuming a local coordinator owner.
 * @param teamId - Team identity to inspect.
 * @param signal - optional cancellation for the local wait.
 * @returns the latest quiescence diagnostics.
 */
async waitForQuiescence(teamId: TeamId, signal?: AbortSignal): Promise<TeamQuiescenceSnapshot>

/**
 * Create the default topology and admit its first human Envelope. Retries
 * with the same key return the same accepted result while this local owner lives.
 * @param request - topology inputs, first human content, and retry identity.
 * @returns the created topology plus its accepted first human Envelope.
 */
async start(request: TeamRunStartRequest): Promise<TeamRunStartResult>

/**
 * Append trusted human content only after the default topology and coordinator
 * residency have committed.
 * @param request - Team identity, human content, and requested delivery intent.
 * @returns the immutable channel Envelope accepted by the Team Hub.
 */
async postHumanInput(request: TeamRunHumanInputRequest): Promise<TeamEnvelope>

/**
 * Request one soft interrupt from this TeamRun's durable human participant
 * to its current local coordinator. A non-active Team has no interruptable
 * product run, so this returns `undefined` without touching the Hub.
 * @param teamId - current locally owned Team run selected by ACP.
 * @returns the committed interrupt, or `undefined` when the Team is no longer active.
 */
async requestCoordinatorInterrupt(teamId: TeamId): Promise<ParticipantInterruptSnapshot | undefined>

/**
 * Mint a capability for one exact local coordinator without exposing Team,
 * participant, activation, or Session identity to its consumer.
 * @param coordinator - current local coordinator Agent selected by a scoped consumer.
 * @returns an opaque capability accepted only while this exact coordinator remains current.
*/
coordinatorTaskAuthority(coordinator: Agent): TeamRunCoordinatorTaskAuthority

/**
 * Set the coordinator's desired local worker-pool size and reconcile durable
 * worker Participants. Requests above the deployment ceiling are clamped and
 * returned as saturated capacity so a coordinator can keep queueing work.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - requested worker count, including the default `worker` slot.
 * @returns bounded pool and queued-task status after reconciliation.
 */
async setWorkerPoolSize( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkerPoolSetRequest, ): Promise<TeamRunWorkerPoolStatus>

/**
 * Mint a capability for an exact local coordinator, or leave ordinary Agents outside the scoped Team-goal tools.
 * @param coordinator - candidate current local coordinator Agent selected by a scoped consumer.
 * @returns an opaque capability, or `undefined` when the Agent owns no current default Team run.
 */
tryCoordinatorGoalAuthority(coordinator: Agent): TeamRunCoordinatorGoalAuthority | undefined

/**
 * Read the durable objective visible to the exact current coordinator.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @returns the current detached Team objective.
 */
async readCoordinatorGoal(authority: TeamRunCoordinatorGoalAuthority): Promise<TeamGoalSnapshot>

/**
 * Compare-and-set the durable objective from an active coordinator turn carrying its trusted human input.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - observed revision and replacement objective.
 * @returns the committed detached Team objective.
 */
async updateCoordinatorGoal( authority: TeamRunCoordinatorGoalAuthority, request: TeamRunCoordinatorGoalUpdateRequest, ): Promise<TeamGoalSnapshot>

/**
 * Compare-and-set the durable objective phase from an exact coordinator activation.
 * @param authority - opaque capability for the current coordinator.
 * @param request - expected revision, next phase, and optional blocker.
 * @returns the committed durable objective.
 */
async transitionCoordinatorGoalPhase( authority: TeamRunCoordinatorGoalAuthority, request: TeamRunCoordinatorGoalPhaseRequest, ): Promise<TeamGoalSnapshot>

/**
 * Lazily activate the default worker and create one bounded scheduler-owned task.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - caller retry key and durable task fields.
 * @returns the accepted or replayed task's compact durable identity.
 */
async startDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskStartRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Admit one child-Team task under the current coordinator's narrowed authority.
 * @param authority - Opaque authority of this Team's current coordinator.
 * @param request - Durable objective, requested scopes and budget, and optional complete template identity.
 * @returns The accepted or replayed parent task; its Consumer owns child startup.
 */
async startDelegatedTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDelegatedTaskStartRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Wait for one task previously accepted through this coordinator authority.
 * @param authority - opaque capability minted for the exact current coordinator.
 * @param request - owned task identity and optional local wait cancellation.
 * @returns the task's terminal result or retained terminal attempt fact.
 * @throws TeamRunError when the Team stalls or a local reviewer stops without an accepted decision.
 */
async waitForDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskWaitRequest, ): Promise<TeamRunDefaultWorkerTaskTerminal>

/**
 * List compact task state owned by the exact current coordinator.
 * @param authority - opaque capability for the exact current coordinator.
 * @returns the current bounded list of non-workflow default-worker tasks.
 */
async listDefaultWorkerTasks(authority: TeamRunCoordinatorTaskAuthority): Promise<TeamRunDefaultWorkerTaskList>

/**
 * Set or clear an advisory owner proposal for one pending coordinator-owned task.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - owned task identity and optional preferred Participant.
 * @returns the task phase and retained scheduler hint after the CAS.
 */
async proposeDefaultWorkerTaskOwner( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskOwnerProposalRequest, ): Promise<TeamRunDefaultWorkerTaskOwnerProposal>

/**
 * Wait for a Team cursor advance, then return the bounded owned-task snapshot.
 * This observes unrelated Team changes too; the returned cursor lets the
 * coordinator establish the next no-gap watch.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - last observed cursor and local cancellation.
 * @returns the current cursor and compact owned-task state.
 */
async watchDefaultWorkerTasks( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskWatchRequest = {}, ): Promise<TeamRunDefaultWorkerTaskWatch>

/**
 * Request cancellation of one coordinator-owned task through the durable Team CAS.
 * @param authority - opaque capability for the exact current coordinator.
 * @param request - owned task identity.
 * @returns accepted stop progress, or an unchanged terminal task.
 */
async cancelDefaultWorkerTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunDefaultWorkerTaskCancelRequest, ): Promise<TeamRunDefaultWorkerTask>

/**
 * Validate and durably compile one declarative workflow plan. Compilation is
 * retry-safe: the plan, each task binding, and the workflow channel are all
 * recovered from Team records rather than inferred from model code.
 * @param authority - opaque capability minted for the exact coordinator.
 * @param request - complete plan, retry identity, and optional local cancellation.
 * @returns the ready or already-terminal durable workflow plan.
 */
async startWorkflowPlan( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowPlanStartRequest, ): Promise<TeamWorkflowPlanSnapshot>

/**
 * Cancel one exact task binding owned by the current coordinator's workflow.
 * @param authority - current coordinator capability.
 * @param request - plan/template selection and optional cancellation reason.
 * @returns task stop progress; independent workflow tasks remain available.
 */
async cancelWorkflowTask( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowTaskCancelRequest, ): Promise<TeamRunWorkflowTaskCancelResult>

/**
 * Wait for all bound tasks to settle and read the Hub-owned terminal result.
 * @param authority - opaque capability minted for the exact coordinator.
 * @param request - owned workflow plan identity and local wait cancellation.
 * @returns the durable workflow terminal phase and projected task results.
 */
async waitForWorkflowPlan( authority: TeamRunCoordinatorTaskAuthority, request: TeamRunWorkflowPlanWaitRequest, ): Promise<TeamRunWorkflowPlanTerminal>

/**
 * Await and receipt the coordinator's explicit final Envelope, then settle
 * the narrow default topology from active through quiescing to completed.
 * @param request - Team identity, last observed channel cursor, and local wait cancellation.
 * @returns the exact human-addressed final value retained in the channel WAL.
 */
async waitForFinal(request: TeamRunFinalWaitRequest): Promise<TeamRunFinal>

/**
 * Cancel a current local Team run after the Hub has durably closed admission.
 * @param teamId - Team selected from the current local product run map.
 * @param humanOwner - optional authenticated product owner that must match the run's durable human.
 * @returns resolution after Team terminal state and local coordinator lease settle.
 */
async cancel( teamId: TeamId, humanOwner?: Extract<TeamParticipantOwner, { readonly kind: 'product-principal' }>, ): Promise<void>

/**
 * Archive one terminal Team only when this service retained the local owner
 * after settling that Team. The opaque proof is minted for this single Hub
 * call and cannot be reconstructed from a Team id or terminal snapshot.
 * @param request - terminal Team identity and observed Team-journal cursor.
 * @returns the Team state with its durable archive marker.
 */
async archiveTerminal(request: TeamArchiveInput): Promise<TeamStateSnapshot>

/** Release current local coordinator leases without mutating durable Team phase on plugin disposal. */
close(): Promise<void>
```

Types: [Agent](core.zh.md)

Source: [`packages/team/team-run/src/index.ts`](../../packages/team/team-run/src/index.ts)

<a id="ctxteams--teamruntime-abstract-seam"></a>

### `ctx.teams` — `TeamRuntime` (abstract seam)

Team Service Definition (`ctx.teams`). A provider supplies Team operations; this base class owns adapter/policy registration and post-commit observer dispatch without depending on an Agent, Session, Hub, storage medium, or transport.

```ts cordis-catalog
/** Validate provider ownership before calling any capability method supplied by a caller.
 * @param token - child operation capability returned by this exact provider.
 * @returns current immutable scope after asynchronous parent and workspace validation.
 */
async assertChildRunAuthorization(token: TeamChildRunAuthorization): Promise<TeamChildRunScope>

/** Register the owner of parent delegation operations and live shared-root resolution.
 * @param source - exact runtime proof resolver retained by the delegation Consumer.
 * @returns effect-owned registration disposer.
 */
registerSystemDelegationProofSource(source: TeamSystemDelegationProofSource): () => void

/**
 * Publish exact service/coordinator endpoints for a reserved child Team.
 * @param _request - live parent authorization, observed child cursor and complete endpoint binding.
 * @returns the durable immutable binding; an identical retry returns its original value.
 */
bindChildRun(_request: import('./types.ts').TeamChildRunBindRequest): Promise<import('./types.ts').TeamChildRunBinding>

/** Register a child runtime or parent saga result owner.
 * @param source - Owner retaining its own nonserializable proofs.
 * @returns Effect disposer that invalidates this source.
 */
registerSystemChildResultProofSource(source: TeamSystemChildResultProofSource): () => void | Promise<void>

/** Accept a child response into the parent task without settling the parent.
 * @param _request - Exact parent task fence and delegation-owned response selection.
 * @returns Durable parent result admission.
 */
admitTaskDelegationResult(_request: TeamTaskDelegationResultAdmitRequest): Promise<TeamDelegationResultAdmission>

/** Admit and receipt an already parent-accepted result, then begin child completion.
 * @param _request - Exact child-result proof and child cursor.
 * @returns Current child state; completed is possible only after resource quiescence.
 */
completeChildTeam(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot>

/** Record child cancellation before releasing runtime resources, including partial bootstrap.
 * @param _request - Provider-owned parent cancellation capability and exact child input.
 * @returns Durable cancellation-admitted child state.
 */
cancelChildTeam(_request: TeamChildCancelRequest): Promise<TeamStateSnapshot>

/** Record an actual coordinator turn ending without its bound service response.
 * @param _request - Live child runtime observation proof and current child cursor.
 * @returns Unchanged state when a response exists, otherwise a durable missing-result stall.
 */
recordChildResultMissing(_request: TeamChildResultCommandRequest): Promise<TeamStateSnapshot>

/**
 * Open one trusted issuer for activation-bound runtime proofs. The issuer
 * validates and freezes each durable binding; its closure prevents later
 * issuance but does not revoke leases it already returned.
 * @returns an issuer whose leases may be revoked independently.
 */
openActivationActorProofIssuer(): ActivationActorProofIssuer

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * activation lifecycle mutations. Registration is effect-scoped: disposing
 * the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemActivationProofSource(source: TeamSystemActivationProofSource): () => void

/**
 * Register one Host owner that privately resolves opaque proofs for exact
 * approval or question action mutations. Registration is effect-scoped:
 * disposing the contributing fiber immediately makes all proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemHumanActionProofSource(source: TeamSystemHumanActionProofSource): () => void

/**
 * Register one authenticated-human binder that privately resolves opaque
 * proofs for exact product Team mutations. Registration is effect-scoped:
 * disposal immediately invalidates every outstanding proof from this source.
 * @param source - named resolver that owns human proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerHumanActorProofSource(source: TeamHumanActorProofSource): () => void

/**
 * Register a named endpoint or expiry owner and revoke its proofs with its effect lifetime.
 * @param source - owner retaining exact runtime operation scopes.
 * @returns an HMR-safe disposer for this registration.
 */
registerSystemChannelAdmissionProofSource(source: TeamSystemChannelAdmissionProofSource): () => void

/**
 * Register one scheduler owner that privately resolves opaque proofs for
 * exact task assignment and elapsed lease expiry. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by that source.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskLeaseProofSource(source: TeamSystemTaskLeaseProofSource): () => void

/**
 * Register one workflow compiler owner that privately resolves opaque proofs
 * for exact workflow channel openings, bindings, phase transitions, and
 * orphan-channel cleanup. Registration is effect-scoped: disposing the
 * contributing fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemWorkflowProofSource(source: TeamSystemWorkflowProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * default-worker owner proposals and current-coordinator cancellations.
 * Registration is effect-scoped: disposing the contributing fiber
 * immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskControlProofSource(source: TeamSystemTaskControlProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact root
 * Team creation. Registration is effect-scoped: disposing the contributing
 * fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemRootCreationProofSource(source: TeamSystemRootCreationProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact child
 * Team creation. No shipped product composition registers this source until
 * parent-task delegation has an owning consumer.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChildCreationProofSource(source: TeamSystemChildCreationProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact durable
 * channel summary appends. No shipped product composition registers this
 * source until a summarization consumer owns the operation.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChannelSummaryProofSource(source: TeamSystemChannelSummaryProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact generic
 * channel openings and closures. Shipped product compositions register no
 * generic lifecycle source until an owning consumer needs this route.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemChannelLifecycleProofSource(source: TeamSystemChannelLifecycleProofSource): () => void

/**
 * Register one owner that privately resolves opaque proofs for exact
 * workspace allocation bindings and cleanup transitions.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemWorkspaceAllocationProofSource(source: TeamSystemWorkspaceAllocationProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * terminal Team archive. Registration is effect-scoped: disposing the
 * contributing fiber immediately invalidates every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemArchiveProofSource(source: TeamSystemArchiveProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * bootstrap, worker, and reviewer topology mutations. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTopologyProofSource(source: TeamSystemTopologyProofSource): () => void

/**
 * Register one scheduler owner that privately resolves opaque proofs for exact
 * review and task-assignment channel lifecycle mutations. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemSchedulerChannelProofSource(source: TeamSystemSchedulerChannelProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * post-release cleanup after a durable cancellation intent. Registration is
 * effect-scoped: disposing the contributing fiber immediately invalidates
 * every proof retained by it.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemCancellationCleanupProofSource(source: TeamSystemCancellationCleanupProofSource): () => void

/**
 * Register one TeamRun owner that privately resolves opaque proofs for exact
 * post-release channel cleanup after a durable human-receipted final result.
 * Registration is effect-scoped: disposal immediately invalidates every proof.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemFinalizationCleanupProofSource(source: TeamSystemFinalizationCleanupProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * coordinator-final human receipts. Registration is effect-scoped: disposing
 * the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemFinalReceiptProofSource(source: TeamSystemFinalReceiptProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * ordinary Envelope admissions. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemEnvelopePostProofSource(source: TeamSystemEnvelopePostProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * durable task-review recovery. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemTaskReviewProofSource(source: TeamSystemTaskReviewProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * Team closure commands. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemClosureProofSource(source: TeamSystemClosureProofSource): () => void

/**
 * Register one closure driver that privately resolves opaque proofs for
 * exact already-durable lifecycle continuation passes.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemClosureDriverProofSource(source: TeamSystemClosureDriverProofSource): () => void

/**
 * Resolve one current closure-driver proof. A source owns the opaque token
 * in private memory; this runtime validates and freezes its durable scope
 * before a provider continues lifecycle settlement.
 * @param proof - runtime-only proof supplied by a registered closure driver.
 * @returns immutable source attribution and the exact durable recovery scope.
 * @throws {@link TeamError} with `TEAM_ACTOR_PROOF_INVALID` when no live source owns the proof or its scope is invalid.
 */
requireSystemClosureDriverProof( proof: TeamSystemClosureDriverProof, ): TeamSystemClosureDriverProofResolution

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * Team phase transitions. Registration is effect-scoped: disposing the
 * contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemPhaseProofSource(source: TeamSystemPhaseProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * destructive Team-maintenance operations. Registration is effect-scoped:
 * disposing the contributing fiber immediately makes all of its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemMaintenanceProofSource(source: TeamSystemMaintenanceProofSource): () => void

/**
 * Register one system owner that privately resolves opaque proofs for exact
 * TeamRun human-to-coordinator soft-interrupt requests. Registration is
 * effect-scoped: disposing the contributing fiber immediately makes all of
 * its proofs invalid.
 * @param source - named resolver that owns proof construction and lifetime.
 * @returns an HMR-safe disposer that removes exactly this source.
 * @throws {@link TeamError} when the source name is invalid or already registered.
 */
registerSystemInterruptProofSource(source: TeamSystemInterruptProofSource): () => void

/**
 * Create one Team, mint its identity, and commit its initial durable state.
 * A nested request names both its parent Team and the parent task; a provider
 * resolves its separate runtime proof and persists the resulting depth under
 * its deployment policy.
 * @param request - JSON-only Team payload plus root or child runtime authority.
 * @returns the detached state committed for the new Team.
 */
abstract createTeam(request: TeamCreateRequest): Promise<TeamStateSnapshot>

/**
 * Read the complete detached state of one Team.
 * @param request - Team identity to read.
 * @returns the current Team state and its journal cursor.
 */
abstract getTeam(request: TeamGetRequest): Promise<TeamStateSnapshot>

/** Read one current human action without copying the Team projection.
 * @param request - Exact Team and action identity.
 * @returns the bounded action snapshot; unsupported providers reject.
 */
getHumanAction(request: TeamHumanActionReadRequest): Promise<TeamHumanActionSnapshot>

/** Read initial Team identity, bounded display text, counts and exact coordinator binding without history arrays.
 * @param request - Team selected for read-only inspection.
 * @returns the lightweight selection projection; no activation is created or resumed.
 */
abstract getTeamSelection(request: TeamSelectionRequest): Promise<TeamSelectionSnapshot>

/** Read bounded display summaries without materializing task/plan execution history.
 * @param request - Team, collection, provider-order cursor and requested row limit.
 * @returns a byte- and row-limited page, with actual scan work and optional continuation.
 */
abstract browse(request: TeamBrowseRequest): Promise<TeamBrowsePage>

/** Read current task fields or one bounded attempt/review history page, without private artifact references.
 * @param request - Exact Team/task, section, optional revision fence and history continuation.
 * @returns detached data capped by the provider's response budget; indivisible oversized records reject.
 */
abstract inspectTask(request: TeamTaskInspectRequest): Promise<TeamTaskInspection>

/** Resolve the latest published Session of one retained Team member without starting an Agent.
 * @param request - exact owning Team and member.
 * @returns published binding, including offline history; missing members or bindings reject.
 */
abstract getMemberSession(request: TeamMemberSessionRequest): Promise<TeamMemberSessionSnapshot>

/** Read non-secret member metadata and one capability page without activating an Agent.
 * @param request - Team/member identity and optional cursor-pinned capability continuation.
 * @returns bounded detail; a changed Team cursor rejects continuation until refreshed.
 */
abstract inspectMember(request: TeamMemberInspectRequest): Promise<TeamMemberInspection>

/**
 * Retain one host-mediated approval/question in the Team journal. Providers
 * that do not offer durable interaction records fail explicitly so callers
 * cannot mistake a transient mux frame for Team truth.
 * The Host source derives the pending action, policy actor, and timestamps;
 * callers provide only runtime proof and JSON routing fields.
 * @param request - Host runtime authority, Team identity, and observed cursor.
 * @returns the accepted or idempotently replayed interaction snapshot.
 */
upsertHumanAction(request: TeamHumanActionUpsertRequest): Promise<TeamHumanActionSnapshot>

/**
 * Settle one durable Team human action through its cursor fence.
 * The Host source derives the action identity, terminal outcome, and policy
 * actor; callers provide only runtime proof and JSON routing fields.
 * @param request - Host runtime authority, Team identity, and observed cursor.
 * @returns the settled interaction snapshot.
 */
resolveHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/**
 * Record one activation-authorized provider usage sample for Team-subtree
 * budget accounting. Providers derive Team, Participant, and Session from
 * the runtime proof; a child Team's sample is charged to each parent before
 * more child work proceeds. Unsupported providers fail explicitly instead
 * of silently presenting process-local estimates.
 * @param request - runtime activation authority plus JSON-only cursor and
 * provider/model usage facts; callers do not select durable Team,
 * participant, Session, or observed-time provenance because the Hub derives them.
 * @returns the durable aggregate after accepting or replaying the sample.
 */
recordUsage(request: TeamUsageRecordRequest): Promise<TeamUsageSnapshot>

/**
 * Inspect durable Team state for a completion-policy-safe quiescence result.
 * This read never mutates state and intentionally reports blocked tasks,
 * resident activations, and open channels instead of treating incomplete
 * work as completed.
 * @param teamId - Team identity to inspect.
 * @returns detached quiescence diagnostics derived from current Team state.
 */
async inspectQuiescence(teamId: TeamId): Promise<TeamQuiescenceSnapshot>

/**
 * List a bounded page of visible Team summaries for product and transport consumers.
 * @param request - opaque discovery position or -1, plus a physical scan-work limit.
 * @returns detached summaries, scanned work and an optional continuation, including for empty pages.
 */
abstract listTeamsPage(request: TeamListPageRequest): Promise<TeamListPage>

/**
 * Archive one terminal Team without deleting its journals or descendants.
 * @param request - JSON-only Team/cursor fields plus a current runtime archive proof.
 * @returns the complete detached state after archival.
 */
abstract archiveTeam(request: TeamArchiveRequest): Promise<TeamStateSnapshot>

/**
 * Authorize one authenticated human to recover local ownership of an active or stalled Team.
 * @param request - Team cursor fence and runtime-only authenticated-human proof.
 * @returns an opaque authorization that must remain live through coordinator recovery.
 */
authorizeHumanResume(request: TeamHumanResumeRequest): Promise<TeamHumanResumeAuthorization>

/**
 * Read a bounded provider-owned audit projection for the Team journal or one attached channel WAL.
 * @param request - selected Team/source, cursor, and page limit.
 * @returns source records projected without changing authoritative state.
 */
abstract readAudit(request: TeamAuditReadRequest): Promise<TeamAuditReadResult>

/**
 * Wait until a Team journal moves beyond a caller-observed cursor, closes, or
 * the caller aborts its local wait. Providers omit `request.signal` before
 * parsing the JSON-only request fields; cancellation changes no durable data.
 * @param request - Team identity, last observed journal cursor, and optional local cancellation.
 * @returns an advanced cursor, or closed at an immutable archived tail or provider shutdown.
 * @throws when `request.signal` aborts before the watch resolves.
 */
abstract watchTeam(request: TeamWatchRequest): Promise<TeamWatchResult>

/**
 * Compare-and-set one Team lifecycle transition.
 * @param request - Team identity, observed cursor, and next lifecycle phase.
 * @returns the complete detached state after the committed transition.
 */
abstract transitionTeamPhase(request: TeamPhaseTransitionRequest): Promise<TeamStateSnapshot>

/**
 * Validate a Consumer call against its live provider-owned sink capability.
 * @param proof - Runtime-only capability supplied by the Hub command.
 * @param scope - Complete operation and exact data selected for this storage call.
 */
validateHumanSinkProof(proof: TeamHumanSinkProof, scope: TeamHumanSinkScope): void

/**
 * Register an exact ordinary-human-delivery proof owner.
 * @param source - Consumer that retains proof construction and lifetime.
 * @returns Effect disposer that immediately revokes the source.
 */
registerSystemHumanDeliveryProofSource(source: TeamSystemHumanDeliveryProofSource): () => void | Promise<void>

/**
 * Persist one ordinary human delivery and then its receipt under exact source authority.
 * @param request - Current source proof and observed pending-delivery selection.
 * @returns Durable inbox item and recipient receipt.
 */
admitHumanChannelDelivery(request: TeamHumanChannelDeliveryRequest): Promise<TeamHumanChannelDeliveryResult>

/** Accept a live Host-owned answer before invoking its callback.
 * @param request - Exact source proof and Team cursor.
 * @returns Durable action with response acceptance.
 */
acceptHumanActionResponse(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/** Cancel an unrecoverable action and stall its Team without inventing a callback.
 * @param request - Failure-only Host proof.
 * @returns Explicit unavailable action.
 */
unavailableHumanAction(request: TeamHumanActionResolveRequest): Promise<TeamHumanActionSnapshot>

/**
 * Persist final acceptance through the closed TeamRun result owner.
 * @param request - exact WAL content selection and current source-owned proof.
 * @returns the flushed admission, or its original value for an identical retry.
 */
admitTeamFinalResult(request: TeamFinalAdmissionRequest): Promise<TeamFinalAdmission>

/**
 * Accept an authenticated completion intent; receipt repair requires separate durable final admission.
 * @param request - exact authorized closure selection.
 * @returns the durable completion intent state.
 */
completeTeam(request: TeamCompleteRequest): Promise<TeamStateSnapshot>

/**
 * Accept one Team failure intent through the provider's failure policy.
 * @param request - authenticated structured failure command.
 * @returns the durable quiescing state; a closure driver commits terminal failure after owned work settles.
 */
failTeam(request: TeamFailRequest): Promise<TeamStateSnapshot>

/**
 * Cancel one Team through the provider's admission and quiescence policy.
 * @param request - authenticated structured cancellation command.
 * @returns the terminal Team state, or the durable quiescing/stalled state
 *   while an owned resource still needs to settle.
 */
cancelTeam(request: TeamCancelRequest): Promise<TeamStateSnapshot>

/**
 * Continue one source-owned Team lifecycle observation or already durable
 * closure/cancellation through a runtime-only recovery proof.
 * @param request - cursor-fenced durable Team selection plus recovery proof.
 * @returns the current Team state after one provider-owned recovery pass.
 */
continueTeamClosure(request: TeamClosureContinuationRequest): Promise<TeamStateSnapshot>

/**
 * Compare-and-set a Team objective's text and/or goal-specific resource limits through one exact activation or authenticated-human proof.
 * @param request - runtime authority, Team identity, observed goal revision, and at least one replacement field.
 * @returns the complete detached state after the committed objective update.
 */
abstract updateTeamGoal(request: TeamGoalUpdateRequest): Promise<TeamStateSnapshot>

/**
 * Compare-and-set a Team objective lifecycle transition through one exact activation or authenticated-human proof.
 * @param request - runtime authority, Team identity, observed goal revision, next objective phase, and optional blocker.
 * @returns the complete detached state after the committed objective transition.
 */
abstract transitionTeamGoalPhase(request: TeamGoalPhaseTransitionRequest): Promise<TeamStateSnapshot>

/**
 * Invite one participant, mint its identity, and commit its initial phase.
 * @param request - topology or authenticated-human proof plus Team identity, observed cursor, and participant descriptor.
 * @returns the detached participant projection after invitation.
 */
abstract inviteParticipant(request: ParticipantInviteRequest): Promise<ParticipantSnapshot>

/**
 * List a bounded page of detached participant projections for one Team.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns participant projections and an optional continuation cursor.
 */
abstract listParticipantsPage(request: TeamMemberListPageRequest): Promise<TeamMemberListPage>

/**
 * Compare-and-set one participant-membership lifecycle transition.
 * @param request - topology or authenticated-human proof plus Team/participant identities, observed cursor, and next phase.
 * @returns the detached participant projection after the transition.
 */
abstract transitionParticipantPhase(request: ParticipantPhaseTransitionRequest): Promise<ParticipantSnapshot>

/**
 * Persist a published activation's immutable Session and provider binding.
 * @param request - source-owned runtime proof, observed Team cursor, and published activation binding.
 * @returns the detached durable binding after acceptance.
 */
abstract bindActivation(request: ActivationBindRequest): Promise<ActivationBindingSnapshot>

/** Reserve capacity before invoking an activation provider.
 * @param request - Exact controller-owned startup identity and cursor.
 * @returns the durable startup reservation.
 */
abstract reserveActivation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>

/** Release an unpublished startup only after its controller proves cleanup.
 * @param request - Exact reservation, owner and current cursor.
 * @returns the reservation carrying its durable release time.
 */
abstract releaseActivationReservation(request: ActivationReservationRequest): Promise<ActivationReservationSnapshot>

/**
 * Persist one permitted residency-status transition for a bound activation.
 * @param request - source-owned runtime proof, Team/activation identity, observed cursor, and next status.
 * @returns the detached binding after its durable status update.
 */
abstract updateActivationStatus(request: ActivationStatusUpdateRequest): Promise<ActivationBindingSnapshot>

/**
 * Atomically release task leases held by one externally fenced activation,
 * record its offline fence proof, and retire any recorded wake channels.
 * Callers must prove process termination before invoking this trusted recovery operation.
 * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
 * @returns the complete detached Team state after lease release and offline transition.
 */
abstract fenceActivation(request: ActivationFenceRequest): Promise<TeamStateSnapshot>

/**
 * Release task leases held by one locally settled activation and persist its
 * quiescence proof before another epoch can use the same Session.
 * @param request - source-owned runtime proof, exact activation relation, and current Team cursor.
 * @returns the complete detached Team state after quiescence settles.
 */
abstract quiesceActivation(request: ActivationQuiesceRequest): Promise<TeamStateSnapshot>

/**
 * Read one durable activation binding.
 * @param request - Team and activation identities.
 * @returns the current durable binding.
 */
abstract getActivation(request: ActivationGetRequest): Promise<ActivationBindingSnapshot>

/**
 * Resolve the current TeamRun human/coordinator topology from one
 * source-owned proof and commit its soft interrupt request. A matching
 * unacknowledged target returns its existing durable request without another append.
 * @param request - runtime TeamRun authority, Team identity, and observed cursor.
 * @returns the durable request bound to the resolved activation, Session, and provider.
 */
abstract requestParticipantInterrupt(request: ParticipantInterruptRequest): Promise<ParticipantInterruptSnapshot>

/**
 * List unacknowledged soft interrupts for one exact current activation proof.
 * @param request - runtime target authority without caller-selected binding identities.
 * @returns detached pending interrupts in durable request order.
 */
abstract listPendingParticipantInterrupts( request: ParticipantInterruptListPendingRequest, ): Promise<readonly ParticipantInterruptSnapshot[]>

/**
 * Acknowledge one soft interrupt from the exact current activation it targets.
 * Repeating an acknowledgement returns the original durable acknowledgement.
 * @param request - runtime target authority and selected interrupt identity.
 * @returns the acknowledged durable interrupt.
 */
abstract acknowledgeParticipantInterrupt( request: ParticipantInterruptAcknowledgeRequest, ): Promise<ParticipantInterruptSnapshot>

/**
 * Create one Team task, mint its identity, and commit its initial phase. The runtime proof derives either an
 * activation creator or an authenticated human creator; the provider replays its original task before cursor
 * comparison. A conflicting command reuse rejects.
 * @param request - Team identity, observed cursor, complete task fields, retry command, and runtime proof.
 * @returns the detached task projection after creation or matching command replay.
 */
abstract createTask(request: TeamTaskCreateRequest): Promise<TeamTaskSnapshot>

/**
 * Compare-and-set an advisory preferred owner for one pending task. The
 * proposal is a scheduler hint only; it does not grant task or Participant
 * authority and a provider may select another eligible owner.
 * @param request - Team/task identity, observed task revision, and optional preferred Participant.
 * @returns the detached task projection after the proposal change.
 */
proposeTaskOwner(request: TeamTaskOwnerProposalRequest): Promise<TeamTaskSnapshot>

/**
 * Admit one complete JSON workflow plan before any compiled task or channel
 * record is created. Providers retain the plan in `compiling` so recovery can
 * resume the compiler from durable bindings.
 * @param request - Team cursor, retry identity, complete workflow plan, and current coordinator proof.
 * @returns the accepted or idempotently replayed workflow plan.
 */
admitWorkflowPlan(request: TeamWorkflowPlanAdmissionRequest): Promise<TeamWorkflowPlanSnapshot>

/** Read current workflow metadata and one task/dependency window.
 * @param request - Exact workflow, optional revision and page selection.
 * @returns a bounded inspection without complete plan or result bodies.
 */
inspectWorkflowPlan(request: TeamWorkflowInspectRequest): Promise<TeamWorkflowInspection>

/**
 * Read one durable workflow plan and its compiled task/channel bindings.
 * @param request - owning Team and workflow plan identities.
 * @returns the current detached workflow plan projection.
 */
getWorkflowPlan(request: TeamWorkflowPlanGetRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * List a bounded page of workflow plans in durable admission order.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns detached workflow plan projections and an optional continuation cursor.
 */
listWorkflowPlansPage(request: TeamWorkflowPlanListPageRequest): Promise<TeamWorkflowPlanListPage>

/**
 * Bind one durable Team task to its plan-local template.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and task binding.
 * @returns the updated detached workflow plan projection.
 */
bindWorkflowPlanTask(request: TeamWorkflowPlanTaskBindRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Bind one durable workflow channel to its plan.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and channel identity.
 * @returns the updated detached workflow plan projection.
 */
bindWorkflowPlanChannel(request: TeamWorkflowPlanChannelBindRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Advance a workflow plan to `ready` or retain one terminal result/failure.
 * @param request - TeamRun workflow proof plus JSON-only Team/plan cursor fences and next durable phase.
 * @returns the updated detached workflow plan projection.
 */
transitionWorkflowPlan(request: TeamWorkflowPlanPhaseRequest): Promise<TeamWorkflowPlanSnapshot>

/**
 * Read one detached Team task projection, including a deleted tombstone.
 * @param request - Team and task identities to read.
 * @returns the current task projection.
 */
abstract getTask(request: TeamTaskGetRequest): Promise<TeamTaskSnapshot>

/** Reserve one child identity and complete creation payload under parent-task CAS.
 * @param request - exact source-owned reservation and resolved child template.
 * @returns the running parent task retaining its child reservation.
 */
abstract beginTaskDelegation(request: TeamTaskDelegationBeginRequest): Promise<TeamTaskSnapshot>

/** Bind a published child runtime to its existing parent reservation.
 * @param request - current task/delegation/child identities and revision.
 * @returns the active parent delegation projection.
 */
abstract bindTaskDelegation(request: TeamTaskDelegationBindRequest): Promise<TeamTaskSnapshot>

/** Settle a child task only after terminal child execution and parent charging.
 * @param request - exact child reservation and current parent task revision.
 * @returns the terminal parent task retaining child result and failure provenance.
 */
abstract settleTaskDelegation(request: TeamTaskDelegationSettleRequest): Promise<TeamTaskSnapshot>

/** Retain a child operational stall without releasing its concurrency or scopes.
 * @param request - current parent task and exact stall reason.
 * @returns the stalled delegation projection.
 */
abstract stallTaskDelegation(request: TeamTaskDelegationStallRequest): Promise<TeamTaskSnapshot>

/** Authorize one child startup or cancellation with live parent and workspace checks.
 * @param request - source-owned exact operation and parent revision.
 * @returns a provider-owned runtime capability whose caller must close after settlement.
 */
abstract authorizeChildRun(request: TeamChildRunAuthorizeRequest): Promise<TeamChildRunAuthorization>

/**
 * List a bounded page of current detached task projections for one Team.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns detached task projections and an optional continuation cursor.
 */
abstract listTasksPage(request: TeamTaskListPageRequest): Promise<TeamTaskListPage>

/** Resolve one visible, unambiguous Team artifact reference.
 * @param request - Team identity and artifact id selected by the caller.
 * @returns the visible reference, or `undefined` for missing, private, or ambiguous identities.
 */
getArtifact(request: TeamArtifactGetRequest): Promise<TeamArtifactReference | undefined>

/** List a bounded page of visible, unambiguous Team artifact references.
 * @param request - Team identity, provider-order cursor, and page limit.
 * @returns visible artifact references and an optional continuation cursor.
 */
listArtifactsPage(request: TeamArtifactListPageRequest): Promise<TeamArtifactListPage>

/**
 * Compare-and-set a lease-free task details edit without changing phase, scheduler facts, or attempts.
 * @param request - current coordinator proof plus JSON-only task detail fields.
 * @returns the detached task projection after the committed details edit.
 */
abstract updateTaskDetails(request: TeamTaskDetailsUpdateRequest): Promise<TeamTaskSnapshot>

/**
 * Persist a single-task cancellation while exact live work retains ownership.
 * @param request - Team/task identities and the observed task revision.
 * @returns accepted stop progress or the settled task after owner cleanup.
 */
abstract cancelTask(request: TeamTaskCancelRequest): Promise<TeamTaskSnapshot>

/**
 * Continue an accepted lease-free cancellation after interrupted channel cleanup.
 * @param request - scheduler proof and the exact retained cancellation revision.
 * @returns the task after its corresponding review channel closes.
 */
abstract reconcileTaskCancellation(request: TeamTaskCancellationReconcileRequest): Promise<TeamTaskSnapshot>

/**
 * Cancel one exact pending task only while a durable TeamRun cancellation
 * intent still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic task-cancellation authority.
 * @param request - TeamRun cancellation-cleanup proof plus Team/task/cancellation cursor fences.
 * @returns the detached cancelled task projection.
 */
cancelTeamCancellationTask(request: TeamCancellationTaskCancelRequest): Promise<TeamTaskSnapshot>

/**
 * Replace a lease-free non-review task with its deleted tombstone after provider DAG and policy checks.
 * @param request - current coordinator proof plus JSON-only task tombstone fields.
 * @returns the detached deleted task projection after the committed tombstone.
 */
abstract deleteTask(request: TeamTaskDeleteRequest): Promise<TeamTaskSnapshot>

/**
 * Resolve a lease-free review task through task-mutate policy for the reviewer
 * derived from its current activation proof.
 * @param request - runtime reviewer proof plus JSON-only task/revision/decision fields.
 * @returns the detached task projection after the committed review resolution.
 */
abstract resolveTaskReview(request: TeamTaskReviewResolveRequest): Promise<TeamTaskSnapshot>

/**
 * Recover one task review from the exact durable consult response selected by
 * a registered system source. The source scope, rather than caller fields,
 * identifies the Team, reviewer, request, response, decision, and reason.
 * @param request - runtime-only system recovery proof.
 * @returns the detached task projection after the recovered review decision.
 */
abstract resolveTaskReviewFromResponse(request: TeamTaskReviewRecoverRequest): Promise<TeamTaskSnapshot>

/**
 * Assign a pending task, mint its next non-reusable attempt id, and commit its bounded lease.
 * The scheduler source selects the exact task, participant, optional activation,
 * wake channel, and lease duration through runtime-only authority.
 * @param request - scheduler proof plus JSON-only assignment identifiers and bounds.
 * @returns the detached assigned task projection with its current lease.
 */
abstract assignTask(request: TeamTaskAssignRequest): Promise<TeamTaskSnapshot>

/**
 * Start the exact current attempt after checking its revision, id, participant, and optional activation epoch.
 * @param request - current activation proof plus JSON-only task attempt fence.
 * @returns the detached running task projection with its current lease.
 */
abstract startTaskAttempt(request: TeamTaskAttemptStartRequest): Promise<TeamTaskSnapshot>

/**
 * Claim and start the exact assigned attempt after its durable assignment
 * Envelope reaches the activation bound to the request's runtime-only actor
 * proof. Providers derive the Team, Participant, activation, and Session
 * from that proof. Repeating the same current claim after it starts returns
 * the running task without another durable transition.
 * @param request - Runtime actor proof, lease identity, assignment revision, assignment channel, and accepted Envelope.
 * @returns the detached running task projection for the current attempt.
 */
abstract claimTaskAttemptStart(request: TeamTaskAttemptStartClaimRequest): Promise<TeamTaskSnapshot>

/**
 * Renew the exact current attempt for its fixed lease duration after resolving its runtime-only actor proof.
 * Providers derive the Team, Participant, activation, and Session from that proof before renewing the lease.
 * @param request - Runtime actor proof, task-attempt identity, and observed revision.
 * @returns the detached task projection with its renewed current lease.
 */
abstract heartbeatTaskAttempt(request: TeamTaskAttemptHeartbeatRequest): Promise<TeamTaskSnapshot>

/**
 * Settle the exact current attempt once, retaining its closed outcome and removing its lease.
 * The provider maps completed to direct completion or review from the frozen route, cancelled to cancelled,
 * and released or failed to pending until maxAttempts, then failed.
 * Providers resolve the runtime-only actor proof and derive the Team, Participant, activation, and Session
 * before mapping the closed outcome.
 * @param request - Runtime actor proof, task-attempt identity, observed revision, and closed outcome.
 * @returns the detached task projection with the settled attempt in its bounded history.
 */
abstract settleTaskAttempt(request: TeamTaskAttemptSettleRequest): Promise<TeamTaskSnapshot>

/**
 * Expire an elapsed current lease once, retaining a lease-expired outcome before retry or failure.
 * The provider returns the task to pending until maxAttempts, then fails it.
 * @param request - scheduler proof plus JSON-only task-attempt fence.
 * @returns the detached task projection with the expired attempt in its bounded history.
 */
abstract expireTaskAttempt(request: TeamTaskAttemptExpireRequest): Promise<TeamTaskSnapshot>

/**
 * Commit a provider-owned bounded workspace observation against its exact allocation and prior scan.
 * @param request - Live provider proof and complete scan facts with allocation revision and prior observation CAS.
 * @returns The durable observation with derived task/attempt identity and scope classifications.
 */
abstract recordWorkspaceObservation(request: TeamWorkspaceObservationRequest): Promise<TeamWorkspaceObservation>

/**
 * Reserve one provider allocation before its filesystem root is materialized.
 * @param request - source-owned allocation reservation scope.
 * @returns the durable allocation snapshot after reservation.
 */
abstract reserveWorkspaceAllocation(request: TeamWorkspaceAllocationReserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Mark one reserved or preserved allocation active after provider materialization or restore.
 * @param request - source-owned allocation activation scope.
 * @returns the durable allocation snapshot after activation.
 */
abstract activateWorkspaceAllocation(request: TeamWorkspaceAllocationActivateRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Persist release intent before the provider starts physical cleanup.
 * @param request - source-owned allocation release-intent scope.
 * @returns the durable allocation snapshot after release intent.
 */
abstract requestWorkspaceAllocationRelease(request: TeamWorkspaceAllocationReleaseRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Preserve one source-owned provider allocation that cannot yet be released.
 * @param request - source-owned allocation preservation scope.
 * @returns the durable allocation snapshot after preservation.
 */
abstract preserveWorkspaceAllocation(request: TeamWorkspaceAllocationPreserveRequest): Promise<TeamWorkspaceAllocationSnapshot>

/** Persist exact provider loss without inferring resource release.
 * @param request - source-owned allocation/world/revision and retained artifacts.
 * @returns the unavailable allocation retaining its exact loss observation.
 */
abstract recordWorkspaceAllocationLoss(request: TeamWorkspaceAllocationLossRequest): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Confirm successful release of one source-owned provider allocation.
 * @param request - source-owned allocation release-confirmation scope.
 * @returns the durable allocation snapshot after release.
 */
abstract confirmWorkspaceAllocationRelease( request: TeamWorkspaceAllocationReleaseConfirmRequest, ): Promise<TeamWorkspaceAllocationSnapshot>

/**
 * Open one channel, mint its identity, and commit its immutable manifest.
 * TeamRun bootstrap and workflow-plan channels require their exact runtime
 * proofs; other generic channels retain their existing JSON-only request form.
 * @param request - Team identity, observed cursor, adapter identity, manifest fields, and runtime proof when applicable.
 * @returns the detached channel projection after opening.
 */
abstract openChannel(request: ChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Read durable channel invitations without acknowledging endpoint support.
 * @param request - channel whose admission is inspected.
 * @returns exact channel and invitation projection.
 */
getChannelAdmission(request: ChannelGetRequest): Promise<ChannelAdmissionSnapshot>

/**
 * List attached channels for the current authenticated human Team member.
 * @param request - Exact actor-free page selection plus its runtime membership proof.
 * @returns Bounded channel projections and an optional insertion-index continuation.
 */
listTeamChannels(request: TeamChannelListRequest): Promise<TeamChannelListPage>

/**
 * Read one retained Envelope after checking current Team-human membership.
 * @param request - Exact Team, channel, Envelope and current source-owned proof.
 * @returns Immutable accepted content; missing or compacted Envelopes reject.
 */
getHumanChannelEnvelope(request: ChannelHumanEnvelopeGetRequest): Promise<TeamEnvelope>

/**
 * Read an attached channel's invitation status for an authenticated Team human.
 * @param request - Team, channel and current payload-bound principal proof.
 * @returns Complete admission state without granting endpoint consent authority.
 */
getHumanChannelAdmission(request: ChannelHumanAdmissionGetRequest): Promise<ChannelHumanAdmissionSnapshot>

/**
 * Read only the authenticated human's invitation without accepting the protocol.
 * @param request - channel identity and current payload-bound human proof.
 * @returns manifest and the caller's own invitation.
 */
getHumanChannelInvitation(request: ChannelHumanInvitationGetRequest): Promise<ChannelHumanInvitationSnapshot>

/**
 * Confirm a manifest using the invited endpoint's current activation proof.
 * @param request - exact invitation revision, accepted manifest and retry identity.
 * @returns the durable acknowledgement and possibly activated channel.
 */
acknowledgeChannelInvitation(request: ChannelInvitationAcknowledgeRequest): Promise<ChannelAdmissionSnapshot>

/**
 * End due invitations using an admission-owned clock and exact durable cursors.
 * @param request - source proof and bounded channel selection.
 * @returns the durable invitations and resulting channel phase.
 */
expireChannelInvitations(request: ChannelInvitationExpireRequest): Promise<ChannelAdmissionSnapshot>

/**
 * Open one exact scheduler-owned consult channel for a participant-review task.
 * @param request - scheduler channel proof plus Team/task/review binding fences.
 * @returns the detached opened consult channel projection.
 */
openSchedulerReviewChannel(request: SchedulerReviewChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Open one exact scheduler-owned self-addressed task-assignment wake channel.
 * @param request - scheduler channel proof plus Team/task/activation binding fences.
 * @returns the detached opened wake channel projection.
 */
openSchedulerWakeChannel(request: SchedulerWakeChannelOpenRequest): Promise<ChannelSnapshot>

/**
 * Authenticate, authorize, stamp, and atomically append one channel Envelope.
 * The JSON input carries only the observed cursor, optional retry key, and
 * unstamped draft. An activation proof derives a current sender; an
 * authenticated-human proof derives an active product human sender; a
 * registered system proof derives only its scoped TeamRun human input or
 * scheduler-owned assignment/review post. Task-assignment and review-request
 * drafts reject an activation proof before policy or WAL admission.
 * @param request - runtime actor proof plus JSON-only channel post fields.
 * @returns the immutable Envelope accepted by the durable channel WAL.
 */
abstract postChannelEnvelope(request: ChannelEnvelopePostRequest): Promise<TeamEnvelope>

/**
 * Atomically prepare and append one protocol-owned final Envelope. The
 * provider derives the sender, peer, draft, and cursor under its channel write lock.
 * @param request - runtime actor proof plus selected channel, retry key, and final text.
 * @returns the immutable final Envelope accepted by the durable channel WAL.
 */
abstract postChannelFinalEnvelope(request: ChannelFinalPostRequest): Promise<TeamEnvelope>

/**
 * Append one durable receipt after an authenticated recipient persists the
 * referenced Envelope in its own delivery target. A duplicate receipt
 * returns the original durable record without another channel-WAL append.
 * The runtime-only actor derives the recipient; providers resolve it before
 * policy evaluation or pending-delivery removal.
 * @param request - runtime authority plus JSON-only accepted Envelope and cursor fields.
 * @returns the immutable receipt accepted by the durable channel WAL.
 */
abstract ackChannelEnvelope(request: ChannelEnvelopeReceiptRequest): Promise<ChannelReceiptRecord>

/**
 * Atomically claim one unacknowledged Envelope delivery through an opaque
 * activation proof. The provider resolves the proof under its Team/channel
 * serializers before it derives the recipient binding and treatment. A
 * defined claim neither reserves a model turn nor promises exactly-once
 * delivery; it is ephemeral and has no claim identifier or settlement operation.
 * @param request - runtime-only activation proof plus JSON-only channel and Envelope identities.
 * @returns the claim, or `undefined` when the recipient already durably acknowledged the Envelope.
 */
abstract claimChannelDelivery(request: ChannelDeliveryClaimRequest): Promise<ChannelDeliveryClaim | undefined>

/**
 * List a bounded page of currently pending deliveries for one recipient.
 * `afterCursor` is an exclusive source channel-WAL cursor, never a receipt
 * high-water. This discovery read neither claims nor acknowledges a delivery;
 * a consumer must call {@link claimChannelDelivery} before delivery.
 * @param request - channel, recipient, exclusive source cursor, and page limit.
 * @returns detached pending deliveries and the cursor for the next page or watch.
 */
abstract listChannelPendingDeliveries(request: ChannelPendingDeliveryListRequest): Promise<ChannelPendingDeliveryPage>

/**
 * Durably expire one exact bounded TTL delivery batch through a scheduler-owned proof.
 * @param request - scheduler channel proof plus Team/channel cursors, clock observation, and bound.
 * @returns the channel projection and expiry records committed by the authorized batch.
 */
expireSchedulerChannelDeliveries(request: SchedulerChannelDeliveryExpireRequest): Promise<ChannelDeliveryExpireResult>

/**
 * Read bounded channel-wide source content for an authenticated explicit summary selection.
 * @param request - Current coordinator/human proof and exact channel/range/retry selection.
 * @returns The ordered source content and fingerprint, or the matching committed result.
 */
abstract readChannelSummarySource(request: ChannelSummarySourceRequest): Promise<ChannelSummarySource>

/**
 * Append one idempotent durable summary over a bounded channel source range.
 * @param request - runtime summary proof plus JSON-only channel source and retry fields.
 * @returns the committed channel summary record.
 */
abstract summarizeChannel(request: ChannelSummarizeRequest): Promise<ChannelSummaryRecord>

/**
 * Read one detached channel projection.
 * @param request - channel identity to read.
 * @returns the current channel projection and WAL cursor.
 */
abstract getChannel(request: ChannelGetRequest): Promise<ChannelSnapshot>

/**
 * Read channel metadata only for a current member activation, including pending admission.
 * @param request - current actor proof and channel identity, without caller-selected member identity.
 * @returns manifest, phase and cursors; no messages, summaries or adapter state.
 */
getChannelForActor(request: ChannelActorGetRequest): Promise<ChannelSnapshot>

/**
 * Read records committed after one caller-observed channel-WAL cursor.
 * @param request - channel identity and last observed WAL cursor.
 * @returns the detached channel projection and ordered record suffix.
 */
abstract readChannel(request: ChannelReadRequest): Promise<ChannelReadResult>

/**
 * Read a bounded page of records committed after one channel-WAL cursor.
 * @param request - channel identity, cursor, and page limit.
 * @returns the detached channel projection, page records, and continuation cursor.
 */
abstract readChannelPage(request: ChannelReadPageRequest): Promise<ChannelReadPageResult>

/**
 * Compact a terminal channel's obsolete WAL prefix after durable delivery
 * and checkpoint watermarks prove the prefix is no longer required.
 * @param request - Team/channel identity, observed cursor, and prefix bound.
 * @returns the channel projection and compaction watermarks.
 */
abstract compactChannel(request: TeamChannelCompactRequest): Promise<TeamChannelCompactResult>

/**
 * Compact a terminal Team journal's obsolete prefix after durable audit and
 * checkpoint watermarks prove the prefix is no longer required.
 * @param request - Team identity, maintenance actor, observed cursor, and prefix bound.
 * @returns the Team projection and compaction watermarks.
 */
abstract compactTeam(request: TeamJournalCompactRequest): Promise<TeamJournalCompactResult>

/**
 * Compare-and-set closure of one channel.
 * @param request - channel identity, observed WAL cursor, and optional reason.
 * @returns the detached terminal channel projection.
 */
abstract closeChannel(request: ChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact scheduler-owned wake channel only when no current lease owns it.
 * @param request - scheduler channel proof plus immutable wake-manifest and channel cursor fences.
 * @returns the detached terminal wake channel projection.
 */
closeSchedulerFailedWakeChannel(request: SchedulerFailedWakeChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active channel only while a durable TeamRun cancellation
 * intent still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic channel-close authority.
 * @param request - TeamRun cancellation-cleanup proof plus Team/channel/cancellation cursor fences and reason.
 * @returns the detached terminal channel projection.
 */
closeTeamCancellationChannel(request: TeamCancellationChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active channel only while a durable human-receipted TeamRun
 * final result still owns the selected Team. This narrow post-release cleanup
 * command deliberately does not grant generic channel-close authority.
 * @param request - TeamRun finalization-cleanup proof plus Team/final/channel cursor fences and completion reason.
 * @returns the detached terminal channel projection.
 */
closeTeamFinalizationChannel(request: TeamFinalizationChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Close one exact active workflow channel only while its compiling plan has
 * not bound that channel. TeamRun uses this narrow cleanup command after a
 * failed compiler open/bind attempt so no orphaned workflow channel remains.
 * @param request - TeamRun workflow proof plus Team/plan/channel cursor fences and optional reason.
 * @returns the detached terminal channel projection.
 */
closeWorkflowChannel(request: TeamWorkflowChannelCloseRequest): Promise<ChannelSnapshot>

/**
 * Wait until a channel WAL moves beyond a caller-observed cursor, closes, or
 * the caller aborts its local wait. Providers omit `request.signal` before
 * parsing the JSON-only request fields; cancellation changes no durable data.
 * @param request - channel identity, last observed WAL cursor, and optional local cancellation.
 * @returns whether the cursor advanced or the provider closed the watch.
 * @throws when `request.signal` aborts before the watch resolves.
 */
abstract watchChannel(request: ChannelWatchRequest): Promise<ChannelWatchResult>

/**
 * Register one synchronous pure channel adapter. Registration is effect-scoped
 * and duplicate accepting `(type, version)` identities reject before publication.
 * @param adapter - adapter implementation for future channel openings.
 * @returns an HMR-safe disposer that retires exactly this registration while existing leases retain its object.
 */
registerAdapter(adapter: TeamChannelAdapter): () => void

/**
 * Resolve one exact adapter implementation that still accepts new work.
 * @param ref - type and version frozen in a channel manifest.
 * @returns the accepting registered adapter.
 * @throws {@link TeamError} when no accepting exact adapter remains registered.
 */
getAdapter(ref: TeamAdapterRef): TeamChannelAdapter

/**
 * Acquire one exact adapter object for an already admitted channel. Retiring
 * its registration blocks later acquisitions but does not invalidate this
 * handle.
 * @param ref - type and version frozen in a channel manifest.
 * @returns a release-once handle retaining the exact adapter object.
 * @throws {@link TeamError} when no accepting exact adapter is registered.
 */
acquireAdapter(ref: TeamAdapterRef): TeamAdapterLease

/**
 * List registered adapter identities in registration order.
 * @returns detached adapter references.
 */
listAdapters(): TeamAdapterRef[]

/**
 * Register one pure versioned channel view policy through a Cordis effect.
 * @param policy - view-policy implementation.
 * @returns an HMR-safe disposer that retires the registration while existing leases retain its object.
 */
registerViewPolicy(policy: TeamViewPolicy): () => void

/**
 * Resolve one exact durable channel view policy identity that still accepts new work.
 * @param ref - versioned view-policy identity.
 * @returns the accepting registered pure view-policy implementation.
 * @throws {@link TeamError} when no accepting exact view policy remains registered.
 */
getViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicy

/**
 * Acquire one exact view-policy object for an already admitted channel.
 * Retiring its registration blocks later acquisitions but does not invalidate
 * this handle.
 * @param ref - type and version frozen in a channel manifest.
 * @returns a release-once handle retaining the exact policy object.
 * @throws {@link TeamError} when no accepting exact view policy is registered.
 */
acquireViewPolicy(ref: TeamViewPolicyRef): TeamViewPolicyLease

/**
 * List registered channel view policies in registration order.
 * @returns detached view-policy identities.
 */
listViewPolicies(): TeamViewPolicyRef[]

/**
 * Return process-local counts for accepting and retired implementation
 * registrations plus the channel leases retaining them.
 * @returns a detached snapshot for HMR and runtime diagnostics.
 */
getImplementationLeaseMetrics(): TeamImplementationLeaseMetrics

/**
 * Return a detached operational counter/gauge snapshot for dashboards and alerts.
 * @returns current in-process Team metrics.
 */
getMetrics(): TeamMetricsSnapshot

/** Record one workspace integration conflict observed by a Team provider. */
reportWorkspaceConflict(): void

/**
 * Register one named policy for exactly one Team operation. Matching requests
 * reach it through the `team/policy` waterfall; nonmatching hooks delegate.
 * @param hook - Team operation this policy intercepts.
 * @param policy - named policy implementation.
 * @returns an HMR-safe disposer that removes exactly this policy.
 */
registerPolicy(hook: TeamPolicyHook, policy: TeamPolicy): () => void

/**
 * List current policy registrations in hook and registration order.
 * @returns detached diagnostic identities.
 */
listPolicies(): TeamPolicyRegistration[]

/**
 * Run the policy waterfall for one provider-validated Team operation.
 * @param request - operation facts to authorize or govern.
 * @returns the final allow or deny decision.
 */
async authorize(request: TeamPolicyRequest): Promise<TeamPolicyDecision>
```

Types: [TeamWorkspaceAllocationLossRequest](team-workspace.zh.md) · [TeamWorkspaceObservation](team-workspace.zh.md) · [TeamWorkspaceObservationRequest](team-workspace.zh.md)

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="ctxteamtelemetry--teamtelemetrybackend-abstract-seam"></a>

### `ctx.teamTelemetry` — `TeamTelemetryBackend` (abstract seam)

Team telemetry backend Service Definition. A deployment provider extends this class and composes TeamTelemetryCoordinator; the coordinator owns capture and correlation, while batching, retry, loss, and export stay with the provider.

```ts cordis-catalog
/**
 * See {@link TeamTelemetrySink.emit}.
 * @param record - detached telemetry record owned by the backend.
 */
abstract emit(record: TeamTelemetryRecord): void

/** See {@link TeamTelemetrySink.flush}. */
flush?(): void

/**
 * See {@link TeamTelemetrySink.shutdown}.
 * @returns completion after the backend reaches quiescence.
 */
abstract shutdown(): Promise<void>
```

Source: [`packages/core/team/src/telemetry.ts`](../../packages/core/team/src/telemetry.ts)

<a id="channel-events"></a>

### `channel/*` events

<a id="channelchanged--emit"></a>

#### `channel/changed` — emit

A provider committed a channel WAL record. Listener failure cannot roll back the already committed fact.

```ts cordis-catalog
/**
 * A provider committed a channel WAL record. Listener failure cannot roll
 * back the already committed fact.
 * @param event - identified committed channel record.
 * @mode emit
 */
'channel/changed'(this: TeamRuntime, event: ChannelEvent): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="team-events"></a>

### `team/*` events

<a id="teamadapter-added--emit"></a>

#### `team/adapter-added` — emit

A Team channel adapter became available for future channel openings.

```ts cordis-catalog
/**
 * A Team channel adapter became available for future channel openings.
 * @param adapter - registered adapter identity.
 * @mode emit
 */
'team/adapter-added'(this: TeamRuntime, adapter: TeamAdapterRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamadapter-removed--emit"></a>

#### `team/adapter-removed` — emit

A Team channel adapter stopped accepting new channels. Existing leases retain the exact implementation until their owners release them.

```ts cordis-catalog
/**
 * A Team channel adapter stopped accepting new channels. Existing leases
 * retain the exact implementation until their owners release them.
 * @param adapter - removed adapter identity.
 * @mode emit
 */
'team/adapter-removed'(this: TeamRuntime, adapter: TeamAdapterRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamchanged--emit"></a>

#### `team/changed` — emit

A provider committed a Team-journal record. Listener failure cannot roll back the already committed fact.

```ts cordis-catalog
/**
 * A provider committed a Team-journal record. Listener failure cannot roll
 * back the already committed fact.
 * @param event - committed Team record projection.
 * @mode emit
 */
'team/changed'(this: TeamRuntime, event: TeamEvent): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy--waterfall"></a>

#### `team/policy` — waterfall

Authorize one Team operation. An allowing listener must call `next()`; a denial returns a decision without delegating.

```ts cordis-catalog
/**
 * Authorize one Team operation. An allowing listener must call `next()`;
 * a denial returns a decision without delegating.
 * @param request - provider-validated operation facts.
 * @mode waterfall
 */
'team/policy'(this: TeamRuntime, request: TeamPolicyRequest, next: () => Promise<TeamPolicyDecision>): Promise<TeamPolicyDecision>
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy-added--emit"></a>

#### `team/policy-added` — emit

A policy began intercepting one Team operation.

```ts cordis-catalog
/**
 * A policy began intercepting one Team operation.
 * @param policy - registered policy identity.
 * @mode emit
 */
'team/policy-added'(this: TeamRuntime, policy: TeamPolicyRegistration): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teampolicy-removed--emit"></a>

#### `team/policy-removed` — emit

A policy no longer intercepts future Team operations.

```ts cordis-catalog
/**
 * A policy no longer intercepts future Team operations.
 * @param policy - removed policy identity.
 * @mode emit
 */
'team/policy-removed'(this: TeamRuntime, policy: TeamPolicyRegistration): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamview-policy-added--emit"></a>

#### `team/view-policy-added` — emit

A pure channel view policy became available for future channel reads.

```ts cordis-catalog
/** A pure channel view policy became available for future channel reads.
 * @param policy - registered view-policy identity.
 * @mode emit
 */
'team/view-policy-added'(this: TeamRuntime, policy: TeamViewPolicyRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="teamview-policy-removed--emit"></a>

#### `team/view-policy-removed` — emit

A channel view policy stopped accepting new channels; existing leases retain its exact implementation.

```ts cordis-catalog
/** A channel view policy stopped accepting new channels; existing leases retain its exact implementation.
 * @param policy - removed view-policy identity.
 * @mode emit
 */
'team/view-policy-removed'(this: TeamRuntime, policy: TeamViewPolicyRef): void
```

Source: [`packages/core/team/src/runtime.ts`](../../packages/core/team/src/runtime.ts)

<a id="team-scheduler-events"></a>

### `team-scheduler/*` events

<a id="team-schedulerassigned--emit"></a>

#### `team-scheduler/assigned` — emit

The scheduler committed a task lease and its durable assignment Envelope. This observation remains advisory; a task-delivery Consumer pulls the channel WAL after restart before it starts an owner-fenced attempt.

```ts cordis-catalog
/**
 * The scheduler committed a task lease and its durable assignment Envelope.
 * This observation remains advisory; a task-delivery Consumer pulls the
 * channel WAL after restart before it starts an owner-fenced attempt.
 * @param notice - immutable assignment task, activation, channel, and Envelope.
 * @mode emit
 */
'team-scheduler/assigned'(this: TeamDagScheduler, notice: TeamTaskAssignmentNotice): void
```

Source: [`packages/team/team-scheduler-dag/src/index.ts`](../../packages/team/team-scheduler-dag/src/index.ts)

<a id="team-telemetry-events"></a>

### `team-telemetry/*` events

<a id="team-telemetryrecord--waterfall"></a>

#### `team-telemetry/record` — waterfall

Transform one Team telemetry record before export. A listener must call `next()` to preserve lower redaction or enrichment layers.

```ts cordis-catalog
/**
 * Transform one Team telemetry record before export. A listener must call
 * `next()` to preserve lower redaction or enrichment layers.
 * @param record - detached candidate record.
 * @param next - remaining telemetry policy waterfall.
 * @mode waterfall
 */
'team-telemetry/record'(record: TeamTelemetryRecord, next: () => TeamTelemetryRecord): TeamTelemetryRecord
```

Source: [`packages/core/team/src/telemetry.ts`](../../packages/core/team/src/telemetry.ts)
<!-- END GENERATED cordis-surface -->
