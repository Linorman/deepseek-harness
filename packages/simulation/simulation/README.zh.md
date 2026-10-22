# Simulation

[English](README.md) | 中文

`rawArchive(selection)` 是 provider 拥有的只读保留能力，与回放检查分开。结果明确未执行 Native 验证，不能作为可写 run 或检查点使用。公开消费者必须在调用前独立授权完整历史记录正文。

`updateRunControl()` 持久化精确的 Host 停止目标与幂等命令回执。Native 时钟和显式版本化的领域时钟分别解释；`checkStopBoundary()` 提供纯纠错检查，不改写提案。外部执行尚未确认时，新目标在对账前保持 pending；触达边界后冻结已受理责任，并按显式预算暂停或收尾。检查点状态与暂停分别表达。解除目标不会自动恢复运行。 保存重试保留同一停止命令与切面，追加新的物理检查点尝试，保留每个失败 Native 检查点。只有真实完成的 Native 切面与提供方明确的备份覆盖才能标记完整保存。

`recordDriverObservation()` 追加安全调度事实，不修改 Native phase。开始记录绑定 owner/batch，只有当前匹配批次才能成功或失败收尾。回放保留最近观察并拒绝过期回调。journal 版本 102 拒绝旧格式；历史事实不能证明当前存在实时 owner。

`WorldDefinition.limits` 必须提供非负安全整数 `maxBirthsPerInterval` 和 `maxExternalExpansionsPerInterval`；零禁用对应动态创建。`maxPendingMutations` 固定为字面量 `1`。招聘和外部代表预留保留 Native 拥有的 `reservedAt`，首次准备后保留不可变 `prepared.time`/`sequence`。结构计费使用这些事实及原结果时间，包括取消结果。已记录模型上下文包含冻结的 `worldLimits`。[Native owner](../simulation-local/README.zh.md)定义周期计费与共享未结责任。


World schema 拒绝返回最多八条字段路径与解析错误，诊断文本有界，完整原始 Zod 错误保留为 cause。可修正的 payload 错误不会提交计划，也不会重置已准备的规划尝试。

显式 `WorldDefinition.hiringFees` 与可移植 v1 的 `organization.hiringFees` 按录用操作及岗位声明一次性资金费用，包含既有收支账户、单位、数量、原授权和模拟预留期限。请求者在请求前读取获准费用条款；Native 从原请求者派生资金权限。共享资源台账扣除全部 active 承诺。生成招聘在 IO 前同批保存身份与资金；既有人物招聘保存原资金承诺，不分配新人物。提交同批结算支付、任职、结果及 wake 责任。普通资源工具不能结算 World owner 的 hold。身份 IO 未知时，资金保留至 canonical 清理确认；墙钟时间不推进模拟期限。原件重试不刷新价格、账户读集或到期时间，终态历史也不退还额度。

Activation 历史拒绝保留原 Team 上限、startup reservation/activation/Session 身份和 Native writer epoch。已确认清理要求 writer 已释放；未确认清理仍计入占用。退休或新管理命令不腾出历史容量。保留的拒绝阻止再次启动，须对账原 startup 并创建新场景。

辅助 compaction 拒绝在 journal stream 102 保留规范 writer、Session、compaction/request 位置及完整请求指纹。不扣未分发 token，并原子取消当前未提交的自有决策、归还 wake。暂停时仍保持暂停；显式继续使用新事务与决策并保留旧证据。

普通决策的共享模型池拒绝以 `decision/model-blocked` 保留已刷盘的 Session 请求位置和当时池/队列限额。当前 writer 原子取消未提交的尝试、归还 wake 并记录 `SIM_MODEL_POOL_CAPACITY`；已结束的单决策窗口在同一批次关闭。并发用户暂停仍保持暂停。占用数是历史证据：回放不预留许可或重启推理，显式继续创建新决策并保留旧尝试。

协议输入通过浏览器安全的 `./world` 和仅类型的 `./world-types` 入口提供。纯 `./world-domain`、`./world-domain-types`、`./world-domain-registry` 和 `./world-domains` 入口定义严格领域封装、typed 引用及内建 parser 目录。可信 `configureWorld()` 在初始 binding 与私有通道准备后冻结唯一 director、组织作用域授权、有限 Persona 模板及请求/计划限额。`openHireIntent()` 按 run、domain、operation 和业务申请 business key 派生身份；同身份变更 requester、目标或前案引用会拒绝。同一请求者、组织和岗位的最新案件因资料不足被拒绝后，新申请必须提供原 `priorRequestId`；该前案必须保留相同拒绝结果。其他人物、作用域、未结案件、取消或其他拒绝原因均不能作为前案。原申请重试保留已接受字段和结果。模型 `world/request` 提供显式 domain/operation/version、business key 和严格已安装 payload；主体、规范 binding、writer epoch 与 Decision 来源由 Native 派生。已消费的可信 `goal` 上下文允许当前任职且有授权的普通成员在 acceptance 创建未预建 HireIntent 的事项；角色文本不授予权限。当前招聘 payload 要求 `expectedTime: null` 及空 evidence。一个请求展开为本地 intent 及依赖它的标准私有 post；`world/resolve` 保存完整 apply/reject 计划，接受不等于入职。申请/规划作用域决策不能替换成普通消息，director 决策要求 resolve 权限。每个已准备的 resolve 决策占用一次有界规划尝试，后续取消也保留计数。无关日志 revision 不使计划失效；岗位/授权/任职显式 read-set 变化保留 stale 计划。

`SimulationWorldDomainRegistry` 在不可变 schema 引用下共同登记四类严格 payload parser。未知 domain/operation/version 及未知 payload 字段在 acceptance 前拒绝。`register()` 返回异步 disposer：同步关闭新准入、排空原 generation 的执行 lease，并保留精确 parser 供回放；相同 pin 和 parser 偷换会拒绝。provider 用 `ctx.effect()` 包裹登记。此库不安装任意 Native reducer，也不授予执行权限。Native stream 102 在每次世界 acceptance 中记录由已消费上下文派生的显式实现 pin；回放不从最新实现补齐缺失 pin。计划保留 typed 岗位、授权关系、世界定义和任职集合读集，无关 revision 不使计划 stale。 已固定的 Native domain 可把 `resultNotificationRole` 设为 requester 或 director；省略时保留请求者通知。Native 从不可变请求/World 定义派生 actor；其排队 wake、回放和已消费结果视图必须与该角色及精确已确认私有 Channel 端点一致，模型输入不能选择 sender。

可信 `cancelWorldCase()` 在 Native 历史中保留原命令回执及唯一结构化业务结果。取消先于计划结算则获胜，已有拒绝则返回 `already-resolved`；重试保留原命令和终态结果。拒绝与取消原子追加仅含安全结果索引的 wake，不推理、不公开私有解释。准备中取消保留 `cancel-requested` 与占用，已提交入职返回 `already-committed`；`onWorldHireCleanup()` 绑定规范运行时 owner；`settleWorldHireCancellation()` 在 Native 队列外对账该 owner，再原子保存清理、abandoned/terminated 身份、原取消回执和结果 wake。未知 IO 保留占用；终态重试不执行目标 IO。`assertSimulationWorldPreparationAdmission()` 根据原可执行入职事项检查全部相关成员，在取消或已接受计划失效后撤销新的身份拓扑 IO；持久身份观察仍可用于清理。可信 `reserveWorldHire/prepareWorldHire/commitWorldHire` 持久保存身份、要求原停稳维护 owner 并原子提交任职/ready/结果/wake；这些管理方法不向模型工具开放。容量、失效与原件核对由 [Native provider](../simulation-local/README.zh.md)拥有。结果/首次行动上下文只能在精确原 wake 与 actor 下选择不可变结果及获准新人。模型必须提交 Native 冻结的安全结果通知，或通过原招聘者通道普通自我介绍；私有解释不进入公开上下文。

`beginMaintenance()` 保留唯一的可信维护 owner，关闭新 writer、决策、调度提名、任务执行和时钟推进；owner 排空期间，已接受的决策与发布回复仍可结算。`quiesceMaintenance()` 要求调度暂停、窗口/决策结束、writer 已释放且没有在途发布；`finishMaintenance()` 重验这些条件，绝不自动恢复运行。精确重试保留原状态，变更 owner 或并发维护以 `SimulationMaintenanceError` 拒绝。旧完成请求不能释放新的 owner。调用方负责外部 IO，并须在后续启动前另行维护用户暂停意图。

`SimulationEntity.readiness` 必须显式指定，且独立于 `phase`：可信 `entity/create` 调用方对已授权的初始实体选择 `ready`，对分阶段身份准备选择 `preparing`；缺失字段会拒绝。只有暂停且无窗口的 `entity/readiness` 命令可以将 active/preparing 实体结算为 `ready`（认知实体还需规范 binding）或永久的 `abandoned`，且不能有未退休 writer。普通决策、调度提名、任务执行和 writer 预留要求 ready。profile 文本与 Team active 成员状态不授予 readiness。管理创建属于可信入口，模型工具不能调用这些命令。

`budgetInterval()` 与 `budgetUsage()` 从保留的 Native 事实派生当前区间准入、显式追加额度与已计费 token；本地 provider 与产品读取复用同一函数。`simulationTokenCount()` 与 token 总计费精确求和，超出安全整数范围时拒绝。unknown 或 reserved attempt 至少保留预留额度及更高的已观察用量；不可用的算术不能显示为零。

`attributeSimulationTokens()` 将每个 Native reservation 恰好归入业务选择、裁决、结果收尾、通信、压缩或 unknown。类型化压缩所有权与匹配的已消费 Native context 提供归因；可选的规范 Session 日志进一步核对精确输入和请求身份。证据缺失或冲突时保留 unknown；通信和业务共享的请求不拆分。运行指标仅公开固定大小的汇总：结算状态计数、未结算预留、已结算 input/output/cache 桶，以及独立的 unknown 已观察用量。分类与整个运行的总量逐项对账；token 不代表货币费用。

`simulationResidentSlots()` 拥有与本地 writer 准入及 `population()` 共用的预留谓词：reserved、active 与 revoked writer 在 release 前均占用容量。恢复数量包含非 active writer，以及无所有者或所有权证据不可用时保留的 writer。这是已占用准入容量，不是进程存活证明。`simulationRuntimeMetrics()` 额外提供区间宽度、unknown token attempt、open／submitted decision 加 queued／reserved nomination、未结算外部意图及明确 unknown outcome；只读取权威状态，不执行、恢复或披露上下文。浏览器 DTO 可通过 `./metrics-types` 导入纯类型声明。

`SimulationInspectionSelection.includeRecords` 请求在 `SimulationRunObservation.records` 中返回经回放验证的原始日志条目。不传时保持仅元数据／snapshot 的检查。这个受信任原生选项不授予产品权限，消费者必须分别授权并删节原始值；读取不打开 writer，也不改变模拟时间。

浏览器 DTO 可从 `./time-types` 导入 `SimTime` 品牌类型；此仅类型时钟声明不包含 provider、Session 或 Cordis 扩展。根 API 保留相同的品牌类型导出。

`./identities` 同样提供不含运行时声明的原生 entity、decision、decision-slot、operation、checkpoint 和 writer-epoch 品牌类型。现有根/schema 导出保留相同类型和持久编码。

检查点失败可保留 `SimulationCheckpointDiagnostic`：固定的管线阶段、规则类别及规范 run／Team／频道／Session／实体／检查点对象。公开读取方从 `./checkpoint-diagnostics-types` 导入声明，从 `./checkpoint-diagnostics-schema` 导入严格解析器；这两个入口均不挂载服务。`SimulationCheckpointError` 将这些事实与私有 message／cause 分开，`SimulationCheckpointCleanupError` 保留两项原错误并独立标明清理未确认。任意 provider 消息或属性不能确定公开类别；读取方仍须在读取关联对象正文前鉴权。

Checkpoint manifest 8 通过定义/投影承诺及明确的原责任记录绑定完整 World 内容，包括补证问题/修订和裁决/延迟事件状态。完整 run-prefix 和 Session 引用绑定 Persona、上下文、资源、通知及清理历史，不复制私密正文。发布和回放拒绝遗漏或改变的引用。[引用覆盖](../../../.agents/notes/implemented/architecture/2026-10-14-world-checkpoint-reference-coverage.zh.md)拥有 record sequence 和格式策略。

`resolveInspection()` 在 `inspect()` 读取现有历史前校验 provider 支持和不可变 expected spec。可选的 provider inspection 不会回退到 `open()`，并区分缺失状态。`SimulationRunObservation` 包含完整可信原生状态及所有权观察；读取方负责鉴权和公开删节。它不恢复 writer 状态，不改 run phase，也不执行运行。

`ctx.simulations` 注册具名的持久 run 提供方。调用 `resolve(request)` 时显式指定提供方、create/open 模式、run 身份、时钟单位/原点/最大值及规则/策略版本，再将结果传给 `open()`。提供方返回由调用者持有的句柄，支持 `snapshot()`、校验 revision 的 `setPhase()` 和排空操作的 `close()`。注册受 effect 作用域约束；缺失或重复的提供方会被拒绝。

`inspectEntity(id)` 返回独立的实体快照及同次观察的 run 身份和全局 revision，不复制无关历史。未知身份不包含实体；写入仍校验预期 revision 和权限。

时间使用规范的非负十进制字符串，按 run 最大值校验并按数值比较。run 身份使用独立于 Session 和 Team 身份的品牌类型。[本地提供方](../simulation-local/README.zh.md)拥有存储与协调器排他控制；[设计提案](../../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)拥有完整协同设计。

`reserveParticipant()` 在 Team IO 前记录不可变本地角色配置与规范身份。绑定必须匹配该预留；引导未完成时禁止 run 进入运行状态。`reserveChannel()` 保留稳定的 direct 频道身份、有序成员与限制；`confirmChannel()` 在执行前记录已完成的挂接与端点同意。

`SimulationRun.change()` 拥有管理侧 Entity 与组织变更。`changeMany()` 验证有序变更，并通过一次原子追加发布；任一变更无效或写入失败时保留原状态。Entity 的 kind/cognition 不变，profile 单独记录 revision；终止状态不可逆。run 配置声明关系端点类型和时态环约束。关系可带组织 `scope`，但规则必须通过 `scopeKinds` 明确允许该实体类型；环检查限定在同一作用域。`relationsAt(time, scope)` 选择该组织，`null` 选择无作用域的事实，省略则选择全部事实。关系采用半开模拟时间区间及 revision 校验，`relationsAt()` 按稳定 id 顺序返回结果。这些方法不是面向模型的提案工具。确定性决策先保留不可变策略版本与输出，再使用相同的提交／接受协议；选择策略后禁止推理。

认知实体可保留一个不可变的 Team/Participant/Session 绑定及一个 writer epoch。`reserveWriter()` 返回仅供控制器持有的 lease；启用、撤销和确认停稳后的释放共用 run 队列。未释放 epoch 会阻止后继 writer，并阻止释放 run 所有权。`onClose()` 安装唯一且不可重入的运行时退役回调。[Team 集成](../simulation-team/README.zh.md)提供实际控制器证据及服务端生成的 Session 身份。

`SimulationRunSpec` 必须提供 `maxTokensPerInterval`、`tokensPerModelRequest`、`budgetInterval`、`maxDecisionsPerInterval`、`maxMessagesPerInterval`、`maxPendingEvents`、`maxPendingInteractions`、`maxKnowledgeBytes`、`maxKnowledgePerQuery`、`maxQueuedDecisions`、`maxDispatchWaitRounds`、`maxEntities`、`maxResidentActors`、`maxIngressBytes`、`maxConflictRetries`、`decisionTimeoutMs`、`maxDecisionsPerWindow`、`maxOperationsPerDecision` 和 `maxResourceQuantity`。writer 安装实时决策准入检查，打开串行 slot，再提交暂存操作。接受会原子持久化决策与全部意图，不会执行效果。run 执行器按 slot/index 顺序结算本地操作，重试返回已记录的不可变结果。资源采用固定单位的整数字符串。精确的一次性授权允许跨实体转移；请求只有经受理者接受才创建承诺，兑现必须有匹配的世界证据或债权方确认。

`scheduleWake()` 分配并持久化 `(time, microstep, phase, slot)` 键。`drive({ until })` 按显式的 `maxDriveSteps`、`maxMicrostepsPerTime` 和 `phaseOrder` 策略结算本地操作与事件。事件消费在返回前记录持久唤醒责任或期限事实。调度决策认领自己的 wake；接受会完成该责任，取消或 writer 退役则将其交回重试。

记录的暂停以 `SimulationDecisionPausedError` 拒绝已有所有者的已准备决策继续推理。live writer 可通过 `cancelDecisionForPause()` 结算该精确未接受模型 slot，归还原 wake 并保留全部 token 计费。重复取消只读；已接受、确定性或无关失败工作不能改标为暂停。显式继续从保留的 wake 打开新 slot。

`openWindow()` 通过一次追加冻结有序角色集合、一个 run revision 及全部授权上下文。角色独立持久提交提案；`commitWindow()` 按 slot 顺序接受，并在首个未完成 slot 处停止。世界操作与时钟推进等待窗口关闭。取消保留 slot 并将其 wake 归还 pending；writer 退役会取消未接受提案。

`communication/post` 将接收者、频道、文本和 `deliverAt` 固定在已接受意图中。`dispatchOperation()` 仅在就绪后调用可信且幂等的 `SimulationTeamTransport`，校验精确回执，并按显式 `outboxMaxAttempts`/`outboxRetryDelayMs` 持久记录现实时间尝试。预算耗尽会记录未知结果并停滞。`retryOutbox(request, authorize?)` 为准确的当前 unknown 外部意图及正数 attempt-count fence 记录一次原始有界额度。不可变请求保留稳定 grant id、operation id、规范化 reason 及原受理现实时间。相同重试在后续 attempt、结果、phase 或冷重放后返回原 grant，变更载荷则拒绝。grant 保留 operation 身份与 fingerprint，不发布或恢复调度。已到期但尚未确认发布的消息会阻止接收者打开新决策。

模型决策在首次请求前记录一个现实时间截止点。完成时间与提案提交或接受共用批次。未完成决策到期后变为 `cancelled`，原因是 `timeout`；其 wake 回到 pending，窗口后续 slot 可继续。回放使用已记录时间，不启动计时器。

资源读取版本冲突在后续 microstep 为每个决策生成一个重试责任。新决策从 wake 继承根决策与次数；重启不会重置谱系。`maxConflictRetries` 限制这些自动机会，零表示首次冲突就停滞。耗尽记录为 `SIM_CONFLICT_RETRY_LIMIT`；`acknowledgeConflict()` 保留失败结果和预算，再由调用方显式恢复。已应用操作不会自动重放。等待未来依赖的旧操作保留所有权，不阻塞重试窗口准入。

`ingest()` 原子记录外部文本、接收顺序与已分配事件键。同一 id 保留原载荷与分配；冲突重试会拒绝。暂停或窗口冻结期间仍可接收输入。可用时间不早于当前模拟时间，事件不能进入旧窗口。`maxIngressBytes` 限制完整 UTF-8 JSON 回执。来源标签是归属说明，不是权限。

`population()` 从持久实体和 writer 派生计数。`maxEntities` 包括 active 与 inactive 实体；不可逆终止释放人口额度，但保留历史。`maxResidentActors` 为 reserved、active 和 revoked writer 保留额度，直到确认释放。创建／预留折叠在运行时启动前强制这些限制；重启后仍保留计数，直到控制器完成对账。

`collectDecisionWakes()` 在 `maxDriveSteps` 内，按原事件键顺序汇集时间、microstep 和阶段相同的待决策事件。返回 work-limit 时须继续汇集后再提名；已认领 wake、已提名候选、其他阶段与后续 microstep 都会阻止继续汇集。部分汇集在重启后保留。`queueDecision()` 保留不可变的管理优先级、可选期限及 wake 身份。`reserveDecisionWindow()` 持久分配不同角色的顺序：等待达到 `maxDispatchWaitRounds` 次分配的候选先按入队顺序，再比较最早期限、降序优先级与入队顺序。`openWindow()` 必须保持分配结果。队列容量包含已预留候选；取消已选候选时，`cancelQueuedDecision()` 取消整个未打开分配。轮数与入队序号提供等待年龄并在重启后保留；驻留和上下文解析在选择后执行。

`budgetUsage()` 从已打开决策和已接受消息意图计算区间用量。区间从模拟零点按 `budgetInterval` 的整数倍划分；取消和传输重试不退款。超额窗口或消息提案不会被部分接受，并记录 `SIM_BUDGET_LIMIT`。`extendBudget()` 以不可变重试身份和原因给单一区间追加容量；显式恢复要求足够容纳被拒绝的需求。追加容量不结转到后续区间。每次模型尝试在派发前按 `tokensPerModelRequest` 预留 `maxTokensPerInterval` 额度。完整 usage 计费未缓存输入、缓存和输出；部分或缺失 usage 至少保留预留额及更高的已观察用量。`reconcileTokenUsage()` 对账未知尝试，不重复推理。报告超额时须确认并补足区间容量才能恢复；预留不代表提供方已强制执行 token 上限。

`queueUsage()` 计入待处理事件及 pending/claimed wake，以及未解决的交互。仅回复过期不释放未解决交互；完成、取消或拒绝会释放容量。`maxPendingEvents` 和 `maxPendingInteractions` 限制这两类积压。容量失败记录 `SIM_QUEUE_CAPACITY`，不会部分发布业务效果及其衍生事件。释放容量或幂等 `extendCapacity()` 后可显式恢复；历史记录仍保留。

`recordKnowledge()` 保留归属与类别不变的观察、已接收报告、推断、配置化信念和策略派生摘要版本。`queryKnowledge()` 结合固定游标／时间与历史及当前读者权限，并以非递归遍历检查全部推断与摘要前提。候选选择优先使用显式 id，并在取得指定数量的授权结果后停止。`prepareContext()` 可指定知识 id 和必需／可选标记；按决策归属及快照选择，再使用现有字节预算。撤权拒绝后续检索／提交，不删除已保留的 Session 历史。报告要求特定接收者回执及精确正文；推断要求前提确实选入其已接受决策。

`SimulationTaskExecutionRequest.interaction.execution` 区分 `obligation` 与 `continuation`。前者要求已接受的开放承诺。后者只允许对已兑现转移继续处理，且完整证据须来自同一任务、assignee 和规范 Session 的已物理退休旧 attempt。它不改写交互或承诺。新 attempt 记录并消费自己的输入，受理无提案的决策；任何世界提案均被拒绝。只有完成这次确认后，结果才可引用精确原转移证据。已取消承诺、无关证据、仍存活旧 writer 及复用 epoch 均拒绝。

`SimulationWorldError.failure` 为 `SIM_WORLD_LIMIT` 保留 Native 拥有的精确额度类别：岗位、实体、历史成员、通道、字节、申请、命令、计划、出生、外部展开或未结结构变更。消费者根据该数据分类，不解析诊断文字；限额错误的构造必须提供类别。

`organization.hire-existing/1` 接受已有人物及精确组织/岗位请求。apply 与 mutation 重复原请求；拒绝 Persona、Participant 和 Session 字段。委员会选择区分 `finite-template` 与 `existing-person`，后者固定原人物 revision 和 profile hash。typed reads 包含 canonical binding hash 和跨 scope 的任职 subject set。已安装招聘审批提案 artifact 使用 schema/native `/2`；Native 持久 stream 拒绝旧格式。

`PersonnelObligationQuery` 选择精确人物或任职 revision，完整 metadata envelope 上限为 1,024 项和 1 MiB。稳定 typed refs 指明 Native、Team 或 Channel owner 及支持的处置。`native-only`、`partial` 和 `overflow` 保持不完整；`covered` 表示已观察全部所选来源账簿，包括仍有未知责任时。它不授权离职，也不执行取消。领域 provider 从原 pinned 请求明确派生额外关联人物。

外部请求使用严格的 `external.interact/v1` parser 和已安装的 `clocky.external.availability/1` 模拟规则。Native 派生原调用者，在请求受理时保留稳定的 `(run, scope, externalKey)` 身份，并将实际库存输入、typed known/unknown 结果与业务结果共同提交。计划只能确认规则求值，不能指定数量、sender 或观察事实。typed `resource-owner-set` 读项检测库存新建和余额变化，无关账户不会使计划过时。仅向请求者披露原主体在所选单位下的库存；资金和私密规划正文不进入结果，所有账户保持不变。真实适配器、URL、凭证、source/sink 效果、调控者裁决仍不受支持；代表准备使用独立 v2 操作。

`external.interact/v2` 安装模拟代表联系与有限的已接受 Persona。Native 在 IO 前保留唯一原 generation 和全部 Entity/Participant/Session/Channel 分配；停稳准备将 `represents`、ready、安全结果及请求者联系 wake 原子提交。外部组织保持非认知，并继续拥有原账户。并发联系通过明确受理的 reuse 计划复用原 generation。`reserveExternalContact()` 和 `commitExternalContact()` 保留每个调用者的 canonical 私有 Channel 和安全结果；同一调用者复用原 Channel，另一调用者获得独立 Channel，仍使用同一代表 Person/Session。联系正文包含 Native 派生的请求者身份与单位，使代表能够真实回复，不接受任意 sender 字段。准备中代表取消只在原 canonical owner 证明 IO 排空、身份终态和未物化 Session 后结算，已确认历史继续保留。`onExternalContactCleanup()` 与 `settleExternalContactCancellation()` 在冻结的停稳维护下仅撤回原联系。另一个原有未结事项保留共享调用者 Channel；没有保留方时，必须有 canonical 终态或明确缺失证明。代表 Person/Session 与原资源保持不变。未知读取或关闭结果保留责任；所有旧联系关闭后，后续明确的新 case 分配新会话。可移植 v1 定义可配置这些操作；[故障 runner](../../../examples/simulation-company/tests/world-r06.snapshot.ts)验证原身份与清理责任跨进程丢失保持不变。

`./world-evidence` 与 `./world-evidence-types` 定义严格的补证询问、带作用域来源引用的文本回答、不可变 challenge/revision 记录及品牌身份。领域注册可声明有限的 `evidenceFields` 字段集合。注册复制并冻结该集合；在保留的 schemaRef 下改名、改写说明或移除字段会拒绝。`./context-reference` 是共用来源引用解析器。Native provider 与 World driver 保留补证问题和修订、核验原私有通知消费与有限期限/次数，并继续原案件；Definition 导出本身不启动认知。

[预登记环境评估器](../../../scripts/world-environment-registered-evaluate.ts)接受 `register`、`run` 和 `verify`，其后可指定项目内已存在的输出目录。它冻结真实项目源码，不受调用者工作目录影响；登记和原始结果不能覆盖已有证据。验证重新计算确定性对照，校验执行元数据及登记/开始/完成的先后顺序，拒绝源码漂移、被修改的结果和额外报告字段。报告保留每次试验、失败和模拟生产成本；算术/schema 探针、未执行的模型 judge 与暂缓的人工评分分别记录。[评估决策](../../../.agents/notes/implemented/architecture/2026-10-19-world-environment-evolution.zh.md)限定其仅比较资源的适用范围。

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

`external.interact/v3` 声明调控者裁决的环境事实、有限延迟叶子、类型化失败、未验证报价和有限代表准备。World 定义冻结完整裁决策略参数；缺少策略时拒绝安装此操作。条件使用封闭 schema，资产或承诺声明保留原 Native 证据。权威事实使用 `clocky.world-fact/external-adjudicated/1`，包含类型化声明、观察时刻和精简的原裁决／事件引用。未验证报价保持为报告。实际认知版本和来源引用由 Native owner 提供，模型输出不能指定它们。代表计划提交时，在一个有容量限制的原子批次中保存原请求者首次联系 wake、调控者结果通知、ready 状态和代表关系。

请求在裁决前保留允许的联系、库存和报价维度，Native 将输出单位绑定到这些原维度。低权限结果使用固定报告／失败模板、不透明事件身份及原请求者声明的证据；调控者原叙述和完整证据仍保留在原裁决正文中。

场景主动环境请求要求原有限日历和显式选择支持的领域。每次实际 occurrence 记录可用的 director wake 或独立 `maxRequests` 额度耗尽。Native 从原来源派生 trigger、稳定 business key、作用域和目标；复制 ID、角色文本和任意 wake 都不能授予权限。已接受案件保存实际 Director Decision/binding/epoch 与 trigger，`notificationOperationId` 为 null。请求、规划和结果观察分别消费有因果来源的 Native 上下文，经相同 Agent 工具和共享公平队列执行，不创建发给自己的 Channel/Envelope。普通请求保留真实私有通知及收件消费证据。拒绝或取消的场景案件仍占额度，每次 occurrence 只准入一个业务身份。延迟环境后果消费原持久 leaf 和结果 wake。Native stream 102 拒绝早期格式；compiler 9 保留独立场景额度及声明的已安装能力。

`resource/reserve` 保留真实 actor、完整守恒交易、一次性 grant ID 及有限模拟 `expiresAt`。commit/cancel 要求原 ID/revision。可用量不含 active 借方预留；复用 grant、stale reads 和恰好到期时提交均拒绝。终态历史仍占必需冻结的 `maxResourceReservationHistory`，取消或到期 ID 不能创建另一 hold。

WorldFact 与 Norm 可以选择历史内容时间/cursor，但 `scope-members` 读取使用所提供 Native 前缀中的当前 active 组织任职。过去查询时间不能恢复已结束的任职或失活岗位/组织权限。原历史前缀仍可重建原选择，已保存 Session view 不改写。Prepared context 为选中的作用域正文保留 Native 派生 `worldScopeAccess`；重复准备、上下文重取及模型准入重验它，不替换旧 view。Prepared goal 在披露时也要求原任职及操作授权关系仍有效；招聘费用、候选人/任职机会与委员会规则共享请求准入的当前目标、active 端点及 relationRules 检查。所有附带提案正文的上下文（包括 request/result）还在 `governanceAccess` 保存原投票授权引用；缺少原证据或撤权后拒绝披露。新作用域公告使用相同成员规则；已接受公告的冻结收件人不改变。

`simulations.inspectPersonnelObligations(selection, query)` 通过已安装 provider 读取有界的 Native snapshot 与配对人员清单，不打开可写 run。历史缺失返回 `undefined`；不支持的 provider 拒绝。该 metadata 读取不 attach Team、恢复执行、改变 phase 或调用模型。纯入口 `./personnel-obligations` 向浏览器和 SDK 导出原 owner/reference schema。

`GenerationJob` 固定实际披露输入、audience、模型/prompt/策略版本、单次尝试及有限 token/输出额度。`transitionGeneration()` 在 incorporate 前持久化原 canonical 身份、原始输出、取消和验证；Host 提供实时披露授权。生成费用与 actor、compaction 调用共用 `budgetUsage()`。`PlannerAssignment` 另绑定已安装领域的未结请求、Native 冻结读集、effect allowlist 以及有限父任务/深度/子任务/token 额度。director 只有在其 Session context 消费精确已验证输出后才能选择 `generationJobId`；原单一 Native 计划队列保留 stale、supersedes 历史。助手输出不会授予 world 权限。 planner 准入同时检查当前分配的完整子树预算及祖先预算，包括模型池排队后的分派前检查；子任务已知或已观测超支会阻止新的推理，根 planner 也不例外。
