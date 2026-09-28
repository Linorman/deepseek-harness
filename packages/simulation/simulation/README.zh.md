# Simulation

[English](README.md) | 中文

`ctx.simulations` 注册具名的持久 run 提供方。调用 `resolve(request)` 时显式指定提供方、create/open 模式、run 身份、时钟单位/原点/最大值及规则/策略版本，再将结果传给 `open()`。提供方返回由调用者持有的句柄，支持 `snapshot()`、校验 revision 的 `setPhase()` 和排空操作的 `close()`。注册受 effect 作用域约束；缺失或重复的提供方会被拒绝。

`inspectEntity(id)` 返回独立的实体快照及同次观察的 run 身份和全局 revision，不复制无关历史。未知身份不包含实体；写入仍校验预期 revision 和权限。

时间使用规范的非负十进制字符串，按 run 最大值校验并按数值比较。run 身份使用独立于 Session 和 Team 身份的品牌类型。[本地提供方](../simulation-local/README.zh.md)拥有存储与协调器排他控制；[设计提案](../../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)拥有完整协同设计。

`reserveParticipant()` 在 Team IO 前记录不可变本地角色配置与规范身份。绑定必须匹配该预留；引导未完成时禁止 run 进入运行状态。`reserveChannel()` 保留稳定的 direct 频道身份、有序成员与限制；`confirmChannel()` 在执行前记录已完成的挂接与端点同意。

`SimulationRun.change()` 拥有管理侧 Entity 与组织变更。`changeMany()` 验证有序变更，并通过一次原子追加发布；任一变更无效或写入失败时保留原状态。Entity 的 kind/cognition 不变，profile 单独记录 revision；终止状态不可逆。run 配置声明关系端点类型和时态环约束。关系可带组织 `scope`，但规则必须通过 `scopeKinds` 明确允许该实体类型；环检查限定在同一作用域。`relationsAt(time, scope)` 选择该组织，`null` 选择无作用域的事实，省略则选择全部事实。关系采用半开模拟时间区间及 revision 校验，`relationsAt()` 按稳定 id 顺序返回结果。这些方法不是面向模型的提案工具。确定性决策先保留不可变策略版本与输出，再使用相同的提交／接受协议；选择策略后禁止推理。

认知实体可保留一个不可变的 Team/Participant/Session 绑定及一个 writer epoch。`reserveWriter()` 返回仅供控制器持有的 lease；启用、撤销和确认停稳后的释放共用 run 队列。未释放 epoch 会阻止后继 writer，并阻止释放 run 所有权。`onClose()` 安装唯一且不可重入的运行时退役回调。[Team 集成](../simulation-team/README.zh.md)提供实际控制器证据及服务端生成的 Session 身份。

`SimulationRunSpec` 必须提供 `maxTokensPerInterval`、`tokensPerModelRequest`、`budgetInterval`、`maxDecisionsPerInterval`、`maxMessagesPerInterval`、`maxPendingEvents`、`maxPendingInteractions`、`maxKnowledgeBytes`、`maxKnowledgePerQuery`、`maxQueuedDecisions`、`maxDispatchWaitRounds`、`maxEntities`、`maxResidentActors`、`maxIngressBytes`、`maxConflictRetries`、`decisionTimeoutMs`、`maxDecisionsPerWindow`、`maxOperationsPerDecision` 和 `maxResourceQuantity`。writer 安装实时决策准入检查，打开串行 slot，再提交暂存操作。接受会原子持久化决策与全部意图，不会执行效果。run 执行器按 slot/index 顺序结算本地操作，重试返回已记录的不可变结果。资源采用固定单位的整数字符串。精确的一次性授权允许跨实体转移；请求只有经受理者接受才创建承诺，兑现必须有匹配的世界证据或债权方确认。

`scheduleWake()` 分配并持久化 `(time, microstep, phase, slot)` 键。`drive({ until })` 按显式的 `maxDriveSteps`、`maxMicrostepsPerTime` 和 `phaseOrder` 策略结算本地操作与事件。事件消费在返回前记录持久唤醒责任或期限事实。调度决策认领自己的 wake；接受会完成该责任，取消或 writer 退役则将其交回重试。

`openWindow()` 通过一次追加冻结有序角色集合、一个 run revision 及全部授权上下文。角色独立持久提交提案；`commitWindow()` 按 slot 顺序接受，并在首个未完成 slot 处停止。世界操作与时钟推进等待窗口关闭。取消保留 slot 并将其 wake 归还 pending；writer 退役会取消未接受提案。

`communication/post` 将接收者、频道、文本和 `deliverAt` 固定在已接受意图中。`dispatchOperation()` 仅在就绪后调用可信且幂等的 `SimulationTeamTransport`，校验精确回执，并按显式 `outboxMaxAttempts`/`outboxRetryDelayMs` 持久记录现实时间尝试。预算耗尽会记录未知结果并停滞；`retryOutbox()` 记录新的重试预算，不改变身份或 payload。已到期但尚未确认发布的消息会阻止接收者打开新决策。

模型决策在首次请求前记录一个现实时间截止点。完成时间与提案提交或接受共用批次。未完成决策到期后变为 `cancelled`，原因是 `timeout`；其 wake 回到 pending，窗口后续 slot 可继续。回放使用已记录时间，不启动计时器。

资源读取版本冲突在后续 microstep 为每个决策生成一个重试责任。新决策从 wake 继承根决策与次数；重启不会重置谱系。`maxConflictRetries` 限制这些自动机会，零表示首次冲突就停滞。耗尽记录为 `SIM_CONFLICT_RETRY_LIMIT`；`acknowledgeConflict()` 保留失败结果和预算，再由调用方显式恢复。已应用操作不会自动重放。等待未来依赖的旧操作保留所有权，不阻塞重试窗口准入。

`ingest()` 原子记录外部文本、接收顺序与已分配事件键。同一 id 保留原载荷与分配；冲突重试会拒绝。暂停或窗口冻结期间仍可接收输入。可用时间不早于当前模拟时间，事件不能进入旧窗口。`maxIngressBytes` 限制完整 UTF-8 JSON 回执。来源标签是归属说明，不是权限。

`population()` 从持久实体和 writer 派生计数。`maxEntities` 包括 active 与 inactive 实体；不可逆终止释放人口额度，但保留历史。`maxResidentActors` 为 reserved、active 和 revoked writer 保留额度，直到确认释放。创建／预留折叠在运行时启动前强制这些限制；重启后仍保留计数，直到控制器完成对账。

`collectDecisionWakes()` 在 `maxDriveSteps` 内，按原事件键顺序汇集时间、microstep 和阶段相同的待决策事件。返回 work-limit 时须继续汇集后再提名；已认领 wake、已提名候选、其他阶段与后续 microstep 都会阻止继续汇集。部分汇集在重启后保留。`queueDecision()` 保留不可变的管理优先级、可选期限及 wake 身份。`reserveDecisionWindow()` 持久分配不同角色的顺序：等待达到 `maxDispatchWaitRounds` 次分配的候选先按入队顺序，再比较最早期限、降序优先级与入队顺序。`openWindow()` 必须保持分配结果。队列容量包含已预留候选；取消已选候选时，`cancelQueuedDecision()` 取消整个未打开分配。轮数与入队序号提供等待年龄并在重启后保留；驻留和上下文解析在选择后执行。

`budgetUsage()` 从已打开决策和已接受消息意图计算区间用量。区间从模拟零点按 `budgetInterval` 的整数倍划分；取消和传输重试不退款。超额窗口或消息提案不会被部分接受，并记录 `SIM_BUDGET_LIMIT`。`extendBudget()` 以不可变重试身份和原因给单一区间追加容量；显式恢复要求足够容纳被拒绝的需求。追加容量不结转到后续区间。每次模型尝试在派发前按 `tokensPerModelRequest` 预留 `maxTokensPerInterval` 额度。完整 usage 计费未缓存输入、缓存和输出；部分或缺失 usage 至少保留预留额及更高的已观察用量。`reconcileTokenUsage()` 对账未知尝试，不重复推理。报告超额时须确认并补足区间容量才能恢复；预留不代表提供方已强制执行 token 上限。

`queueUsage()` 计入待处理事件及 pending/claimed wake，以及未解决的交互。仅回复过期不释放未解决交互；完成、取消或拒绝会释放容量。`maxPendingEvents` 和 `maxPendingInteractions` 限制这两类积压。容量失败记录 `SIM_QUEUE_CAPACITY`，不会部分发布业务效果及其衍生事件。释放容量或幂等 `extendCapacity()` 后可显式恢复；历史记录仍保留。

`recordKnowledge()` 保留归属与类别不变的观察、已接收报告、推断、配置化信念和策略派生摘要版本。`queryKnowledge()` 结合固定游标／时间与历史及当前读者权限，并以非递归遍历检查全部推断与摘要前提。候选选择优先使用显式 id，并在取得指定数量的授权结果后停止。`prepareContext()` 可指定知识 id 和必需／可选标记；按决策归属及快照选择，再使用现有字节预算。撤权拒绝后续检索／提交，不删除已保留的 Session 历史。报告要求特定接收者回执及精确正文；推断要求前提确实选入其已接受决策。

## Model Experience

### Run administration

#### What the model sees

`ctx.simulations` 不直接向模型提供内容；run 管理不会请求推理，也不改变 Session 上下文、token 用量或 KV-cache 前缀。

#### Token effect

无直接 token 消耗。

#### KV Cache effect

不修改模型请求前缀。

## Known Limitations and Deferred Work

- run 使用单一本地协调者；分布式执行和分支身份重映射尚未实现。

信念／推断置信度是 `[0, 1]` 内的可选策略数据，不改变可见性或世界权限。摘要保留精确前提版本与策略版本，当前来源撤权也会阻止后续摘要检索。未来才可用的新版本不会遮蔽查询时刻仍可用的旧版本。

被压缩的报告引用可在不改变决策身份、快照与来源版本的情况下重物化。展示保留必需分节预算及此前哈希，Session 修复只接受权威当前／此前展示。必需内容过大时须取消并以适当预算重新准备。 根预留或已完成检查点会在实体绑定前固定规范执行 Team。绑定、根预留、检查点发布和连接均须与该持久身份一致；未确认的根 Team 不能发布为完整检查点。
