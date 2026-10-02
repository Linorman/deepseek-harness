# Simulation

[English](simulation.md) | 中文

`SimulationProductSourceInput` 只指定保留的决策来源序号及可选位置／续页，`SimulationProductSourceInspection` 区分定位进度与已授权文本。每次读取分别需要仿真来源 grant 和当前 Team 成员读取资格，不接受任意频道选择，也不推理。[来源读取契约](../../packages/simulation/simulation-product/README.zh.md)负责额度、删节和续页规则。

实体／决策的 `knowledge` 分区在明确内容 grant 与当前传递受众检查下检索当前或原始已选精确知识。`knowledgeVisible/selectKnowledge` 是共享的纯定义包投影，本地 provider 负责其持久写入。原始已送达报告文本需要独立来源权限和保留送达证据。带来源记录不代表已验证世界事实，当前受众变化会在复查前释放知识缓存。

`SimulationProductWatchInput/Result` 定义一次已认证、有界的元数据等待。不授予权限的 `readVersion` 约束冻结上下文响应，reset 使旧续页失效。独立 `SimulationProductContextReader` 贡献使用进程内 registrar；策略插件移除唤醒观察，不替换目录或执行所有权。[产品读取策略](../../packages/simulation/simulation-product/README.zh.md)负责真实时间额度、当前主体校验及清理。

`SimulationProductObjectInput` 可独立分页选择实体关系或冻结决策上下文。关系保留精确有效区间。产品目录明确的主体／实体上下文 reader 只公开历史纯文本片段；单独元数据所有权仍删节正文。冻结上下文保留原投影及来源，与完整模型请求不同，也不授予当前知识或 Team／Session 来源访问。[产品读取策略](../../packages/simulation/simulation-product/README.zh.md#relationships-and-frozen-context)负责配置、额度及退役。

`SimulationProductAdministrationControl` 将维护动作与调度分开，提供有界输入目标／时间／字节限制及兼容检查点元数据。已完成原生检查点在日志版本 44 中保留真实 `publishedAt`。恢复引用在明确原生验证前仍只读，当前后缀恢复不请求历史回滚。

`SimulationProductPreflightInput` 包含模板选择、允许的初始参数及可选不可变 `SimulationProductLimits`，不含命令身份。`SimulationProductPreflightResult` 返回精确解析的 `SimulationProductConfiguration` 或有界字段问题；配置含只读 Host 共享并发及版本／时间元数据。当前部署与容量检查不分配 run、Team、actor 或 permit。[创建契约](../../packages/simulation/simulation-product/README.zh.md)负责允许下调的额度、零 token 确定性工作流及重复创建准入。

`SimulationProductRequestsInput/RequestsPage` 在当前运行 owner 授权下提供有界、仅含 receipt 的原请求发现；其 snapshot revision 属于行政日志，独立于 Native 世界 revision。`SimulationProductRetryRequestInput` 只选择原 runId／commandId，明确重试派发保留的原 payload，终态 receipt 不变，冷 owner 恢复仍保留前置条件。原生 phase 与 ingress 历史保持独立。[原请求恢复契约](../../packages/simulation/simulation-product/README.zh.md)负责游标隔离、隐私及有界准入。

`SimulationProductControlBudget` 提供原模型 route、每次请求预留量、每个模拟区间的 token 额度、精确区间、驻留上限及配置的主机共享模型并发。控制 snapshot 分开表示观察到的开始／暂停前置条件、在途工作与原 receipt。[产品行政](../../packages/simulation/simulation-product/README.zh.md)负责准入与命令身份，[浏览器工作区](../../packages/client/ui-simulation/README.zh.md)负责明确确认、原结果恢复及有界原始草稿。

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

`SimulationTaskExecutionRequest.interaction.execution` 选择开放 `obligation` 或经证据核对的 `continuation`。后者保留同一任务／assignee／Session 的已物理退休 attempt 对应已兑现转移引用，以新输入受理无提案确认，不允许新世界提案。原失败 attempt 和已关闭业务事实保持不变。[原生任务契约](../../packages/simulation/simulation/README.zh.md)负责资格及结果证据；本地日志版本 44 拒绝早期格式。已安装公司模板返回 `cognition-only` 或 `automatic-tasks`，任务模式沿用产品 owner 的 timer 及完整检查点／恢复协议。

`SimulationProductTaskReviewListInput` 与 `SimulationProductTaskReviewPage` 描述有界规范审核目标及固定场景证据。`SimulationProductTaskReviewResolveInput` 固定原命令、来源操作、attempt 及任务 revision；安装的采购方审核公司模板将报告返工与一次库存转移分开。[行政审核契约](../../packages/simulation/simulation-product/README.zh.md#administrative-task-review)负责当前权限、冷查询、精确重试及显式调度。

`SimulationProductRunStatusesInput` 选择精确有限的已登记运行批次；`SimulationProductRunStatusesPage` 分别观察各 provider，不授予执行权限。Native `SimulationRuntimeMetrics` 与准入共用预算及 writer 槽位算法：token 计费包含未决预留，未知尝试单独计数。行政运行状态、不可变场景版本及采用真实时间的 Host 模型池，与单 run 的区间用量分开。[状态契约](../../packages/simulation/simulation-product/README.zh.md)负责字节／凭据边界及不可用状态。

`SimulationProductOperationRetryInput` 选择精确的未知外部操作及已记录的尝试次数。产品在 `retryOutbox()` 按不变原生策略授予一次有界额度前先持久保存原命令；授权或查询都不发布、不推理或恢复调度。精确重试保留原生授权和原受理时间，冷重放或后续结果出现后亦如此。明确继续调度时重新核对目标权限，并按原 Envelope／任务身份对账。当前能力元数据区分已确认结果与仅不需要人工授权的操作。[重试契约](../../packages/simulation/simulation-product/README.zh.md)负责命令范围与恢复。

`SimulationCheckpointDiagnostic` 只包含固定阶段／类别和规范引用元数据，清理确认与主失败分开。原生失败检查点和产品检查点／恢复回执保留原诊断，私有 provider 消息和路径仍被隐藏。Session／频道引用包含规范 Team 绑定，让导航选中精确受保护目标。未知失败标为不可用，不根据正文猜测。[诊断决策](../../.agents/notes/implemented/architecture/2026-10-01-simulation-checkpoint-failure-diagnostics.zh.md)负责分类与持久化；关联正文读取仍独立鉴权。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsimulationadministration--simulationadministration"></a>

### `ctx.simulationAdministration` — `SimulationAdministration`

One administration journal and one Host handle per original product creation; startup never resumes models.

```ts cordis-catalog
/**
 * Read the complete bounded installed company catalog under current authentication.
 * @param call - Transport-authenticated principal and wait lifetime.
 * @returns safe version/route/limit metadata; never resolves a native execution handle.
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

/**
 * Browse original journal sequences without opening execution or inferring history from snapshots.
 * @param request - Exact run, optional kind/sequence and policy-bound continuation.
 * @param call - Current authenticated owner and transport lifetime.
 * @returns bounded metadata or explicit whole-run-authorized JSON text parts; policy changes reject the old page.
 */
readRecords(request: SimulationProductRecordsInput, call: AuthenticatedProductCall): Promise<SimulationProductRecordsPage>

/**
 * Read one filtered administrative collection at an exact native world revision.
 * @param request - Registered run, collection-specific filters and opaque continuation.
 * @param call - Current transport-authenticated principal and cancellation lifetime.
 * @returns bounded redacted rows and authoritative filtered total; changed revision/query rejects continuation.
 */
browse(request: SimulationProductBrowseInput, call: AuthenticatedProductCall): Promise<SimulationProductCollectionPage>

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
 * Read existing run facts without opening an execution owner or changing phase.
 * @param selection - Resolved inspection selection.
 * @returns detached history and owner observation, or undefined for a missing run; caller owns authorization and redaction.
 */
inspect(selection: SimulationInspectionSelection): Promise<SimulationRunObservation | undefined>
```

Source: [`packages/simulation/simulation/src/index.ts`](../../packages/simulation/simulation/src/index.ts)

<a id="ctxsimulationteams--simulationteams"></a>

### `ctx.simulationTeams` — `SimulationTeams`

Named run attachments using durable Team rules to prevent controller bypass.

```ts cordis-catalog
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
