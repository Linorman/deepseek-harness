# Agent Note: 本地 Team Hub 持久权威

Status: implemented

[English](2026-08-27-local-team-hub-durable-authority.md) | 中文

## Problem

[持久存储日志与 Team 服务定义](2026-08-27-durable-storage-logs-and-team-service-definition.zh.md)提供持久化操作和抽象 Team 词汇，但两者都不会创建权威 Team 或回放 Team 状态。将该权威保留在实验性 Lead Session 中，会保留原生工作系统设计所移除的身份、恢复和直接子代耦合。

## Decision

`@clocky/clocky-team-hub`将 `TeamRuntime` 实现为显式挂载的本地 `ctx.teams` 提供方。它只通过 `ctx.storageLog` 打开 `team/<TeamId>` journal 和 `channel/<ChannelId>` WAL，生成独立的 Team 域身份，并通过该设施具备路由感知的列举来发现已物化 Team 流。

Hub 将经过验证的 Team journal 和 channel WAL 折叠为按资源划分的投影。它通过预期游标提交 Team／participant 生命周期变更、带 activation-authorized create command 和围栏 attempt lease 的完整 task 快照、activation binding 和 channel 附接；它在 WAL 中提交 channel 的打开、关闭、已认证 Envelope admission 和 recipient receipt。activation binding 会按 ActivationId 保留每个 offline epoch，要求每个 local Participant 使用一个 Session，并拒绝并发 resident epoch。task command 会保留准确 creator binding 和 retry key；journal 与 checkpoint replay 会验证其 relation 和唯一性。task attempt 会保留 owner capability eligibility，并在适用时保留 agent epoch；journal 和 checkpoint replay 会验证与公开 command 相同的 lease、deadline 和 history rule。Envelope admission 要求 active Team 和 channel sender，验证显式 active audience，运行 `send` policy 和被冻结的 adapter，随后原子追加盖章的 Envelope 与 adapter follow-up record。fold 从每个 adapter delivery plan 派生 pending recipient admission；receipt 会移除一条 pending admission 并维护 recipient high-water cursor，重复 receipt 会返回已提交 record 而不会再次追加。root Team 会快照其配置的最大 child 深度。child 同时命名 active parent Team 和未删除的 parent task；Hub 在 child journal 创建期间持有该 parent 的串行队列、派生 child 深度并持久化继承的上限。只有 Team journal 附接 channel id 后，channel 才可见，因此中断后未被引用的 WAL 不会被视为 Team 状态。持久接收先于投影发布和不可变的提交后观察。

首条 `team/created` record 携带 revision-one Team Goal；后续完整的 `goal/changed` record 保留其 compare-and-set 沿袭、phase、仅在 blocked 时存在的说明和 Goal 专用 budget。Hub 通过 `goal-mutate`授权公开的 Goal definition 和 phase mutation；Team resource budget 仍是独立的 creation-time fact。[持久 Team Goal 决策](2026-08-28-durable-team-goal.zh.md)拥有该 objective-state 设计。

只有检查点的序列化、身份、Goal/task-create/task-attempt 语义、pending-delivery ordering、quiescence source 和持久 watermark 一致时，恢复才从该检查点开始；否则恢复会回放 journal 或 WAL。Team journal format 26 与 Team checkpoint format 27 独立于 channel WAL format 5 和 channel checkpoint format 8。quiescence proof 会记录是 fencer 停止了旧进程，还是本地 owner 已结算；只有前者有 cold-replacement 资格。按资源划分的串行队列和持久预期尾部检查会拒绝陈旧命令。游标 watch 在观察当前游标的同一队列内注册，Hub dispose 会关闭准入、在配置的上限内结算已接收工作、尝试写入最终检查点并关闭每条自有流。

只有仍存在 durable human receipt 或准确 pending delivery 时，completion intent 才会保留某条 final。已经过期且没有 receipt 的 final 不能占用 closure authority，因为 TeamRun 和 recovery 都无法确认一条 expiry 已经 durable 的 delivery。Clock 超过 Envelope deadline 本身不会让 delivery 过期。

当 Team 与 Participant grant 都存在时，journal 与 checkpoint 重建采用同一授权包含检查。Operation、workspace mode、read/write scope prefix 与显式 budget ceiling 均不能扩大 Team grant；缺省的 optional grant 仍可读取。Scope prefix 按完整路径段匹配，因此 `packages/team` 包含 `packages/team/review`，但不包含 `packages/teammate`。Journal 与 checkpoint 中的 task owner proposal 必须引用 Team 保留的 participant。离队会保留该 identity，因此历史 proposal 不要求 participant 仍为 active。Checkpoint 校验会双向跟随 reference：workflow task 必须指向其 plan 和 template，而每项 plan binding 必须指向对应的 retained task，并在 channel 存在时指向 attached channel。部分 compiling state 仍然有效。Final admission timestamp 必须位于 Team creation 与 checkpoint cursor 的 update time 之间。拒绝这些不一致能够保留 journal truth，避免发布损坏的 checkpoint fact。

Workflow 的后续 revision 保留每条已接纳的 template-to-task binding，以及一旦存在的 channel binding。新增 channel 不能掩盖 task binding 被删除或改指向；terminal revision 也不能删除或替换 channel。这些检查适用于 journal replay 和有效 checkpoint 之后的 suffix replay，并保留合法的增量 compiling state。序列化格式不变，因为被拒绝的 revision 违反既有 binding 所有权。

Core schema 负责 cancellation/closure 兼容、participant kind/owner 兼容、必填 task creator 与 workflow identity，以及 workflow definition 和内部 binding 有效性。Workflow result schema 要求 template id 唯一且包含全部 selected template；fold 保留准确的 result count 检查，从而建立集合相等关系。唯一 typed result writer `transitionWorkflowPlan` 会先验证 selected template 的顺序与数量，再提交克隆后的 result。Journal 与 checkpoint parser 在 fold 前应用这些 schema；本地 Hub constructor 从已验证的 command input 与已接纳的 state 派生这些字段。Fold 保留跨资源与跨 revision 检查，包括 ready plan 必须有 channel，同时不重复这些 parser 规则。Fold 在创建 workflow map 前只检查一次 identity 唯一性，在校验 allocation transition 前只检查一次 update time。非 cancellation 的 closure cleanup 只接收 closure 白名单已准入的 record，其资源检查仍拒绝新建或重新打开工作。这些共同前提避免重复校验从 caller 到 callee 之间不可能变化的输入。同步 cancellation 白名单在 event dispatch 前拒绝 final-admission 与 goal-change record，因此各自 case 不重复已经执行的 cancellation 检查。

Team 接纳 cancellation 后关闭 human-action admission，completion/failure cleanup 也拒绝新建或重新打开请求。Quiescing 期间的 checkpoint 可以保留此前已接纳的 pending 请求，让 owner 迟到地 resolve 或 cancel。每个 terminal Team projection 都要求 task 与 workflow plan 已终结、workspace allocation 已 released、pending parent-usage ledger 为空、activation 为 offline 且保留 durable `quiescedAt`，human action 已结算。同一检查在每条 journal record 折叠后及 checkpoint 重建后执行，因此 terminal marker 之后的 record 也不能重新打开工作。Quiescing 与 stalled projection 可以保留等待 cleanup 的资源。Channel phase 与 delivery fact 属于独立 WAL stream，仍由 Hub 负责跨 stream 校验。

Workflow result 内容保留其 task-attempt 来源：每个 completed result 必须匹配 task 最后一次 completed outcome，提供的 failure detail 必须匹配最后一次 failed outcome。省略可选 failure detail 仍然合法。Journal replay 与 checkpoint 重建都会验证这项关系，因此即使 task/template id 与 phase 匹配，也不能掩盖被改写的摘要、artifact reference 或失败消息。

当前 task lease 必须各自拥有不同的 wake channel。Checkpoint 重建在构造 task map 前拒绝重复 task identity，因此在单次遍历中用 channel id 集合即可验证 wake 唯一性。Journal assignment 要求 wake channel 已 attached，后续 lease 与 history record 保持这些 identity，attachment 也始终保留。Checkpoint 重建在验证 quiescence 前检查每个保留 attempt 的 attachment。Quiescence proof 随后根据在其 timestamp 结算的已验证 attempt 检查准确 wake 集合，不重复 attachment 检查；outcome 与 active lease 检查仍各自独立。

Checkpoint schema 允许省略 human-action、usage-sample、child-charge、pending-parent-charge 与 workflow-plan 集合；重建时将它们视为空 map。省略 usage 时使用零 aggregate。这些字段在 durable schema 中保持 optional。Quiesced activation 则有独立的 parser 规则：存在 `quiescedAt` 时，必须提供完整的 wake-channel 列表。

Checkpoint 中 activation 的 `quiescedAt` 必须落在所属 Team 的 `createdAt` 与 `updatedAt` 之间。Journal timestamp 的单调性，以及新 proof 的时间必须等于其 record 时间，在 replay 时建立同一关系。Checkpoint 重建会在接纳 activation 前拒绝超出范围的 proof，并回退到 journal。Core binding refinement 与 Hub 的完整 proof constructor 已要求 offline status 和可信 source；fold 保留 record 时间相等以及已接纳 proof 不可变的检查。初建 binding 仍在通用 initial lifecycle transition 前通过专用检查拒绝 proof，以保留准确的 admission 诊断。

Checkpoint 中 activation 的 `fencedAt` 必须落在 Team 创建时间与 checkpoint 更新时间之间，且不能早于已接纳的 closure 或 cancellation 请求。取消场景使用 `cancellation.requestedAt`，因为 terminal cancel closure 在资源清理后写入，可能晚于 fence。Journal record 的单调性与 fence constructor 要求时间等于 record 时间，在 replay 中建立同一下界。Checkpoint 检查保留这些已记录的关系，不把 recovery descriptor 当作进程终止的独立证明。

Root Team 的 outbound parent-charge ledger 始终为空。创建时 map 为空，parent-charge admission 要求存在 parent Team，nested child-charge fold 也仅在 parent 存在时新增 next-hop entry，而 settlement 只删除 entry。Checkpoint 重建会在构造 ledger 前拒绝 root 的每个 pending entry。Team lineage 在 journal replay 中保持不可变，因此 incoming child charge 复用这些已建立的所有权规则，不重复检查 root ledger。

## Alternatives considered

**保留实验性 Lead Session 作为 Team journal。** 不予采纳，因为持久 Team 仍会依赖一个活跃的 Agent／Session 身份，并继承直接子代的恢复语义。

**只在进程内存中保存 Team 和 channel 状态。** 不予采纳，因为重启、HMR 和独立打开的本地 Hub 会丢失或对已接收 Team 状态产生分歧。

**从 Hub 公开投递、Agent runtime placement 或产品 API。** 不予采纳，因为这些角色需要各自的持久所有权和授权规则。本地提供方拥有持久 admission 和 receipt，但不拥有 Agent delivery 或远端 transport；[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)保留远端 replay、scheduler、workspace 和产品工作。

## Consequences

sender-scoped post retry key 在每个 channel 内有上限；达到上限时拒绝新 key，而不淘汰已接受的 retry。

本地 Hub 可以在没有 Lead Session 的情况下创建、恢复、列出、watch 和转换 Team 状态。它覆盖有界 root-or-child Team 层级、带 revision 的 Team Goal、participant 成员关系、持久 activation epoch、带围栏 task attempt 与依赖验证、channel manifest、已认证 Envelope admission、派生的 pending recipient admission、持久 receipt、channel WAL 读取、准确的可见 artifact reference lookup、关闭和游标 watch。它不创建或拥有 participant handle、不选择 task owner、不分配 workspace，也不提供默认产品入口。

pending delivery checkpoint 会为每个 recipient 保留 source order，并拒绝重排后的 projection。因此分页读取只扫描已保留顺序，不必对全部 current pending delivery 排序。

该提供方依赖 `clocky-team` 和 `clocky-storage-log`，绝不依赖 AgentLoop 或实验性 Team 代码。Headless 和 Web 会通过位于 `$CLOCKY_HOME/team-storage.sqlite` 的 SQLite 路由日志挂载它；JSON log storage 仍是显式的开发、测试或 custom-composition backend。未来提供方可以在另一种持久化或 placement 模型上实现相同的 `TeamRuntime` 操作。

Phase 1 决策保持活跃，因为日志约定、身份隔离和 storage 所有权仍约束本提供方。[持久 Team Goal 决策](2026-08-28-durable-team-goal.zh.md)拥有 objective state；[持久 task attempt 与 lease 决策](2026-08-28-durable-task-attempt-leases.zh.md)拥有 task 专用的 attempt/fence 设计。原生工作系统提案保持活跃，因为其后续阶段尚未发布。[隐式 Lead Team 退役决策](../simplification/2026-08-29-retire-implicit-lead-agent-teams.zh.md)拥有已移除的独立实现。

## Verification

Hub 测试将它与真实 JSON 和 SQLite 日志后端组合，重启每种后端，并重建 Team、nested hierarchy、Goal revision、成员名册、activation epoch、task attempt 和已附接的 channel 投影。正式 Headless 与 Web composition test 证明其 Team log 选择共同的 SQLite path，同时 Web domain data 保持在 JSON。测试覆盖深度上限、缺失／删除 task、inactive parent、算术溢出、stale Goal revision、Goal policy、无效 Goal journal/checkpoint 和无效检查点回退；activation identity／Session／residency 拒绝；task dependency/cycle 和 attempt fence rejection；task revision 冲突；有序 WAL 读取；cursor watch；Envelope cursor、membership、policy、adapter、size、atomic follow-up、observer 和 restart 行为；以及 receipt idempotence、high-water ordering、pending-intent validation 和 checkpoint restoration。不变量 companion 会拒绝缺少 Hub 权威已加载投影的提交后 Team、Goal 或带身份的 channel notification。

基于真实 storage 的回归覆盖 JSON 与 SQLite checkpoint 中损坏的 final lifetime、Team/recipient/owner/closure provenance，以及 workflow channel/task/template reference；每项被拒绝的 checkpoint 都会恢复原始 journal fact。其他测试拒绝与 retained WAL content 不一致的 final content proof，并在 closure admission 前拒绝已经过期且没有 receipt 的 final，然后允许之后的 final 使用尚未接纳的 retry key。

序列化 JSON 与 SQLite 回归覆盖 closure 顺序、不可变 child-usage origin、pending parent charge、workspace attempt 所有权与 provider lifecycle timestamp、channel expiry source 与 summary identity，以及部分 workflow checkpoint 恢复。Workflow binding 保留规则同时通过纯 journal 恢复和有效 checkpoint 后追加损坏 suffix 的恢复验证。Invariant companion 保留穷尽式 `assertNever`；仅静态封闭的 `TeamEvent` type alias 对应的 default 与 helper 排除在 coverage 外，同时由 `teamEventSchema` 拒绝未知 JSON event kind。

补充的 JSON 与 SQLite 回归拒绝缺失 creator/workflow 字段、无效 participant owner、损坏的 workflow definition 与内部 binding、自源 child charge、不一致的 usage aggregate，以及失去对应 task attempt 或 Session 的 usage。Quiescence 测试拒绝 active lease、非 quiescence outcome 与不匹配的历史 wake；合法 released attempt 仍可恢复。缺字段的单元 fixture 经过 JSON parser，而不是将不完整对象强制转换成字段必填的 task 类型。

Wake 所有权测试拒绝 current lease 共享或引用未 attached 的 wake，并在 checkpoint 包含任一无效关系时从 journal 恢复不同的 lease。Released task 在其 creator activation 已 quiesced 且 offline 后仍保留该 creator，包括 checkpoint 后的 lease-free 修改。此前已结算的 attempt 仍保留在 history 中，但不会进入后续 quiescence wake proof。缺失、不完整或外来的 wake proof，以及失去 attachment 的历史 wake reference，都会触发 checkpoint 回退，同时保留准确的 quiescence fact 和后续 task 修改。

JSON 与 SQLite 测试先压缩合法的 failed 且 archived Team journal，再读取分别或同时省略各 optional 集合和 usage 字段的 checkpoint。创建前缀已被移除，因此恢复成功证明 checkpoint 被接受，而非 journal 回退。两份 ledger 均省略时保留非零 usage 的验证，仅针对这些 archived Team 读取场景。

Human-action closure 回归使用 JSON 与 SQLite journal/checkpoint 拒绝 cancellation 后的新 admission 与 terminal pending 请求，保留 intent 恢复中的既有 pending 请求，接受迟到的 resolution/cancellation，并拒绝重新打开。无效 terminal checkpoint 会回退到保留原始已结算请求的 journal。

Terminal-resource JSON 与 SQLite 测试拒绝未终结 task（包括 review）、resident 或未 quiesced activation、各类未 released allocation、pending parent charge，以及 compiling/ready workflow。保留未结算资源的 terminal checkpoint 会回退到原始 journal；合法 rules marker 使私有 parent-charge ledger 的拒绝也可被公开结果观察。Completed fixture 基线保留 attached final WAL、独立 admission、匹配的 human receipt 和 closed channel；admission 前的窗口只保留 pending WAL prefix。已结算的合法资源与 intent 后的 cleanup 仍可恢复。这些 fixture 验证 durable 数据关系，其中的 quiescence record 不独立证明进程已经停止。

Workflow outcome 回归先持久化 assigned、running 与 settled task record，再构造 workflow result。JSON 与 SQLite 会拒绝 journal 中被改写的 completed result 或显式 failure detail，并从包含同类损坏的 checkpoint 回退；省略可选 failure detail 的投影仍被接受。

Closure replay 测试先验证完整的 failure/quiescing/terminal/archive prefix，再检查重复 archive 或 archive 后的 record。JSON 与 SQLite 还会拒绝跨 Team intent，以及 failure intent 后新建或重新激活的 task、allocation、activation 和 workflow identity，同时保留合法的 preservation、release、task settlement 与 quiescence cleanup。

Final/closure phase 测试拒绝重复 admission、failure cleanup 期间或 failed 之后的 admission、objective 完成前的 terminal completion，以及已有 closure 不允许的 goal 修改。成功完成的场景保留真实 final WAL、独立 admission、human receipt 和 quiescence fact。Checkpoint 改写 completed goal 的 phase 或 completion intent 关系时，会回退并保留合法的 completed goal。部分 intent 与重复 stalled 更新仍能经过 goal completion 和新的 quiescing transition 恢复。

迟到的 failure/cancellation phase 测试会先恢复序列化且没有保留 closure、没有未结算资源的 failed Team；当前 durable reader 接受该前缀。这个前缀使 phase 检查可被单独验证：正常 driver 生成的 terminal 前缀已有 closure，会先进入 duplicate-intent 或 closure whitelist 检查。该测试证明 durable 输入的可达性，不代表另一套 driver 完成顺序。

Activation-quiescence 的 JSON 与 SQLite 测试拒绝本身格式有效但携带 proof 的初建 binding、与 record 时间不一致的新 proof，以及对已接纳 proof 的修改或完整删除。Resident proof 与缺少 source/wake 字段的输入由实际 journal parser 拒绝。Quiescence 早于 Team 创建时间或晚于记录的 Team 更新时间时，损坏的 checkpoint 会从 journal 恢复原始合法 proof。现有 wake、outcome 与 active lease 检查继续由 durable-workspace 套件验证。

Human task-creation 的 JSON 与 SQLite replay 拒绝缺失或非 human 的 creator reference，以及归属于已离开 human 的新 task，同时在 lease-free 修改与 checkpoint 恢复时保留已有 task 的 creator。不同 task id 不能共用同一 creator/key 对；损坏的 checkpoint 会回退到保留两个合法 key 的 journal。不同 human participant 可以复用相同 key，因为 creator 归属也是 command identity 的组成部分。

Activation-fence 的 JSON 与 SQLite 回归在 checkpoint 时间早于 Team 创建或已接纳的 failure/cancellation 请求时恢复 journal proof。已 stopping 且持有 live allocation 的 activation 通过公开命令和当前注册的 proof source 接纳新 fence，并在完整 quiescence 前保留 release-requested allocation 状态。Checkpoint marker 证明取消场景接受早于后置 terminal cancel closure 的 fence。

Workflow selection 回归区分由 journal parser 拒绝的 selected template 缺失与由 fold count 检查拒绝的额外 result。JSON 与 SQLite 保留准确的 parser/count 诊断，并在任一 checkpoint 损坏后恢复合法 journal；独立 marker 证明合法 selected-result checkpoint 确实被接纳。

Owner-proposal 的 JSON 与 SQLite 回归拒绝 journal 中不存在的 participant，并在相同 checkpoint 引用损坏时恢复 journal 保留的 owner。合法 checkpoint 会保留 marker，以及指向已离队 participant 的 proposal。Summary checkpoint 测试保留真实 source Envelope 和合法 covered range，仅将 summary cursor 移到 checkpoint 之后；source validation 通过，projection 重建则拒绝该 cursor 并恢复 WAL manifest。合法 manifest marker 独立证明 checkpoint 被接纳。

Participant grant 的 JSON 与 SQLite 回归接纳后代 read/write scope，并在 journal 中拒绝只有相邻文字前缀的 scope。Checkpoint 扩大 operation、workspace mode、read/write scope 或 budget ceiling 时，会恢复 journal grant。合法 checkpoint marker 证明收窄 grant，以及允许省略 Team 或 Participant grant 的各场景均被接纳。这些用例验证现有 Participant admission 与 durable reader 规则，不引入 child-delegation consumer。

Root-ledger 的 JSON 与 SQLite 回归接纳 incoming child usage，并在后续 charge 开始 fold 前拒绝 outbound parent-charge record。损坏的 root checkpoint 在 pending-ledger admission 处被拒绝并恢复原始 aggregate；nested checkpoint 仍保留 next-hop charge。准确诊断和 checkpoint marker 明确指出哪个既有所有权检查拒绝了各类 serialized 不一致。
