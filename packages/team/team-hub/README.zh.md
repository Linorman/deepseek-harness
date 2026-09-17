# @clocky/clocky-team-hub

[English](README.md) | 中文

`@clocky/clocky-team-hub`是 `ctx.teams` 上本地权威的 `TeamRuntime` 提供方。将它与 `@clocky/clocky-team`、`@clocky/clocky-storage-log` 以及选定的日志后端一同挂载。它拥有 `team/<TeamId>` journal 和 `channel/<ChannelId>` WAL 流，包括持久声明式 workflow plan 及其 task/channel binding，且不导入 Agent、Session、AgentLoop 或实验性 Team 包。

Channel opening 原子追加 `opened`、`pending` 和每名 manifest 成员的一条 invitation。成员默认 required；generic 或 authenticated-human open request 可显式标记 optional，结构化 TeamRun/workflow/scheduler channel 则要求所有 endpoint。`channelInvitationTimeoutMs` 默认为 `30000`，并冻结每条 invitation deadline。最后一个 required acknowledgement 与 `active` 位于同一 WAL batch。只有 direct-v4 广播可省略尚未确认的 optional recipient；其准确 `deliveryIntents` 不随后续 acknowledgement 改变。Optional expiry 需要保留 adapter 的 `allowParticipantRemoval()` 授权；不支持移除时 channel 进入 failed。关闭先停止 admission，再结束 pending invitation，最后写 terminal record。参见 [admission](../team-channel-admission/README.zh.md)。

Scheduler review 频道使用从 Team、task、attempt 和 reviewer 派生的确定性身份。Hub 在返回已 attached 频道前重新验证当前 scheduler proof 和策略。请求发布失败或 Hub 重载后可继续使用原频道，不额外消耗频道配额；不同 attempt 使用独立身份。

typed `maxChildTeams` budget 限制累计后代身份数量。预留 child 前，父 Team 串行预留 `1 + child.maxChildTeams`；父上限存在时，child 必须明确该额度。取消和归档不会退回预留。journal 与 checkpoint replay 执行相同总量检查。

Scheduler review 频道选择 `recent-window` v1，将任务说明和报告结果放入 reviewer 的有界模型视图。只含元数据的 `directed` 策略不适用于 review 请求。Payload 选择仍由保留的 view policy 负责，Hub 渲染不绕过策略。

`maxLiveActivations` admission 统计启动预留及每个 live child 的完整冻结额度。binding 必须对应尚未使用的准确预留。仅有 offline 状态不能释放额度；未绑定的未知启动也会阻止终态关闭与归档。journal 和 checkpoint replay 校验预留身份、释放依据和相同总量上限。

## 持久 Team 状态

普通 post 接收 JSON-only cursor/retry/draft 字段和运行时 actor。activation proof 派生当前 sender；`team-human-actor` source 派生 authenticated product human sender；`team-run` source 只能派生 scoped human input，`team-scheduler-dag` source 只能派生当前 task-assignment 或 review request。task-assignment channel 与 consult review request 会拒绝 activation proof post。在线 reviewer 通过 activation proof 解决 task，不携带 caller-selected Team 或 Participant field；scheduler 则可在 Hub 验证完整 response provenance 后，通过独立 source-scoped task-review proof 修复一条准确的 closed consult response。adapter-owned final command 接收运行时 `TeamActorProof`以及仅包含 channel、retry-key 和 text 的字段。receipt 只接受 channel、Envelope、cursor 和一个运行时 actor，绝不接受 caller-selected recipient、activation 或 Session：activation proof 派生其当前 recipient，已注册的 `team-run` system proof 则只能确认其 scoped 的、active 的双人 direct-v3 coordinator final，且该 final 仅指向其 human。delivery claim 接收 activation proof 以及仅包含 channel 和 Envelope 的 identity；task-attempt start claim 接收它以及仅包含 task、attempt、assignment-revision、channel 和 Envelope 的 identity。task-attempt heartbeat 或 settlement 接收同一 proof 以及仅包含 task、attempt 和 revision 的字段；settlement 还携带 outcome。Hub 会在持有相应 Team/channel queue 时再次解析每个 proof。它会在 dispatch policy、pending-delivery lookup、cursor comparison、重复 receipt replay 或 WAL append 前校验 receipt actor、`team-run` source scope、当前 topology 与非空 coordinator final Envelope。它会在 adapter、policy、idempotency 或 WAL admission 前为 final admission 派生 sender、为 receipt 派生 recipient、为 delivery claim 派生 recipient 与 delivery intent、为 task-start、heartbeat 和 settlement admission 派生 Team、Participant、activation 和 Session。伪造、已撤销、已替换、offline 或 cross-scope 的 proof 会以 `TEAM_ACTOR_PROOF_INVALID` 拒绝；另一个 activation 的有效 proof 无法执行 owner command。

Hub 拥有 Team／participant／task／activation 状态、channel admission 与可重放 journal。task mutation 使用 revision 和 attempt fence；goal mutation 会在同一 Team queue 内重新校验不透明的 activation 或 authenticated-human proof，并从中派生 policy participant。一个 wake channel 只属于一个 current lease，并会随 settled attempt 保留。带 recovery plan 的 offline activation 必须先获得持久 quiescence：`fenceActivation()`记录外部已围栏的证明，`quiesceActivation()`记录本地已结算的证明；两者都会释放 lease 并终结 wake channel。Team 创建时会把部署限额快照到 `rules.teamLimits`，participant、activation、task、channel、Envelope、pending-delivery、重试键、attempt、lease 和 model usage 操作都执行该不可变快照。只有已围栏证明允许 cold replacement。终态 Team 可通过持久标记归档，journal 仍可读取，而默认列表会将其排除。相同检查会保护 journal 与 checkpoint replay。创建时的 `maxRetriesPerTeam` 与 typed `maxRetries` 取较小值，限制所有 task record 的新 retry；每个 task 的首次 attempt 不消耗 retry 额度。Typed `maxConcurrency` 限制新 task assignment 的同时数量，已接纳的 attempt 仍可完成。`maxWallTimeMsPerTeam` 与 typed `maxWallTimeMs` 取较早的创建时间 deadline，在达到或超过该时间时拒绝新的 channel/task work，同时保留 cancellation 和 archival。Host approval/question adapter 可以追加带 cursor fence 的 `human-action/changed` record；settled action 和 request detail 会跨 Hub 重启保留。`recordUsage()`会替换重复的 turn/step sample，并为整个 Team subtree 追加持久 token/turn/cost aggregate；Child Team 先提交自己的 sample，再在允许继续 child work 前重试幂等的 parent charge。对缺少 provider cost 的 sample，配置的 provider/model `usageRates` table 会计算 pricing，显式 sample cost 仍然优先。超过冻结上限会将 Team 置为 stalled。Hub 会分两阶段记录 cancellation：`team/cancellation` 关闭 admission 并取消无 lease 的 work；active lease 和 activation 在 owner settle 或被 fence 前仍可见。相同 cancellation key 的 retry 会继续这一持久请求，并且只有在这些 resource 与 channel quiesce 后才到达终态 `cancelled`；不同 key 会被拒绝。

root creation 需要一条准确的 `team-run` root-creation proof；Hub 会在 policy 和 stream opening 后重新验证它，并将派生出的不含 secret 的系统来源保存为 `TeamSnapshot.createdBy`。child creation 需要来自 canonical `team-child-delegation` source 的独立、准确 `TeamSystemChildCreationProof`。它的 scope 绑定完整 child payload 和一条 observed parent cursor；Hub 会在 parent repair 前、在 parent queue 内、register policy 后和打开 child stream 后验证它。shipped composition 在 parent-task consumer 拥有该 operation 前不会挂载 child-delegation source，因此 raw child creation 会 fail closed，parent Team/task 或 hierarchy projection 都不能提供 authority。

Claim 返回的模型 view 渲染文本必须符合 Team 冻结的 `maxChannelViewBytes` UTF-8 字节上限，计入 Team/channel identity、adapter view 和 policy projection。合法但超限的输出会以 `TEAM_CHANNEL_BACKPRESSURE` 拒绝，并报告实际字节数与上限。Pending delivery 和 channel cursor 保持不变。Versioned view policy 是纯函数：重试相同不可变 source 时仍会收到相同容量拒绝。其他投影未超限的独立 source 仍可通过同一 policy 投递，并须通过来源 provenance 与 activation proof 校验。

Direct v4 的 null-audience 消息会寻址其他所有已确认的 manifest 成员。Admission 在 Team/channel 锁内检查其当前 active Participant 状态；每名 recipient 保留独立的 pending delivery 和 receipt。v4 final 要求准确的 coordinator/human 两方 manifest、实际 coordinator Agent sender 与实际 human recipient、显式单一 audience 和 turn delivery。仅凭 channel role 标签不能授予 human final authority。[Direct adapter](../team-channel-direct/README.zh.md)拥有 content 与 audience 协议规则。

Channel creation 或 cold recovery 失败后，会保留已获取的 adapter、view-policy 与 adapter-runtime lease，直到已打开 stream 的 close 完成。即使 stream close 或 adapter-runtime cleanup 失败，也会继续尝试释放所有 lease，并同时报告原始 creation 或 recovery error 与 cleanup error。Recovery 从 checkpoint read 到 WAL replay 都拥有 stream cleanup，包括尚未获取实现时的失败；caller 只负责发布成功恢复的 projection。失败的 creation 不会发布 Team attachment 或 channel notification。若 append 已提交但返回结果丢失，未挂接的 WAL 会保留在持久存储中，Team channel read 无法访问它。

terminal archive 需要 JSON-only Team/cursor 字段，以及来自 `team-run`的准确 `TeamSystemArchiveProof`或绑定同一 cursor 的 authenticated-human proof。Hub 会在加载 Team 前绑定该 scope，即使是 idempotent 的已归档 read 也会在 Team queue 内再次解析；随后在 `close` policy 前检查 terminal phase 与 cursor，并在追加 `team/archived`前立即再次解析。archive marker 保持现有 shape，而当前 Team journal/checkpoint version 会约束 replay；durable Team 绝不保留 proof、terminal owner 或可复用 archive credential。

`recordUsage()`只接收 current activation proof 与 JSON-only provider/model fact。Hub 会在 Team queue 内重新验证该 binding，并在 parent-charge repair、重复 replay、policy 或 journal append 前派生 Team、Participant、Session 与 timestamp。未提供 provider cost 的 sample 在重试比较前按冻结 rate table 定价，相同规范化报告保留原 usage record 与 parent charge。Usage policy 接收原始 input；定价失败只在 policy 允许 mutation 后报告。

Typed Team budget 与创建时冻结的 deployment ceiling 同时生效，实际采用已定义值中较小的上限。Typed token／turn 计数允许零，typed cost 上限还允许小数单位。`recordUsage()`先保留已观测用量，再在越界时置为 stalled；已 stalled 时到达的后续结算用量仍会保留。Closure-driver scan 在达到 token、turn、cost 或 wall-time 上限时置为 stalled，无需等待另一条 model observation；零表示这些额度已耗尽。

Integration task 会在 Team task record 中保存已完成 source task/attempt、provider、target、expected target revision 以及 proposal 或 merge mode。Source 必须已经有 completed attempt；创建时执行 `workspace-integrate` policy，completed integration attempt 必须保留匹配的 target result，成功要有 target version，merge 失败要有 conflict path。Hub 拥有这项 authorization 与 durable outcome，workspace provider 拥有 live Git 或 artifact operation。

activation lifecycle command 会携带 JSON-only cursor/binding/status field 与 `TeamSystemActivationProof`。Hub 只接受 controller scope 执行准确的 bind、status、fence 或 quiesce operation，只接受 recovery 对 offline 且已本地 quiesce epoch 重试 retained wake cleanup。它会先解析 proof 选择 Team，再在该 queue 内重新解析，并在 policy、task-lease cleanup 或 journal append 前匹配准确 current binding。

human-action command 只携带 Team/cursor field 与 `TeamSystemHumanActionProof`。Host API proxy 只有在保留 verified interaction entry 时才可签发准确的 pending admission 或 terminal resolution；Hub 会在 Team queue 内重新解析该 scope，派生 durable action 与 policy actor，绝不接收 caller-selected action、participant、Session 或 outcome。存在 closure/cancellation intent 或 Team 已进入终态时，新的 pending action 会在 policy 前被拒绝。匹配的 upsert 重试仍返回现有 action，包括已取消的 action；已接纳的 pending action 仍可记录其 terminal outcome。终态 Team 的 journal 和 checkpoint 不得保留 pending human action。所有终态 Team projection 还要求 allocation 已 released、task 与 workflow plan 已终结、没有 pending parent charge，且 activation 均 offline 并有 quiescence proof。Quiescing/stalled projection 可以保留待清理工作；channel phase 与 delivery 结算另对其 WAL 进行跨流核验。

`assignTask()`与`expireTaskAttempt()`携带 JSON-only task/lease field 和 `TeamSystemTaskLeaseProof`。只有 scheduler source 能选择一条准确的 assignment 或 elapsed attempt；Hub 会在 parent-charge repair 或 wake-channel work 前解析 proof，并在 task-assign policy 或 journal acceptance 前于 Team 与已附加 channel queue 内再次解析。

`openSchedulerReviewChannel()`、`openSchedulerWakeChannel()`、`closeSchedulerFailedWakeChannel()`与`expireSchedulerChannelDeliveries()`携带 `TeamSystemSchedulerChannelProof`。Hub 会从所选 operation 派生固定 consult 或 task-assignment manifest，在 repair 前后验证准确 review attempt/reviewer binding 或 pending task/assignee binding，并在 policy 后、WAL attach 或 close 前再次解析。delivery expiry 则会在两把 lock 内、追加有界 expiry batch 前验证 scheduler-owned clock 与准确 Team/channel cursor；它不使用 policy，并允许已附加的 terminal channel 清空其保留的 pending delivery。failed-wake cleanup 可以在无关 Team 变更后回收 orphan，但会拒绝任何仍被当前 task lease 引用的 channel。

coordinator-authored task creation 与 workflow-plan admission 使用 `TeamActorProof`。authenticated product task creation 与 lease-free task mutation 使用 `TeamHumanActorProof`；Hub 从 active human 派生 durable creator 或 reviewer，绝不接受 caller 选择的 identity。其 JSON input 包含 task 幂等 key 或 plan fact，但没有 raw creator/actor；Hub 会在 repair 前及 Team queue 内解析 proof，要求 active agent role 为 `coordinator`，并在 replay、policy 或 journal append 前派生 durable creator provenance。

workflow compilation 使用 TeamRun 的独立 `TeamSystemWorkflowProof`。Hub 只会以准确 compiling plan revision、current coordinator binding 与完整 manifest scope 接收 workflow-plan channel open，随后为 channel/task binding 和 phase change 再次解析准确 scope。专用 cleanup proof 可以在 compiler failure 后关闭 attached unbound workflow channel，但会拒绝 bound 或 non-compiling plan channel。 Journal replay 会在后续 revision 中保留每条已接纳的 template-to-task 与 channel binding，同时允许增量 compilation。

default-worker task owner proposal 与 current-coordinator cancellation 使用 `TeamSystemTaskControlProof`。Hub 会从准确 scope 派生 coordinator，验证 nonworkflow task 保留同一 durable creator，并在 policy 或 durable mutation 前拒绝 stale run、revision、owner target 或 proof。coordinator release 后的 cancellation cleanup 不适用这条 authority。

Participant invitation 与 membership phase 对受信 topology source 使用 `TeamSystemTopologyProof`，对面向非 human participant 的 authenticated product call 使用 `TeamHumanActorProof`；human participant 创建仍仅限 topology source；Hub 会在 `invite`或`activate` policy 前比较其准确 descriptor、cursor、participant、expected phase 与所选 next phase，并在持有 Team queue 时再次比较。`team-run`只能在发布 Run 前使用 bootstrap scope，之后只能为其封闭的 worker 或 reviewer 操作使用对应 scope。一条 topology proof 只能以准确的有序 manifest 打开初始 active direct-v3 human/coordinator channel。其他非 workflow channel open 需要 `TeamSystemChannelLifecycleProof`及其 runtime-only 的 generic dispatch marker；Hub 会在 policy 前绑定完整 source scope，在 policy 后重新解析，并在 WAL 创建后、attachment 前再次检查。

release 后的 cleanup 按 durable lifecycle evidence 分开。`TeamSystemCancellationCleanupProof`只有在匹配的 TeamRun cancellation 仍然 current 时，才能取消一条准确的 pending task 或关闭一条准确的 active channel；stale proof 会在 parent-charge repair、policy 或 journal work 前被拒绝。`TeamSystemFinalizationCleanupProof`只有在默认 direct-v3 topology 仍保留已由 human receipt 的 coordinator final 时，才能关闭一条准确的 active attached channel；Hub 会在 Team/channel queue 内、close policy 或 WAL append 前重新验证 final、topology、Team cursor 与 channel cursor。两类 proof 都不能跨授权普通 close、workflow cleanup 或 coordinator task control。

`requestParticipantInterrupt()`只接受 TeamRun 当前 human-to-coordinator interrupt proof，在 Team/channel queue 内解析准确的 idle/running coordinator target，并以派生出的 human requester 执行 `interrupt`授权。相同的未确认 target 是幂等的；只有 target Link 的 activation proof 可以列出并确认它，确认既不取消 Team，也不结算 turn。

每项已接收的变更只有在日志追加成功后才更新内存投影，随后发出不可变的 `team/changed`、`goal/changed`、workflow-plan 或带身份的 `channel/changed`观察事件。读取操作会在返回前同步另一个 SQLite-backed Hub 追加的后缀；带过期 expected-tail 的变更仍会使本地投影失效，而不会静默合并并发的持久状态。游标读取和 watch 无订阅间隙地公开有序 channel 记录与 Team/channel 推进。独立的 `audit/<TeamId>` 或 `audit/<TeamId>/channel/<ChannelId>` projection 会在 `readAudit()` 返回前从权威流修复；audit append failure 会被记录并重试，不会回滚业务 mutation。Policy denial 会作为不可变 Team audit observation 发出但不会推进业务游标；`TeamRuntime.getMetrics()`提供 active-admission、事件、拒绝、投递、分配、重试、compaction、checkpoint、audit-repair 与 audit-failure 计数。

activation-bound Link 私有保留其可撤销 proof lease；Hub 只接收不透明的 runtime proof，proof 绝不进入 wire 或持久状态。其 receipt input 只限于 channel、Envelope 和 observed cursor；Hub 会在 Team/channel queue 内重新校验 binding，并在 policy 或 durable admission 前派生 recipient。heartbeat 与 settlement 的 caller-controlled input 只限于 task、attempt 和已观测 revision，settlement 额外带有 typed outcome。Hub 仅用 proof 找到 Team queue，随后在该 lock 内重新校验 binding，并在 policy 或 durable mutation 前派生精确的 task-attempt owner。Closure command 也会将只含 JSON 的 input 与不透明 authority 分开；它先路由到选定 Team，再在 Team 与所有 attached channel queue 内重新解析，之后才会 replay、执行 policy 或 append。activation proof 派生 active participant；`team-run`只能派生其准确的 direct-v3 completion、cancellation 或 creation-failure scope。Hub 只存储这一派生出的 participant 或 `{ kind: 'system', name: 'team-run' }` attribution，绝不保存 raw proof 或 caller-selected actor。Phase transition 使用独立的不透明 system proof：scheduler 只能创建准确的 active-to-stalled transition，而 TeamRun 可以恢复 stalled Team，或将一条已由 human receipt 的 final 从 `active`置为`quiescing`。这条 fence 会持有 Team 与 final-channel queue，校验准确默认 topology 与 final，拒绝未完成的非 channel work，并在本地 release 前阻止后续 channel admission。

`admitTeamFinalResult()`在 TeamRun 的封闭 proof 下追加独立的 `team/final-admitted`事实。Hub 将准确的 Team/channel/Envelope 和 WAL sequence 绑定到 canonical SHA-256 payload fingerprint，派生 human recipient 与 owner，并在 checkpoint 中保留 Team-scoped idempotency key。System final receipt 要求先有这项 durable acceptance。Completion intent 要求 final recipient 的 Participant kind 为 human，且有 durable owner。首次接纳结果或记录 completion intent 前，准确 final 必须已有 durable human receipt 或仍有 pending human delivery；已持久过期且没有 receipt 的 final 会被拒绝，之后的 final 仍可接纳。单纯经过 wall time 不能替代 expiry record。结果接纳后的 delivery 结算不影响该结果的幂等重试。TTL expiry 保留已接纳结果的准确 human delivery，直到写入 receipt，重启后也如此；其他到期 delivery 仍按有界批次结算。明确的取消与失败可通过各自的 expiry record 结算该 delivery。恢复 completion intent 时，driver 先追加缺失的 admission 并返回新的 Team cursor；只有之后持有新 authority 的 pass 才能修复 receipt。Completion 会保持非终态，直到 receipt、owned resource 与 channel 全部 settle。该封闭 result sink 不实现 principal inbox 或 display acknowledgement。

终态 compaction 只接受 scheduler 持有的 `TeamSystemMaintenanceProof`，不接受调用方选择的 system name。其准确 scope 绑定 Team/channel、expected cursor 和 source prefix bound；Hub 会在持有 serializer 时重新解析该 proof，然后才执行 close policy、audit repair、checkpoint write 或 compaction。close-policy fact 会携带派生出的 `{ kind: 'system', name: 'team-scheduler-dag' }` actor，而 durable prefix state 绝不保留 proof。

Failure continuation 会取消 pending 和 review task，保留其 attempt 与 review 历史；pending human action 以 `team-failed` outcome 取消，未完成的 workflow plan 记录原 Team failure 原因并进入 failed。在 failure 或 cancellation intent 下完成 quiescence 时，已释放 attempt 的 task 会被取消，不会重新开放可重试工作。经 provider 确认终止后，可将不可变的 `fencedAt` 与一条 allocation release 请求同时持久化；只有所有 allocation 都已释放，才接纳 offline/quiescent 状态。资源 stall 保留准确的原 intent，供后续 closure recovery 完成。取消在清理 channel 或接纳终态前，要求每个 activation 都已 offline 且有 durable quiescence proof；恢复后只有 offline 状态的 epoch 也必须满足这一要求。`cancelTeam()`与 closure-driver continuation 按顺序尝试所有选定 channel 的清理，等待全部分支结算后汇总独立错误。每个 delivery-expiry 或 channel-close 分支都会在 policy 前和 append 前重新校验 closure proof；重试沿用原 durable intent，并跳过已关闭的 channel。

`getTeamSelection()`返回身份、生命周期、准确 coordinator binding 和集合计数。`maxSelectionBytes`限制 UTF-8 JSON response（默认 16384）；`maxSelectionTextBytes`限制每段显示前缀（默认 512），并明确返回`truncated`。路由元数据过大时以`TEAM_CHANNEL_BACKPRESSURE`拒绝。尚未完成的启动不会将旧 activation 报告为当前绑定。读取不会启动 Agent；冷 selection 仍在内部加载完整 Team。

## 恢复和配置

Host 与 SDK management surface 会调用 `listTeamsPage()`、`listParticipantsPage()`、`listTasksPage()`和`readChannelPage()`，因此单个 response 不会实体化无界的 task、roster、Team 或 channel-WAL page。每个 method 使用 caller cursor 与正整数 limit。Team discovery 最多扫描该数量的物理名称条目，返回 `scanned`，空页也可能带 opaque continuation；discovery cursor 过期时从 `-1` 重扫。其他 collection 保留数值 cursor 和 look-ahead 语义。Discovery 读取原子提交的 Team 摘要，不打开 journal 或加载投影。`maxDiscoveryBytes`限制每次元数据读取，并在 journal 批次提交前拒绝超限摘要；摘要缺失或身份不匹配会明确失败。归档 Team 投影及 audit handle 在最后一个已接纳读取结束后释放；终态 channel handle 不受无关 watch 阻挡。归档 Team 最终 cursor 的 watch 返回 `closed`。选中 Team 的 hydration 仍读取完整投影。`expireSchedulerChannelDeliveries()`只接受准确的 scheduler channel proof，并为 folded deadline 已到的 delivery 追加逐 recipient 的 TTL expiry record。`readChannelSummarySource()`与`summarizeChannel()`要求当前频道成员协调者，或负载绑定且经过认证的人类。[显式摘要 Consumer](../team-channel-summary/README.zh.md) 拥有规范输出证明。Hub 在追加前检查已提交范围、精确来源 id 与规范 SHA-256 指纹、全频道可见性、不可变策略、游标及当前接纳条件。WAL/checkpoint 恢复根据来源 Envelope 验证这些关系；摘要范围在压缩时保留。匹配重试返回原持久化结果。`compactChannel()`与`compactTeam()`是分别面向 terminal channel 与 Team 的 trusted retention operation：两者都要求 actor 已获授权、audit projection 是 current 且 checkpoint 已存在；channel compaction 还要求没有 pending delivery，并保留每条已接纳的 final Envelope，并且两者都会在 compact source stream 前保留配置的 audit tail。压缩后的 channel snapshot 与 audit page 会公开 first retained cursor，consumer 可以从 retained boundary 恢复而无需猜测。内部 scheduler 与 recovery code 仍保留独立的 full-read method，因为它们拥有完整 replay 与 repair 的责任。

显式 Team hydration 会验证 checkpoint watermark 并回放 journal 后缀。Checkpoint 中 activation fence 的时间必须位于 Team lifetime 内，且不得早于已接纳的 cancellation 请求或 completion/failure intent；取消场景的 fence 可以早于后置 terminal closure。Final-admission timestamp 必须位于 Team lifetime 内，workflow checkpoint 同时校验 task-to-plan、plan-to-task reference 和 attached channel identity。当双方都保留 grant 时，checkpoint 中 Participant authority 的 operation、workspace mode、read/write scope 与 budget 必须包含于所属 Team grant。Checkpoint 中 task owner proposal 必须引用 Team 保留的 participant；已离队的 participant 仍是合法历史引用。不一致的 checkpoint 会回退 journal；尚未完成但一致的 compiling binding 仍可恢复。Team journal 使用 format 33，Team checkpoint 使用 format 33；channel WAL 使用 format 7，channel checkpoint 使用 format 10；audit projection 使用 format 1。更早的预发布 format 会被拒绝。`recoveryPageSize`、`checkpointEvery`、`auditRetentionTail`、`disposalTimeoutMs`、pending-delivery 与 retry-key capacity、depth、lease 及 budget limit 都由部署配置。Team 与 channel compaction 会保留原始 cursor；移除 retained prefix 后，旧 read 会收到明确的 compaction error。 Completed task 的结果投影必须匹配其最后一个 attempt 的 completed result；显式 failure 必须匹配其最后一个 attempt 的 failure，省略 failure 详情仍然有效。

终态恢复在 checkpoint 或 journal 中的 Team 对外可见前，根据权威 WAL 检查关联 channel 的所属 Team、终态 phase 及零 pending delivery。Completed 恢复还检查选定 final 的 admission、保留 Envelope、fingerprint、human recipient 与 receipt。Final 查找遵循 WAL 的保留前缀。Checkpoint 关系无效时允许回退 source journal；存储错误及准确实现加载失败向调用方传播。

卸载时，Hub 会同步关闭准入和游标 watch，在 `disposalTimeoutMs` 内等待已接收的工作、尝试写入最终检查点，并在报告聚合清理失败前关闭每一条已加载流。`usageRates`是可选的 provider/model 每 token cost-unit table；它会在 Team creation 时复制到每个 Team 的 `rules`，因此修改 rate 不会重新解释历史 usage。

当 typed Team、task 或 authority grant 设置了 `maxCostUnits` 时，没有显式 cost 的 usage sample 或传播来的 child charge 必须通过冻结的 rate table 解析；未知 pricing 会被拒绝，而不会按 0 计入。

Workflow plan 会作为一个完整、已校验的 JSON value 准入，并在每个 task template 及其 plan-owned versioned workflow channel 都完成 durable binding 前保持 `compiling`。Task 和 channel retry 使用 plan/template identity；scheduler 在 plan 为 `ready` 前不会调度其中的 task，因此 restart 可以从 journal record 继续，而不会重放 model-written code。

## 模型体验

### 本地持久权威

#### 模型所见

`ctx.teams`没有直接的模型可见内容。该提供方不注册提示词片段或工具；后续 Team client 或产品 Consumer 负责所有模型可见的 Team 输入和输出。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有请求前缀。

## 已知限制与延后工作

- **没有 participant 执行或 Link transport**——Hub 会持久化 activation identity 和 residency，但不会创建或拥有 AgentRuntime handle、remote endpoint、remote reconnect 或 transport retry。
- **没有 scheduler、task-delivery publisher、workspace 或产品入口**——Hub 会持久化 task attempt 并验证 delivery-bound start，但不会选择 owner、不追加 task-assignment Envelope、不分配 workspace，也不提供 API、SDK、UI 或默认组合包组装。

[本地 Team Hub 决策](../../../.agents/notes/implemented/architecture/2026-08-27-local-team-hub-durable-authority.zh.md)记录持久权威拆分，[Team 子系统参考](../../../docs/subsystems/team.zh.md)定义公开的提供方操作。

### 单任务取消

Task 取消保留最先接纳的认证 intent，随后拒绝 start、heartbeat、report 和 review 活动。Review 清理关闭选定 attempt 的 consult；scheduler reconciliation 会恢复中断的清理。Owner acknowledgement 和 activation quiescence 必须等 allocation 释放后才能结束任务。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).

`rankingLatencyBucketsMs` 与 `rankingCostRateBuckets` 在 Team 创建时冻结为 `rules.taskRanking`。`ParticipantStats.taskOutcomes` 提供按 capability set 分组的整数计数与固定长度延迟直方图，均来自 settled attempt；task 删除和 journal compaction 保留其源历史。
