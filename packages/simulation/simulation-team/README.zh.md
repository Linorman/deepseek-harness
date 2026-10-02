# Simulation Team 协调

[English](README.md) | 中文

`reviewTask(request, authorize?)` 通过绑定到不可变 Participant reviewer 的准确 active 实体处理已记录的任务完成结果，无需激活 reviewer 或请求推理。请求包含运行内 `commandId`、原 `attemptId`、`reviewerEntityId`、任务 `expectedRevision`、`nextPhase`（`completed` 或 `pending`）及已去除首尾空白的非空 reason。running 与 paused run 均允许审核；检查点采集、关闭与来源退役会撤销权限。可选的调用方准入检查在入口、Hub 策略 IO 前后的 proof 验证及所有者等待后运行。Hub 在策略 IO 前后重新核对原生来源，并将原 command 持久保留在审核历史。相同重试返回保留该决定的当前规范任务；变更载荷会拒绝。后续 attempt 出现后的旧命令重试不能审核该 attempt，也不能将其事实附到旧的原生执行记录。受理后将当前原 attempt 事实对账至 Native。参见[审核权限决策](../../../.agents/notes/implemented/architecture/2026-10-01-simulation-task-review-authority.zh.md)。

`ensureTeam(run, creation, ownerName)` 在 Hub IO 前将根 Team id 预留到 run 日志，再确认持久结果。响应丢失后的重试保留原身份与创建载荷。关闭会排空已受理创建；根 Team 未确认前禁止连接、实体绑定与运行。此方法在连接生命周期所有者之前调用。

`ctx.simulationTeams.attach(run, teamId, ownerName)` 将已打开的 run 连接到专用 Team，其不可变的 `rules.activationLifecycleOwner` 必须等于 `ownerName`，`rules.simulationRunId` 必须匹配 run id。返回的连接将认知实体绑定到尚未激活过的 active 本地 Participant，生成稳定 Session id，提供激活、恢复对账及关闭时的激活排空。所有实体保持一个规范执行 Team。

`ensureParticipant(entityId, participant)` 在 run 暂停时预留不可变角色配置及 Participant/Session 身份，再对账邀请、成员激活与绑定，不启动 Agent。配置冲突会拒绝；引导未完成时禁止运行；关闭会排空已受理的拓扑 IO。 邀请与阶段转换的每次响应都必须匹配预留 Participant，才能完成绑定；身份不匹配时保留可重试预留。

`ensureChannel(request)` 预留一个 direct-v4 身份与有序成员，对账原始 WAL 和 Team 挂接，再取得每个规范 Session 端点的同意。恢复保留邀请截止时间，不启动 Agent。成员或限制变化会拒绝；频道确认未完成时禁止 run 执行。

`invitation(entityId)` 提供冻结到规范 Session 的频道创建选项。`acknowledgeInvitation(entityId, channelId)` 无需激活认知或请求模型即可确认该 direct-v4 端点。可撤销 proof 绑定精确邀请与当前 active 实体；邀请过期或权限撤回时拒绝确认。已确认频道在接收者休眠期间保留待投递消息。连接关闭会排空已受理的独立邀请确认后再释放 run 所有者，包括没有驻留 Agent 的情况。

激活控制器同时约束直接调用和连接调用。启动始终持久预留 Team 容量，并将该预留与 Simulation writer epoch 关联。集成在启动前固定真实 in-process 提供方，精确绑定持久化后才启用 writer，终止前撤销写入权，确认停稳后才释放。缺失所有者、身份不符、重复绑定和外部运行时实现均拒绝。模型权限仅在绑定成功后发布；被拒绝的重试保留原有 writer。run 角色额度在提供方启动前预留，控制器直调用也适用。revoked 或状态不确定的 writer 保留额度，直到控制器确认释放；Team 容量独立生效。

run 关闭在其写队列之外调用连接退役。关闭失败时保留所有权以便重试。恢复区分已提交绑定、未发布启动及尚未通过领域准入的 Team 预留；run 锁继续排斥其他活跃协调器。[Loader fixture（测试前置数据）](../../../examples/headless-agent/tests/fixtures/simulation/simulation-team/cordis.yml)及其子进程测试覆盖两个存储后端。

`hibernate(entityId)` 为闲置角色关闭新的认知和投递准入，排空已受理投递、检查点持久化 Session，再停止精确的控制器所属激活。open 或 submitted 决策须先结算。检查点或终止失败时保留 writer 容量以供重试。`resume(entityId, request)` 复用已证明停稳的规范 Session，不启动推理；待处理投递输入会在下一决策前恢复。未知启动历史需要显式恢复。模型派发在获得模型许可后预留 run token 容量。流清理在结算及释放许可前 flush Session 用量；缺少完整终止用量时保留预留额。每次重新进入模型流都会独立分配尝试。能证明取消发生在下游派发前时，释放预留额度。

`ensureResident(entityId, choice)` 使用显式启动参数与有序候选列表，仅休眠闲置且决策已结算的角色；容量不足和 writer 未确认分别返回明确结果。`driveResident(request, clock, choose)` 在投递需要休眠接收者时应用该策略，遵守相同的协调轮数上限，并在推理前停止。此驱动运行期间拒绝其他协调调用。

`registerDeterministicPolicy()` 注册具名、版本化、同步且有界的策略。`executeDeterministicDecision()` 在规范角色的维护锁内，以冻结的授权视图执行策略。选择与输出均持久化，重试复用已记录输出，提交与资源操作仍使用原权限检查。 此入口同样接受与 JavaScript 属性同名的不透明决策 id。已选策略的决策不能请求推理或预留模型 token。策略属于可信插件代码，必须无 IO。关闭会排空已受理计算并阻止晚到接受。已完成的确定性投递 wake 会在后续认知或休眠前退役精确 inbox 副本，不伪造模型轮次。知识报告若已有规范 Team 原文，则仅引用而不重复正文；原文不在当前模型上下文时，才物化获准的保留正文。压缩后缺少的报告原文会从同一知识版本重物化，持久记录展示变化并重新核算预算；必需内容超限则停滞。被遮蔽的 Simulation view 会重新追加，不替换无关历史。确定性窗口应在打开时声明 `policy`，使冻结视图保留完整报告内容。调用方提供的报告可见性提示不能省略策略所需的报告正文。

`openWindow()` 在 run 冻结 slot 前解析各驻留角色的上下文预算与共享 Team cursor。`executeDecision()` 可并发运行这些角色并返回 `submitted`；`run.commitWindow()` 执行有序接受。`cancelDecision()` 退役未完成 slot，不复用其身份。

`openDecision()` 与 `submitDecision()` 从所连接实体推导 writer。run 写队列内部检查存活 Agent 和当前 Team 成员权限，因此直接提交到 run 也不能跳过已安装的准入检查。退役会立即关闭新准入，即使持久撤销失败也是如此。

Config 要求正整数 `maxContextBytes`、`deliveryPageSize`、`maxCoordinationRounds` 与 `maxConcurrentModels`，以及非负整数 `maxQueuedModels`；上下文预算按选中 content-block 数组的 UTF-8 JSON 字节数计量，与模型路由的总 token 上限分开。`prepareContext()` 接收已授权的分节与来源引用。run 保留身份、权限、输入、目标、承诺以及其他标为必需的分节；可选分节按优先级整段选择，能放入预算才保留。必需内容超限会持久停滞为 `SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW`；取消该决策、调整部署预算并显式恢复后，再分配新 slot。

推理前，pre-step 所有者要求当前决策已准备上下文，追加或精确替换其 `simulation/context-view`，flush Session 后再次检查 writer 的实时权限。模型派发时，准备输入必须属于当前活动的 Agent 回合。stream 必须匹配已记录的请求头、对话及唯一的当前 view，并在 token 预留后再次复核。已消费输入和请求头在内的完整请求前缀会先 flush，再复核 writer 权限与取消状态，然后才构造下游 stream。flush 失败会阻止推理；该对话策略不准入辅助模型用途。重复准备保留同一份选中内容、策略指纹和 input id。

模型许可由此服务的所有已连接 run 共享。等待采用有界 FIFO；取消会移除等待者，已授予许可则保持计数直到下游流清理结束。准入后再次检查权限与已记录请求。`modelUsage()` 返回预留／执行和排队计数。决策截止时间包含准入等待。连接关闭取消自身等待者；服务卸载先关闭全部准入，再停止所属角色。

`executeDecision()` 准备并派发一个驻留角色的决策，然后确认精确输入所属回合结束、提案已提交或接受且 Session 已持久 flush。超时返回已记录的取消结果。未提交与上下文超限会拒绝；重试复用已记录的选择，不重复已消费输入。 决策 id 是不透明标识；与 JavaScript 对象属性同名的值也保持有效，并保留相同的重试身份。[公司场景](../../../examples/simulation-company/README.zh.md)通过此入口运行双实体模型流程。

run 的必需配置 `decisionTimeoutMs` 从首次模型准入尝试起覆盖全部模型与工具步骤。先记录超时，再中断匹配输入的 Agent。暂停不会延长此基础设施截止时间。已完成提案不会因等待 slot 次序而超时。服务关闭立即停止所有已连接 run 的新准入，并开始关闭这些连接，包括等待其他 run 引导工作结束期间。未提交的空闲回合仍保留计时器；提交、激活释放或连接关闭时清理，关闭会排空已受理的超时写入、输入持久化、直接 outbox 派发、收件查询与失败对账、休眠、恢复查询和模型决策完成，并在释放连接前等待普通及自动驻留协调驱动结束。

`dispatchDecision()` 先 flush 固定身份的控制输入，再调用 `Agent.wakePending()`。并发重试共享准入过程；已消费输入只返回持久状态，不再次唤醒。新 slot 运行前会退役终态决策遗留的待处理输入。这些状态表示输入投递，不表示业务接受。

`dispatchOperation()` 通过 direct v4 发布已接受且到期的通信。仅运行时存在的 proof 绑定完整 draft、重试键、run、decision、operation、接受 revision 与指纹；Hub 复核目标成员与策略。writer 退役不取消已接受发布。撤权后只允许对账精确匹配的既有结果，不允许新增发布。发布回执不证明接收者 Session 已持久化，也不代表业务接受。

`receiveOperation()` 通过专用 claim/receipt proof 和共享 direct-v4 renderer 服务驻留接收者。它按精确身份去重，flush Session，原子记录投递事实与 wake，确认 Hub，再将回执保留到 run。在此完成前，`run.drive()` 返回 `delivery-required`。新决策前可在本地恢复已准入输入，无需 Hub 再次通知；已确认回执不会导致重复输入或重复推理。

`connection.drive(request, clock)` 在 journal 调度与必要的发布、接收之间推进，由 `maxCoordinationRounds` 限制轮数。遇到决策需求、接收者未驻留或忙碌、技术重试期限、未知结果或调度上限时返回明确状态。同一推进期限的并发调用共享进度；当前调用结束前，其他期限会被拒绝。调用者在返回后负责驻留和决策处理。

协调器只将精确持久的 `channel/delivery-expired` 记录认定为目标投递失败，不以频道阶段或临时读取错误推断失败。`reconcileDeliveryFailure()` 保留已记录输入，为 flush 后中断的输入重建 wake，在规范活跃 writer 下确认输入缺失，或记录不可逆实体终止。完成对账并显式恢复前，run 保持停滞；业务承诺独立处理。

`modelRequest()` 将观察、提案暂存与提交绑定到注册表拥有的 Agent、当前 writer 和已消费的准备输入。观察返回冻结的选中分节；暂存在该 epoch 内替换完整列表，已接受提交在退役后仍保留。工具执行守卫只允许这些角色调用三个 Simulation 工具。

仅用于检查重放状态的句柄可关闭而不退役历史 writer；一旦受理变更、恢复或注册退役所有者，关闭就必须等待 writer 完全停稳。准入前校验失败会释放 run 锁而不修改持久 writer 记录，允许原样修复来源后重试。

物理退休后，`assignTask()` 可为原任务选择经 Native 校验的 `continuation`，处理已兑现的转移承诺。它保留原交互身份，不对账已关闭承诺。新任务输入和启动使用新 attempt／epoch。Native 只允许无提案确认，并以旧退休 assignee 的精确转移证据完成；模型提案不能重复原效果。Hub 保留原剩余尝试、取消、结果与审核检查。仍存活旧 attempt、无关或已取消承诺不能授权 continuation。

已送达报告的 `reportContinuation` 固定原退休 attempt、创建操作与 prepared context 指纹。Native 要求精确规范报告交付及最新退休前序；输入记录 selector，支持模型输入重建与 SDK 检查。新确认不能提交额外效果。新的返工不能复用历史报告证据。每个任务决策拥有单 slot 有序窗口；executor 恢复自己的精确窗口，restore 只在 writer 已物理退休后取消已提交 slot。规范任务取消先落盘再清理 writer，阻止未受理提案及模型 token 准入，保留已受理效果供对账。

## Model Experience

### Cognition residency

#### What the model sees

`ctx.simulationTeams` 创建或恢复实体的本地 Agent 与 Session。已准备决策将记录的补充上下文和一条带标识的控制消息提供给模型；收到的 direct 内容沿标准 Team 投影呈现一次。`tool-simulation` 消费者提供观察、暂存和提交工具。

#### Token effect

驻留和准备上下文不会启动推理。获准请求包含选中的上下文块；省略的可选分节不消耗模型 token。

#### KV Cache effect

稳定 Session 跨 epoch 替换保留。上下文刷新替换一个旧 view 并保留其他消息；view 变化会从其所在位置起使请求前缀缓存失效。

## Known Limitations and Deferred Work

- 决策选择与授权上下文仍由调用方拥有。冲突重试提供持久 wake，但决策选择与刷新上下文仍由调用方拥有。只有领取该输入已消费事件的决策，才将 ingress 正文及回执引用作为必需上下文。ingress 不修改世界事实，也不授予权限。
- 恢复仅支持本模块的真实同进程运行时组合与本地存储。外部运行时恢复和 fork Session 种子明确拒绝。

`registerSummaryPolicy()` 注册有界、同步且无 IO 的摘要策略。`summarizeKnowledge()` 只提供显式授权子集，不传入读者元数据或 Session／频道背景历史。生成前和发布时检查所有目标读者，精确重试复用保留输出。此过程不要求驻留或模型请求，关闭会排空已受理摘要写入。

模型型压缩在派发前通过 `compaction/request` 记录完整请求。Simulation 仅接受压缩所有者为规范 Session 活跃事务标记的精确选项，先持久化请求，再共享决策的模型并发和 token 计量。辅助预留保留压缩身份而不创建世界决策；未知用量跨重启保留，等待显式对账。writer 撤销停止辅助准入，并仅取消该 writer 的 stream；退役等待提供方清理与 token 结算结束后，才释放 Session 与驻留额度。改写已归属请求的 Session 路由或用途，会在提供方 IO 前拒绝。模型无关后端使用相同的上下文修复路径，也涵盖压缩原始报告而保留当前 context view 的情况。

`assignTask()` 在 Hub 分配规范任务前，显式保留调用者持有的 attempt 身份。所选实体必须已驻留。runtime-only proof 绑定原创建、任务 revision、actor／epoch、ordinal 与 lease 时长；Hub 在 policy IO 前后复查，并保留原能力、工作区、预算与重试检查。分配不交付模型输入，也不启动推理。响应丢失保留原选择；精确重试先读取同一目标 attempt，再决定是否分配。已知终态事实保留原回执。

Controller quiescence 在旧 writer 停止后退休待处理执行关联。被该 quiescence 中断的 Simulation task lease 以 `SIM_WRITER_RETIRED` 失败；其他任务释放保留原语义。原生观察及退休记录在已受理清理期间仍可写入。检查点排空分配 IO，保留或退休对应责任，按采集的 Team 校验目标尝试及 controller 证据。安全驻留淘汰跳过仍有未决任务执行的实体。自动任务选择仍由场景负责。

`executeTaskDecision()` 在创建输入前记录有序 decision／predecessor 身份及规范任务说明。必需 context input 分区通过既有 `simulation/context-view` Session 事件，在配置上下文额度内保留精确 task／attempt／epoch／来源数据。Session inbox 刷新后，原生输入回执才授权 Hub 专用 attempt start，再唤醒 actor。同 decision 重试复用已记录 context 及推理结果；另一 decision 必须保留前驱及原因。任务与决策索引在原生重放后保留。模型／工具准入复查实际 task lease 及已记录说明。提交仍使世界效果保持 pending；效果应用也不会完成 Team 任务。完成证据由已注册的场景策略负责。

`reconcileTask()` 从规范 Team 所有者读取由 Simulation 创建的任务。不可变创建者、原幂等 key 与已受理创建回执必须对应当前 run。日志保留创建操作、任务 revision、阶段及当前或最后已结算尝试的身份；观察到的执行者必须是交互指定的 assignee。完成任务须有精确已完成尝试，包括审核完成。普通 Team 创建的任务和无关回执会被拒绝，不修改交互或承诺。首次关联后不能更换任务。后续观察拒绝旧 revision 或同 revision 的事实变更。任务执行与承诺状态独立：只有显式的 `task-completed` 策略从任务完成派生兑现；转移与债权方验收策略仍要求各自证据。撤销承诺不会取消 Team 任务，后续任务完成也不会复活承诺。已接受的 `task/create` 操作复用 outbox 的尝试、到时调度、重试预算与未知结果恢复。目标证明保留完整任务字段（包括评审策略），只允许在 Team 授权与额度范围内创建 Participant 任务。创建回执标识任务，不证明执行完成或承诺兑现。

`collectCheckpointCandidate(maxDrainRounds, maxAttempts, signal?)` 关闭新的连接准入，暂停调度并取消本地回合，保持 Session 存活直到已受理工作排空，再经生命周期所有者停止本地激活。它持有 run 切点，收集并复核 Team、channel 和物理 Session 引用；只对观测到的游标／来源移动重试。返回的候选尚未发布，准入保持关闭直到 `release()`。释放后调度仍暂停，角色仍已退役。历史缺失、保留策略未受保护、激活静止尚未确认或存在子 Team 所有者时会拒绝。收集与恢复还根据精确频道记录核对已应用发布，根据不可变 Team 创建归属核对任务回执；各所有者独立的指纹不能单独证明这些引用。MVP 要求所有者保留完整历史；不使用逐检查点引用固定，也不发布 manifest。

`checkpoint(request, signal?)` 原子保留请求并暂停调度，收集所有者后，在一条 run 日志记录中发布 manifest 与完成结果。请求携带实现版本和收集范围限制。处理中请求阻止恢复调度和新外部输入。相同终态请求返回原结果；发布失败保留上一个完整 manifest。manifest 绑定完整 run 前缀内容、待处理责任及受保护的所有者引用。 manifest 区分已物化的 Session 前缀与尚未物化的规范身份。只有不存在 run writer 和保留的 Team 激活时才允许记录未物化状态，并在发布前重新确认；已执行的历史缺失必须拒绝。

收集及恢复失败通过[结构化原生诊断](../simulation/README.zh.md)指明实际阶段和规范所有者／引用。明确规则检查提供类别；未知 provider IO 标为来源不可用，来源移动错误保留有界重试规则。公开诊断不包含私有错误正文或物理路径。恢复保留主验证错误及独立清理错误，close 失败时标明清理未确认；失败不能允许执行或替换成功检查点。

`restore(selection, request, signal?)` 独占打开已有 run，校验所选已完成 manifest 与实现版本，验证 Team／channel／Session 保留前缀和当前后缀，再通过生命周期所有者退役中断的 writer。返回由调用方拥有的暂停 run 和连接，不调用模型或执行 outbox。重试重新验证当前后缀，不回滚检查点之后已接受的工作。所有者移动只有限重试；前缀缺失、不兼容或变化均在执行准入前拒绝。 恢复仅在控制器证明 writer 已退役、全部 slot 已接受或取消后关闭中断窗口。已提交提案保留为取消证据，不在恢复时接受；此前已接受意图、释放的 wake 和未结算 token 预留仍然持久保留。窗口关闭写入失败可重试。 根预留或已完成检查点会在实体绑定前固定规范执行 Team。绑定、根预留、检查点发布和连接均须与该持久身份一致；未确认的根 Team 不能发布为完整检查点。 收集要求 Team 生命周期所有者与当前连接一致，且 run 已确认的每个频道仍列于该 Team。收集与恢复还要求每个已记录的 writer 激活 id 在保留的 Team 激活历史中匹配规范 Participant 和 Session，包括已释放的 writer。超时持久化失败会取消匹配的已准备模型输入，即使错误报告也抛错；不会伪造持久超时结果。截止时间所有者关闭与角色退役会等待已受理的超时写入，包括模型派发前就已过期的决策。检查点获取与连接关闭会排空已受理的直接激活调用，包括进入控制器前的查询。取消获取会结束等待，但不取消已受理启动。进程退出留下的未发布 Team 预留由生命周期控制器对账；即使 run 尚无 writer，未释放预留也会阻止 manifest 收集。

`registerTaskCompletionPolicy()` 以 effect 注册有版本、同步、有界的规则，读取冻结且脱离原对象的世界及原尝试视图。`completeTask()` 固定该版本，等待 actor 结束，再于目标结算前保留不可变终态意图。Native 独立核对精确关联的已受理决策及已应用操作；通信还须接收者持久化证据。提交或发布本身不能完成任务。Hub 结算证明重查当前 writer，保留普通结果、审核、取消与预算检查。已受理结果在策略移除或响应丢失后仍按原意图重试，不重复推理或效果。冲突的终态尝试保留为中断；审核完成及交互履约分别负责。

任务 decision 可选择精确已注册的确定性策略。认知选择在 attempt 关联中不可变；重放拒绝不同版本或模型／策略替换。producer 在 actor maintenance 锁内将已准备 context 及精确已消费输入记录到 Session，刷新后启动规范 task，再进行纯计算。它不创建模型 turn 或模型请求。策略输出沿用普通决策受理与世界操作检查；效果应用后使用相同完成规则。精确重试复用已保留输出。

`assignTask()` 可显式选择已接受的交互。Native 原子预留原 attempt 并关联规范 pending task，核对 assignee 与开放承诺。任务跨重试及后续尝试保留该关联；普通任务不能事后增加关联。必需 context 记录关联及原预留来源。完成流程在窗口关闭后对账较新事实，等待必需审核，并跳过已关闭承诺。开放承诺条件在 Native 队列内再次检查；取消不会写部分关联或复活履约。只有 `task-completed` 从 completed task 派生兑现。
