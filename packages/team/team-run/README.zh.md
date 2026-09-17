# @clocky/clocky-team-run

[English](README.md) | 中文

`@clocky/clocky-team-run`在 `ctx.teamRuns`拥有本地默认 Team topology。它会通过一次性的 `TeamSystemRootCreationProof`创建 root，该 proof 绑定完整的已解析 root payload；Hub 会将派生出的系统 source 记录为持久 `createdBy` provenance。随后它创建持久 human participant、活跃的本地 coordinator 和配置数量的已 provision 但 inactive 的 worker pool；打开 direct v3 human/coordinator channel；通过 `ctx.teamActivations`激活 coordinator；并且只会在该 topology 提交后接受可信 human text/image content。它会为每个 current run 保留 source-scoped ordinary-post proof，因此 `postHumanInput()`只接收准确 active human-to-coordinator direct-v3 message，绝不接收 caller-selected sender。`TeamSystemTopologyProof`会在发布前为一条准确的 bootstrap invitation、membership phase 或 direct-channel operation 签发 token；发布后它还会为 worker pool 的 invite、activation、retirement 以及 reviewer 的 invite/phase operation 签发 token。每个 token 只在运行时存在、只用一次，并在发布、release、creation failure 或 disposal 时撤销。同一个 coordinator authority 也可以将 JSON-serializable `TeamWorkflowPlan`编译成持久 task DAG 和 versioned workflow channel；shipped workflow path 不执行 model-written JavaScript。

该 service 自己通过 completion 或 cancellation 结算 Team 后，只会为该 Team 保留一条 in-memory terminal archive owner。`archiveTerminal()`会生成一条以 Team 和传入 cursor 为 scope 的 one-shot `TeamSystemArchiveProof`，随后将 durable marker 委托给 Hub；owner 仍存活时，成功的 Host retry 保持 idempotent。Team id、terminal snapshot、root provenance、roster、新的 TeamRun service 或 process restart 都不能重建 owner。`close()`与 plugin disposal 会同时清除 owner 和未完成的 archive proof。

该 service 不是 Agent loop。`@clocky/clocky-team-agent-client`会将 human Envelope 投递到 coordinator Session，coordinator 必须使用 `team_final`追加显式、面向 human 的 `final` Envelope。`team-run`会注册 source-scoped `TeamSystemFinalReceiptProof` resolver，`waitForFinal()`为一个当前本地 run 的 Team、human/coordinator pair 与默认 channel 私有保留一条 proof。Hub 只会为准确的 active 双人 direct-v3 channel，以及仅面向该 human 的非空 coordinator `final`接收该 proof。`waitForFinal()`先记录 completion intent，再通过 `admitTeamFinalResult()`持久接纳准确结果，之后记录 human receipt。Paused 或 blocked objective、未完成的工作和 completion-policy denial 都会阻止 result admission。挂载 closure driver 时，run 释放本地 lease，并将 channel closure 与 terminal settlement 交给 driver。Recovery 先追加缺失的 result admission，再使用新的 cursor 修复 receipt。未挂载 driver 时，本地 channel cleanup 会在 coordinator release 后使用 `TeamSystemFinalizationCleanupProof`。Team completion 仍要求所得 durable state 已 quiescent。`TeamSystemCancellationCleanupProof`与其分离：durable cancellation 和本地 release 后，它只能影响从该 cancellation 选出的准确 pending task 或 active channel。每次 completion 或 cancellation attempt，以及发布前的 creation failure，都使用独立的临时 `TeamSystemClosureProof`。每条 proof 只携带准确的 TeamRun scope，Hub call 结束后即撤销，并变成 durable 的 `{ kind: 'system', name: 'team-run' }` attribution，而不会冒充 human 或 coordinator。`waitForFinal()`只从本进程的当前 run map 解析 Team：detached Team id 会 fail closed，recovery owner 必须先 `resume()`，获得新的 current-run proof 后才能等待或结算 final result。 如果 coordinator turn 达到 provider 的输出上限，TeamRun 会在同一个 Agent Session 上排队一条有界 continuation，使尚未完成的 worker coordination 无需手动唤醒即可继续。`maxCoordinatorOutputContinuations`限制这类恢复；达到上限后会记录普通的 `FINAL_ANSWER_MISSING` stalled 状态，让 Team 仍可观察、停止，而不会永久等待。

Creation 会等待持久 channel admission，再返回 active handle 或发送初始输入。System-owned human participant 由实际 TeamRun result Consumer 确认。Product-principal owner 必须提供仅限运行时的 `admitHumanChannel` 能力：Host 与 SDK Consumer 验证准确且受支持的 manifest，并在当前 authenticated call 内签发绑定完整 payload 的 human proof。回调返回但没有 durable acknowledgement 时 creation 失败。回调失败或取消会沿用既有 activation release 与 failed-creation cleanup；失败的 start 释放 retry key，已接纳的同 key 请求则返回原结果。该能力不会进入 JSON 或 start fingerprint。Workflow compilation 也会在绑定 channel 前等待 admission。


Principal-owned final 要求挂载[持久 human inbox](../team-human-client/README.zh.md)：Hub 先在那里保存准确的 final 内容，再记录 sink admission 与 receipt。默认 human grant 包含用于 inbox 访问的 `dispatch`。System-owned unattended run 保留独立的封闭 result sink；浏览器 display acknowledgement 不阻止 Team 完成。

可选 `maxChildTeams` 在新 root Team 中冻结累计后代数量预算。零值拒绝创建 child；省略不增加数量上限。有界 root 的委派必须明确 `budget.maxChildTeams`，零值表示 child 不再创建后代。

准确的本地 reviewer turn 结束但没有已接纳响应时，task wait、workflow wait 和阻塞式 task watch 以 `TEAM_RUN_REVIEW_FAILED` 拒绝。返回失败前重新检查 task revision，并保留 review 状态；已有持久响应仍由 scheduler 恢复处理。Team stalled 时，尚未结算的 wait 以 `TEAM_RUN_NOT_QUIESCENT` 拒绝。这些错误不会取消或重复执行 worker。

`maxLiveActivations` 冻结 root 的同时启动/epoch 额度；child 请求必须明确分配子额度，包含其 coordinator 和 idle 成员。发行 headless/web root 在 Cordis 配置中设置 `maxChildTeams: 32` 与 `maxLiveActivations: 128`。

## Configuration

`channelPageSize`是正整数配置，默认为 `128`；`waitForFinal()`使用它通过 provider page 有界读取 final-output channel WAL。

`activationProvider`、participant display name、`workerCount`、`maxWorkerCount`、reviewer name/capability/preset、`templateId`、`templateVersion`、`placementDefaults`、worker capability/task limit、`workerPreset`、prompt order、`receiptRetryAttempts`、`humanInputRetryAttempts`和 `maxCoordinatorOutputContinuations`都是配置字段。`placementDefaults`是可选的 JSON-friendly restriction set（`participantIds`、`roles`、`providers`、`presets`或`models`），会冻结到省略显式 placement 的 participant task；task 自己提供的 placement 优先。`maxCoordinatorOutputContinuations`默认为 `3`，限制 provider 输出达到上限后的同一 Session 恢复。`workerCount`是初始 worker pool 的非负整数，默认为 1；`maxWorkerCount`是 deployment ceiling，默认为 32。coordinator 可以通过 `team_worker_pool_set` 增减 durable pool；slot zero 保留为 `worker`，后续 slot 命名为 `worker-2`、`worker-3`等，任务压力下降后会回收空闲的多余 slot。后续扩容会优先复用已 retired 的 role number，反复调整不会无谓消耗 participant limit。shipped Headless 和 Web profile 从 1 个 worker 开始，最多允许 32 个。独立 task 无须等待空闲 slot 才能接纳；active worker 可用时 scheduler 会并行分配，pool 饱和或触顶会返回明确的 queue 状态，不会把 Team 标记成 stalled。初始 Team rules 会保留已配置的 template id/version，作为产品 topology provenance，直到 core Team template record 落地。`create()`会仅为该 coordinator 使用可选的 `selection`和具名 `preset`，否则使用当前 `agentDefaultModel`选择且不使用 preset；可选的正整数 `maxTokens`只作用于该 coordinator 的请求，不会改变任一默认值。default-worker task 需要配置 `workerPreset`；选定的 activation provider 会在惰性 worker activation 时解析该 exact preset，并在 preset 不可用时拒绝，而不会回退到 coordinator 或 roster default。配置 `reviewerPreset` 后，声明 write scope 的 task 会惰性 provision 并激活 reviewer Participant，同时冻结 participant-review route。

Coordinator 在能节省时间或上下文时委派可独立交付和验证的工作，小型且紧密关联的任务可由一个执行者完成。Brief 明确输入、产物、scope、验收和交接，并行 writer 使用互不重叠的 scope。Prompt 提供已配置的 workflow worker capability，要求整合前检查保留的证据，不重复创建仍在重试或取消中的任务。

`start()`将 topology 创建与首条可信 human Envelope 组合为一个操作。调用方提供一个 sender-scoped idempotency key；当前本地 owner 可用时，相同请求的 retry 返回同一 Team 与 Envelope，而使用该 key 的不同请求会失败。`postHumanInput()`接受相同的可选 key，并会在中间 receipt 或 reply 改变 channel cursor 后最多按 `humanInputRetryAttempts`重读，因此 retry 不会重复写入持久输入。

`resume({ teamId })`会在之前的 coordinator activation 已离线 settle 后，重新拥有一个 active 或 stalled 的持久默认 Team。对于 stalled Team，它会签发一条 source-scoped phase proof，只能将这支 Team 恢复为 `active`，随后复用持久化的 coordinator Session、model route、preset 和默认 channel，并生成新的 activation epoch；terminal 或 archived Team 不可恢复。

`cancel(teamId)`会先携带临时 TeamRun cancellation proof 向 Hub 发送 typed cancellation command。只有该命令持久化地关闭 admission 后，才会释放本地 lease，并为每个可重试的准确 task 或 channel cleanup 使用新的 cancellation-cleanup proof；若不相关的已接纳 Team record 先推进 cursor，它会在 `receiptRetryAttempts`内重读并以同一 idempotency key 和新的 proof 重试。若初始命令未被接受，service 会保留本地 ownership，使调用方可以 retry，而不会留下普通的 quiescing Team。

`requestCoordinatorInterrupt(teamId)`是 ACP cancellation 使用的狭窄 product interrupt path。它会签发一次性 source proof，只派生此 run 的 human requester 和默认 coordinator target；非 active 或 detached Team id 不会到达 Hub interrupt command。

Default-worker task creation 对 worker-pool 准备、reviewer 的每个 membership/activation 步骤和 task admission 分别应用 `receiptRetryAttempts`。coordinator 并发发起的 admission 只在 pool topology 和 task creation 周围串行化，因此每个独立 task 都会参与自动扩容；worker execution 仍保持并行。Reviewer 步骤成功后重置该步骤的 cursor-conflict 计数；已完成的 participant 准备不会消耗 task mutation 的重试次数。每次尝试都重读 Team 状态并签发新 proof，非 cursor 错误仍直接传播。

## 默认 worker task

`coordinatorTaskAuthority(coordinator)`只会为确切、存活的本地 coordinator 生成 opaque capability。`setWorkerPoolSize()`接收该 capability，将 target 限制在 `maxWorkerCount` 内，激活新邀请的 worker、回收空闲多余 worker，并返回 active/idle/busy/queued count 以及 saturation flag。自动缩容会保留 slot zero，以及仍作为待处理 review consult 发起方的 participant，直到 review 结算。`startDefaultWorkerTask()`接收该 capability、调用方提供的 branded task-creation key、subject、instructions 和 read/write scope；准入前会将 target 提升到足以覆盖尚未结束的 default-worker task，然后为 current coordinator 签发一次性 activation proof。Hub 会从该 proof 派生 durable creator identity，保留已声明的 scope，懒激活已配置的非委派 worker，并将其余 task policy 固定为默认 worker、shared workspace 和已配置的 limit。若配置了 reviewer preset 且 task 声明 mutating scope，task 会冻结 participant-review route，并在准入前激活 reviewer。匹配的 retry 使用新 proof 并返回 Hub 保留的 task。

Task start、list、watch、cancellation 和 terminal wait 的返回值包含冻结的 `reviewPolicy` 和有界的 `reviewResult`。结果为该 attempt 的持久审阅记录所投影的 `{ attemptId, decision: 'accepted' | 'rework' }`，尚无决定时为 `null`。存在 active lease 时选择其 attempt，否则选择最近结算的 attempt。因此 pending task 可以显示最近一次 rework 决定，但新分配的 attempt 不会继承该决定。`none` policy 与结果为 null 的 participant policy 有明确区别。投影不包含审阅理由或更早 attempt 的决定。

`waitForDefaultWorkerTask()`只接收此前由同一 coordinator authority 准入的 task。它会监视 Team journal，直到 task 完成配置的审阅并到达 `completed`，或到达 `failed`、`cancelled`、`deleted`；完成时返回保留的 result，失败时保留最终的 failed、released 或 lease-expired attempt fact。其 signal 只会停止这一次本地 watch，不会 cancel、delete 或以其他方式修改持久 task。

`listDefaultWorkerTasks()`会返回通过该 coordinator authority 准入的每个非 workflow task 的紧凑 phase。`watchDefaultWorkerTasks()`会等待 Team cursor 前进，并用新 cursor 返回同样有界的 snapshot；其 signal 只会停止这一次本地 watch。 Provider 返回重复或回退的 Team cursor 时，本地 wait 会以 `TEAM_RUN_NOT_QUIESCENT` 失败，而不会重复提交同一 watch。

`proposeDefaultWorkerTaskOwner()`会通过同一条 one-shot task-control proof 在 owned pending task 上记录或清除 advisory Participant hint。该 hint 是 durable 且受 revision fence 保护，但不会授予 task authority；scheduler 在 assignment 前仍会校验候选者的 capability、availability、workspace 和 budget。这些 proof 只在 current coordinator 拥有 run 时适用；release 后的 cancellation cleanup 使用独立 authority。

## 声明式 workflow plan

`startWorkflowPlan()`接受一个完整的 `TeamWorkflowPlan`，在 Team admission 前校验 task DAG、bounds、result selection、participant-role graph 和准确版本的 workflow extension。缺少 `channel.viewPolicy` 的请求会在激活 participant 或持久化 plan/task 前被拒绝。TeamRun 会为 plan admission 和每个 plan-template task command 使用新的 current-coordinator activation proof，因此 Hub 会派生 durable plan actor 与 task creator。Hub 会将 plan 记录为 `compiling`；随后 TeamRun 打开或恢复 plan-owned workflow channel、按 dependency order 绑定 task，并将 plan 标记为 `ready`。scheduler 在 ready record 存在前不会调度 workflow task，并强制 plan 的 parallelism 与 total-attempt bound。相同 model-call lineage 的重试会复用 plan、channel 和 task binding；重启可以根据这些 record 继续未完成的 compilation。

对于 compiler-owned channel open、plan channel/task binding 与 plan phase transition，TeamRun 会保留独立的一次性 `TeamSystemWorkflowProof`，其中固定准确 plan、cursor、revision、manifest、binding 或 terminal payload。为 compiling plan 打开的 channel 无法 bind 时，TeamRun 会用 scoped orphan cleanup proof 只关闭这个 unbound channel；后续已经 bound 的 channel 永远不属于这条 cleanup。

已授权的 active 自定义或远程 Agent 角色没有驻留 Activation 时，编译器在 plan admission 后、创建 channel 前调用 `ctx.teamPlacement.prepareRoles()` 就绪角色。缺少 placement 或路由会拒绝编译；部分成功保留 compiling plan 供重试。未结算的旧 epoch 必须走恢复流程，编译器不会调度仅部分绑定的任务。

`cancelWorkflowTask()` 选择所拥有的 plan/template binding 并返回准确任务的停止进度。`waitForWorkflowPlan()` 等待全部绑定任务，读取 Hub 的 completed/failed/cancelled 汇总结果，结果投影只包含配置选定的任务。取消 wait 不会取消 workflow。本地 shipped Consumer 会将 channel role 解析为默认 coordinator、worker 和已配置 reviewer Participant，默认使用 shared workspace；非 shared workflow mode 必须显式挂载对应 provider 与 scheduler mode。

## Coordinator objective authority

`tryCoordinatorGoalAuthority(coordinator)`会为确切的本地 coordinator 生成独立的 opaque capability，普通 Agent 则返回 `undefined`。`readCoordinatorGoal()`读取其持久 objective，`updateCoordinatorGoal()`则从该 coordinator activation lease 签发私有、短生命周期 proof，再通过 Hub 提交 compare-and-set edit。每次调用都会重新验证 live Agent、scoped initiator 和持久 activation；edit 还要求当前 open turn 包含来自本 run human participant、经默认 channel 投递的 direct v3 human Envelope。

## 单任务取消

Task start/list/watch/wait 和取消结果包含有界 `cancellation` 进度：请求时的 revision、选定 attempt（pending 工作为 null），以及 lease 期限是否已经过去。Null 表示没有单任务 intent。`cancelDefaultWorkerTask()`接纳 pending、review、assigned 或 running 工作的取消，Team 保持 active。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md)。

`workerCount: 0` 与 `maxWorkerCount: 0` 创建仅含一个模型参与者的 Team，沿用频道、final receipt、关闭和恢复流程。handle 的 `worker` 为 undefined；委派 worker task 会明确拒绝，不会自动增加执行者。

`members` 声明额外的模型参与者，指定唯一角色、能力、runtime provider、模型路由、可选 preset 和输出 token 上限，并在创建时激活。这些路由冻结在 Team 模板中，恢复时继续使用；成员描述与模板不符时拒绝恢复。Workflow 的执行者和审阅者角色从 active roster 解析，不再要求默认 worker。run handle 的 `members` 提供这些成员身份；其 Activation 沿用相同 controller 和取消结算流程。

## Model Experience

### Coordinator final output

#### What the model sees

coordinator 会收到带 Team provenance 的持久 direct v3 `user/message` human input。可选 request preset 会先组合其 scoped tool 和 prompt section，随后 Team-run 添加 direct-channel instruction，要求使用 `team_final`生成面向 human 的结果。

#### Token effect

coordinator 的下一次 request 会增加一条 scoped final-output instruction 和一个 `team_final` tool schema。选定 preset 拥有其额外 token 影响。Human input 和 final output 仍是动态 channel/session fact。

#### KV Cache effect

final-output instruction 和选定 preset 在 coordinator activation 期间保持稳定。Human input 和 tool result 是动态 suffix entry。

## Known Limitations and Deferred Work

- distributed human delivery 仍是独立的 Phase 8 工作。Host Team input admission 已支持 attachment ingress；配置 reviewer preset 后可用 review routing。Crash recovery 仍需要持久化的 provider-specific fence plan。
- 该本地 provider 只拥有当前进程的 run。卸载会移除其 source-scoped final-receipt proof，并保留 active durable Team 供之后的 recovery owner 使用；后者必须先 `resume()`，才能等待或结算 final result。
