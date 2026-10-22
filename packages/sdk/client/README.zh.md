# @clocky/clocky-sdk-client

协调者 transcript 严格校验 `compaction/assessment` 估计值和 `compaction/end.noGain` 的摘要、计数及无收益关系；格式错误或成功结束却携带无收益证据的事件会在进入类型化事件前拒绝。

`archiveRawSimulation()` 读取一页显式授权的原始保留内容并校验登记 run 身份；文字片段可拼接为原始字节归档。客户端不会自动跟随续页、改写来源版本或恢复推理。

`updateSimulationRunControl()` 通过 `simulation/runs-run-control` 持久化原始停止目标或显式 null 解除。输入不接受调用方角色、principal 或 revision；输出校验 run、命令和目标身份，当前 control 可以对应后续命令。解除保留 null 字段且不会恢复调度。

归档预览要求来源已暂停且静止，不会退休角色。执行保留一个原 command、revision 和 plan hash，读取用于对账其持久结果。首次归档复制并校验完整 owner 历史，不删除原件或释放历史容量。归档原记录分页需要独立的完整记录读取权限；拥有 run 或归档命令不代表可以读取 Session、Channel 正文。

生成请求、读取、执行、状态转换和 Persona 草稿方法保留原 job 身份，仅显式执行调用模型。产品输入必须为用户撰写；Host 记录实际 principal 来源并限制 runtime、scope 和 audience。Persona 纳入经过已有 A2 预览和提交路径，保留生成草稿的 revision/hash。读取和重试不创建替代 job，未知输出仍是原对账责任。结果属于私有数据，并按当前权限重新检查。

`simulation/generation-input` 和 `simulation/generation-output` 是必读的助手事件。转录读取校验精确输入消息身份、scope/audience、模型/策略版本、原输出及可选 token 计数；额外字段、非法请求字节和 ignorable 标记均拒绝，缺少 usage 仍表示未知。

[English](README.md) | 中文

`readSimulationWorldManagementFields`、`previewSimulationWorldManagement` 和 `submitSimulationWorldManagement` 保留完整原调岗、离职或已有人员招聘表单。字段和预览不推理、不恢复可写 owner。提交要求固定 Native revision/hash 和唯一保留的 command ID；传输丢失后先查询原命令，再精确重试。用户案件明确标记 authenticated-user 来源，requester 为 null，不虚构 Operation。案件取消同样要求允许取消时返回的 revision/hash 和实际影响预览。

两种公开 API 的 `preflightSimulationWorld`、`createSimulationWorld`、`prepareSimulationWorld` 和 `exportSimulationWorldDefinition` 校验 Host 拥有的严格 World DTO。创建／准备保留精确的 command、定义和预览，不确定回复须通过原 request 查询对账。返回的创建／准备／导出身份必须匹配所选 command／run。创建、准备、读取和导出不启动模型，显式管理与冷恢复仍独立。未知必需 Session event 拒绝 typed transcript 重建；未知且带 `ignorable: true` 的 event 保留在原始通知中，并从 `RunResult.events` 省略，不强转为已知 event。

v1 `organization.hiringFees`只携带显式创作的一次性招聘费用：固定policy、招聘操作、岗位、不同的既有付款/收款账户、单位、正十进制数量、不同grant引用和正模拟预留周期。省略保持未声明，不补费用或付款默认值；空/错误字段和未知属性拒绝。资金、预留历史容量和模拟到期通过闭合的 `resource-capacity`、`resource-history-limit`、`resource-reservation-expired`停止分类观察，控制及运行状态DTO一致保留。账户解析、授权、扣费与恢复由Host/Native拥有；SDK没有新增付款写入API或私有compilerVersion DTO字段。

World 原生额度包含 `maxResourceReservationHistory`：已解析额度必须完整提供正安全整数，场景可请求有界的正整数覆盖。它限制全部保留的资源预留历史；取消或模拟到期不会退还历史额度。资源预留、提交与取消通过既有 operation 元数据和获准读取的原 journal 文本观察，SDK 不提供 Native 交易写入接口；缺失必填字段、未知结构字段和未经授权的正文仍拒绝。

两端客户端的 `listSimulationWorldCases`、`inspectSimulationWorldCase` 和 `cancelSimulationWorldCase` 保留原 World 案件选择。列表/详情校验 run、revision、filter 或 section；严格解析拒绝隐藏 Native 字段和 withheld 正文携带的文本。案件与 Persona 授权独立于 run 访问。取消使用保留的 command 与 request 身份；原请求查询/重试对账不确定回复，不替换意图或自动恢复调度。 摘要使用 `clocky.world-case/v4`，携带精确 domain/operation/version 和 `targetEntityId`。缺失版本标签、旧岗位别名及不符合领域的 Persona／预留数据均被拒绝。明确 null 申请通知与 Channel 发布保持区别。必填 lifecycle 分离请求、计划、回调/业务与通知；执行和通知详情必须与同一前缀的摘要一致。最终计划页核对当前计划，中间页不宣称完整；旧 v1 响应被拒绝。

`listSimulationRequests()` 在重新连接后发现有界原始 receipt 元数据；`retrySimulationRequest()` 只按运行和命令身份重试后端保留的原请求。两个公开接口核对返回运行、原命令、所请求 revision 和页大小，不自动遍历分页或重试，不接受替换命令 payload，并保留不可变终态 receipt。继续游标过期后须显式读取首页。

`Clocky` 与 `HarnessClient` 的 `preflightSimulation()` 校验允许的创建草稿，不分配命令或运行。它返回解析后的不可变额度或安全字段问题，不预留资源。两个 SDK 接口在使用前校验输入和结果；未知原生配置会被拒绝。`maxTime` 保持精确十进制字符串；创建时给同一草稿补上新保留的命令身份，create 会复核当前部署就绪状态。

失败的检查点／恢复 receipt 和检查点引用详情可包含 typed `diagnostic`，携带阶段、固定公开 code、规范对象及独立的未确认清理标记。这些字段在原结果查询中保留来源身份；原始 provider 文本、文件系统路径及任意 cause 字段会被拒绝。

`retrySimulationOperation()` 为精确未知操作及观察到的尝试次数授予一次原有有界 outbox 重试额度。调用者保留原命令及原因；`getSimulationRequest()` 返回规范化的 `retryOperation` 原意图及不可变 receipt。client 核对运行／命令／kind，拒绝格式错误的原输入，不悄悄修改目标或次数。授权与查询不发布也不启动模型；显式调度执行目标对账。`not-found` 仍表示不确定。

`getSimulationRunStatuses({ runIds })` 读取一次精确、有界的已授权批次。原生指标报告模拟区间费用、保留驻留槽和待处理工作；共享模型池 permit 使用真实时间，与配置预算上限分开。当前行政元数据只含可信场景版本及 owner／driver／停止／重试事实。client 按请求顺序核对每个返回 ID，观察不打开或恢复运行。

`listSimulationTaskReviews()` 与 `resolveSimulationTaskReview()` 提供有界规范元数据和原场景审核命令。审核权限来自受信任模板及已认证运行所有者。client 核对运行／revision／页或原命令／kind；响应丢失后，`getSimulationRequest()` 保留精确原审核输入。参见[行政审核](../../simulation/simulation-product/README.zh.md)。

`inspectSimulationSource()` 沿冻结决策的来源序号读取。searching 结果用 cursor 继续定位，found 结果用 cursor 和精确 `envelope.sequence` 继续正文。响应核对 run、decision、source、revision 与请求页大小；正文同时需要仿真来源 grant 和当前 Team 读取资格。

`readSimulationRecords()` 通过 `simulation/records-list` 按精确 run、kind／sequence 和 metadata／original 模式读取，校验回显筛选、revision 与分页大小。原始 JSON 文本需要独立的整运行历史正文授权，记录数与文本分片数不同。重建记录或导出固定观察时，消费者保留原游标与策略版本。

知识分区保留精确决策引用和当前受众检查，可选 `reference` 在请求、选择与结果之间核对。报告来源正文需要明确 Host 知识／来源 grant。

`watchSimulation()` 以明确旧游标或零等待探测进行一次有界失效等待；不返回正文，也不启动执行。reset 使旧策略／正文响应失效。client 不自动启动周期观察。

`Clocky` 和 `HarnessClient` 提供产品元数据、原创建／准备请求，以及 `getSimulationControl()`、`manageSimulation()`、`getSimulationManagement()`、`checkpointSimulation()`、`restoreSimulation()`、`ingressSimulation()` 和 `getSimulationIngress()`。调用者在结果不确定时保留原命令、管理或输入 ID 与 payload；`not-found` 既不证明失败，也不创建另一个身份。创建准备 paused 运行，不推理。旧调度重试返回原意图，不撤销后来暂停；完整检查点／恢复保留暂停 owner，恢复验证当前后缀，不回滚也不推理。输入分配与消费是独立事实。client 校验公开 DTO 及精确选择／revision、命令类型、恢复目标、调度 phase 和输入目标／时间。这些方法要求[产品组装](../../simulation/simulation-product/README.zh.md)，不会自动重试命令或遍历分页。`inspectSimulationObject()` 支持独立分页的实体关系与冻结决策上下文。正文权限来自 Host，来源引用不授予 Team／Session 访问，该上下文视图不是完整模型请求。

调用 `updateTeamTask()` 或 `HarnessTeam.updateTask()` 时保留 `commandId` 与原字段。已受理重试返回原 receipt 和当前任务；拒绝重试在条件改变后仍保留原失败。`getTeamTaskUpdateResult()` 与 `HarnessTeam.updateResult()` 只读取受理、终态拒绝或当前未找到。client 对每种结果核对精确 Team／task／command 身份。`not-found` 仍将原操作保留为未确定。

以子进程方式驱动 Clocky 运行时、走 stdio JSON-RPC 的 TypeScript 客户端 SDK——[Python SDK](../../../python/README.zh.md)（`clocky`）的设计孪生，共享同一个运行时对端、协议与分层：`Clocky` 是高层自有运行 API，`HarnessClient` 是低层协议客户端。包（package）根枚举消费方接口：两层客户端、面向调用方的类型和 `JsonRpcResponseError`；源模块、规范化辅助函数与订阅投递机制不供消费方导入。纯库：不在任何 Cordis 上下文注册；它所 spawn 的运行时进程是一个完整 harness，其组成由自己的 `cordis.yml` 决定。

`listTeams()` 读取一页已授权安全目录，不含扫描计数或 grant 正文。加密 `nextCursor` 仅保留在当前主体代际内；过期续页要求明确读取首页。`getTeamSelection()` 报告成员或父团队只读状态；读取不启动或恢复 Team。

与 Python SDK 不同，启动规格完全显式（`command`/`args`）：本包面向仓库近旁的 TypeScript 消费方，包括 [`clocky-subagent-clocky-sdk`](../../compat/subagent-clocky-sdk/README.zh.md) 后端和自动化；它们知道自己要启动哪个运行时。捆绑运行时解析（寻找打包可执行文件）仍归 Python 发行版负责。


`Clocky` 与 `HarnessClient` 提供 `inboxRead({ afterCursor?, limit? })`、`inboxWatch(...)` 和 `inboxAcknowledge({ throughCursor })`。这些方法选择初始化时已认证 principal 的持久 final inbox，不接受 caller identity。读取省略 cursor 时从共享 display position 继续；display acknowledgement 永不创建 channel receipt。[Inbox Consumer](../../team/team-human-client/README.zh.md) 拥有持久化、权限、限制与当前缺口。

Team-list continuation 是 opaque string，`-1` 表示新扫描。`scanned` 表示 discovery 工作量；即使 `items` 为空，也应根据 `nextCursor` 继续。遇到 `TEAM_DISCOVERY_CURSOR_EXPIRED` 时开启新扫描。Member、task 和 channel cursor 仍为数值。


`listSimulationTasks()` 读取有界的规范运行任务控制。`cancelSimulationTask()` 固定来源操作、任务 revision、命令 ID 与精确 attempt ID；显式 `null` 要求当前没有活动 attempt lease。客户端拒绝其他运行、命令或回执类型。`getSimulationRequest()` 仅为 `cancel-task` 返回原始 `cancellation`；查询与精确重试不分配新命令。这些方法不授予通用 Team 写权限，也不启动推理。

Simulation 目录／预检结果要求带判别值的 `readiness`；`ready.model` 是创建时应传给 `expectedModel` 的精确路由。预检不携带该确认字段或命令 ID。缺失／未知就绪字段或路由在使用前被拒绝；模型变化拒绝要求重新确认，未知响应保留原命令身份。

`readSimulationWorldDomain`（Python 为 `read_simulation_world_domain`）共用 `simulation/world-domain-read`。严格的 `clocky.world-read/v1` 结果绑定完整原选择及独立有界覆盖范围，拒绝未知字段或替换身份、版本、分区、覆盖信息。续页使用返回的 cursor 及原 revision／readVersion。未知驻留和可空义务计数保持未知；模拟时间及制度／提案版本保持规范十进制字符串。读取不恢复、不 attach、不推理，正文授权不代表 Session 权限。

`readSimulationDraft` 与 `saveSimulationDraft` 访问私有不可变创作文档。保存使用原保存 ID 与父版本 CAS；冲突返回双方定义，精确重试返回原保存版本。两个 API 均拒绝属于其他草稿、版本或保存意图的响应，不创建运行中的世界或调用模型。

## Clocky

```ts
import { Clocky } from '@clocky/clocky-sdk-client'

await using harness = new Clocky({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  credential: 'product-credential',
  provider: 'test-provider',
  model: 'test-model',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

子进程在首次使用时惰性启动，并在多次 `run()` 之间持续归实例所有；必须 `close()`（或 `await using`），子进程才总能被回收。`credential` 是只在 `initialize` 期间发送的不透明产品凭据；客户端会从子进程环境移除它，拒绝它出现在启动 command/arguments 中，并在客户端错误中脱敏。`start()` 记忆化 `initialize` 握手（工作区 cwd——在通过协议传输之前解析为绝对路径——加 provider/model 路由和可选的正整数 `maxTokens` 输出上限）；握手失败会回收运行时并换入全新客户端，后续调用用新子进程重试（直到终结性的 `close()`）。该上限作用于每个 Team coordinator 请求；压缩（compaction）插件单独持有摘要上限。`createTeam(input, { objective? })`返回带 Hub 铸造的 `id`、coordinator transcript id、`waitForFinal()` 与 `cancel()` 的 `HarnessTeam`。这些方法只在 spawn 的 runtime 仍持有该 TeamRun 时可用。任一终态操作结算后，`HarnessTeam.archive()`会将观察到的 cursor 绑定到 authenticated human 的`close`authority；同一 authenticated owner 可通过`HarnessClient.archiveTeam()`归档 terminal、detached 或 restarted Team。`HarnessTeam.resume()`以及通用 member/channel/goal/task mutation helper 都使用连接的 authenticated human proof，wire 上不携带 actor 或 proof。

`run(input, { objective?, onNotification? })`创建一个 Team、接纳初始 human Envelope，并等待其显式 final result。它返回 `RunResult { teamId, finalResponse, final, events, notifications }`；`final`包含 final channel 与 Envelope id，`finalResponse`就是该面向 human 的 final text。`events`与`notifications`都只包含 coordinator Session，且按协议传输顺序排列。即使结果与通知在同一传输批次到达，也会收集最终响应之前已排队的通知。提示词文本默认作为 objective；无文本 content 必须提供 `objective`。`resumeTeam(teamId)`会先读取新鲜 Team cursor，再提交经认证且不含 actor 的 resume request；持久 Team id 不是认证。传输丢失、超时、过期 fence 与协议违例也会导致 Promise 被拒绝。

`inspectTeamTask({ teamId, taskId, section: "record" })`读取当前字段及历史计数。选择`"attempts"`或`"reviews"`，传入`afterCursor`、`limit`，并将返回的版本用作`expectedRevision`，即可读取有界历史窗口。响应必须匹配所请求的 Team、任务、分区、版本及窗口；任务变化后需要刷新当前记录。此读取省略私有产物引用，不激活 Agent。

## HarnessClient

`listTeams()`、`listTeamMembers()`、`listTeamTasks()`和 `HarnessTeam.channel()`暴露有界 page field `afterCursor` 与 `limit`；每个 result 都可以带 `nextCursor`。High-level call 会保留 page boundary，因此 caller 可以在不要求 subprocess 返回无界 response 的情况下继续读取大型 Team 或 channel。

可用的 Team inspection 操作包括 list/get、member/channel/task read/watch、quiescence、audit，以及通过 `teamMetrics()` 与 `HarnessTeam.metrics()` 获得的进程内 metrics。只要挂载的 Team provider 支持这些可选 record，Team state read 还会包含持久 pending／settled human action 以及 provider 报告的 token／turn／cost usage。

`HarnessClient.readTeamArtifact()` 和 `HarnessTeam.readArtifact()` 按 durable id 读取一个可见的 provider-backed artifact，并返回准确的 reference、byte count 和 base64 data。Private、ambiguous、没有 provider、缺失和超限 artifact 在该 SDK surface 上仍不可用。

自有运行 API 之下的协议客户端：显式 `start()`/`initialize()`/`createTeam()`/`resumeTeam()`/`waitForTeamFinal()`/`cancelTeam()`/`archiveTeam()`/`request()`/`close()`，外加通知订阅。`createTeam()`在持久 Team 和首个 Envelope 接纳后返回；`waitForTeamFinal()` 与 `cancelTeam()`只作用于当前本地 Team。初始化后，如果运行时组合了`teamHumanActors`，member mutation、channel open/post/close、goal update/transition、task create/update/cancel/delete/review、terminal archive 与 resume 都会使用连接的 authenticated human proof；每个 proof 绑定完整 payload 与观察到的 cursor 或 revision，archive 与 resume 会直接到达 Hub，用于 detached 或 restarted Team。缺少 binder 时以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`拒绝。Team id、cursor、revision 与 participant id 都不能证明 authority。`subscribe(filter?)` 返回 `NotificationSubscription`（可等待的 `next()`、非阻塞 `tryNext()`、异步迭代）。本包导出有明确类型的错误：`JsonRpcResponseError`（协议错误响应，保留 code/data）、`RequestTimeoutError`（配置的时限已到）、`SdkProtocolError`（响应超出文档化协议）、`TransportClosedError`（运行时已消失——消息携带退出码与有界 stderr 尾部）。

`HarnessClient.openActivation({ target, seed })`、`enrollActivationLink({ target, binding, enrollment })`、`getActivationStatus({ target })`、`interruptActivation({ target, cause })` 和 `disposeActivation({ target })` 是底层 remote placement lifecycle。每个 `target` 都携带 `activationId`、`teamId`、`participantId` 与 `sessionId`；每个返回 state 会重复这些 provenance、加入驻留状态和 `statusSequence`。`enrollActivationLink()` 供受信任 placement owner 在持久 binding 提交后使用：它把匹配的带 provider binding 与短期不透明 credential 下发给 child，以启动固定 delivery，不是产品 Team API。在 open 前订阅，把 `activation.status` 通知交给 `parseActivationStatusNotification()`，再按同一 target 和 sequence 用查询校准。helpers 会验证出站帧和每个具名响应；畸形帧以 `SdkProtocolError` 拒绝。`disposeActivation()` 只释放该 remote Agent，运行时进程仍可承载另一 activation 或 Team。

`close()` 先请求协议 `shutdown`（受 `shutdownTimeoutMs` 约束，默认 1000 毫秒），然后走 stdin-EOF → SIGTERM → SIGKILL 阶梯（`disposeEofGraceMs` 默认 6000，`disposeGraceMs` 默认 3000）直到进程真正退出。该阶梯为本客户端私有：它运行在任何 harness 上下文之外，无法搭乘 [`clocky-subprocess`](../../subprocess/README.zh.md) 服务——即该 seam 所记录的 SDK 托管传输例外。`detached` 是陈旧进程 fencer 的 opt-in hosting 控制；普通调用方不设置它，启用它的客户端会回收整个隔离 POSIX 进程组。该操作幂等，已关闭的客户端拒绝复用。

`HarnessClientOptions.env` 给定时整体替换子进程环境（`undefined` 原样继承父进程环境）；凭据策略归调用方——`clocky-subprocess` 的 `scrubbedParentEnv` 是面向隔离启动的共享擦除基底。

## 私密备份导出

`backupExport({ runId, commandId })` 通过 `simulation/backup-export` 读取已完成的原始私密包。客户端拒绝变化的 run/command 身份及精确 UTF-8 包字节的 SHA-256 不匹配。导出需要独立原始记录披露授权，不启动或恢复运行。 完整分支导出还要求祖先的当前披露授权，或针对该分支的显式 `includeProvenance: true` 授权；只有分支自身权限不能读取祖先字节。

## 模型体验

无，因为这是一个客户端进程库；模型运行在 spawn 出的运行时中，其体验由该运行时的 `cordis.yml` 所组合的插件决定。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无捆绑运行时解析**——调用方显式指定运行时可执行文件；打包可执行文件的发现留在 Python 侧，直到出现 TypeScript 发行版消费方。
- **没有 detached current-run control**——`waitForTeamFinal()`与`cancelTeam()`仍要求 SDK server 保留 TeamRun。resume 与 terminal archive 通过 authenticated human proof 到达 Hub；连接绑定记录在[authenticated product-principal Team control note](../../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)中。
- **没有自动 integration**——workspace provider 拥有显式 publish/integrate authority，绝不会自动 merge 用户更改。
- **没有 AgentRuntime provider 或 Team binding**——这些 helpers 只暴露 lifecycle wire。placement provider 负责进程丢失、status-sequence 校准和持久 Team bind-or-dispose handoff。
- **没有 fork activation seed**——remote activation 接受 fresh 或持久 resume，不传输 Session event history。
- **客户端→服务端通知与服务端→客户端请求**在协议两端都未实现；传输层为未来审批流保留了承载能力。

### 单任务取消

`cancelTeamTask()`和`HarnessTeam.cancelTask()`接收可选原因，返回 durable cancellation 进度。Assigned 或 running 结果仍保留 live work；应观察任务状态直到 cancelled。该操作让 Team 继续处理其他任务。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).

`previewSimulationWorldCalendar` 为暂停运行的排班修改生成 quote。`submitSimulationWorldCalendar` 先持久保留不变 quote；`readSimulationWorldCalendarCommand` 在响应丢失或客户端重启后找回作者限定原件，`cancelSimulationWorldCalendar` 仅撤销尚未执行命令。civil 排班固定时区数据库版本和 DST 选择，由 Host 转换。`readSimulationWorldDomain` 使用 `kind: "proposal", section: "impact"` 只预览政策语义、不发布；独立案件/操作权限可使完整报告 withheld。提案视图包含原审批路线契约、冻结投票人、期限和实际 Resolution。

`branchWorld`、`readWorldBranch`、`queryWorldCausal` 和 `compareWorlds` 保留原实验命令和归档观察。Client 拒绝替换分支 UUID、来源或记忆策略；因果读取校验回显来源和完整字节/节点预算，比较校验两侧观察。未知结果后保留原 UUID。返回分支保持 paused 并关闭真实效果，调度需单独授权；这些 API 不合并历史或自动遍历因果分页。
