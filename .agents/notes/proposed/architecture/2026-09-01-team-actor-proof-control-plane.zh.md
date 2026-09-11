# Agent Note: Team actor proof control plane

Status: proposed

[English](2026-09-01-team-actor-proof-control-plane.md) | 中文

## 问题

Team command 目前接受裸 participant identifier、activation record 或 system name。这些值标识一个持久 subject，却不能证明当前 caller 持有该 subject 的 authority。Host 与 SDK management route 因而可以从 Team state 派生 human id，或完全省略 actor，而 Hub 会回退到 Team root grant。Session header 也有同样问题：它将 command 路由到 Team，却不是已认证 human principal。

## 提议

已交付的产品认证 human consumer 记录在[经认证的产品主体 Team 控制](../../implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)。本提议保留更广泛的 activation 与 system-proof 决策范围。

定义一个不可序列化的 `TeamActorProof`，它只能由真实 authority source 签发，并由 Hub 在 policy 或 durable acceptance 前解析。proof 是不透明 runtime state，绝不进入 Team journal、checkpoint、Session event、WebSocket frame、RPC parameter 或 model input。Hub 只有在验证 proof 的 Team scope、issuer lease 与当前 human 或 activation relationship 后，才会把解析出的 durable attribution 投影到 closure 与 audit fact。

既有 authority source 签发第一批 proof：activation-bound local 或 WebSocket Link 会在验证准确 durable binding 后签发 activation proof；TeamRun、scheduler、activation controller、recovery 与 retention 会为自有 operation 签发窄范围 system proof。未来 Host authentication provider 只有在将已认证 product principal 映射到一个准确 active human Participant 后才会签发 human proof。任何 route 都不得从 Session header、participant id 或 request body 派生 proof。

在 route 具备这种 source 前，它会 fail closed。`/goal`保持 status-only，Host/SDK 通用 management write 变为 unavailable，而不是把选中的 human 或伪造的 system name 当作 authority。read、list、watch 与 audit call 保持可用。

## 当前产品 run 边界

临时产品边界不会撤销进程自有的 TeamRun 操作。Host 保留 `team.create`、`team.start`，以及仅用于本地进程仍持有的 TeamRun 的 `team.postInput`/`team.waitFinal`/`team.cancel`；SDK 保留 `team/create`，以及仅用于其已跟踪、由运行时持有的 run 的 `team/wait-final`/`team/cancel`。`team-run`只在该 run 保持 current 时保留 final receipt 的 source-scoped proof，因此对 wait 或 cancellation 的 detached request 是通用 management write，会被拒绝。针对带 Team provenance 的 coordinator 的 Host `session.cancel` 也会拒绝，而不会把它的 Session header 或 roster entry 当作 authority。terminal archive 是狭窄例外：只有自行完成或取消 Team 的 TeamRun 才会保留 in-memory terminal owner，Host 或同一 SDK server 才能经由 `archiveTerminal()`路由该 owner；SDK 成功后会移除自己的 terminal record，而 Host owner 在 TeamRun disposal 前允许 idempotent retry。resume、member、channel 与 task write 仍保持 unavailable；read、list、watch、audit、quiescence 与 metrics 保持现有 scope。

root Team creation 现在遵循同一条 process-owned 边界。`team-run`只在 Hub 创建其 root 期间保留一条准确 `TeamSystemRootCreationProof`，Hub 会在 policy 前以及打开新 stream 后把该 proof 绑定到完整 root payload。首条 Team record、projection 与 checkpoint 只保留派生的 `{ kind: 'system', name: 'team-run' }` provenance 作为 `createdBy`；proof 本身绝不持久化。child creation 现在有自己的 `TeamSystemChildCreationProof` scope，其中包含完整 child payload 和 observed parent cursor。Hub 只接收 canonical `team-child-delegation` source，并在 parent repair 前、parent lock 内、register policy 后以及 child-stream opening 后重新验证它。parent-task delegation 的 owner 尚未实现，因此 shipped product composition 不注册该 source，raw child creation 会 fail closed；Session header、product request body、parent Team、parent task 或 hierarchy projection 都不会被当作 creator。

terminal Team archive 同样是 proof-only。`team-run`不保留 durable credential：它在自身成功完成或取消后，只保留一条以 Team id 为键的本地 owner，为每个请求的 cursor 签发新的 `TeamSystemArchiveProof`，并在 close 或 disposal 时清除 owner 与未完成 proof。Hub 只接收 `team-run` source 的准确 `{ kind: 'team-run-terminal-archive', teamId, expectedCursor }` scope；它会在加载 Team 前、在 Team lock 内（包括已归档的 idempotent read）以及 close policy 后、`team/archived` append 前重新解析。archive 绝不持久化 proof、owner 或新的 record field；Team id、terminal snapshot、`createdBy`、roster、detached SDK server、新 TeamRun 或 restart 都不能恢复 authority。

channel summary append 同样是 proof-only。`ChannelSummarizeInput`只保留 channel、cursor、有界 source range、准确 Envelope id、text、view-policy ref 和 retry key；`TeamSystemChannelSummaryProof`会在 canonical `team-channel-summary` source 中绑定该完整 payload。summary consumer 拥有该 source 前，没有 shipped composition 注册它，因此 raw summary request 会 fail closed。Hub 会在加载 channel 前、channel lock 内以及异步读取 source range 后、WAL append 前再次解析 proof。summary record 只保留既有 source/business fact，绝不保留 proof 或 issuer state；channel id、policy、WAL range 或 read projection 都不能重建 authority。

## Proof command boundary

proof-only command 包括 adapter-owned final admission、recipient receipt、delivery claim、task-attempt start claim、heartbeat 和 settlement。final admission 的公开 input 只包含 channel、retry key 与 text；receipt 只包含 channel、Envelope 与 observed-cursor identity；delivery claim 只包含 channel 和 Envelope identity；task-start claim 只包含 task、attempt、assignment-revision、channel 和 Envelope identity；heartbeat 只包含 task、attempt 和已观测 revision；settlement 额外带有 typed outcome。本地 Link 和已认证 WebSocket listener 会在验证 binding 后生成私有 activation proof、私有地保留其 lease，并将 proof 传递给 Hub。在 Team/channel lock 内，Hub 会重新校验 binding，为 final admission 派生 sender、为 receipt 派生当前 recipient、为 delivery claim 派生 recipient 与 delivery intent、为 task-start admission 派生 Team、Participant、activation 和 Session。`team-run`会注册一条独立的 source-scoped system proof，它只能确认当前本地 run 的 active 双人 direct-v3 coordinator final，且该 final 仅指向其 human。对于 heartbeat 与 settlement，Hub 从 proof 选择 Team，然后在 Team lock 内重新校验 binding，并在 policy 或 durable mutation 前派生精确的当前 lease owner。普通 `postChannelEnvelope()`接收运行时 actor 以及只含 JSON 的 cursor、retry 和 draft 字段。Link 从 activation proof 派生 sender；`team-run`只派生其当前 human-to-coordinator direct-v3 input；`team-scheduler-dag`只派生当前 task-assignment 或 participant-review request。Hub 要求每个 task-assignment channel post 与 consult review request 使用 scheduler proof，因此 activation actor 不能占用 scheduler-owned Envelope。在线 reviewer 只能通过 activation proof 和仅含 JSON 的 task/revision/decision 字段解决 task；独立的 scheduler task-review proof 只会在 Hub 验证 task 和两条 Envelope record 后修复一条准确的 closed consult response。closure、goal、workspace、artifact、task 与 maintenance command 需要各自 source-scoped issuer。通过 cast、JSON round trip、clone、cross-Team reuse、revoked issuer lease 或 stale activation 伪造的 proof 会在 policy waterfall 或 append 前被拒绝。

closure 现在接收只含 JSON 的 command 字段与 `TeamClosureAuthority`：activation proof 派生当前 active participant，`team-run`则只解析准确的 completion、cancellation 与 creation-failure scope。Hub 会根据 proof 的 Team 路由，在 Team 与 attached-channel lock 内重新解析 proof，然后才 replay 或执行 policy，并且只将派生出的 durable actor 写入 journal。

Goal update 与 phase-transition command 现在采用规范的只含 JSON input 加 `TeamActorProof`形式。TeamRun 只有在其准确 coordinator capability 与 human direct-v3 turn 检查通过后，才会签发私有、短生命周期 proof；Hub 会在 Team lock 内重新解析该 proof 并派生 policy participant。原有 raw `participantId`与结构化 activation-actor form 已被移除，`/goal`仍保持 status-only。

通用 Team lifecycle transition 现在使用独立的 `TeamSystemPhaseProof`。scheduler 只能以准确 unassignable-work reason 证明一条 active-to-stalled transition，TeamRun 可以证明一条 stalled-to-active resume，或将一条已由 human receipt 的 final 从 `active`置为`quiescing`。finalization scope 绑定 Team cursor、final channel 与 Envelope 以及默认 human/coordinator topology；Hub 会锁定该 channel，拒绝未完成的非 channel work，并在 close policy 后、phase append 前再次解析 proof。fixture state 通过私有方式种入，而不会重新开放通用 transition command。

终态 stream compaction 现在使用 `TeamSystemMaintenanceProof`。scheduler source 会绑定一条 Team journal 或 channel WAL、其观察 cursor 和准确 `throughSequence`；Hub 会在 close policy、audit repair、checkpoint 或破坏性 storage work 前解析该 proof。Raw system name 仍只作为 durable attribution。

Soft interrupt 现在会派生命令两端。ACP 会要求 TeamRun 签发一次性 proof，只命名当前默认 human-to-coordinator topology；Link discovery 与 acknowledgement 使用 target activation 的私有 `TeamActorProof`。Hub 会在 interrupt policy 或 journal append 前于其 Team/channel lock 内解析每条 proof。

Usage recording 现在使用 activation-proof boundary。`team-agent-client`会为每条准确 current binding 私有保留一份 lease，并且只发送 JSON provider/model fact；Hub 会在 parent-charge repair、重复 replay、policy 或 append 前重新验证 binding，然后派生 Team、Participant、Session 与 timestamp。Parent-charge propagation 保持为内部 Hub settlement，并携带已派生的 durable provenance。

activation lifecycle command 现在使用 `TeamSystemActivationProof`。`team-activation-controller`只会在其 Hub call 期间保留一条准确 bind、status、fence 或 quiesce scope；`team-activation-recovery`只保留记录为本地 quiesce 的 offline epoch 的 wake-cleanup retry。Hub 会在选择 Team 前以及在 lock 内解析 proof，然后才执行 policy、lease cleanup 或 append；两条 source 都不持久化 proof。

Host approval 与 question action 现在使用 `TeamSystemHumanActionProof`。API proxy 只会在 Hub admission 成功后保留 verified pending interaction，并为每次 resolution retry 签发新的 cursor-bound terminal proof。Hub 会在 Team lock 内派生 action、policy actor、outcome 与 timestamp；proxy restart 会丢失 verified entry 并记录诊断，而不会重建 raw authority。

scheduler assignment 与 expiry 现在使用 `TeamSystemTaskLeaseProof`。`team-scheduler-dag`只会在其 Hub call 期间保留一条准确 task/participant/activation/wake-channel assignment scope 或一条 elapsed attempt scope。Hub 会在 parent-charge repair 前解析它，并在 Team 与已附加 wake-channel lock 内再次解析；assignment 被拒绝时会关闭刚打开的 wake channel，而不会遗留它。

scheduler review 与 wake channel lifecycle 现在使用 `TeamSystemSchedulerChannelProof`。scheduler 会为一条 completed review attempt 与 idle reviewer binding、一条 pending task 与 idle assignee activation，或一条 failed-assignment wake channel 固定 scope；Hub 会派生固定 manifest，在 repair 前后重新验证 scope，并在 policy 后、attachment 或 close 前再次验证。orphan wake 可以在无关 Team 变更后被回收，但当前 task lease 始终保护其 wake channel。

只有 `expireSchedulerChannelDeliveries()`使用 scheduler TTL delivery-expiry proof family。其准确 scope 绑定 active Team、attached channel、两条 observed cursor、scheduler 的 clock observation 和有界 batch limit。Hub 保留 policy-free provider-drive 行为，在 channel-WAL append 前立即重新验证 scope，并允许 attached terminal channel 清空 pending delivery。

coordinator-authored task creation 与 workflow-plan admission 现在使用 `TeamActorProof`。其 JSON field 保留必需的 retry key 或 plan fact，但没有 raw creator/actor identity；Hub 会在 repair 前和 Team lock 内解析 current active coordinator，然后派生 durable task creator 或 plan actor。每个新写入的 Task snapshot 都会保留该 creator command，journal 或 checkpoint parser 会拒绝缺失 provenance。workflow channel、task-binding 与 phase command 仍是独立的 compiler authority 问题。

direct task-attempt start 现在使用 current lease owner 的`TeamActorProof`，只接收 task/revision/attempt 字段；Hub 会在 lock 内派生 Team、Participant 与 activation。lease-free task details edit 与 tombstone 同样需要 current coordinator proof。三条路径都会在`task-mutate` policy 后、append 前重新验证 proof 与 task fence；任何 request 都不携带 caller-selected owner 或 activation。

workflow compilation 现在使用 `TeamSystemWorkflowProof`。TeamRun 会将 compiling plan 的 channel manifest、channel/task binding、phase payload 或 orphan cleanup 限制在一次 call；Hub 会在 Team/channel lock 内重新解析它。orphan cleanup proof 只会在 plan bind 前关闭 attached active workflow channel，绝不会关闭 bound 或 non-compiling plan channel。

current-coordinator 的 default-worker owner proposal 与 cancellation 均要求 `TeamSystemTaskControlProof`。TeamRun 固定 durable creator、task revision 与 selected payload；Hub 验证该 creator，并在 policy 后、append 前再次验证 proof。Owner proposal 要求 pending nonworkflow task。[单任务取消决策](../../implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md)拥有取消接纳和精确工作结算规则。Post-release cleanup 保留独立 authority lifetime；`cancelTask()`没有 actor-free path。

Participant topology 现在使用 `TeamSystemTopologyProof`。发布 Run 前，TeamRun 只能签发一条 bootstrap participant invitation、membership transition 或初始 direct-v3 channel-open scope；发布后，它只能为已声明 worker 的 activation 或 reviewer 的 invitation/transition 签发 scope。Hub 会在 participant policy 前解析 proof，并在 Team serializer 内、append 或 bootstrap WAL creation 前再次解析，因此 raw participant mutation 会 fail closed，而 scheduler-owned structural channel open 保持其独立形式。

通用的非 workflow channel open 与普通 close 使用 `TeamSystemChannelLifecycleProof`。其 runtime-only 的 `channel-lifecycle` dispatch marker 选择通用 open 路径但不授予 authority；canonical source 绑定完整 payload，Hub 会在 policy 后以及 WAL 创建后、attachment 前再次解析它。shipped product composition 不注册通用 lifecycle source。

release 后的 cleanup 使用分离的 cancellation 与 finalization proof。`TeamSystemCancellationCleanupProof`绑定一条已接纳的 cancellation identity、Team cursor 和准确的 pending task 或 active channel；Hub 会在 parent-charge repair 前预检它，并在 policy 或 append 前再次解析。`TeamSystemFinalizationCleanupProof`绑定一条已由 human receipt 的 coordinator final、默认 topology、Team cursor 和 active attached channel；它只能以 completion-specific reason 关闭该 channel。两类 proof 都不会授予普通 close、workflow cleanup 或 coordinator task-control authority。

## 考虑过的替代方案

**将 `ParticipantId` 包装为新的 TypeScript type。** 不予采用，因为 caller 仍可构造该值，Hub 仍没有持有 authority 的证据。

**将唯一 active human Participant 用于每个 product caller。** 不予采用，因为 roster lookup 不是认证，任何已连接 Host 或 SDK client 都可冒充该 human。

**将 capability 与 Team 一起持久化。** 不予采用，因为 durable log 应保留 attribution 与 business fact，而不是可复用的 caller secret；Link credential 与 Host principal 有不同的 revocation lifetime。

**在只为新 API 添加 proof 的同时保留不安全 route。** 不予采用，因为每条保留的 raw write 都是绕过新 control plane 的路径。

## 验收标准

- 每个 Team write 都在 policy 或 durable acceptance 前于 Hub 内解析一个 opaque proof。
- Link、TeamRun、scheduler、controller、recovery 与 retention proof 受 issuer 与 hook scope 限制；过期或 cross-Team proof 会被拒绝。
- receipt admission 从 activation proof 派生 recipient，或从 `team-run`精确 final-receipt proof 派生 recipient，后者要求 Hub 验证 active 默认 topology 与 final Envelope。
- 普通 Envelope admission 不接受 caller-selected sender、activation 或 Session；scheduler-owned assignment 与 review draft 会拒绝 activation proof。reviewer 从 activation proof 派生 authority，scheduler recovery 只从一条 scoped durable consult response 派生 authority。
- 没有 authenticated product principal 的 Host/SDK 通用 write 会明确失败，而当前 run 的 TeamRun operation 仍受其 owning process 限制；wire schema 不含 actor proof 或 caller-selected actor field。
- closure 与 audit record 只保留 Hub 派生的 durable attribution。
- local、WebSocket、TeamRun 与 system operation 在 JSON 和 SQLite 上通过 proof-based test 保留有效行为；伪造或 stale proof 会在 mutation 前失败。

## 风险

这是一个跨 package 的预发布 contract change，涉及 core schema、Hub、Link、product consumer、Host、SDK、catalog、snapshot 与 Python projection。在其 principal issuer 存在前重新启用暂时 unavailable 的 management route 会重建绕过路径；每次重新引入都必须包含 source-specific proof 与 denial test。
