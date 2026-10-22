# Simulation Team 协调

[English](README.md) | 中文

`requestCapacity()` 复用 Company/World driver 的纯构造器，度量已知必需初始上下文子集。UTF-8 字节包含实际 block 数组包装及 JSON 转义；Team owner 的 `maxContextBytes` 可在分配 run、Team 或 Session 前拒绝该子集。token 使用运行时 token meter 和已安装的 `inputSafetyFactor` 估算；存在 `requestPolicy` 时，以输入估计、至少一个输出 token 和安全余量对照冻结的单请求额度及实际模型窗口。这是已安装准入策略下的下界，不是提供方 tokenizer 的精确计数；没有该策略时 token 可行性仍为 unknown。度量明确返回 `coverage: required-subset`、`completeEnvelope: unknown`、`futureConsumption: unknown`：system prompt、tools、动态领域输入/历史及后来新增角色属于额外上下文。通过检查不证明完整请求或全年预算可行，原 run 额度保持不变。

决策收尾从当前实际消费输入对应的 Session 终止事件传递结构化提供方 code/status/retry-after；历史其他失败 turn 不会替换当前决策结果。Native 准入、暂停和超额取消保留各自终态语义。

`ensureResident()` 在 resident 额度已满、未释放的非 active writer 或缺失本地 writer 仍占用时返回需要恢复。腾位期间，只有直接且带类型的 provider 停止拒绝，并且原 writer epoch 同一且已 revoked，才转为该结果；其他 runtime 失败仍拒绝。原 epoch 继续收费，重复安置既不启动另一人物，也不重复退休 IO。持有未结算决策或任务的 active 人物仍不可驱逐，并产生普通容量拒绝。恢复结果指向持有未恢复 epoch 的人物，容量结果指向等待安置的人物。

结构维护在持久 pause/cancel 改变来源后重新收集新 Native cut。原 `maxAttempts` 限制所有尝试，每个 cut 只做一次收集。Team/Session 移动仍可重试；无控制历史变化的 Native 移动、缺失证据和次数耗尽仍拒绝。

Collection 和可写 restore 把实际 Participant descriptor 与原 Native reservation 比较，并把已确认 Channel manifest/consent 与原永久 Session endpoint 核对，覆盖所选 checkpoint 之后创建的 owner。姓名、role、capabilities、runtime hints、adapter/limits、required consent 和 manifest fingerprint 不能悄悄改变。关闭 Channel 和退休成员保留合法生命周期，原不可变来源检查不要求其 active。缺失或不一致来源在 phase 改变、attachment 或 writer recovery 前拒绝；已接受 publication receipt 仍要求原精确 Envelope。

World 恢复除 Native parser/reducer catalog 外，还要求显式安装 execution 工厂 catalog。`restore()` 先在取得可写 owner 前纯检查原 journal，持有精确执行 generation lease，并核验所有冻结操作和保留的 request/plan/result/mutation payload 是否符合共享 strict parser 合同。取得独占 open 后，在改变 phase、附着 Team 或恢复 writer 前再次检查。缺失或替换的版本拒绝恢复，不选择 fallback。Lease 覆盖已准入的恢复 IO，成功和失败都释放；安装和纯检查不构造 handler、不调用模型。基础仿真不要求 World execution catalog。Product owner 也在退休先前持有的 run 前验证 provider。

checkpoint 和可写恢复以已消费 Session turn 中原成功 `simulation_stage` 及后续 `simulation_submit` 核验世界提交拒绝；缺失、变更或外来工具参数拒绝恢复。普通消息只有直接且严格的 Hub Envelope 字节拒绝，精确匹配原 Team/Channel/sender/key 和完整 draft hash，才确定为拒绝。普通非法参数、cursor 错误及丢回复保留未知 outbox 责任；Hub 先按 sender/key 读回，再验证字节上限。


仅在 controller 明确报告清理已确认或未确认后，才消费 Hub 历史拒绝。Native 记录核对原 Participant/Session/reservation 及已释放或仍计占用的 writer。checkpoint/恢复重验真实 Team 历史和 startup 释放证据。直接重复激活也不能为已阻塞实体再创建 raw handle。

辅助池拒绝在 LLM 错误规范化之前持久保存。checkpoint 和可写恢复重验原已刷盘请求指纹、事务/start 引用及 provider/model；原件缺失或改变时拒绝恢复。已分发的流及其未知用量仍保留到 provider owner 结算。

普通决策流在模型池和等待队列同时满时返回含精确占用的类型化拒绝。在 LLM 层规范化错误之前，当前规范 writer 在 Native 保存已刷盘的 Session 请求位置并取消未提交的决策，归还原 wake，不重新分发已经消费的输入。已接受效果和已退休 epoch 不能转换为此类拒绝。

提交世界操作前，规范 Session owner 验证已准备上下文与已进入步骤的控制输入，在 Native 写队列外 flush Session，再证明精确事件位置和 view hash。director resolve 还要求已消费原始私有通知，包括由原 Envelope 派生的精确消息。Native 将回执绑定到当前 writer、规范 Session 和冻结上下文；直接提交未消费内容会拒绝。checkpoint 收集与可写恢复把保留回执同完整 Session 历史核对。普通非世界决策提交保持既有合同。Native 结果与新人首次行动上下文也要求在普通通信提交前持有精确已消费视图回执。结果文本/路由由 Native 冻结；首次行动仅限原招聘者通道。没有规划上下文的 director 决策只允许普通通信。

`quiesceForMaintenance()` 先记录 Native 维护 owner，再通过 checkpoint collector 暂停、排空已接受 IO、退休规范 writer 并验证跨 owner 引用。它在记录 Native 停稳前释放临时 cut；持久维护 owner 继续阻止直接激活。失败或取消保留 draining 责任，未确认终止的 writer 仍占用容量。返回的 quiescent 状态允许可信调用方准备身份，然后显式 `finishMaintenance()`；过程不发布 checkpoint，也不自动恢复运行。

激活准入在不可变 Team lifecycle owner 中检查 Native 实体的显式 readiness，并在 Native writer 预留时再次检查。preparing 实体可以准备规范 Participant/Session binding 与通道，但直接控制器激活和 checkpoint 恢复均不授予普通执行资格。恢复仍保留仅可退休的 writer 能力，以便受阻实体释放已证明停止的 writer。入职案件取消或已接受计划失效会撤销 Participant、Channel 与端点同意的准备 proof，排队及迟到回调同样适用。同意检查预留通道的全部成员，现有角色不能为已取消新人授权。目标已写入的身份仍保留供清理；撤权不结算未知 IO，也不释放容量。可信 `cancelWorldCase(request)` 先记录取消，再排空已接受准备，通过精确可撤销 proof 只关闭原两个私有通道、退出原 membership，最后调用 Native 原子结算。只有排空后 owner 明确返回 not-found 才证明不存在；存储失败或未确认回复保留责任。发现意外 activation/task/Session 或额外通道责任会拒绝。此未激活新人路径要求 Session 尚未物化。checkpoint 与可写恢复根据当前 Team/Channel/Session 历史验证清理证据，保留身份且保持暂停。 共享联系取消在原冻结维护 owner 下使用独立清理来源。它排空 Channel 及邀请 IO，保留另一个原有同调用者事项，或证明独占通道终态/缺失，绝不退役 ready 代表及其 Session。已撤回且无人保留的通道与已取消历史 key 拒绝新 IO。checkpoint 与恢复核验已保留 Channel 前缀，即使原保留方后来提交或取消；未知读取或 closing 状态不能释放责任。

`reviewTask(request, authorize?)` 通过绑定到不可变 Participant reviewer 的准确 active 实体处理已记录的任务完成结果，无需激活 reviewer 或请求推理。请求包含运行内 `commandId`、原 `attemptId`、`reviewerEntityId`、任务 `expectedRevision`、`nextPhase`（`completed` 或 `pending`）及已去除首尾空白的非空 reason。running 与 paused run 均允许审核；检查点采集、关闭与来源退役会撤销权限。可选的调用方准入检查在入口、Hub 策略 IO 前后的 proof 验证及所有者等待后运行。Hub 在策略 IO 前后重新核对原生来源，并将原 command 持久保留在审核历史。相同重试返回保留该决定的当前规范任务；变更载荷会拒绝。后续 attempt 出现后的旧命令重试不能审核该 attempt，也不能将其事实附到旧的原生执行记录。受理后将当前原 attempt 事实对账至 Native。参见[审核权限决策](../../../.agents/notes/implemented/architecture/2026-10-01-simulation-task-review-authority.zh.md)。

`ensureTeam(run, creation, ownerName)` 在 Hub IO 前将根 Team id 预留到 run 日志，再确认持久结果。响应丢失后的重试保留原身份与创建载荷。关闭会排空已受理创建；根 Team 未确认前禁止连接、实体绑定与运行。此方法在连接生命周期所有者之前调用。创建载荷可提供完整 `limits`；Native 在 IO 前保留它们，bootstrap proof 覆盖该字段，TeamHub 独立拒绝超过部署上限或改变原限额的载荷。

`ctx.simulationTeams.attach(run, teamId, ownerName)` 将已打开的 run 连接到专用 Team，其不可变的 `rules.activationLifecycleOwner` 必须等于 `ownerName`，`rules.simulationRunId` 必须匹配 run id。返回的连接将认知实体绑定到尚未激活过的 active 本地 Participant，生成稳定 Session id，提供激活、恢复对账及关闭时的激活排空。所有实体保持一个规范执行 Team。

`ensureParticipant(entityId, participant)` 在 run 暂停时预留不可变角色配置及 Participant/Session 身份，再对账邀请、成员激活与绑定，不启动 Agent。配置冲突会拒绝；引导未完成时禁止运行；关闭会排空已受理的拓扑 IO。 邀请与阶段转换的每次响应都必须匹配预留 Participant，才能完成绑定；身份不匹配时保留可重试预留。

`ensureChannel(request)` 预留一个 direct-v4 身份与有序成员，对账原始 WAL 和 Team 挂接，再取得每个规范 Session 端点的同意。恢复保留邀请截止时间，不启动 Agent。成员或限制变化会拒绝；频道确认未完成时禁止 run 执行。

`invitation(entityId)` 提供冻结到规范 Session 的频道创建选项。`acknowledgeInvitation(entityId, channelId)` 无需激活认知或请求模型即可确认该 direct-v4 端点。可撤销 proof 绑定精确邀请与当前 active 实体；邀请过期或权限撤回时拒绝确认。已确认频道在接收者休眠期间保留待投递消息。连接关闭会排空已受理的独立邀请确认后再释放 run 所有者，包括没有驻留 Agent 的情况。

激活控制器同时约束直接调用和连接调用。启动始终持久预留 Team 容量，并将该预留与 Simulation writer epoch 关联。集成在启动前固定真实 in-process 提供方，精确绑定持久化后才启用 writer，终止前撤销写入权，确认停稳后才释放。缺失所有者、身份不符、重复绑定和外部运行时实现均拒绝。模型权限仅在绑定成功后发布；被拒绝的重试保留原有 writer。run 角色额度在提供方启动前预留，控制器直调用也适用。revoked 或状态不确定的 writer 保留额度，直到控制器确认释放；Team 容量独立生效。

run 关闭在其写队列之外调用连接退役。关闭失败时保留所有权以便重试。恢复区分已提交绑定、未发布启动及尚未通过领域准入的 Team 预留；run 锁继续排斥其他活跃协调器。[Loader fixture（测试前置数据）](../../../examples/headless-agent/tests/fixtures/simulation/simulation-team/cordis.yml)及其子进程测试覆盖两个存储后端。

`hibernate(entityId)` 为闲置角色关闭新的认知和投递准入，排空已受理投递、检查点持久化 Session，再停止精确的控制器所属激活。open 或 submitted 决策须先结算。检查点或终止失败时保留 writer 容量以供重试。`resume(entityId, request)` 复用已证明停稳的规范 Session，不启动推理；待处理投递输入会在下一决策前恢复。未知启动历史需要显式恢复。模型派发在获得模型许可后预留 run token 容量。流清理在结算及释放许可前 flush Session 用量；缺少完整终止用量时保留预留额。每次重新进入模型流都会独立分配尝试。能证明取消发生在下游派发前时，释放预留额度。

`ensureResident(entityId, choice)` 使用显式启动参数与有序候选列表，仅休眠闲置且决策已结算的角色；容量不足和 writer 未确认分别返回明确结果。`driveResident(request, clock, choose)` 在投递需要休眠接收者时应用该策略，遵守相同的协调轮数上限，并在推理前停止。此驱动运行期间拒绝其他协调调用。

可选的 `residencyPolicy: { version: "1", idleFor, maxCandidates }` 在调用者允许的淘汰集合中优先选择闲置最久的角色。`idleFor` 使用模拟 tick，`maxCandidates` 限制单次请求的退休数量。待处理 wake、未投递消息、未完成任务和决策保留驻留；每次等待退休后重新检查资格。未知 writer 继续占用容量并要求恢复。默认 `null` 保留调用者顺序；已保留的 `choice.policy` 优先于部署策略，公司和任务驱动可通过 `driver.residency` 保留它。选择不改变 cognition、规范 Session 身份、资产或历史 activation 计数。

`registerDeterministicPolicy()` 注册具名、版本化、同步且有界的策略。`executeDeterministicDecision()` 在规范角色的维护锁内，以冻结的授权视图执行策略。选择与输出均持久化，重试复用已记录输出，提交与资源操作仍使用原权限检查。 此入口同样接受与 JavaScript 属性同名的不透明决策 id。已选策略的决策不能请求推理或预留模型 token。策略属于可信插件代码，必须无 IO。关闭会排空已受理计算并阻止晚到接受。已完成的确定性投递 wake 会在后续认知或休眠前退役精确 inbox 副本，不伪造模型轮次。知识报告若已有规范 Team 原文，则仅引用而不重复正文；原文不在当前模型上下文时，才物化获准的保留正文。压缩后缺少的报告原文会从同一知识版本重物化，持久记录展示变化并重新核算预算；必需内容超限则停滞。被遮蔽的 Simulation view 会重新追加，不替换无关历史。确定性窗口应在打开时声明 `policy`，使冻结视图保留完整报告内容。调用方提供的报告可见性提示不能省略策略所需的报告正文。

`openWindow()` 在 run 冻结 slot 前解析各驻留角色的上下文预算与共享 Team cursor。`executeDecision()` 可并发运行这些角色并返回 `submitted`；`run.commitWindow()` 执行有序接受。`cancelDecision()` 退役未完成 slot，不复用其身份。

`openDecision()` 与 `submitDecision()` 从所连接实体推导 writer。run 写队列内部检查存活 Agent 和当前 Team 成员权限，因此直接提交到 run 也不能跳过已安装的准入检查。退役会立即关闭新准入，即使持久撤销失败也是如此。

Config 要求正整数 `maxContextBytes`、`deliveryPageSize`、`maxCoordinationRounds` 与 `maxConcurrentModels`，以及非负整数 `maxQueuedModels`；上下文预算按选中 content-block 数组的 UTF-8 JSON 字节数计量，与模型路由的总 token 上限分开。`prepareContext()` 接收已授权的分节与来源引用。run 保留身份、权限、输入、目标、承诺以及其他标为必需的分节；可选分节按优先级整段选择，能放入预算才保留。必需内容超限会持久停滞为 `SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW`；取消该决策、调整部署预算并显式恢复后，再分配新 slot。

推理前，pre-step 所有者要求当前决策已准备上下文，追加或精确替换其 `simulation/context-view`，flush Session 后再次检查 writer 的实时权限。模型派发时，准备输入必须属于当前活动的 Agent 回合。stream 必须匹配已记录的请求头、对话及唯一的当前 view，并在 token 预留后再次复核。已消费输入和请求头在内的完整请求前缀会先 flush，再复核 writer 权限与取消状态，然后才构造下游 stream。flush 失败会阻止推理；该对话策略不准入辅助模型用途。重复准备保留同一份选中内容、策略指纹和 input id。

模型许可由此服务的所有已连接 run 共享。等待采用有界 FIFO；取消会移除等待者，已授予许可则保持计数直到下游流清理结束。准入后再次检查权限与已记录请求。`modelUsage()` 返回预留／执行和排队计数。决策截止时间包含准入等待。连接关闭取消自身等待者；服务卸载先关闭全部准入，再停止所属角色。

`executeDecision()` 准备并派发一个驻留角色的决策，然后确认精确输入所属回合结束、提案已提交或接受且 Session 已持久 flush。超时返回已记录的取消结果。当 Native 因调度暂停拒绝下一次模型准入时，同一 writer 原子取消其当前已准备但未接受的决策，记录 `cancellation: 'paused'`、归还 wake，并关闭已结算的窗口。已使用或结果未知的 token 责任保留；能证明未派发的预留被释放。Agent 不再发起模型请求，结束后 flush Session 并返回该决策。精确重试返回原取消结果，不重新派发；显式继续用新决策承接归还的 wake。其他 runtime 错误仍会拒绝，包括与暂停并发发生的错误。未提交与上下文超限会拒绝；重试复用已记录的选择，不重复已消费输入。 决策 id 是不透明标识；与 JavaScript 对象属性同名的值也保持有效，并保留相同的重试身份。[公司场景](../../../examples/simulation-company/README.zh.md)通过此入口运行双实体模型流程。

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

`connection.inspectPersonnelObligations()` 将 Native refs 与实际 canonical Team 任务、attempt、startup/activation、workspace 清理及 Channel 待送达责任组合。它只发布 metadata，重验 owner cursors，将移动或受限扫描标为 partial，并在组合后执行完整 UTF-8/项数上限。它不 claim/ack 消息、改变 phase、启动认知或执行处置。connection close 关闭读取准入并排空在途观察；迟到读取不能发布报告。完整报告是盘点，不是调岗或离职许可。

`commitPersonnel()` 在 canonical Team 与全部 Channel 队列持锁期间，由 Native serializer 重验私有 runtime-only proof。cut 使用严格来源 cursor 与原 pending Envelope 元数据；回调只执行 Native append，不重入 Team／模型。完整来源覆盖不等于职责已清偿。关闭 connection 撤销新 proof 准入，并等待已接受的结算调用；已提交重试直接返回原结果，不再取得 cut 或执行 IO。默认 Team provider 明确拒绝不支持的人员 cut。

人员结算从实际持锁 Team snapshot 提取无 lease 的终态 task 元数据，绑定其不可变 Simulation creator 和原 Native receipt，并将元数据纳入来源 fingerprint。任务标签、复制的正文或 proposed owner 都不能证明清偿。原 Native attempt 和清理责任仍阻止提交，直至各自 owner 对账。维护 draining 时，人员取消返回已保留的 pending 原命令；已证明停稳后执行精确 Native 人员取消结算，不走招聘身份清理。

人员维护 collection 正在等待原 controller 停止时，已准入 connection 可以保存精确同维护 owner 所属人员 case 的取消。这个控制例外只记录原 Native 取消责任，不授予模型、activation、发布或无关 case 准入。普通 checkpoint collection 与已封闭 Native cut 保持写入屏障，关闭的 connection 不恢复新取消权限。

人员提交与生成招聘清理来源只在 Native canonical Team 预留确认后绑定；普通 Simulation 连接无需 World bootstrap 即可使用。辅助压缩请求使用相同的原 writer、token 与模型容量 owner，未知终止在明确对账前保留完整预留。

## 请求预算与上下文压缩

可选 `requestPolicy` 配置 `maxOutputTokens`、`safetyMarginTokens`、`inputSafetyFactor`（1–4）和 `compactionAttempts`（0–2），依赖共享 TokenMeter。会话输出在记录规范请求头之前受限。准入估算完整系统提示、工具 schema 和消息，保留提供方用量基线，并将输入 × 安全系数 + 输出 + 余量与原始 Native 预留量及已知模型容量的较小值比较。过大的请求在调用模型之前记录 `SIM_REQUEST_BUDGET_EXCEEDED`，取消决策、归还唤醒并关闭已结算窗口。实际超额保留真实计费量，立即以 `SIM_TOKEN_RESERVATION_EXCEEDED` 取消决策。

角色的压缩提供方可以在下一次请求之前按配置次数压缩上下文。压缩共享模型并发池及 Native token 计费，失败不会产生未计费重试。压缩后，所有者恢复当前权威上下文，并在推理之前持久化 Session。原始 Session 事件保持保留。压缩后必要上下文仍无法容纳时拒绝请求；压缩不会扩大运行的不可变额度。省略 `requestPolicy` 保留显式组合的旧行为。

消费凭据指向唯一已输入消息之前的原始上下文。后续展示必须有已完成的压缩摘要及其原始表面替换事件，不能取代原始消费证据。规范消费或持久化错误会取消决策并记录 `SIM_CONTEXT_INTEGRITY`，停止 Agent，不进入模型修复循环。新超时记录保留 `SIM_DECISION_TIMEOUT`，归还唤醒，并关闭所有槽位均已结算的窗口。不带显式停止标志的旧超时记录仍按原语义重放。两类停止均需操作者显式处理后才能继续调度。

观察支持用互不重复的 `sections` 名称按规范顺序读取冻结章节，不能与 `detail: full` 同时使用。结果决策可在提交时携带 `notification: {resultId}`，由所有者解析精确冻结通信、记录消费并提交；任意改写正文、不同结果和冲突的已暂存动作仍受相同 Native 权威校验约束。

通信暂存与 Native 最终接纳共用同一纯校验：检查收件人的 Entity ID、同 Team 规范绑定和发送时间，不会隐式转换 Participant ID。暂存拒绝后，本轮仍可提交修正后的完整提案列表。

裁决暂存必须使用准备好的 resolve 上下文选中的请求。过期请求 ID 在提交前被拒绝，允许同一轮修正；最终权限仍由 Native 验证。

暂存按照当前冻结上下文授权的精确领域版本，预检请求和 apply 计划的 payload；不分配请求或执行租约。替换失败保留此前有效暂存。诊断最多返回八个字段路径，每项最多八个允许值，不回显模型提交的私密正文。联合类型恰有一个 `kind` 分支匹配时，返回该分支的嵌套字段错误；有歧义时保留联合类型诊断。展开后的诊断仍遵守相同字节与条目上限，并标明截断。修正后的提交仍需通过 Native 的权限、时序和业务校验。

## Model Experience

### Cognition residency

#### What the model sees

`ctx.simulationTeams` 创建或恢复实体的本地 Agent 与 Session。已准备决策将记录的补充上下文和一条带标识的控制消息提供给模型；收到的 direct 内容沿标准 Team 投影呈现一次。`tool-simulation` 消费者提供观察、暂存和提交工具。每条控制消息标明当前输入身份，要求重新观察，并区分先前提交与当前打开的决策。不采取行动时也必须暂存空提案列表并提交；文字总结不等于接受。

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

导演规划与补证回答必须消费当前选定的原私有通知及其精确 Envelope 消息。补证完成后，导演必须消费最新修订通知；已消费旧请求通知不能授权另一方案。接收端在渲染前核验原 Channel、Envelope 位置、canonical sender/recipient、完整 payload、audience、指纹及原接受 operation 的关联；不相关的 task、causation 或 lifetime 元数据被拒绝。Checkpoint 与 writable restore 使用相同来源校验，不能用模型可见文本相同替代原件相同。

`simulationTeams.inspectPersonnelObligations(selection, query, signal?)` 无需创建 connection，即可对关闭的 run 执行同样的跨 owner 盘点。它重验 Native binding 与 owner cursors，在来源移动时保留 partial coverage，并在 service disposal 时排空已准入观察。取消阻止发布；读取不确认送达，也不创建 task/activation ownership。

`generate(jobId, authorize, signal?)` 在专用 canonical Session 中显式执行已接受的 Native job。输入只有冻结的 job 材料，无工具或环境历史，在分发前作为 `simulation/generation-input` 持久化。已有会话或其他 scope 历史会拒绝。调用共用 FIFO 模型池；`simulation/generation-output` 先 flush，再写 Native 输出和验证。重试从已保留 Session 结果恢复，不再次调用模型。连接关闭会取消并排空已准入生成，保留未知责任及 token 预留。Host 必须物化原 Session 并授权每次披露；生成不是每个角色的自动默认配置。[所有权说明](../../../.agents/notes/implemented/architecture/2026-10-19-world-generation-planners.zh.md) 解释隔离和恢复。

封闭 checkpoint collection 的 `exportArchive(limits)` 捕获原 Native、Team、Channel、已物化 Session 和标准图像字节，并保留未物化 Session 引用。完整历史保守保护此前全部 case、plan、context、cleanup 和 checkpoint 引用；子 Team 与闭包外 Session 祖先被拒绝。`planWorldArchive` 报告实际字节和数量，可释放容量为零。`publishWorldArchive` 校验内容后原子发布位置，`readWorldArchive` 校验正文与附件 hash；这些 API 不删除源历史。`restoreWorldArchive` 导入隔离的同级 staging，要求所有者 parser 验证并关闭所有者后原子发布目录。它保留身份和事件，要求显式源 cwd 到目标最终宿主路径映射，将 header 变化记录在 receipt 中并保留原包。未知版本、缺失所有者、损坏图像、与保留引用不一致的 Session header 或图像元数据，以及目标冲突被拒绝。部署代码提供的目标所有者必须把存储根置于 staging 内；成功命令重试会重新验证已发布所有者。参见[归档所有权](../../../.agents/notes/implemented/architecture/2026-10-19-world-reference-archive.zh.md)。

归档 v1 仅覆盖精确的内置 domain pin、in-process 参与者运行时和无自定义 view provider 的 direct-v4 Channel；已安装不等于引用可便携。原始归档不含 Product 创建来源证据及 Host provider/preset 配置。完整 Product bundle 添加原创建帧；仅 Host 可用的 Product 导入 helper 在验证后登记 paused 目标。目标 provider/preset 配置仍需显式提供。

### 私密完整备份与离线转换

`createWorldBackup(body, limits)` 为封闭归档添加 `world-backup/1` 元数据：全部 Native/Team/Channel/Session cut 与版本、每个所有者的 hash、图像 hash、领域 pin 和未物化 Session ID。`verifyWorldBackup` 在完整序列化 bundle 的字节预算内校验闭包和 manifest。未知必需 Session 事件被拒绝；明确可忽略的原记录保持不变。目标组合在发布前验证已安装的所有者 reducer 和 provider。

完整外部归档要求安装精确的 `WorldExternalArchiveProvider`；仅注册执行领域不足以建立可移植闭包。provider 在同一封闭 Native/Team/Session 引用向量下捕获、校验和恢复原始私密状态，manifest 包含 provider ID、精确 pin、payload hash 和记录数量，计入总预算。Harbor 的 `clocky.harbor.private-backup/1` 携带固定源文件、原裁判 journal/state 和桥接输入/receipt。缺失原件、身份变化、不安全路径、链接和不兼容版本被拒绝；恢复路径由隔离目标部署配置选择。普通 Native checkpoint 仍保持 `external-state-required`，完整外部包实际成立后才有完整备份证据。provider 注册随安装插件释放。

`publishWorldBackup` 写入仅所有者可读的文件，校验 staging 字节，并以不可覆盖的内容地址发布。并发相同重试共享结果；冲突字节被拒绝。`readWorldBackup` 返回私密记录前校验大小、地址和 manifest。历史记忆本身可能含秘密：保密策略为私密明文，要求仅所有者可访问的存储或外部管理的加密；包内不包含密钥和可执行 provider 配置。源 cwd 仅保留为证据，必须显式映射到目标路径。脱敏数据集不能使用这种可写完整备份格式。

`restoreWorldBackup` 委托隔离归档恢复，仅在验证后发布 paused 目标，不启动推理或授予真实外部效果权限。`planWorldBackupMigration` 仅支持使用 `archive-envelope/1` 将 `world-archive/1` 转为 `world-backup/1`，绑定精确输入/输出 hash，丢失集合为空。`migrateWorldBackup` 发布新包前验证该计划。转换保留原记录值，不补造缺失的批准、Persona、sender 或 receipt。必要闭包缺失、不支持的格式以及转换器或输入变化均被拒绝，原始归档保持不变。Product 部署 helper 校验原创建来源证据，并随隔离存储根原子发布 paused 发现目录；目标 provider/preset 路由仍由部署负责。

`migrateWorldNative101` 是单独且显式的 `native101-to102/1` 离线转换器。宿主提供固定 W0 parser（`0e85170d1236cfe846ebc3b88a073d848903fb47`）和当前纯 validator；两次回放都必须严格重现原归档 paused 投影。目标改变物理 journal descriptor，并添加 creation 来源声明；原 ID、sequence、业务记录值和历史 checkpoint manifest 全部保留。历史 context profile 仅用于原 hash 覆盖的 cut，新 context 使用当前规则。Native 返回投影前逐条验证原前缀。未知领域 profile、缺失源/外部状态以及回放不一致被拒绝；普通 backend 仍拒绝格式 101。`publishWorldNative101` 将精确原包字节、完整转换证明和目标包按不同不可覆盖内容地址保存。恢复仍要求隔离目标、新 checkpoint 和明确 start；转换不会恢复原运行。

`createWorldExperimentBranch` 从所有者已验证的 initial-world 或 settled-world 归档 cut 创建 paused 分支。它通过已安装 provider 回放不可变 Native 前缀，不访问原存储，并拒绝活跃 writer、未结效果以及缺少受支持 seed owner 的责任。不可变 `run/branch-init` 在分配新所有者前记录父 hash/revision、命令 namespace、记忆策略、显式干预及预算。精确重试重新打开同一 namespace，对账已预留身份与继承输入。继承 Session 以 detached 状态准备，在挂接 runtime 前持久化；seed 角色首次激活继续这些实际日志，后续生成角色仍按普通新建流程启动。writer epoch 属于新 run/entity，即使十进制计数各自从一开始，也不共用权限。Entity 取得显式 lineage 身份；Team、Participant、Session 和 Channel 所有者分配全新可写身份。当前实体、关系和余额通过普通 Native 命令初始化；动态文本事实引用新 branch-init 事件，继承的私密知识成为新记录的 belief；原 proof 与 receipt 留在只读来源证据中。精确父归档保存在专用存储所有者中，递归纳入分支导出；完整字节、累计条目和八层父来源上限共同约束该闭包。

支持的干预是 `public-facts` 与 `authorized-memory`。两者均保留编写的 profile 和场景事实；public-facts 不继承初始私密知识和全部父 Session 事件。authorized-memory 只支持文本 Session 历史，在纯预检时拒绝媒体及非文本 content block，并通过 detached `Session.create(...).deriveMessages()` 仅将各原角色的实际模型历史消息引用到新持久化 `user/message` 中，附带源 cut 与策略。父 Session 事件不会被复用为可执行 proof。调用者必须在每次操作前后提供当前整记录授权；分支默认无真实效果。这一策略不对编写的 profile 作通用脱敏。不支持未结义务或事件、联邦来源及其来源祖先、制度/委员会/外部/环境/演化 seed owner、任意模型干预、全生命周期 token 预算或自动历史合并。settled-world seed 保留模拟 cut 时间，遇到不支持的状态明确拒绝，不静默丢弃。

`buildWorldCausalIndex` 读取真实 Native `event/queued`、`decision/opened`、`operation/intent` 和 `operation/settled` 记录。它忽略可变 snapshot 关系，采用 B1 长度分隔前缀 hash。resolve action 保留显式请求引用；缺失的 inception 或 receipt 来源保持 unknown。索引可丢弃重建。`queryWorldCausalIndex` 重新核验来源权限，限制深度、节点数和完整响应字节。`compareWorldExperiments` 要求相同父 commitment，仅使用显式 lineage ID 字段，不重写自由文本，分别呈现事实/资源/人员/策略变化；缺少评价证据时质量和成本明确为 unknown，且绝不由相关性断言因果。

普通完整 bundle 拒绝当前运行或任意来源祖先中的 Native 联邦时间证据，包括日志有 fence 而所给 snapshot 删去了该字段的情形。这种依赖要求携带原 mailbox 前缀的完整联邦 checkpoint。原始 `exportArchive` 仍可作为组合格式的组件；普通 bundle 校验和封装迁移都不能将不完整的联邦闭包标为完整备份。

实验初始化及继承输入 payload 使用版本 2。Native 回放拒绝版本 1 初始化；此前的原始事件记忆格式不迁移、不改写。没有分支初始化的当前格式运行仍可读取；Native 101 必须使用显式离线转换器。Entity 引用遵循已声明的 schema 字段；resource、fact、knowledge、relation 和 template ID 保留各自 run 内的独立 ID 域，编写的文本及 Persona 名称逐字节保持原样。缺少已声明 Entity 所有者时，纯预检即拒绝。
