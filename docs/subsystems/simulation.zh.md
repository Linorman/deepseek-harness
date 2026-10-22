# Simulation

[English](simulation.md) | 中文

长期运行检查使用可重建、绑定来源的索引；归档保护完整的跨 owner 历史，并发布已校验归档而不删除原件。闲置驻留保留规范 Session，表示切换则限于已证明无记忆的主体。隔离的生成 job 保留实际输入/输出及共享预算，领域规划者仍通过原 director 和 Native 提交顺序执行。环境与主观经历操作通过 domain 注册表接入。消费者契约分别见 [Simulation Product](../../packages/simulation/simulation-product/README.zh.md)、[Team 协调](../../packages/simulation/simulation-team/README.zh.md)和 [Native domain](../../packages/simulation/simulation-local/README.zh.md)。

`RequestCapacityInput` 向 Team 预检提供冻结的请求/窗口额度和运行时共用的必需上下文。`RequestCapacityResult` 拒绝已证明不可能通过字节或准入策略检查的配置，或报告已知子集的大小，同时将完整请求可行性和未来消耗保留为 unknown。`SimulationWorldDomainPin` 为控制和执行可用性选择精确安装的操作/parser 代次，本身不授予执行权限。它们的所有者契约仍见上面的 Team 协调和 Native domain。

`SimulationExternalIdentity` 与 `SimulationExternalInteraction` 保留稳定 scope/key 主体，以及已安装模拟库存规则的实际输入、策略／版本和 known/unknown 输出。`DomainMutationProjection.externalEffects` 仅允许一个封闭求值；Native 在 append 中记录实际结果，回放验证算术与原来源后使用保留值。typed `resource-owner-set` 读项检测新建库存与余额变化。外部求值不能改变账户、发布调控者正文或冒充 sender；checkpoint 同时包含身份和交互指纹。组合生命周期验收独立跟踪；[Native owner](../../packages/simulation/simulation-local/README.zh.md)负责准入与披露。

`SimulationProductWorldDomainInput` 与 `SimulationProductWorldDomainResult` 绑定公开查询与响应。`readWorldDomain` 通过 `simulation.world.domain.read` 及共享 SDK 方法公开十类严格选择的 `clocky.world-read/v1` metadata。每个响应保留完整原查询、revision／read version 及精确有界覆盖；续页绑定查询、读者、policy generation 和来源 fingerprint。仅末页不能证明全量覆盖。提案／制度正文、Persona 与案件 business key 使用独立授权，并在异步读取后重验。typed 来源引用保留 Native 身份及精确 canonical Envelope／task metadata，不授予目标正文权限。冷人员盘点组合 Native 与 canonical Team owners，不打开或恢复执行。不支持的历史生命周期查询明确拒绝，不替换为当前状态。浏览器窗口彼此独立；Native 推进遮蔽过期正文，而 metadata 追上时不能废弃当前或更新响应。

`SimulationExternalRepresentativeReservation` 在 canonical IO 前保留原外部认知身份分配、冻结路由与 generation。三个 Native reserve/prepare/commit 方法要求原已接受有限 Persona 及精确维护／停稳；表示、ready 和安全联系结果／wake 原子成为事实。跨 owner binding 和 Channel 保持原件，被代表组织保留原身份／认知／账户。未来认知身份准备守卫统一覆盖招聘与外部代表；`SimulationExternalContact` 通过 `reserveExternalContact/commitExternalContact` 保留 case 到 generation 的关联及每个调用者的精确私有 Channel。竞争 create 计划通过 typed `external-representation` 读项变为 stale；明确的 supersedes reuse 计划引用原 generation。联系等待 ready，保持同一 Person/Session，并原子提交安全结果/wake。取消保留清理／容量责任；准备中代表清理使用精确 canonical 终态证明与 Native 废弃结果；联系清理独立证明另一个原有调用者事项，或独占通道的终态；保持代表及原资源，恢复时重验已保留 Channel 前缀，未知 IO 保留责任。[故障 runner](../../examples/simulation-company/tests/world-r06.snapshot.ts)在 JSON 与 SQLite 上验证原外部责任跨 SIGKILL 和新进程恢复保持不变。

World 案件提供有界的原 request、plan、execution、notification 分区、绑定 revision 的分页和分别可卸载的案件正文/Persona 授权。`SimulationProductWorldCasesInput`/`Page`、`SimulationProductWorldCaseInput`/`Inspection` 是浏览器安全投影；`SimulationProductCaseReader` 选择可信披露策略，`SimulationProductWorldCaseControlReader` 提供当前 owner 的参考资格。`SimulationProductWorldCaseCancelInput` 在 Native 取消/入职竞争前保留原 run/command/request 选择。未知准备 IO 保留 accepted 清理责任；终态重试不改写原结果或启动推理。 必填的 `clocky.world-case/v4` 摘要从同一 Native 前缀投影四条独立状态轨，详情必须与之相符。回调确认、业务结果及发布/收件保持独立；补证答案需要案件正文权限，Team/Session 内容仍使用独立授权。

`SimulationWorldContext.governanceAccess` 保留每个附带提案的 revision/hash、原投票 operation pin 和准确授权关系证据。[当前披露检查](../../packages/simulation/simulation/src/world-membership.ts)在 Session 插入及模型派发前覆盖所有上下文用途，包括非 goal 的 request/result 输入。缺少原见证或撤权后拒绝披露，冻结上下文和已消费历史仍保持原样。招聘与委员会 goal 材料采用和请求准入相同的当前目标授权。

世界请求与 director 计划使用既有三工具及规范私有 Channel。Native 冻结 director 绑定与招聘授权，在接受时展开请求，保留完整计划和显式 read-set，并验证规范 Session 消费回执。[场景编译器](../../packages/simulation/simulation-scenario/README.zh.md)提供有界的纯 JSON/安全 YAML 校验、冻结部署解析及可移植定义导出，不负责创建 run。`SimulationWorldResult` 和原 `SimulationWorldCancellation` 回执保留案件终态及原子安全请求者 wake。可信 Native 取消与计划结算竞争并保留已接受计划；Native `SimulationWorldHireReserveRequest/SimulationWorldHireReservation` 固定原计划、维护 owner、可信 member route、全部技术身份及预留状态；停稳后的任职/ready/结果/wake 原子提交，准备中取消保留责任与占用。关键执行 read-set 变化持久标记 stale 并保留原计划。规范 Team 清理对账原 Channel 关闭、membership 退出及未物化 Session 证据，再由 Native 原子结算取消。checkpoint 与可写恢复重验该证据；未知 IO 保留责任。[World driver](../../packages/simulation/simulation-world/README.zh.md)跨两个可移植场景编排原 wake、公平队列、维护、入职、安全结果通知与新人独立认知。终态视图要求精确原 actor/wake 与消费回执。冷回放保持暂停且不推理；原已认证产品执行 owner 调度、暂停、采集 checkpoint 并恢复 World run。浏览器导入并预检 World JSON，创建暂停运行并展示分别授权的案件分区；可见 metadata watch 退休过时私有读取，撤销授权后的迟到响应不能恢复正文。浏览、刷新和定义导出不推理或构造执行 owner；[Native 契约](../../packages/simulation/simulation-local/README.zh.md)拥有执行前置条件与错误。

`WorldExecutionProvider` 是独立安装、无需 run 的工厂，固定精确 Native schema/artifact/generation pin。`WorldExecutionBinding` 提供原独占 run、规范 connection、已接受 compilation、checkpoint anchor 和 lifetime；构造工厂产物不执行 IO。`WorldExecutionHandler` 拥有该 run 的执行与对账。独立 `simulationWorldExecutions` 插件安装实际内建工厂和中立 Team 恢复 catalog。恢复先核验纯读取的 Native 历史、共享 strict parser 对象身份及所有保留 pin/payload，再在独占 open 后、改变 phase 或 writer 前复验。准入 lease 覆盖恢复 IO，成功和失败都释放。Product 恢复在退休已有 owner 前检查相同 provider。缺失或替换的能力拒绝可写恢复；Driver 也拒绝不完整或不匹配的实际 handler。

显式启用的 World 产品创建在身份 IO 前，将完整原受理定义、解析结果、owner 和 command 保存在行政日志 4。严格的浏览器安全预览/导出 DTO 只包含初始摘要和定义输入，不包含 Native snapshot 或执行日志。`preflightWorld/createWorld/prepareWorld/exportWorldDefinition` 复用原命令、认证与恢复机制；实际 Team 限额及 model/preset/runtime metadata 参与预检。创建保持暂停，无 Agent 或推理；显式调度通过同一原 World owner 和公开 Native/Team 能力驱动事件及编排入职。记录的用户暂停以直接且绑定决策的 `SimulationDecisionPausedError` 拒绝后续模型派发；只有符合条件的已准备、未接受 slot 结算为暂停取消，原 wake 与 token 计费保留，无关错误仍报错。[Native 契约](../../packages/simulation/simulation-local/README.zh.md)拥有 stream 102 和旧 stream 拒绝规则。

v1 compiler `9` 保留完整声明目录和独立实际 Team 上限，再派生有效限额。即使有效值不变，其承诺仍覆盖两类原输入；旧私有解析结果会拒绝。[部署决策](../../.agents/notes/implemented/architecture/2026-10-13-world-v1-deployment-commitment.zh.md)定义保留来源。

`SimulationProductWorldPreflightInput/Result`、`SimulationProductWorldCreateInput` 和 `SimulationProductWorldExportResult` 是闭合的浏览器安全契约，分别承载符号化创作输入、惰性初始摘要、精确原命令/预览承诺及绑定 run 的可移植定义；parser 不包含私有已接受执行配置或实时 Native snapshot。

`SimulationSnapshot.maintenance` 保留唯一未完成的结构维护 owner 及历史完成记录。Native 准入与 Team 激活 lifecycle owner 独立于 run phase 和实体 readiness 执行此约束。Team connection 可以通过 `quiesceForMaintenance()` 排空并退休，再记录 Native 停稳；完成后调度保持暂停。该原语本身不授权 world plan，也不办理入职。

实体执行还要求显式 `readiness: ready`。可信创建声明 `ready` 或 `preparing`；分阶段准备通过带 revision 检查的暂停态 `entity/readiness` 命令结算，`abandoned` 不可逆。Native writer 与决策准入、公平调度及任务执行拒绝未 ready 实体；Team lifecycle owner 对直接激活和恢复后的连接执行相同检查，同时保留仅可退休的恢复能力。

`SimulationProductSourceInput` 只指定保留的决策来源序号及可选位置／续页，`SimulationProductSourceInspection` 区分定位进度与已授权文本。每次读取分别需要仿真来源 grant 和当前 Team 成员读取资格，不接受任意频道选择，也不推理。[来源读取契约](../../packages/simulation/simulation-product/README.zh.md)负责额度、删节和续页规则。

实体／决策的 `knowledge` 分区在明确内容 grant 与当前传递受众检查下检索当前或原始已选精确知识。`knowledgeVisible/selectKnowledge` 是共享的纯定义包投影，本地 provider 负责其持久写入。原始已送达报告文本需要独立来源权限和保留送达证据。带来源记录不代表已验证世界事实，当前受众变化会在复查前释放知识缓存。

`SimulationProductWatchInput/Result` 定义一次已认证、有界的元数据等待。不授予权限的 `readVersion` 约束冻结上下文响应，reset 使旧续页失效。独立 `SimulationProductContextReader` 贡献使用进程内 registrar；策略插件移除唤醒观察，不替换目录或执行所有权。[产品读取策略](../../packages/simulation/simulation-product/README.zh.md)负责真实时间额度、当前主体校验及清理。

`SimulationProductObjectInput` 可独立分页选择实体关系或冻结决策上下文。关系保留精确有效区间。产品目录明确的主体／实体上下文 reader 只公开历史纯文本片段；单独元数据所有权仍删节正文。冻结上下文保留原投影及来源，与完整模型请求不同，也不授予当前知识或 Team／Session 来源访问。[产品读取策略](../../packages/simulation/simulation-product/README.zh.md#relationships-and-frozen-context)负责配置、额度及退役。

`SimulationProductAdministrationControl` 将维护动作与调度分开，提供有界输入目标／时间／字节限制及兼容检查点元数据。已完成原生检查点在日志版本 96 中保留真实 `publishedAt`。恢复引用在明确原生验证前仍只读，当前后缀恢复不请求历史回滚。

`SimulationProductPreflightInput` 包含模板选择、允许的初始参数及可选不可变 `SimulationProductLimits`，不含命令身份。`SimulationProductPreflightResult` 返回精确解析的 `SimulationProductConfiguration` 或有界字段问题；配置含只读 Host 共享并发及版本／时间元数据。当前部署与容量检查不分配 run、Team、actor 或 permit。[创建契约](../../packages/simulation/simulation-product/README.zh.md)负责允许下调的额度、零 token 确定性工作流及重复创建准入。

`SimulationProductRequestsInput/RequestsPage` 在当前运行 owner 授权下提供有界、仅含 receipt 的原请求发现；其 snapshot revision 属于行政日志，独立于 Native 世界 revision。`SimulationProductRetryRequestInput` 只选择原 runId／commandId，明确重试派发保留的原 payload，终态 receipt 不变，冷 owner 恢复仍保留前置条件。原生 phase 与 ingress 历史保持独立。[原请求恢复契约](../../packages/simulation/simulation-product/README.zh.md)负责游标隔离、隐私及有界准入。

`SimulationProductControlBudget` 提供原模型 route、每次请求预留量、每个模拟区间的 token 额度、精确区间、驻留上限及配置的主机共享模型并发。控制 snapshot 分开表示观察到的开始／暂停前置条件、在途工作与原 receipt。[产品行政](../../packages/simulation/simulation-product/README.zh.md)负责准入与命令身份，[浏览器工作区](../../packages/client/ui-simulation/README.zh.md)负责明确确认、原结果恢复及有界原始草稿。 World 控制还保留 `tokenRecovery` 精确用量报价与 `requestBudget` 请求拒绝测量；暂停管理请求可显式确认已结算超额且保持暂停，不能修改单次额度。完整请求预算与摘要压缩由 [Simulation Team](../../packages/simulation/simulation-team/README.zh.md) 共同约束。

`SimulationDecision.messageRejection` 以代码、原提案哈希和重试次数保留尚未接纳的通信失败。校验与有界修正由 [Native 所有者](../../packages/simulation/simulation-local/README.zh.md)负责；`message-rejected` 控制停止与执行所有权恢复需求分开。

显式启用的[产品目录](../../packages/simulation/simulation-product/README.zh.md) 提供 `ctx.simulationProducts.list/inspect` 和已认证 Host fetch 读取。不可变登记将不透明产品 ID 关联到私有 provider/spec 选择和一个所属主体。目录元数据独立于 provider 激活；精确历史检查返回有界公开世界摘要，不包含知识、profile 或模型上下文。`SimulationProductRunId` 和 `SimulationProductCursor` 为产品选择和加密分页提供品牌类型；`SimulationProductRunInspection` 区分历史缺失与已观察世界，并保留规范十进制时间。读取不取得执行所有权，不恢复或推进 run。

`SimulationProductBrowseInput` 选择实体、决策、操作或检查点筛选；`SimulationProductCollectionPage` 携带删节后的条目、精确 `snapshotRevision`、筛选总量和绑定的续页。`SimulationProductObjectInput` 选择精确身份与 section、可选读取 revision 和受支持详情分页。`SimulationProductObjectInspection` 区分授权缺失与匹配的 section 数据。纯 `./identities` 入口提供原生身份品牌类型。技术 attempt 和检查点引用独立分页，知识/上下文文本保持删节。完成的检查点报告 `sourceValidation: 'not-performed'`，效果/发布/接收方/任务证据分别保留。[元数据读取约定](../../packages/simulation/simulation-product/README.zh.md) 定义字段、额度与过期行为。

产品包还提供[公司场景准备](../../packages/simulation/simulation-product/README.zh.md)：`SimulationCompanyPreparation` 定义受信任初始设置与采集额度；`SimulationCompanyPrepared` 返回规范身份及初始完整检查点。对账 paused、尚未启动的拓扑，不激活 actor 或推理。调用者生命周期、保留事实检查及终态检查点重试由包契约定义。

[公司 driver](../../packages/simulation/simulation-product/README.zh.md) 在调用者持有的已准备／恢复运行上提供有界 `advance()/drain()`。`SimulationCompanyDriverConfig` 固定版本、route 与偏移；`SimulationCompanyDriveResult` 分别表示停止原因、控制工作量、精确 revision／时间及中断身份。复用原生 actor／窗口／模型／效果 owner，暂停保留 submitted 工作。后台调度及 driver 所有权仍是独立工作。

受信任的 `SimulationCompanyDriverConfig.scenario` 选择有限确定性 `task-workflow/1`，在已准备 actor 上绑定准确 source、executor、recipient 与 reviewer。每个任务根据自身授权且已持久投递的报告完成；审核证据可不含采购库存事实。[工作流契约](../../packages/simulation/simulation-product/README.zh.md)负责配置、路由、返工及不支持的拓扑／模型范围。

`SimulationTaskExecutorConfig` 固定受信任来源／实体路由、认知／完成策略版本、可选交互、lease 时长、批次额度与单 attempt 决策上限。`SimulationTaskExecutorOptions` 提供规范任务读取、授权上下文、驻留、lifetime 及可选的受信任有界后继选择器；`SimulationTaskExecutorResult` 分开表示任务／效果／恢复停止，保留精确来源及 attempt 引用。[任务 executor 契约](../../packages/simulation/simulation-product/README.zh.md#automatic-task-batches)负责原身份重试以及调用方调度／检查点责任。

显式 `./administration` 入口提供 `ctx.simulationAdministration.catalog/preflight/create/prepare/request`。`SimulationCompanyTemplate` 定义受信任版本化配置；`SimulationCompanyCreation` 保留精确私有解析结果。`SimulationProductCommandId` 和 `SimulationProductTemplateId` 为公开选择提供品牌类型；create／prepare 输入不含权限或部署配置。`SimulationProductRequestReceipt` 保留受理／终态结果；`SimulationProductRequestResult` 区分已知结果与不能证明失败的缺失。独立命令日志在原生 IO 前受理，重试保留原身份，并拥有 paused 准备句柄。读取／启动不打开或推进运行。[创建约定](../../packages/simulation/simulation-product/README.zh.md)定义额度、对账及退役。

`ctx.simulations.resolveInspection()` 和 `inspect()` 独立于执行 open 检查现有历史。有界 replay 前校验不可变 provider／spec 选择。本地检查不取得 coordinator、不改 phase、不恢复或执行 writer；owner status 是观察，不是接管权限。原生 snapshot 含私有世界事实，由读取方负责鉴权和公开删节。[只读历史决策](../../.agents/notes/implemented/architecture/2026-09-29-simulation-readonly-history.zh.md)负责存储一致性与生命周期；产品授权和行政操作各有独立 owner。

Simulation run 具有具名提供方、稳定的 `SimulationRunId`，以及包含时钟与规则/策略版本的持久化 `SimulationRunSpec`。`SimTime` 是规范的非负十进制字符串。`SimulationSnapshot` 包含精确的规格、日志 revision、管理状态、实体和组织关系。Entity 的 kind/cognition 保持稳定，profile 单独记录 revision，终止状态不可逆。关系规则约束端点类型、明确允许的组织作用域类型，以及同一作用域内在同一模拟时刻成立的环；有效期采用半开区间。`SimulationRun` 句柄拥有校验 revision 的状态写入和排空关闭操作；单独的运行状态不会执行模型或业务工作。

`SimulationEntitySnapshot` 包含 `runId`、全局 `revision` 和可选的独立 `entity`。`SimulationRun.inspectEntity(id)` 读取该观察，不复制其他实体、决策或历史。未知身份不包含实体；权限消费方在策略等待后重新读取。

[注册表](../../packages/simulation/simulation/README.zh.md)定义提供方选择。[本地提供方](../../packages/simulation/simulation-local/README.zh.md)拥有专用存储、严格重放和同宿主协调器排他控制。[协同设计与状态](../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)涵盖 Entity 写入者、Team 集成、调度和业务效果。

闲置角色可在排空已受理投递、完成 Session 检查点后，通过精确的控制器所属激活休眠。恢复保留规范 Session，并在下一决策前恢复待处理输入。清理失败时保留 writer 与容量。

`SimulationRun.population()` 报告未终止实体和已占用 writer 额度。持久的 `maxEntities` 与 `maxResidentActors` 限制在实体创建和运行时预留之前生效；revoked writer 保留额度直到释放。

`ctx.simulationTeams.modelUsage()` 报告服务级模型许可与有界 FIFO 等待者。请求取消不提前释放许可，需等流清理完成；等待请求在派发前复核 writer 与已记录上下文。

`ctx.simulationTeams` 将一个 run 连接到规范执行 Team。`SimulationSnapshot.channelReservations` 保留配置的 direct 频道身份、成员与确认状态；未确认的预留会阻止执行。`SimulationEntity.participantReservation` 在 Team IO 前保存角色配置与规范 Participant/Session 身份。`SimulationTeamConnection` 创建该成员、绑定预留 Session、激活实体并协调本地恢复。`SimulationWriterLease` 为控制器携带一个 epoch 范围内的启用/撤销/释放能力；未结算 writer 会保留 run 所有权锁。[控制器生命周期接口](../../packages/team/team-activation-controller/src/lifecycle.ts)定义不可变 Team 规则选择的可信回调。

`SimulationWindow` 固定共享 run revision、有序决策及其已准备上下文。`submitted` 决策保留提案而不创建操作意图；有序接受先于窗口关闭和世界执行。`maxDecisionsPerWindow` 限制准入角色数。决策的 `inference` 保留现实时间的开始、截止及完成或过期时间；`decisionTimeoutMs` 在创建 run 时固定预算。超时取消未完成 slot，不取消已经提交的提案。

决策在接受提案前固定输入游标和 writer epoch。接受记录与全部初始意图一同提交。`executeOperation()` 按 slot/index 顺序执行守恒资源转移及精确的一次性授权；重试返回原结果。交互分别保存回复和执行状态，承诺必须以世界转移证据或债权方明确确认兑现。

`SimulationIngress` 保留请求、接收序号、事件身份、已分配键与日志序列。消费后创建接收者 wake；对应决策保留 `ingressId`。上下文准备将精确正文作为必需输入，并附带有作用域的 run-event 引用。暂停或接收更多输入不会改变既有窗口 view。

资源冲突与失败结果原子保留 `conflict-retry` 事件或重试耗尽标记。重试决策通过已消费 wake 继承根决策与次数。耗尽需确认后再显式恢复，不返还已消耗的重试预算。

调度事件保留原有排序键与终态历史。已消费 wake 是持久责任，与 Session 输入消费相互独立。defer 回复和期限事件与业务状态转移在同一批次生成队列记录。`drive()` 在等待决策、达到配置工作上限、暂停或发生类型化 microstep 停滞时停止。

`SimulationTeamTransport` 是可信的幂等发布能力。Outbox 尝试独立于模拟时间保存现实时间戳，回执除操作 id、指纹和频道外，还保留 run、Team、接收者及精确 Envelope 序号。检查点收集与恢复根据对应 Envelope 或不可变任务创建记录核对已应用目标。未知结果保留意图，预算耗尽后需要显式决定新的重试预算。发布不等于接收者持久化，也不等于业务接受。

`SimulationTaskExecutionRequest.interaction.execution` 选择开放 `obligation` 或经证据核对的 `continuation`。后者保留同一任务／assignee／Session 的已物理退休 attempt 对应已兑现转移引用，以新输入受理无提案确认，不允许新世界提案。原失败 attempt 和已关闭业务事实保持不变。[原生任务契约](../../packages/simulation/simulation/README.zh.md)负责资格及结果证据；本地日志版本 96 拒绝早期格式。已安装公司模板返回 `cognition-only` 或 `automatic-tasks`，任务模式沿用产品 owner 的 timer 及完整检查点／恢复协议。

`SimulationProductTaskReviewListInput` 与 `SimulationProductTaskReviewPage` 描述有界规范审核目标及固定场景证据。`SimulationProductTaskReviewResolveInput` 固定原命令、来源操作、attempt 及任务 revision；安装的采购方审核公司模板将报告返工与一次库存转移分开。[行政审核契约](../../packages/simulation/simulation-product/README.zh.md#administrative-task-review)负责当前权限、冷查询、精确重试及显式调度。

`SimulationProductRunStatusesInput` 选择精确有限的已登记运行批次；`SimulationProductRunStatusesPage` 分别观察各 provider，不授予执行权限。Native `SimulationRuntimeMetrics` 与准入共用预算及 writer 槽位算法：token 计费包含未决预留，未知尝试单独计数。行政运行状态、不可变场景版本及采用真实时间的 Host 模型池，与单 run 的区间用量分开。[状态契约](../../packages/simulation/simulation-product/README.zh.md)负责字节／凭据边界及不可用状态。

`SimulationProductOperationRetryInput` 选择精确的未知外部操作及已记录的尝试次数。产品在 `retryOutbox()` 按不变原生策略授予一次有界额度前先持久保存原命令；授权或查询都不发布、不推理或恢复调度。精确重试保留原生授权和原受理时间，冷重放或后续结果出现后亦如此。明确继续调度时重新核对目标权限，并按原 Envelope／任务身份对账。当前能力元数据区分已确认结果与仅不需要人工授权的操作。[重试契约](../../packages/simulation/simulation-product/README.zh.md)负责命令范围与恢复。

`SimulationCheckpointDiagnostic` 只包含固定阶段／类别和规范引用元数据，清理确认与主失败分开。原生失败检查点和产品检查点／恢复回执保留原诊断，私有 provider 消息和路径仍被隐藏。Session／频道引用包含规范 Team 绑定，让导航选中精确受保护目标。未知失败标为不可用，不根据正文猜测。[诊断决策](../../.agents/notes/implemented/architecture/2026-10-01-simulation-checkpoint-failure-diagnostics.zh.md)负责分类与持久化；关联正文读取仍独立鉴权。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxexternaleffectsandbox--externaleffectsandbox"></a>

### `ctx.externalEffectSandbox` — `ExternalEffectSandbox`

Host service for explicit, authenticated sandbox operations; disposal drains before closing both journals.

```ts cordis-catalog
/** Save an original sandbox request.
 * @param input - Exact finite test intent.
 * @param call - Real user lease.
 * @returns Durable original.
 */
async propose(input: ExternalEffectIntent, call: AuthenticatedProductCall): Promise<ExternalEffectRecord>

/** Record finite explicit user consent.
 * @param input - Grant for the original action.
 * @param call - Real user lease.
 * @returns Durable consent. */
async grant(input: ExternalEffectGrant, call: AuthenticatedProductCall): Promise<ExternalEffectRecord>

/** Send once, or reconcile a prior unknown result.
 * @param effectId - Original request identity.
 * @param call - Real user lease.
 * @returns Current durable state. */
async execute(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord>

/** Inspect without provider IO.
 * @param effectId - Original request identity.
 * @param call - Real user lease.
 * @returns Current durable state. */
async inspect(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord>

/** Cancel only unstarted effects, retaining uncertain occupancy.
 * @param effectId - Original request identity.
 * @param call - Real user lease.
 * @returns Durable revoked state. */
async revoke(effectId: string, call: AuthenticatedProductCall): Promise<ExternalEffectRecord>
```

Types: [AuthenticatedProductCall](core.zh.md)

Source: [`packages/simulation/simulation-product/src/external-effect-sandbox.ts`](../../packages/simulation/simulation-product/src/external-effect-sandbox.ts)

<a id="ctxfederationmailbox--federationmailbox"></a>

### `ctx.federationMailbox` — `FederationMailbox`

One exclusive destination inbox and source outbox; this service does not mutate Native facts.

```ts cordis-catalog
/** Persist the source original before any transport IO. Source sequence is assigned per target.
 *
 * @param input - Exact ID, peer, causal prerequisites and bounded body.
 * @param call - Source Host user lease.
 * @returns Original durable wire message. */
enqueue(input: { messageId: string; targetRun: string; after: string[]; body: string; at?: string }, call: AuthenticatedProductCall): Promise<FederationMessage>

/** Accept once in destination order; missing causal predecessors reject with an explicit retryable block.
 *
 * @param input - Original wire message.
 * @param call - Authenticated configured source principal.
 * @returns Durable original inbox receipt. */
receive(input: FederationMessage, call: AuthenticatedProductCall): Promise<FederationReceipt>

/** Persist a validated destination acknowledgement; lost replies leave the original outbox pending.
 *
 * @param input - Receipt for one original outbox message.
 * @param call - Authenticated destination Host lease; a source sender cannot confirm its own delivery.
 * @returns Durable receipt. */
acknowledge(input: FederationReceipt, call: AuthenticatedProductCall): Promise<FederationReceipt>

/** Inspect bounded originals including pending delivery responsibility; no transport or model IO occurs.
 *
 * @param call - Local Host user lease.
 * @returns Detached inbox and outbox with their original receipts. */
async inspect(call: AuthenticatedProductCall): Promise<FederationMailboxInspection>

/** Retain the authenticated mailbox cut in the actual Native executor; direct drive and event consumption enforce it.
 * @param run - The exact local Native run, initially paused when binding its first fence.
 * @param call - Current local Host lease, rechecked inside the Native queue.
 * @returns Native snapshot after its durable fence commit; no model or scheduling work occurs.
 */
syncNativeClock(run: SimulationRun, call: AuthenticatedProductCall): Promise<SimulationSnapshot>

/** Hold the mailbox serializer throughout a coordinated cut; callbacks must not call this mailbox recursively.
 * @param call - Local Host user lease.
 * @param capture - Owner coordinator receiving detached state and the complete immutable journal.
 * @returns the coordinator result after authority is rechecked; callbacks cannot mutate retained state.
 */
withCheckpoint<T>(call: AuthenticatedProductCall, capture: (state: FederationMailboxInspection, archive: LogArchive) => Promise<T>): Promise<T>

/** Persist a no-earlier-message promise before exporting it to a peer.
 *
 * @param targetRun - Configured destination.
 * @param time - Inclusive safe simulation boundary.
 * @param call - Local Host user lease.
 * @returns Original durable boundary. */
sealBoundary(targetRun: string, time: string, call: AuthenticatedProductCall): Promise<FederationBoundary>

/** Accept a time promise only after all messages covered by its source sequence are durable here.
 *
 * @param input - Exact source promise.
 * @param call - Authenticated source Host lease.
 * @returns Durable accepted promise. */
receiveBoundary(input: FederationBoundary, call: AuthenticatedProductCall): Promise<FederationBoundary>

/** Advance only to every peer's durable no-earlier-message promise; absent or unreachable peers block.
 *
 * @param time - Requested monotonic mailbox boundary; Native treats the synced value as an exclusive execution limit.
 * @param call - Local Host user lease.
 * @returns Durable local simulation boundary. */
advance(time: string, call: AuthenticatedProductCall): Promise<string>

/** Record a permanent peer failure. This generation cannot resume time or accept more messages from it.
 *
 * @param peerRun - Explicit unreachable peer.
 * @param call - Local Host user lease.
 * @returns Durable stopped peer identity. */
stopPeer(peerRun: string, call: AuthenticatedProductCall): Promise<string>
```

Types: [AuthenticatedProductCall](core.zh.md) · [LogArchive](storage.zh.md)

Source: [`packages/simulation/simulation-product/src/federation-mailbox.ts`](../../packages/simulation/simulation-product/src/federation-mailbox.ts)

<a id="ctxfederationownership--federationownership"></a>

### `ctx.federationOwnership` — `FederationOwnership`

The coordinator is the only writer. Partition calls carry generations but never mint or release local ownership.

```ts cordis-catalog
/** Register a new resource at generation zero; coordinator authority is independent of simulation governance.
 * @param input - Exact resource identity, home and quantity.
 * @param call - Coordinator Host lease.
 * @returns Durable original resource; an identity cannot acquire another original payload. */
register(input: { objectId: string; home: string; quantity: string }, call: AuthenticatedProductCall): Promise<FederationOwnedResource>

/** Spend only through the canonical owner; a transfer reservation blocks both partitions until settlement.
 * @param input - Original operation and exact owner generation.
 * @param call - Home partition Host lease.
 * @returns Canonical quantity immediately after this operation; retries return that original result across ownership changes. */
spend(input: { operationId: string; objectId: string; home: string; generation: number; amount: string }, call: AuthenticatedProductCall): Promise<string>

/** Freeze the whole resource before transport; timeout or missing acknowledgement never releases either side.
 * @param input - Immutable source-to-target transfer.
 * @param call - Current source partition Host lease.
 * @returns Durable original reservation. Partial Native-resource transactions are outside this contract. */
reserve(input: { transferId: string; objectId: string; source: string; target: string; generation: number }, call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer>

/** Destination explicitly accepts the original reservation; acceptance alone does not grant a writer.
 * @param transferId - Original reservation.
 * @param call - Target partition Host lease.
 * @returns Original confirmed responsibility, including unknown settlement after a lost response. */
confirm(transferId: string, call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer>

/** Commit one generation change at the coordinator; old source and old target fences permanently fail.
 * @param transferId - Explicitly confirmed original.
 * @param call - Coordinator Host lease.
 * @returns Settled original. A network partition cannot substitute a local settlement. */
settle(transferId: string, call: AuthenticatedProductCall): Promise<FederationOwnershipTransfer>

/** Capture the exact registry prefix at one serialized queue position while callers hold every mailbox cut.
 * @param call - Coordinator Host lease.
 * @param capture - Called while resource admission is frozen.
 * @returns Caller result after release; capture must not re-enter this registry. */
withCheckpoint<T>(call: AuthenticatedProductCall, capture: (archive: LogArchive) => T | Promise<T>): Promise<T>

/** Inspect canonical owners and unresolved transfers; reading never releases responsibility.
 * @param call - Coordinator Host lease.
 * @returns Detached bounded canonical state. */
inspect(call: AuthenticatedProductCall): Promise<{ resources: FederationOwnedResource[]; transfers: FederationOwnershipTransfer[] }>
```

Types: [AuthenticatedProductCall](core.zh.md) · [LogArchive](storage.zh.md)

Source: [`packages/simulation/simulation-product/src/federation-ownership.ts`](../../packages/simulation/simulation-product/src/federation-ownership.ts)

<a id="ctxsimulationadministration--simulationadministration"></a>

### `ctx.simulationAdministration` — `SimulationAdministration`

One administration journal and one Host handle per original product creation; startup never resumes models.

```ts cordis-catalog
/**
 * Read the complete bounded installed company catalog and explicitly published World authoring templates under current authentication.
 * @param call - Transport-authenticated principal and wait lifetime.
 * @returns company version/route/limit metadata and opt-in authored World definitions; never resolves a native execution handle.
 */
catalog(call: AuthenticatedProductCall): Promise<SimulationProductCatalog>

/**
 * Validate permitted creation settings and current deployment/capacity without durable acceptance.
 * @param request - Template, names, stock and explicitly allowlisted immutable allowances.
 * @param call - Current authenticated principal and read lifetime.
 * @returns bounded field issues or exact defaults; readiness reserves no run, writer, actor or model permit.
 */
preflight(request: SimulationProductPreflightInput, call: AuthenticatedProductCall): Promise<SimulationProductPreflightResult>

/**
 * Inspect an authorized portable World definition against actual deployment metadata, without durable acceptance.
 * @param request - Definition only; provider, model routes and implementation configuration stay Host-selected.
 * @param call - Authenticated read lifetime.
 * @returns frozen compilation or field diagnostics with no identity, command, Session or inference allocation.
 */
preflightWorld(request: SimulationProductWorldPreflightInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldPreflightResult>

/**
 * Retain one original World creation and its frozen preview resolution before allocating Native/Team identities.
 * @param request - Caller command, portable definition and exact reviewed preview; no execution starts here.
 * @param call - Authenticated owner; accepted preparation survives a disconnected waiter.
 * @returns immutable original command receipt. Changed payloads or previews reject; exact retries retain their original resolution.
 */
createWorld(request: SimulationProductWorldCreateInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Reconcile an unstarted World from its original accepted artifact, never from current templates.
 * @param request - Owned run and original or new explicit preparation command.
 * @param call - Authenticated owner; original failed checkpoints are not silently substituted.
 * @returns durable receipt for this preparation attempt. A new command after an initial checkpoint failure collects
 * a distinct checkpoint with the original policy, without changing the original creation or canonical identities.
 */
prepareWorld(request: SimulationProductPrepareInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Export only the original portable definition for a new run, without reading runtime or Session history.
 * @param request - Original product run identity; it must have an owned World creation.
 * @param call - Current authenticated owner of that original definition.
 * @returns detached portable input; generated people, requests, plans, credentials and Host paths are excluded.
 */
exportWorldDefinition(request: SimulationProductControlInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldExportResult>

/**
 * Persist one original allocation and launch bounded preparation after durable acceptance.
 * @param request - Caller-retained command and permitted template parameters.
 * @param call - Current authenticated owner; carrier cancellation never cancels accepted preparation.
 * @returns stable run/command receipt; exact retries return its historical state and changed payloads reject.
 */
create(request: SimulationProductCreateInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Register a distinct explicit preparation attempt on the original owned creation.
 * @param request - Original run and new or exact-retried preparation identity.
 * @param call - Authenticated owning principal; known/private absence has one refusal.
 * @returns immutable preparation attempt receipt; original failed attempts remain failed.
 */
prepare(request: SimulationProductPrepareInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Query the exact original accepted or terminal request without running reconciliation.
 * @param request - Original command identity.
 * @param call - Current authenticated principal.
 * @returns original fact or non-authoritative not-found; no outcome is inferred from a disconnected waiter.
 */
request(request: SimulationProductRequestInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestResult>

/**
 * Discover original receipts after reconnecting or reauthenticating without opening a native owner.
 * @param request - Owned run, bounded page and optional exact journal revision.
 * @param call - Current authenticated principal; continuations bind this credential and service lifetime.
 * @returns receipt-only page ordered by acceptance time and command identity; journal changes retire continuations.
 */
listRequests(request: SimulationProductRequestsInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestsPage>

/**
 * Resume only the selected original retained semantics after an explicit user retry.
 * @param request - Exact owned run and original durable command identity; unknown selections refuse without allocation.
 * @param call - Current authenticated run owner; the original operation rechecks authority and native admission.
 * @returns original receipt unchanged when terminal; accepted commands use their existing public operation.
 * Cold accepted review/retry-operation commands require explicit owner restoration first. Disconnected waiters do
 * not cancel accepted preparation or maintenance; authentication-sensitive review/retry mutations keep their rules.
 */
async retryRequest(request: SimulationProductRetryRequestInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Retain a full checkpoint request before closing scheduling admission and collecting native owners.
 * @param request - Original product run and caller-retained command; collector policy is server-derived.
 * @param call - Current authenticated owning principal; its retirement only ends the waiter.
 * @returns durable operation receipt; query the same command to distinguish accepted from terminal outcome.
 */
checkpoint(request: SimulationProductCheckpointInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Explicitly validate a full checkpoint and the current suffix, retire old writers and acquire a paused product owner.
 * @param request - Original run, command and completed checkpoint; implementation/policy versions are server-derived.
 * @param call - Current authenticated owner; a lost waiter does not cancel accepted recovery.
 * @returns original durable recovery receipt; a new command revalidates history even after prior recovery success.
 */
restore(request: SimulationProductRestoreInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/** Read exact private portable bytes from a completed original, with independent disclosure authority.
 * @param request - Original run and retention command; retries preserve these identities.
 * @param call - Current authenticated owner and private-record grant.
 * @returns bounded immutable bundle; no live owner, model or scheduling operation is opened.
 */
backupExport(request: SimulationProductBackupExportInput, call: AuthenticatedProductCall): Promise<SimulationProductBackupExportResult>

/**
 * Register original Product creation frames after isolated target owners validate a paused import anchor.
 * This Host-only operation preserves the source principal and rejects live or colliding targets.
 * @param bundle - Verified private backup with original creation provenance.
 * @param checkpointId - Target checkpoint produced after owner replay and explicit cwd mapping.
 * @param call - Current original authenticated principal; imports never transfer authority.
 * @returns registration completion without acquiring an execution owner or starting inference.
 */
importPausedBackup(bundle: WorldBackupBundle, checkpointId: string, call: AuthenticatedProductCall): Promise<void>

/** Retain one explicit original branch command and prepare a paused writable simulation with fresh canonical identities.
 * @param request - Immutable source archive, UUID and memory intervention.
 * @param call - Authenticated owner with independent whole-record source disclosure.
 * @returns original paused branch receipt; retries preserve all original identities and never auto-start.
 */
branchWorld(request: SimulationProductWorldBranchInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldBranchResult>

/** Read retained branch responsibility without opening any owner or Session.
 * @param request - Original command UUID.
 * @param call - Current authenticated principal.
 * @returns original paused metadata, or indistinguishable missing/foreign absence.
 */
readWorldBranch(request: SimulationProductWorldBranchReadInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldBranchResult>

/** Traverse actual immutable Native event references under independent source-read authority.
 * @param request - Exact retained cut and complete traversal bounds.
 * @param call - Current source owner and whole-record reader.
 * @returns bounded references with the original source selection; no model fills missing edges.
 */
queryWorldCausal(request: SimulationProductWorldCausalInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCausalResult>

/** Compare two exact authorized archived observations with the same actual parent provenance.
 * @param request - Original left and right retention cuts.
 * @param call - Current owner with independent whole-record grants for both.
 * @returns bounded observed differences, budgets and explicit unknown quality/cost; no scheduling occurs.
 */
compareWorlds(request: SimulationProductWorldCompareInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCompareResult>

/** Preview an explicitly checkpointed paused source without changing scheduling or invoking a model.
 * @param request - Original product run to inspect.
 * @param call - Current authenticated owner and request lifetime.
 * @returns exact source-bound plan or a quiescence failure without retiring actors.
 */
retentionPreview(request: SimulationProductRetentionPreviewInput, call: AuthenticatedProductCall): Promise<SimulationProductRetentionPlan>

/** Retain the exact user-selected archive and publish its original location; identical command retries never recollect.
 * @param request - Original command, source revision and preview hash.
 * @param call - Current authenticated owning principal.
 * @returns durable original acceptance or completed archive metadata.
 */
retentionExecute(request: SimulationProductRetentionExecuteInput, call: AuthenticatedProductCall): Promise<SimulationProductRetentionResult>

/** Read original acceptance/completion after interruption, without opening or resuming a simulation.
 * @param request - Original run and command identity.
 * @param call - Current authenticated owning principal.
 * @returns bounded durable status or authorized absence.
 */
retentionRead(request: SimulationProductRetentionReadInput, call: AuthenticatedProductCall): Promise<SimulationProductRetentionResult>

/** Read bounded archived originals only with the separate whole-record disclosure grant.
 * @param request - Original owner, sequence and finite page bound.
 * @param call - Current principal with an independent whole-record grant.
 * @returns exact original records within the complete response byte limit.
 */
retentionRecords(request: SimulationProductRetentionRecordsInput, call: AuthenticatedProductCall): Promise<SimulationProductRetentionRecordsResult>

/**
 * Register one attributed input without adding world authority or changing the scheduling phase.
 * @param request - Exact original input identity, allowed entity, text and canonical earliest time.
 * @param call - Current authenticated owner; attribution comes from this principal, not browser fields.
 * @returns original assignment and independently observed consumption; identical retries do not inject twice.
 */
ingress(request: SimulationProductIngressInput, call: AuthenticatedProductCall): Promise<SimulationProductIngressReceipt>

/**
 * Read one original assignment and its recorded decision consumption without starting or attaching a run.
 * @param request - Exact original run/input identity.
 * @param call - Current authenticated owner checked around provider IO.
 * @returns original metadata or non-authoritative absence; text and principal details are omitted.
 */
ingressRequest(request: SimulationProductIngressQuery, call: AuthenticatedProductCall): Promise<SimulationProductIngressResult>

/**
 * Inspect current scheduling ownership and preconditions without attaching or driving actors.
 * @param request - Original registered product run.
 * @param call - Current authenticated owning principal.
 * @returns separate durable phase, driver and in-flight work; a cold run remains recovery-required.
 */
control(request: SimulationProductControlInput, call: AuthenticatedProductCall): Promise<SimulationProductControl>

/**
 * Enrich one bounded authorized Native status batch with independent current company scheduling metadata.
 * @param request - Exact registered run identities; native reads authorize the entire batch before provider IO.
 * @param call - Current authenticated reader; absent company administration never denies permitted directory metadata.
 * @returns bounded native facts, trusted original scenario version and real shared permits, without acquiring any owner.
 */
runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage>

/**
 * Install, tighten or explicitly clear a persistent stopping boundary without starting inference.
 * @param request - Complete original command and target; clear explicitly carries null.
 * @param call - Current authenticated owner, rechecked at the Native write position and before publication.
 * @returns original idempotent receipt and a separate current control observation.
 */
updateRunControl(request: import('./control-types.ts').SimulationProductRunControlInput, call: AuthenticatedProductCall): Promise<import('./control-types.ts').SimulationProductRunControlResult>

/**
 * Persist scheduling intent and drive the owned company through bounded background batches.
 * @param request - Exact caller-retained management identity and target phase; no proxy-only CAS is accepted.
 * @param call - Current authenticated owner; retiring the carrier ends only its wait, not admitted scheduling.
 * @returns original redacted management result and separate current observation; terminal retry never undoes later pause.
 */
manage(request: SimulationProductManageInput, call: AuthenticatedProductCall): Promise<SimulationProductManageResult>

/**
 * Query a durable original scheduling result through read-only history when its execution owner is absent.
 * @param request - Original product run and management identity.
 * @param call - Current authenticated owner, checked before and after provider IO.
 * @returns historical redacted result or non-authoritative absence; never opens a run or resumes models.
 */
managementRequest(request: SimulationProductManagementInput, call: AuthenticatedProductCall): Promise<SimulationProductManagementResult>

/**
 * Read current run-owned task controls without exposing task bodies, opening execution or starting inference.
 * @param request - Exact owned run, canonical observation fence and bounded continuation.
 * @param call - Current authenticated owner; every canonical read rechecks ownership before publication.
 * @returns one bounded task-source window; its cursor binds both world and canonical task revisions.
 */
listTasks(request: SimulationProductTasksInput, call: AuthenticatedProductCall): Promise<SimulationProductTasksPage>

/**
 * Persist one original scoped cancellation before canonical task IO; accepted work outlives its transport waiter.
 * @param request - Original command and exact source/task revision/attempt selection, with authored reason.
 * @param call - Current run owner; native authority is minted from the retained accepted source.
 * @returns original request receipt; completion confirms cancellation/cleanup, never general Team write access.
 */
cancelTask(request: SimulationProductTaskCancelInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Inspect real current personnel choices without opening a run or reserving business work.
 * @param request - Owned run, exact person and one installed management family.
 * @param call - Current authenticated owner and read lifetime.
 * @returns bounded fields with exact Native/person revisions; recovery absence is explicit.
 */
worldManagementFields(request: SimulationProductWorldManagementFieldsInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldManagementFields>

/** Validate a complete paused schedule replacement using the already held original Native owner.
 * @param request - Exact owned run and replacement command.
 * @param call - Current authenticated principal; no caller identity comes from request JSON.
 * @returns inert quote bound to the actual Native revision and original payload.
 */
previewWorldCalendar(request: SimulationProductCalendarInput, call: AuthenticatedProductCall): Promise<SimulationProductCalendarPreview>

/** Recover an original private calendar quote without restoring or acquiring a writer.
 * @param request - Owned run and optional exact command identity.
 * @param call - Current authenticated author.
 * @returns original pending/applied/cancelled outcome, or null for unavailable identities.
 */
readWorldCalendarCommand(request: SimulationProductCalendarCommandInput, call: AuthenticatedProductCall): Promise<SimulationProductCalendarCommandResult>

/** Retain one original user quote before any request can execute its effect.
 * @param request - Complete original quote and command identity.
 * @param call - Authenticated original author.
 * @returns durable original quote; retention alone never reschedules a calendar.
 */
retainWorldCalendar(request: SimulationProductCalendarSubmit, call: AuthenticatedProductCall): Promise<SimulationProductCalendarCommandResult>

/** Withdraw an original retained intent while preserving a raced accepted effect.
 * @param request - Exact original command identity.
 * @param call - Actual authenticated author.
 * @returns the authoritative cancellation or application outcome.
 */
cancelWorldCalendar(request: SimulationProductCalendarCancel, call: AuthenticatedProductCall): Promise<SimulationProductCalendarCommandResult>

/** Commit the unchanged quote with Native command deduplication; retries survive a lost transport reply.
 * @param request - Complete original quote and command identity.
 * @param call - Current authenticated owner retained as Native provenance.
 * @returns original acceptance sequence and rule revision; stale or changed input rejects before append.
 */
submitWorldCalendar(request: SimulationProductCalendarSubmit, call: AuthenticatedProductCall): Promise<SimulationProductCalendarReceipt>

/**
 * Preview actual identities, fees and obligations under a current canonical source fence, with no reservation or inference.
 * @param request - Complete original form choices and the displayed person's revision.
 * @param call - Actual authenticated owner; authority is checked again at Native's read boundary.
 * @returns inert impact and original Native commitment; waiting duties do not masquerade as impossible admission.
 */
previewWorldManagement(request: SimulationProductWorldManagementDraft, call: AuthenticatedProductCall): Promise<SimulationProductWorldManagementPreview>

/**
 * Retain one immutable authenticated command before Native acceptance, then execute only its original direct plan.
 * @param request - Original form, command identity and the exact confirmed Native preview hash/revision.
 * @param call - Actual authenticated owner; caller/Decision/sender fields are never accepted from the payload.
 * @returns original receipt; callback uncertainty stays accepted and exact retry cannot change the case or create an owner.
 */
submitWorldManagement(request: SimulationProductWorldManagementSubmitInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Prepare a dedicated helper and retain explicit user-authored input under the original scenario runtime.
 * @param request - Strict user input; claimed source references other than user-authored reject.
 * @param call - Actual authenticated run owner, rechecked through canonical preparation.
 * @returns original accepted job without invoking a model.
 */
generationRequest(request: SimulationProductGenerationRequest, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult>

/**
 * Read an original private result without opening execution or invoking a model.
 * @param request - Owned run and exact job identity.
 * @param call - Current authenticated owner; unrelated Native generation sources remain private.
 * @returns retained original or null in this observed prefix.
 */
generationRead(request: SimulationProductGenerationRead, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult>

/**
 * Explicitly execute one accepted helper through the canonical Session and shared model pool.
 * @param request - Original job, never replacement model input or an implicit retry request.
 * @param call - Current human owner; cancellation preserves accepted provider responsibility.
 * @returns original validated output or rejects with its retained unknown state available to reads.
 */
generationExecute(request: SimulationProductGenerationRead, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult>

/**
 * Validate, cancel or link a retained result; provider output and start transitions are never client-selectable.
 * @param request - Strict finite review transition.
 * @param call - Current actual run owner and disclosure authority.
 * @returns original durable disposition without inference.
 */
generationTransition(request: SimulationProductGenerationTransition, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult>

/**
 * Submit a validated generated Persona through the existing A2 draft owner, then link the exact committed draft.
 * @param request - Explicit finite-template review placement; no acceptance or hiring is implied.
 * @param call - Actual human owner; the original management policy still authorizes the draft.
 * @returns incorporated source after the A2 draft commits, or retained original responsibility on interruption.
 */
generationPersonaDraft(request: SimulationProductGenerationPersonaDraft, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult>

/**
 * Retain one original World cancellation before competing with hiring at Native's linearization point.
 * @param request - Owned original run, caller-retained command and run-local case identity.
 * @param call - Current authenticated owner; terminal retries remain readable after later world changes.
 * @returns original receipt; unknown cleanup remains accepted and explicit retry uses the exact retained selector.
 */
cancelWorldCase(request: SimulationProductWorldCaseCancelInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Observe bounded canonical task review metadata without opening a run, attaching actors or invoking models.
 * @param request - Owned run, exact world revision and bounded continuation.
 * @param call - Current authenticated product owner; revoked reads reject after canonical IO.
 * @returns only run-owned latest attempt metadata and current non-authorizing action hints.
 */
listTaskReviews(request: SimulationProductTaskReviewListInput, call: AuthenticatedProductCall): Promise<SimulationProductTaskReviewPage>

/**
 * Persist a scene-scoped original review before canonical mutation; browser fields never grant Team authority.
 * @param request - Exact task creation, completed attempt, observed task revision and immutable outcome/reason.
 * @param call - Current authenticated run owner, rechecked at the serialized write position.
 * @returns original accepted or terminal request receipt; cold writes require explicit restore, cold reads stay inert.
 */
resolveTaskReview(request: SimulationProductTaskReviewResolveInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>

/**
 * Retain one exact retry permission before native IO; unknown accepted outcomes keep their original identity.
 * @param request - Original command, accepted external operation, positive attempt-count fence and reason.
 * @param call - Current authenticated run owner; queued native mutation rechecks this lease.
 * @returns original accepted or terminal receipt. Cold accepted requests require explicit owner restore and this same retry.
 */
retryOperation(request: SimulationProductOperationRetryInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt>
```

Types: [AuthenticatedProductCall](core.zh.md)

Source: [`packages/simulation/simulation-product/src/administration.ts`](../../packages/simulation/simulation-product/src/administration.ts)

<a id="ctxsimulationproducts--simulationproducts"></a>

### `ctx.simulationProducts` — `SimulationProducts`

One Host-owned metadata directory; list/inspect never take Simulation execution ownership.

```ts cordis-catalog
/** Read the current author's original saved definition.
 * @param request - Exact private draft and optional revision.
 * @param call - Authenticated author.
 * @returns the original saved definition without opening a run or invoking a model. */
readScenarioDraft(request: ScenarioDraftRead, call: AuthenticatedProductCall): Promise<ScenarioDraftReadResult>

/** Save one private immutable revision without editing any running world.
 * @param request - Original save intent and parent revision.
 * @param call - Authenticated author.
 * @returns saved revision or explicit conflict; no running world is changed. */
saveScenarioDraft(request: ScenarioDraftSave, call: AuthenticatedProductCall): Promise<ScenarioDraftSaveResult>

/**
 * Obtain a process-local registration capability for the trusted creation owner; it cannot cross JSON transports.
 * @returns a writer that persists the original allocated registration, coalesces exact retries and refuses changed ownership/spec.
 * The caller persists its creation intent first and drains this capability before its own teardown. Reads never invoke it.
 */
creationRegistrar(): (record: SimulationProductRecord) => Promise<void>

/**
 * Read safe metadata for the current principal without opening provider history.
 * @param request - Actor-free query and opaque continuation.
 * @param call - Transport-authenticated current principal and cancellation lifetime.
 * @returns complete bounded authorized directory window; new observations require first-page restart.
 */
list(request: SimulationProductListInput, call: AuthenticatedProductCall): Promise<SimulationProductRunPage>

/**
 * Inspect exact registered history under current ownership association before and after provider IO.
 * @param request - Registered run identity only.
 * @param call - Transport-authenticated principal and cancellation lifetime.
 * @returns bounded administrative world summary without knowledge, instructions or physical paths.
 */
inspect(request: SimulationProductInspectInput, call: AuthenticatedProductCall): Promise<SimulationProductRunInspection>

/**
 * Observe a finite authorized directory window without opening, restoring or executing any native run.
 * @param request - Distinct registered run identities bounded by maxPageSize and complete request bytes.
 * @param call - Current authenticated principal and credential-retirement lifetime.
 * @returns request-ordered observations; independent provider or accounting failures yield safe per-run unavailability.
 * Missing authorization or credential retirement rejects the whole batch, and complete response overflow rejects without partial rows.
 */
runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage>

/**
 * Inspect one exact Team Envelope reference retained by a prepared decision.
 * @param request - Frozen source ordinal, bounded lookup/body continuation and optional exact position.
 * @param call - Authenticated owner; Simulation disclosure and Team membership remain independent.
 * @returns inert source text, explicit lookup progress or redacted absence; every IO is followed by authority checks.
 */
inspectSource(request: SimulationProductSourceInput, call: AuthenticatedProductCall): Promise<SimulationProductSourceInspection>

/** Current whole-record disclosure authority shared by live and archived source readers; ownership alone is insufficient.
 * @param runId - Original directory run, resolved only after caller validation.
 * @param call - Current principal credential lifetime.
 * @returns current independent whole-record grant without opening execution.
 */
recordBodyAllowed(runId: SimulationProductRunId, call: AuthenticatedProductCall): boolean

/** Explicit whole-ancestor closure permission for this exact owned branch; a wildcard run grant cannot supply it.
 * @param runId - Exact current branch registration.
 * @param call - Current authenticated owner and disclosure lifetime.
 * @returns current explicit closure permission; absence never infers permission from shared principal identity.
 */
provenanceBodyAllowed(runId: SimulationProductRunId, call: AuthenticatedProductCall): boolean

/**
 * Preserve original source bytes under an explicit whole-record grant even when its Native parser is unavailable.
 * @param request - Registered run and encrypted source/policy-bound text continuation; no caller paths or role hints.
 * @param call - Current owner and whole-record permission, rechecked after storage IO and before publication.
 * @returns bounded raw-only text parts; this never opens a writer, interprets Native state or claims a complete checkpoint.
 */
archiveRaw(request: import('./raw-archive-types.ts').SimulationProductRawArchiveInput, call: AuthenticatedProductCall): Promise<import('./raw-archive-types.ts').SimulationProductRawArchivePage>

/**
 * Browse original journal sequences without opening execution or inferring history from snapshots.
 * @param request - Exact run, optional kind/sequence and policy-bound continuation.
 * @param call - Current authenticated owner and transport lifetime.
 * @returns bounded metadata or explicit whole-run-authorized JSON text parts; policy changes reject the old page.
 */
readRecords(request: SimulationProductRecordsInput, call: AuthenticatedProductCall): Promise<SimulationProductRecordsPage>

/**
 * Explicitly rebuild derived references for the authenticated owner's exact source prefix.
 * @param request - Owned run and expected revision; retries preserve the selected source.
 * @param call - Live transport identity; revocation prevents new publication admission.
 * @returns published metadata without source bodies, model calls or world mutations.
 */
rebuildIndex(request: SimulationProductRebuildIndexInput, call: AuthenticatedProductCall): Promise<SimulationProductRebuildIndexResult>

/**
 * Read one filtered administrative collection at an exact native world revision.
 * @param request - Registered run, collection-specific filters and opaque continuation.
 * @param call - Current transport-authenticated principal and cancellation lifetime.
 * @returns bounded redacted rows and authoritative filtered total; changed revision/query rejects continuation.
 */
browse(request: SimulationProductBrowseInput, call: AuthenticatedProductCall): Promise<SimulationProductCollectionPage>

/**
 * Discover original World cases without private bodies or execution allocation.
 * @param request - Owned run, exact filter and revision-bound continuation.
 * @param call - Current authenticated credential.
 * @returns bounded original case metadata; this never invokes a model.
 */
listWorldCases(request: SimulationProductWorldCasesInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCasesPage>

/**
 * Read one exact bounded World domain window without acquiring a writable run or execution connection.
 * @param request - Kind-specific selector, exact temporal and continuation fences, with no caller-selected policy.
 * @param call - Authenticated owner; private bodies require additional current context/case/Persona grants.
 * @returns one detached public projection and explicit source coverage, or a strict missing original.
 * Pages shrink to the complete reply byte allowance; an oversized single row refuses without truncating its structure.
 */
readWorldDomain(request: SimulationProductWorldDomainInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldDomainResult>

/**
 * Read one original World case section with separate case-prose and Persona permission.
 * @param request - Original case, independently authorized section and continuation.
 * @param call - Current authenticated credential.
 * @returns bounded details; revoked policy strips private bodies before the response settles.
 */
inspectWorldCase(request: SimulationProductWorldCaseInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCaseInspection>

/**
 * Obtain a trusted case-policy registrar without granting disclosure merely by discovering it.
 * @returns process-local disposable grants; installing or retiring a contribution invalidates private read lifetimes.
 */
caseReaderRegistrar(): (readers: readonly SimulationProductCaseReader[]) => () => void

/**
 * Obtain the single original-administration case-control reader capability.
 * @returns a process-local registrar whose disposal invalidates observations without Native effects.
 */
worldCaseControlReaderRegistrar(): (reader: SimulationProductWorldCaseControlReader) => () => void

/**
 * Obtain the single original administration's read-only personnel action registrar.
 * @returns process-local metadata registration; disposal retires the hints and invalidates read continuations.
 */
worldManagementReaderRegistrar(): (reader: SimulationProductWorldManagementReader) => () => void

/**
 * Recheck the actual private-case read policy at a cross-owner disclosure boundary.
 * @param runId - Registered run, checked against the current principal.
 * @param requestId - Original case identity; this does not infer its existence or read its body.
 * @param call - Current credential lifetime.
 * @param domain - Independently authorized case or Persona prose.
 * @returns whether a currently installed reader grants this exact disclosure; revocation is immediate.
 */
caseReadable(runId: import('./types.ts').SimulationProductRunId, requestId: import('@clocky/clocky-simulation/world-types').WorldRequestId, call: AuthenticatedProductCall, domain: 'case' | 'persona'): boolean

/**
 * Read exact object sections; private context text requires a separate trusted entity-scoped reader.
 * @param request - Registered run, branded object and section, optional revision fence and section page.
 * @param call - Current authenticated principal and cancellation lifetime.
 * @returns bounded section or authorized absence; stale revision/page requires explicit refresh.
 */
inspectObject(request: SimulationProductObjectInput, call: AuthenticatedProductCall): Promise<SimulationProductObjectInspection>

/**
 * Obtain the process-local registration capability for the original administration owner.
 * @returns single-reader registrar; its disposer removes hints and invalidates pending observations without native effects.
 */
operationRetryReaderRegistrar(): (reader: SimulationProductOperationRetryReader) => () => void

/**
 * Obtain a runtime-only policy registration capability for trusted deployment plugins, with no effect merely from discovery.
 * @returns a registrar whose validated grants retire with their disposer. It cannot be serialized or used after this service closes.
 */
contextReaderRegistrar(): (readers: readonly SimulationProductContextReader[]) => () => void

/**
 * Obtain the trusted whole-run historical journal policy registrar.
 * @returns process-local registrar; disposal revokes content and invalidates waiting readers without stopping execution.
 */
recordReaderRegistrar(): (readers: readonly SimulationProductRecordReader[]) => () => void

/**
 * Wait for metadata invalidation without opening execution or returning bodies. Polls use ordinary bounded read admission.
 * @param request - Exact run, prior authenticated cursor and optional real wait; zero is an immediate probe.
 * @param call - Current credential lease; cancellation and unload retire the wait and drain admitted native IO.
 * @returns current policy lifetime and world observation. Expired/foreign cursors reset; provider absence is explicit.
 */
watch(request: SimulationProductWatchInput, call: AuthenticatedProductCall): Promise<SimulationProductWatchResult>
```

Types: [AuthenticatedProductCall](core.zh.md)

Source: [`packages/simulation/simulation-product/src/index.ts`](../../packages/simulation/simulation-product/src/index.ts)

<a id="ctxsimulations--simulations"></a>

### `ctx.simulations` — `Simulations`

Registry whose providers own run IO and exclusive coordinator lifetimes.

```ts cordis-catalog
/** Validate a portable Native prefix through its original provider without opening a run.
 * @param provider - Explicit installed reducer provider.
 * @param input - Complete original prefix, exact source format and source spec.
 * @returns detached replayed snapshot; absent provider capability refuses without IO.
 */
validateArchivePrefix(provider: string, input: import('./experiment.ts').SimulationArchivePrefix): import('./types.ts').SimulationSnapshot

/**
 * Access the selected provider's explicit pure World parser/reducer catalog.
 * @param name - Registered deployment provider identity.
 * @returns the provider-owned catalog; absent World capability rejects before side effects.
 */
domains(name: string): SimulationWorldDomainRegistry<NativeWorldDomain>

/**
 * Register an implementation.
 * @param provider - Named implementation.
 * @returns effect-scoped disposer.
 */
registerProvider(provider: SimulationProvider): () => void

/**
 * Validate explicit selection before IO.
 * @param request - Run request.
 * @returns resolved selection.
 */
resolve(request: SimulationRunRequest): SimulationRunSelection

/**
 * Open a resolved run.
 * @param selection - Explicit provider and run configuration.
 * @returns caller-owned run.
 */
open(selection: SimulationRunSelection): Promise<SimulationRun>

/**
 * Resolve immutable selection and provider support before read-only IO.
 * @param request - Provider and expected run spec; no execution or storage path flags.
 * @returns validated supported inspection selection.
 */
resolveInspection(request: SimulationInspectionSelection): SimulationInspectionSelection

/**
 * Read raw registered-source bytes without acquiring execution or selecting a fallback Native parser.
 * @param selection - Deployment-owned provider/run selection; public consumers must authorize whole-record disclosure.
 * @returns bounded storage-only preservation or absence, never writable/replayed Native state.
 */
rawArchive(selection: SimulationInspectionSelection): Promise<import('./inspection.ts').SimulationRawArchiveObservation | undefined>

/**
 * Read existing run facts without opening an execution owner or changing phase.
 * @param selection - Resolved inspection selection.
 * @returns detached history and owner observation, or undefined for a missing run; caller owns authorization and redaction.
 */
inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined>

/**
 * Rebuild a provider-owned reference index without opening a writer or invoking models.
 * @param selection - Existing provider and immutable spec.
 * @param expectedRevision - Exact source revision.
 * @param authorize - Current trusted caller fence, retained through source IO.
 * @returns published source identity; unsupported providers reject explicitly.
 */
rebuildIndex(selection: SimulationInspectionSelection, expectedRevision: number, authorize: () => void): Promise<import('./inspection.ts').SimulationIndexManifest>

/**
 * Preview existing history through its installed provider without opening or creating a run.
 * @param selection - Exact provider and immutable existing-run spec.
 * @param request - Current-prefix strict user action, without a durable reservation.
 * @param authority - Trusted live authentication, exact management permission and source-cut resolver.
 * @returns actual bounded Native quote, or undefined for absent history.
 */
previewWorldManagement(selection: SimulationInspectionSelection, request: import('./world-management-types.ts').SimulationWorldManagementPreviewRequest, authority: import('./world-management-types.ts').SimulationWorldManagementAuthority): Promise<import('./world-management-types.ts').SimulationWorldManagementPreview | undefined>

/**
 * Read bounded Native personnel duties with the provider's actual installed manifest and no execution owner.
 * @param selection - Explicit immutable read selection; create/open and storage options are excluded.
 * @param query - Exact original person/assignment selector and complete item/byte bounds.
 * @returns detached paired Native prefix and report, or undefined if history is absent.
 */
inspectPersonnelObligations(selection: SimulationInspectionSelection, query: import('./personnel-obligations.ts').PersonnelObligationQuery): Promise<import('./inspection.ts').SimulationPersonnelObligationObservation | undefined>
```

Source: [`packages/simulation/simulation/src/index.ts`](../../packages/simulation/simulation/src/index.ts)

<a id="ctxsimulationteams--simulationteams"></a>

### `ctx.simulationTeams` — `SimulationTeams`

Named run attachments using durable Team rules to prevent controller bypass.

```ts cordis-catalog
/**
 * Read cross-owner personnel duties without opening, attaching, restoring or claiming execution ownership.
 * @param selection - Original existing Native provider/spec, resolved by the authenticated consumer.
 * @param request - Exact person/assignment revisions plus complete bounded inventory limits.
 * @param signal - Optional caller cancellation; admitted owner reads drain and late results cannot publish.
 * @returns original paired Native prefix and canonical inventory, with explicit partial source coverage.
 */
inspectPersonnelObligations(selection: import('@clocky/clocky-simulation').SimulationInspectionSelection, request: import('@clocky/clocky-simulation').PersonnelObligationQuery, signal?: AbortSignal): Promise<import('@clocky/clocky-simulation').SimulationPersonnelObligationObservation | undefined>

/**
 * Install the trusted execution-factory catalog used before World writable restore.
 * @param catalog - Provider-owned strict parser and exact generation registry; Native catalogs remain separate.
 * @returns synchronous admission-removal disposer; the installing Fiber owns its effect and registry drainage.
 */
registerWorldExecutionCatalog(catalog: SimulationWorldDomainRegistry): () => void

/**
 * Open an existing run, verify a completed manifest and every retained owner suffix, then retire old writers.
 * @param selection - Exact existing run configuration; create mode rejects.
 * @param request - Completed checkpoint id, required implementation version and owner-movement retry bound.
 * @param signal - Optional cancellation; admitted controller cleanup is still drained.
 * @returns caller-owned run and connection, paused without model calls or outbox effects. Repeated restores
 * revalidate current retained suffixes; they never roll state back to the checkpoint. Retired decision windows
 * close only after every slot is accepted or cancelled; restoration never accepts a submitted proposal.
 */
restore(selection: import('@clocky/clocky-simulation').SimulationRunSelection, request: import('@clocky/clocky-simulation').SimulationCheckpointRestoreRequest, signal?: AbortSignal): Promise<import('./types.ts').SimulationCheckpointRestoration>

/**
 * Measure the known runtime-shared required context and refuse only a provable byte or admission-policy impossibility.
 * @param request - Frozen request allowance, optional model capacity and known runtime-shared required sections.
 * @returns exact known bytes and estimated input floor when supplied; complete envelope and future consumption remain unknown.
 */
requestCapacity(request: RequestCapacityInput): RequestCapacityResult

/**
 * Inspect host-local Simulation model admission across all attached runs.
 * @returns reserved/executing permits, queued requests and their configured limits.
 */
modelUsage(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number }

/**
 * Create or reconcile the run's canonical execution Team before attaching its lifecycle owner.
 * @param run - Open, unattached run whose root identity is journal-owned.
 * @param creation - Explicit Team goal, budgets and optional authority grant.
 * @param ownerName - Immutable lifecycle owner used by the subsequent attachment.
 * @returns the confirmed Team; target response loss reuses the reserved identity.
 */
ensureTeam(run: SimulationRun, creation: Omit<import('@clocky/clocky-team').TeamRootCreateInput, 'rules'>, ownerName: string): Promise<import('@clocky/clocky-team').TeamStateSnapshot>

/**
 * Register an exact provider-owned external archive contract for this deployment.
 * @param provider - Trusted plugin's pure verifier and bounded capture/restore capabilities.
 * @returns effect-scoped removal; disposal closes new capture/restore while prior packages remain read-only evidence.
 */
registerWorldArchiveProvider(provider: import('./external-archive.ts').WorldExternalArchiveProvider): () => void

/** Read the installed exact external archive contracts.
 * @returns current trusted capabilities; this map grants no run or principal authority.
 */
worldArchiveProviders(): import('./external-archive.ts').WorldExternalArchiveProviders

/**
 * Register one trusted bounded pure task completion rule; source disposal retires future evaluation.
 * @param policy - Exact policy generation and deterministic world-effect evaluator.
 * @returns HMR-safe disposer; accepted result retries use the recorded result without re-evaluation.
 */
registerTaskCompletionPolicy(policy: import('@clocky/clocky-simulation').SimulationTaskCompletionPolicy): () => void

/**
 * Register a versioned pure summary policy over explicitly selected authorized knowledge.
 * @param policy - Bounded synchronous, IO-free transformation; ambient histories must not be read.
 * @returns effect-scoped disposer; retained summaries do not depend on the implementation remaining loaded.
 */
registerSummaryPolicy(policy: import('@clocky/clocky-simulation').SimulationSummaryPolicy): () => void

/**
 * Register an effect-scoped pure computation policy; duplicate ids reject even across versions.
 * @param policy - Explicit identity/version and bounded synchronous computation over a frozen authorized view.
 * @returns disposer stopping new computation; already recorded outputs remain durable.
 */
registerDeterministicPolicy(policy: import('@clocky/clocky-simulation').SimulationDeterministicPolicy): () => void

/**
 * Execute a model operation using its actual current Agent identity.
 * @param agent - Registry-owned local caller, supplied by tool execution.
 * @param request - Observation, replacement proposals or submission without caller-selected identities.
 * @param signal - Calling tool cancellation.
 * @returns authorized observations or proposal acknowledgement, never fabricated world results.
 */
modelRequest(agent: Agent, request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult>

/**
 * Attach one run to a dedicated Team whose immutable activationLifecycleOwner rule names this owner.
 * @param run - Caller-owned open run.
 * @param teamId - Canonical Team selected by the deployment.
 * @param ownerName - Exact durable rule value, unique in this controller.
 * @returns a connection that derives entity identity and drains activation ownership on close.
 */
async attach(run: SimulationRun, teamId: TeamId, ownerName: string): Promise<SimulationTeamConnection>
```

Types: [Agent](core.zh.md) · [TeamId](team.zh.md) · [TeamRootCreateInput](team.zh.md) · [TeamStateSnapshot](team.zh.md)

Source: [`packages/simulation/simulation-team/src/index.ts`](../../packages/simulation/simulation-team/src/index.ts)

<a id="ctxsimulationworldexecutions--simulationworldexecutions"></a>

### `ctx.simulationWorldExecutions` — `SimulationWorldExecutions`

Opt-in factory provider; pure browsing needs neither this service nor its execution bindings.

```ts cordis-catalog
/**
 * Register an independent strict execution factory; its installing Fiber owns the returned disposer.
 * @param entry - Actual factory and exact immutable schema/artifact/generation identity.
 * @returns disposer which closes new restore/binding admission synchronously and drains admitted factory leases.
 */
register(entry: WorldExecutionProvider): () => Promise<void>

/**
 * Observe installation of current frozen pins without rereading retained payload bodies.
 * @param pins - Exact operation generations from an authoritative live Native control projection.
 * @param native - Installed Native parser catalog, compared by identity.
 * @returns whether all factories and original parsers are installed; this hint does not admit execution or restoration.
 */
controlAvailable(pins: readonly SimulationWorldDomainPin[], native: SimulationWorldDomainRegistry): boolean

/**
 * Admit original execution generations before a product owner retires or restores its current connection.
 * @param snapshot - Current retained Native state, including all historical pins and payloads.
 * @param native - Installed Native catalog whose original parser objects must match.
 * @returns release after admitted ownership movement; this performs no construction, IO or inference.
 */
retain(snapshot: Pick<SimulationSnapshot, 'world'>, native: SimulationWorldDomainRegistry): () => void

/**
 * Bind every required original provider without IO, preserving explicitly supplied test adapters.
 * @param binding - Frozen Native run, resolved routes, connection and maintenance anchor.
 * @param overrides - Trusted already-bound adapters; exact pin and schemas are independently checked by the driver.
 * @returns complete handler set; a missing provider or malformed factory output rejects before scheduling.
 */
handlers(binding: WorldExecutionBinding, overrides: readonly WorldExecutionHandler[] = []): readonly WorldExecutionHandler[]
```

Source: [`packages/simulation/simulation-world/src/providers.ts`](../../packages/simulation/simulation-world/src/providers.ts)

<a id="simulation-events"></a>

### `simulation/*` events

<a id="simulationcommitted--emit"></a>

#### `simulation/committed` — emit

Projection published after the matching journal append or replay. The run may contain several independently bound Sessions.

```ts cordis-catalog
/**
 * Projection published after the matching journal append or replay.
 * The run may contain several independently bound Sessions.
 * @mode emit
 * @param snapshot - Committed detached projection.
 * @param durableTail - Tail returned by storage.
 * @param previousRevision - Tail before this append; absent for initial replay publication.
 */
'simulation/committed'(snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number): void
```

Source: [`packages/simulation/simulation-local/src/index.ts`](../../packages/simulation/simulation-local/src/index.ts)
<!-- END GENERATED cordis-surface -->

显式派生索引维护通过 Product `rebuildIndex`、Host `simulation.index.rebuild` 和 SDK `simulation/index-rebuild` 提供。调用方保留 `runId` 与 `expectedRevision`；成功返回已发布源 hash 和格式版本。普通浏览不会发布索引。前缀校验、原子发布和冷重建边界见[只读历史决策](../../.agents/notes/implemented/architecture/2026-09-29-simulation-readonly-history.zh.md#derived-inspection-index)。

`simulations.validateArchivePrefix(provider, input)` 能力通过已安装 provider、准确日志版本和来源 spec，在内存中校验完整便携 Native 前缀。本地校验与 inspection 使用相同 reducer 和投影不变量，执行配置的扫描限制，不打开来源存储、不创建身份、也不调用模型。实验分支在初始化新可写 owner 前使用此能力验证不可变旧 cut 和离线归档。
