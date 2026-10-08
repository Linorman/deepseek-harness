# Simulation 产品访问

[English](README.md) | 中文

`inspectSource()`／`simulation.sources.inspect` 通过决策保留的 `sourceIndex` 选择 `team-envelope`，不接受调用方提供的 Team／频道身份；公开冻结上下文条目提供该序号。读取同时需要明确的实体 `sources` grant 与当前 Team 人工读取资格。引用、运行所有权和整运行日志 grant 都不授予 Team 来源访问。频道 IO 前后均检查 Team 权限，失败路径也复查。私有／缺失 Team 访问统一为 `withheld`；provider 缺失或历史不可读返回 `unavailable`，不返回私有诊断。

首次请求最多扫描一页已授权频道记录，`searching` 提供加密定位续页，不返回无关记录或扫描计数。找到后，`envelope.sequence` 支持单行精确读取；错误位置不会改选其他来源。`found` 的 `nextCursor` 必须与该精确 `envelopeSequence` 一起继续正文。续页绑定 run／decision／source、位置、页大小、冻结决策 revision、凭据和读取策略生命周期；后续世界推进不重置不可变来源页，明确传入的 `expectedRevision` 仍核对当前世界观察。纯 `content` 文本按 `maxContextPartBytes` 惰性拆片，未知块／payload 仅返回 `unsupported`，不暴露 provider 数据；完整包装受 `maxBytes` 限制。原生与 Team provider 的额度独立执行。读取不发布、确认送达、激活执行，也不声称接收方已消费。

`readRecords()`／`simulation.records.list` 按原生日志序号读取记录，接受不含 actor 的 metadata／original 模式、精确 sequence／kind、revision 和 cursor。`totalRecords` 统计筛选后的记录数；原文按 `maxContextPartBytes` 拆成有序、保持 Unicode 完整的 JSON 文本分片。完整响应含策略版本和加密续页，受 `maxBytes` 限制；单个分片也无法容纳时拒绝。分片惰性生成，小分片额度不会为整个日志创建分片数组。此 API 提供可导出数据，尚不是文件下载端点。

普通登记所有权和实体 `contextReaders` 均不授权原始日志正文。独立、受信任的 `recordReaders` 指定认证主体和可选的自有 run，授予**整个运行的历史正文**，包括旧私有输入、上下文和部署 reservation。该管理权限不继承实体受众限制，不能代替实体范围的知识读取授权。`context-readers` 接受独立 `recordReaders` 列表作为可卸载部署策略。撤销改变 `readVersion`、唤醒 watch，并拒绝在途旧响应和旧游标。即使有此授权，metadata 模式仍删节原始 JSON。原文仅作为检查或导出的文本，不作为可执行标记；原生私有值不是公开的结构化 DTO 字段。

此显式启用插件提供 `ctx.simulationProducts`，负责部署登记的 Simulation 历史持久目录和已认证公开读取投影。它依赖 Storage Log 与 Simulation 注册表，不进入内置 profile；[Loader 组装](../../../examples/headless-agent/tests/fixtures/simulation/simulation-product/cordis.yml) 是可执行的接线示例。

## 登记与授权

部署 `imports` 将不透明产品 ID 和显示名称关联到一个不可变 provider/run spec 及拥有该记录的产品主体。浏览器请求只接受产品 ID 和查询参数。目录流格式 1 保留登记与时间戳；重启重放完整前缀，拒绝损坏、重复和配置变化，精确登记则复用。从配置移除 import 不会删除或转移保留的登记。目录中每个 provider/run 对只有一个产品身份。

`directoryStream` 必填，使用其 Storage Log 后端路由。`maxRuns` 限制保留的登记数量，`recoveryPageSize` 限制重放分页。`maxDirectoryEntryBytes` 在导入与重放时检查每个完整 UTF-8 JSON 登记，独立于公开响应限额。服务进入 active 前必须完成初始化；卸载关闭读取准入，排空已准入工作，再关闭其流。

每次调用必须提供传输认证的 `AuthenticatedProductCall`。只有登记所属主体可以列出或检查该记录。缺失与私有产品 ID 使用同一拒绝。取消或凭据退役会在 provider IO 前及其成功或失败后拒绝读取。调用方必须通过主体 lease 取得每次调用上下文；不透明产品 ID 不授予权限。

## 公开读取

`retryOperation()` 仅接受自有原创建、由行政服务持有的 owner，以及精确 unknown、已到期的外部意图。持久命令保留 `runId`、无首尾空白的 `commandId`、`operationId`、正数 `expectedAttemptCount` 与规范化非空 reason。Native 获得派生的稳定 grant id 及原产品 `acceptedAt`；响应丢失后复用同一载荷，不追加另一份额度。`request()` 在 `retry-operation` receipt 旁暴露原 `retryOperation` 输入。冷受理请求在显式恢复 owner 和以当前认证重试同一命令前保持惰性。grant 与查询不发布或推理，stalled／paused run 随后需要显式 start。操作执行详情提供当前 retry reason、count fence 与不变上限；由 effect 所有的元数据读取贡献 owner／容量准入，并在卸载时退役。这些读取提示不授予后续修改权限。参见[重试权限决策](../../../.agents/notes/implemented/architecture/2026-10-01-simulation-original-outbox-retry.zh.md)。

`list()` 只读取目录元数据，不检查 provider journal。搜索覆盖登记名称；ID 按字符串序位排序。分页使用加密游标绑定搜索、limit、目录 revision、主体 issuer/subject/ID、凭据代际和服务生命周期。替换或篡改游标时拒绝并提示从首页重新开始。公开摘要不包含 provider 路径、私有 spec、主体关联或物理扫描计数。名称受 `maxTextBytes` 限制并明确标记截断。

`inspect()` 解析登记的 provider/spec，再调用原生只读检查。历史缺失与身份不可访问、历史不可用或损坏分别表示；不支持检查时目录仍可发现。世界输出包括精确十进制时间、有界 tick／规则／策略标签、所有权、数量和观察时间。`world.metrics` 从同一 Native 预算函数派生当前追加后的区间上限与实际准入量，包括已计费预留和 unknown token attempt。槽位在 release 前保留 reserved／active／revoked writer；恢复数量区分未确认责任。待决数量包括 open／submitted decision 与 queued／reserved nomination；外部数量包括未结算通信／任务创建意图及明确 unknown outcome。scheduler stop 仅暴露固定 code 与 recovery action。省略私有 profile、上下文、指令、路径及原始配置。旧 peer 可缺少新增字段；缺失或不安全的数值计费表示不可用，不推测为零。所有权不授予接管权限，持久 running phase 也不表示调度正在执行。

`runStatuses({ runIds })` 按请求顺序观察一个有限目录窗口。ID 必须为不同的自有登记，数量不超过 `maxPageSize`；`maxBytes` 限制完整请求与响应。独立的 provider 或计费失败产生安全的逐 run `unavailable` 摘要，历史缺失仍为 `missing`。每项在 IO 前后鉴权；凭据退役会拒绝整批结果。即使其他项失败，卸载仍排空全部已准入 provider 读取。此方法不打开、恢复或驱动 run。仅 Native 结果明确将行政调度与共享模型池观察标为不可用；已安装的行政所有者可从当前自有元数据补充这些观察，不逐行调用 control。参见[状态观察决策](../../../.agents/notes/implemented/architecture/2026-10-01-simulation-runtime-status-observations.zh.md)。

`maxPendingReads` 限制所有已准入读取，包括等待初始化的调用。读取独立推进，慢历史观察不阻塞目录发现。`maxPageSize` 限制公开行数；`maxBytes` 检查完整公开 JSON 请求与结果，包括游标和包装。单行无法容纳时拒绝。原生 provider 检查保留独立的历史限额与校验。[配置默认值](../../../docs/config-catalog.zh.md) 从 schema 生成。

`browse()` 通过 `simulation.collections.list` 提供实体、决策、操作和检查点。筛选按集合限定；决策 slot 按精确十进制排序，操作按所属决策 slot 和局部 index 排序，检查点按保留请求的 sequence 排序。每页携带同一个 `snapshotRevision` 与完整筛选总量。续页绑定登记的 run、集合、筛选、limit、revision 和当前凭据；变化时通过 `simulation-product-stale` 要求明确刷新首页。原生历史缺失表示不可用；已观察的成功空集合总量为零。

`inspectObject()` 通过 `simulation.objects.inspect` 提供精确元数据：实体身份／绑定或关系、决策执行／计量或冻结上下文、操作执行或技术尝试，以及检查点引用。可选 `expectedRevision` 限定读取观察，不提供写入 CAS。关系、上下文片段／引用、attempt 和检查点引用独立分页，完整外层 section 包装共享 `maxBytes`。未知和其他 run 的对象 ID 使用同一缺失状态。来源引用不授予 Team/Session 正文权限。只选择公开实体名称标签；任意 profile 正文、完整模型请求、当前知识、attempt 诊断、存储流及 fingerprint 均保持删节。上下文分区采用下述独立正文公开规则。

决策提交/接受与效果已执行分别表示。操作输出区分发布、Session 输入持久化、接收方 receipt、任务创建和保留的送达失败处理状态。它们均不声称接收方业务处理或任务完成。检查点完成表示保留的 manifest；`sourceValidation: 'not-performed'` 明确不声称当前跨所有者来源已验证。决策真实推理时间与模拟时间分别保留。上下文计量是带 `content: 'withheld'` 的元数据，不是完整模型请求。

fetch carrier 提供 `client.simulations.list/inspect/browse/inspectObject`。浏览器 DTO 与解析器使用 `./types` 和 `./schema`，不包含 Host Cordis 声明。私有登记类型保留在根 Host 入口。Host dispatch 为每次调用解析当前认证，分别映射 forbidden、invalid、unavailable 和 stale 失败；未知失败不包含内部诊断。未部署目录时返回不可用。响应解析拒绝被替换的 run、集合、对象、section 或选中 revision。

<a id="relationships-and-frozen-context"></a>

## 关系与冻结上下文

实体的 `relationships` 分区按稳定 ID 顺序返回入向、出向及范围关系。保留原始左闭右开有效区间，并以精确十进制比较观察模拟时间内的有效性。读取不改变拓扑，端点跳转也不授予权限。

决策的 `context` 分区读取精确保留的上下文视图、原投影／版本／时钟元数据、知识版本引用及 Run／Team Envelope 来源。它不检索当前知识，也不声称展示完整模型请求。普通 run 所有权只允许元数据。受信任 `contextReaders` 条目独立选择 `principalId`、`entityIds` 及可选产品 `runId`；省略运行选择时仍只覆盖该主体自己的登记。不接受浏览器自报 grant 或正文开关。配置在 IO 前校验并复制。凭据退役拒绝待完成读取；服务卸载将仍可按元数据结算的已受理上下文正文删节。策略退役不冒充主体替换，也不丢弃无关原命令。

获准的已记录纯文本按 `maxContextPartBytes`（默认 16384，最少 4 个 UTF-8 字节）拆分为有序内容块片段。不切断 Unicode 标量；精确片段可重组，不采用标签截断。删节及不支持的内容块不包含原 payload。完整分区包装仍遵循 `maxBytes`，单行超额明确拒绝。上下文续页除对象／revision／凭据／服务身份外还绑定正文权限和片段额度。首页刷新清除观察约束。历史上下文权限不授予当前知识检索或来源 Team／Session 正文权限。

## 当前与已选知识

实体的 `knowledge` 分区选择当前时间可见记录。决策分区使用其已准备上下文原始记录的精确版本，可通过 `reference` 选择单项而不遍历分页。不相关引用与未知数据使用同一缺失状态，不替换成更新版本。两条路径共享 Simulation 定义包中的原生 `knowledgeVisible/selectKnowledge` 投影；历史检索仍检查当前受众、最新版本撤销、时间边界及每个推导前提。

reader 可选 `content` 明确选择 `context`、`knowledge` 和 `sources`；省略时保持仅上下文权限。知识正文需要明确 `knowledge` 权限。报告来源原文另需 `sources`，并核对精确保留通信／持久送达关系；只公开该原始文本，不公开频道历史、私有诊断或任意来源数据。来源将观察、已送达报告、信念、推导和摘要与权威世界事实分开。片段与完整包装继续有界，续页绑定策略、冻结引用及世界 revision。受众可独立于部署策略变化，因此更新的世界观察释放知识缓存。

## 有界失效等待

`watch()` 和 `simulation.changes.watch` 只返回当前读取策略身份、世界 revision 或明确缺失／不可用状态，以及凭据绑定续页。`waitMs: 0` 立即观察；其他等待受 Host 的 `maxWatchWaitMs`（默认 20000 真实毫秒）上限约束。`watchPollMs`（默认 2000）限制原生观察频率，`maxWatchers`（默认 32）独立限制已准入等待。休眠等待不占普通读取准入，原生探测占用；已准入原生 IO 可能超过等待区间。凭据退役拒绝请求，服务卸载取消并排空，两者均不打开执行。其他主体或过期续页返回 reset 和新游标，不公布旧策略数据。

显式启用的 `./context-readers` 插件通过进程内能力独立登记受信任 `readers`；发现能力本身不授予权限，且不能经 JSON 传递。贡献只在挂载期间补充基础 `contextReaders`。重载／移除改变策略版本、唤醒等待观察者，并约束上下文续页与待完成正文，不替换目录、执行 owner 或浏览器模块。调用方输入先复制再严格校验。浏览器 runtime 在 reset 时释放旧正文、忽略旧标签响应并自动复查选中上下文；无关草稿和结果不确定的原命令保留。普通网络失败保留标记的可读数据，确认策略不可用则清除私有正文。

## 持久公司创建

显式 `./administration` 插件提供 `ctx.simulationAdministration` 及 Host fetch `catalog/preflight/create/prepare/request`，依赖读取目录、原生 Simulation／Team owner、LLM 注册表及 Agent Presets。可信 `templates` 包含 version 1 公司采购设置、完整原生 policy、preset、driver 路由／时间偏移及检查点边界。加载检查原生查看、预设及模板结构，不要求模型提供方已注册。安装配置的 `driver.model` 为显式 `{ provider, name }` 路由或 `{ source: 'agent-default' }`；后者在预检与受理时读取 `agentDefaultModel.currentSelection()`，将其 `model` ID 映射为 driver 的 `name`。目录与预检的严格 `readiness` 区分附带路由的 `ready`、`needs-model` 和附安全原因的 `unavailable`。元数据解析不推理或自动测试连接。公司激活暂不支持显式推理强度覆盖，返回 `reasoning-unsupported`；支持提供方默认行为。浏览器请求包含命令身份、安装模板／版本、名称、规范正库存与可编辑额度；任意 spec、路径、代码与凭据被拒绝。

受信任 `editableLimits` 列出允许降低的 `maxEntities`、`maxResidentActors`、`tokensPerModelRequest`、`maxTokensPerInterval` 和规范十进制 `maxTime`；省略时全部额度固定。已安装 spec 值兼作默认值和上限。目录公开这些额度、允许列表、tick／预算单位、policy 版本及当前共享模型容量。`preflight()` 接受不含 `commandId` 或 `expectedModel` 的创建语义，返回完整解析配置或带机器可读字段／code 的有界问题。它校验场景容量、模型采购的单请求 token 准入、完成时间边界、库存、provider、preset 及当前产品容量，不写日志，不分配身份、Team、actor，不推理或预占 permit。仅含确定性步骤的 task workflow 允许区间 token 预算为零，不发起模型请求。创建在持久受理时重新检查同一额度规则；预检通过不预留容量。额度不能改变时钟定义、route 或 Host 共享 permit。原公开选择和完整原生 spec 一同持久保存，后来修改模板不会改变重试或恢复。

创建要求 `expectedModel` 与已展示路由一致，并在串行受理位置复核路由、授权及容量。不一致返回 `SIMULATION_PRODUCT_MODEL_CHANGED`（RPC 为 `simulation-product-model-changed`），确认本次尝试未分配运行，调用方必须重新查看并确认。网络未知结果保留原身份。已受理的精确重试先对照冻结 driver 中的确认路由，再考虑当前默认、模板及模型可用性。

必填 `journalStream` 使用独立的 format 2 命令日志。持久结构不变：语义输入省去冗余确认字段，其精确路由由冻结 driver 重建。部署选择器不进入 driver 或原生 spec，不转换格式或自动重写日志。受理在目录登记或原生 IO 前持久记录原主体、分配的产品／原生身份及完整不可变模板解析结果。精确重试必须匹配原 owner 和 payload，返回原请求的保留状态。HTTP 等待丢失或退役不取消已受理准备。`request()` 只读取原日志结果；`not-found` 不能证明失败。后续尝试不替换原失败结果。新的 `prepare()` 命令对账原运行，使用自己的检查点身份。

`listRequests()` / `simulation.requests.list` 在当前已认证 owner 下发现某个运行仅含 receipt 的行政历史。`maxRequestPageSize` 默认 32；`maxBytes` 约束完整请求和页面。条目按原受理时间和命令身份排序。`snapshotRevision` 统计该运行的受理与终态日志条目，独立于原生世界 revision 和其他运行。加密 continuation 绑定运行、页额度、日志 revision、主体代际与服务生命周期；观察变化后须刷新首页。不公开原参数、输入正文或审核理由，也不创建原生 writer 或模型工作。

`retryRequest()` / `simulation.requests.retry` 只接收所选运行和原命令 ID。未知、其他主体或跨运行选择统一拒绝，不能分配任何对象。终态 receipt 原样返回。已受理原命令使用保留的精确输入调用既有 create、prepare、checkpoint、restore、review 或 operation-retry 方法，保留各方法的所有权、准入、串行化和等待者规则。冷启动下已受理的 review 或 operation-retry 必须先明确恢复运行 owner，再重试原请求。重新认证后以新凭据发现持久事实，不保留旧凭据或恢复旧的私有浏览器草稿。

每个已分配运行最多持有一个独占原生句柄。准备补齐缺失拓扑并发布初始完整检查点，保持 paused，不驻留 actor 或临时 Team connection。已持有的运行可以采集另一次明确准备检查点。外部所有权返回 `recovery-required`，不接管；部分准备失败在确认关闭后返回 `preparation-required`。终态追加失败保留 `accepted`；明确精确重试可对账原分配。启动只重放命令并登记发现，不打开原生运行或恢复模型。

`maxCommands` 和 `maxEntryBytes` 分别约束受理／恢复中的保留意图数量和完整日志条目，历史必须保留连续前缀。`maxPendingPreparations` 约束持久待处理尝试；`maxHeldRuns` 在分配前计算不同的待处理／持有运行。`maxPendingRequests`、`maxBytes` 和 `maxTextBytes` 独立约束传输等待、完整公开输入／结果和目录标签。容量满时拒绝新写入，精确重试和结果读取仍可使用。卸载关闭准入，排空等待／准备后才关闭原生句柄及日志。未确认原生退役时保留命令 stream，并通过 Cordis teardown 报告失败。[创建决策](../../../.agents/notes/implemented/architecture/2026-09-29-persistent-company-creation.zh.md)定义这些持久语义；[Loader 配置](../../../examples/simulation-company/tests/fixtures/product-administration/cordis.yml)验证显式插件接入。


已认证 SDK server 通过当前连接 lease 转发相同的目录和行政操作。TypeScript 与 Python client 复用公开 DTO，核对精确选择并保留原命令身份；认证过期／替换后不能发布旧响应。SDK 检查不执行原生 open、restore 或 drive。SDK 创建／准备不推理，已完成重试只返回保留 receipt。[SDK client](../../sdk/client/README.zh.md)定义方法名及调用者重试责任。

Host 和 SDK 分发通过纯 `./errors` 入口的 `isSimulationProductError()` 识别产品拒绝。公开 code 在独立打包的构造器之间标识拒绝；未知失败仍使用通用诊断。

<a id="product-scheduling-ownership"></a>

## 产品调度所有权

控制观察包含删节的不可变模型／预算摘要：provider／model、每次请求预留 token、区间 token 额度、精确十进制区间、驻留上限及当前配置的主机共享模型并发上限。这些字段不授予配置权限。调用者在明确开始前确认摘要，原生准入仍重新检查 live owner 与预算。

`ctx.simulationAdministration.control/manage/managementRequest` 与 Host fetch `control/manage/managementRequest` 观察并控制原产品创建。`manage()` 接受不透明 `managementId` 和 `paused` 或 `running`，沿用原生有序语义，不提供仅代理层实现的 revision CAS。原生 run 日志保留原请求及终态结果；已完成重试返回历史结果，并附独立的当前控制观察。同 ID 改变 phase 会拒绝。重启后的只读查询不打开或继续运行；新的冷调度请求必须先明确恢复。

每个成功准备的运行具有一个产品 owner。构造及读取不分配 connection 或模型工作。已授权开始检查当前模型与实际 in-process runtime 登记、准备进度和完整检查点依据，挂接一个规范 Team connection，并调度有界公司 driver 批次。暂停阻止后续 timer 准入；已受理推理或清理可能仍在进行，响应独立报告这些工作。初始准备失败后，新的成功准备检查点可作为启动依据，不改写原失败。准备和管理共用 owner 队列；准备不能替换已挂接的 scheduler。

`driverIntervalMs` 控制有效推进批次间的真实时间；`driverRetryMs` 约束临时容量与传输重试观察。原生重试时间戳保持有效，原生 driver 逐次复查。完成、未知、恢复、stalled 和场景阻塞结果等待明确处理，不自动重复推理。`maxManagementRequestsPerRun` 限制保留的原生调度身份；容量满时原重试及读取仍可使用。公开观察删节异常正文。carrier 退役只影响其等待者。服务卸载关闭 owner 准入，取消受支持的 connection 工作，排空已受理管理／模型工作，然后释放原生 run；connection 未确认退役时保留所有权。

<a id="checkpoints-recovery-and-input"></a>

`control().modelPool` 通过既有模型准入 owner 观察真实时间的 Host 全局活动 permit、排队请求及其上限；它独立于原生检查指标中的每运行模拟区间用量，也独立于 `control().budget` 的不可变预算上限。暂停调度不释放已准入的模型 permit；确认流清理后才释放。observed 零是实测值；观察缺失或失败显式返回 `unavailable` 且不携带数量。旧 peer 可缺少新字段。

`control().versions` 来自原不可变 spec 和受信任公司模板，携带有界的规则／策略／tick 标签及场景／模板／driver 版本。已观察的场景元数据还包含保留创建配置中的不可变执行模式 `cognition-only` 或 `automatic-tasks`，不由当前目录模板或任务数量推断。行政 `runStatuses()` 在单次已授权原生批次上补充这些场景身份以及当前 owner／driver／在途／停止／重试元数据，并附带一次共享模型池观察。没有公司创建的可读导入运行仍可读取，其场景／行政状态为 unavailable。元数据读取不取得 owner、不恢复检查点，也不根据显示名称推断场景身份。冷已知公司元数据保留可信版本，返回 `not-held` 且不调度模型。

## 检查点、恢复与输入

失败的 checkpoint／restore receipt 与 checkpoint 详情仅暴露记录的安全 stage、分类与 source 引用；私有原生错误文本保持隐藏。

`control().administration` 按原生所有权、保留请求容量及生命周期，分开返回当前检查点／恢复／准备／输入提示。恢复公开兼容完整依据的 ID、真实发布时间、精确模拟时间、前缀 revision 和来源计数；实际来源／后缀验证仍由明确 restore 执行。输入只公开当前获准实体、精确上限及完整原生字节额度，名称有界。这些提示不授予写权限，每次操作仍重新检查准入。

`checkpoint()` 只接受原 run／command 身份，从保留的创建设置派生 `product-checkpoint/<commandId>` 及采集策略。`restore()` 使用新命令或精确重试命令选择既有完整检查点；实现版本及 owner 选择仍由服务器派生。两者在原生 IO 前持久记录受理意图，并返回 `request()` 也使用的 `SimulationProductRequestReceipt`。其闭合 kind 包含 `checkpoint` 和 `restore`，对应 receipt 携带精确检查点 ID。终态失败保留原类别与身份；失败请求必须使用独立尝试，不能复活旧结果。

采集共用产品 owner 准入队列，关闭后续 driver 准入，暂停原生 run，取消／排空受支持推理，退休 writer 并发布既有完整跨 owner manifest。成功关闭临时 connection，保持暂停；失败保留最近成功依据。已受理采集中断后，只有验证保留的完整检查点与当前后缀，才能使用原身份继续。恢复在退休已持有 run 前核对完整兼容依据，再使用原生 Team 恢复流程复查 Run／Team／Channel／Session 来源并退休旧 writer。恢复当前事实，不回滚、不推理。同命令终态重试返回历史结果；新的恢复命令重新验证。清理未确认时保留原生所有权责任。

`ingress()` 接受一个允许的公司实体（`buyer` 或 `supplier`）、原 ingress ID、文本及规范十进制最早时间。source 来自已认证主体；不接受浏览器归因、广播、世界修改或 route 覆盖。原生 input／event 追加保留原分配。`ingressRequest()` 独立于正文可见性读取待处理／已认领／已消费／已取消事实及关联 decision。已收集事件只有在 wake 完成后才报告已消费。新输入要求已准备或已恢复 owner；原输入查询／重试在冷历史上仍为只读。输入不改变调度 phase。处于 running 的已完成场景可通过有界 driver 批次处理新的未来输入，暂停运行则等待明确开始。

`maxIngressRequestsPerRun` 限制保留的原生输入身份，也包括已完成身份。容量满时仍可精确重试或查询。公开 receipt 不包含 actor 输入文本或主体详情，类型化 Host carrier 核对原 run／command／checkpoint／entity／time 引用。[产品维护场景](../../../examples/simulation-company/tests/product-maintenance.snapshot.ts)及[进程退出恢复场景](../../../examples/simulation-company/tests/product-maintenance-recovery.snapshot.ts)使用脚本外部模型验证生产 owner。

## 公司场景准备

`prepareSimulationCompany()` 提供独立于已认证读取的受信任 version 1 采购拓扑准备。调用者独占持有 paused、尚未启动的原生运行，随创建意图保留已校验设置，并在关闭前排空准备。写入前核对已有实体／资源事实；缺失步骤复用原生规范 Team、Participant、Session 和频道 reservation。相同在途调用合并。准备不激活 actor、不调用模型；发布初始完整检查点并排空临时 connection 后才返回。失败检查点保持终态，须明确使用新的检查点身份。[准备决策](../../../.agents/notes/implemented/architecture/2026-09-29-company-initial-preparation.zh.md) 定义对账及调用者生命周期。此 helper 不提供公开模板目录、run／command 分配或场景驱动。

## 公司场景驱动

`SimulationCompanyDriver` 消费独占持有、已准备／恢复的运行及规范 connection。经校验的版本、模型 route、交付／deadline 偏移与 `maxControlSteps` 来自受信任部署设置。`advance()` 合并一个有界批次，要求原初始完整检查点，并在冻结模型窗口前安置一个 actor。原生驻留、模型 permit、预算及工具仍是权威。请求、接受、转移、明确结果及已交付报告是独立阶段；通知／ingress wake 独立处理。构造、读取和 paused 批次不推理。完成后重试不重复推理。

暂停保留 submitted 窗口供恢复。暂停期间结束却未提交的回合被取消，并用 `interruption` 标识，不声称完成。普通执行失败保留原生责任并继续返回错误。调用者关闭新批次准入、等待 `drain()` 后才能采集检查点或关闭 connection／run；它还负责周期、重试等待及持久创建／设置。此 class 不提供后台 timer 或公开目录。见 [driver 决策](../../../.agents/notes/implemented/architecture/2026-09-29-company-procurement-driver.zh.md)。

<a id="automatic-task-batches"></a>

## 自动任务批次

`SimulationTaskExecutor` 消费带规范 Team 回执的已受理 `task/create` 操作。受信任的版本 1 配置将每个来源实体映射到执行实体、可选精确创建操作、确定性认知、完成策略版本和显式交互。任务文本不选择这些值。`maxControlSteps` 限制控制推进次数，`maxDecisionsPerAttempt` 限制一个 attempt 内的认知次数（默认 `1`），`leaseDurationMs` 固定原分配 lease。调用方提供规范任务 reader、授权上下文、placement 和 lifetime，并拥有已准备 run、connection、推进周期与检查点准入。

构造和 paused 批次不激活或推理。running 批次检查依赖、建立驻留、在分配前保留一个稳定 attempt、交付已记录输入、执行 scoped decision、应用当前到期操作，并且只按证据结算。响应丢失复用原 attempt、decision 与结果意图；配置变化须与保留事实核对，不一致时拒绝。审核、完成证据缺失、取消、技术重试、未知效果和 writer 恢复分别停止。经校验的 `retry` 策略默认 `never`。`before-effects` 仅允许在没有世界操作意图被受理时替换已物理退休的 attempt。`scene` 要求受信任同步恢复函数，先推进原已受理操作，再读取冻结事实。替换仍受 Team 取消、剩余尝试次数及 Native 来源／writer 检查约束。已物理退休的 attempt 使用带 epoch 的独立新身份，已受理世界效果保留原身份。场景 scheduler 推进未来到期效果。

可选的受信任同步 `nextDecision` 回调只在已受理决策仍处于 running、但完成证据缺失时读取冻结的 run／execution 事实。它明确返回 `waiting`、`blocked`，或带原因及可选认知策略的新决策。未配置回调或 `waiting` 不准入认知；`blocked` 与超过 attempt 决策上限的请求返回 `task-blocked`。选定后继在执行前保留前驱、原因、策略及任务说明；响应丢失恢复最后保留的决策，不重新选择或执行。每个后继消耗一次控制推进与既有 Native 预算。

规范 reviewer 将最新 completed attempt 返回 `pending` 时，可以创建独立的下一 attempt，但仍受取消、依赖与 `maxAttempts` 约束。它不复活旧 attempt，也不修改旧结果。待审核不准入新认知。场景完成条件与 Native 交互权限仍生效：rework 不能通过不支持的 continuation 重复已兑现转移。公司模板仍为单决策、无需审核的场景。参见[推进决策](../../../.agents/notes/implemented/feature/2026-10-01-simulation-task-progression.zh.md)。

`advance()` 合并串行批次，`drain()` 等待已准入工作。异步准入步骤后重新检查 owner 退休及暂停。executor 不创建后台 timer，不 open 或 restore run。[Loader 场景](../../../examples/simulation-company/tests/task-executor.snapshot.ts) 通过模型和确定性认知验证真实自动 attempt 与完成；[产品任务场景](../../../examples/simulation-company/tests/product-task.snapshot.ts)验证后台调度及九个跨所有者进程退出点。目录按已安装模板返回 `cognition-only` 或 `automatic-tasks`，Web／SDK 客户端保留该模式。

## 公司任务模式

可选的受信任 `driver.tasks` 配置固定版本 `1`、`cognition`（`model` 或 `deterministic`）、`leaseDurationMs`、`maxAttempts` 与 `retry`。它将直接转移认知替换为一次 scoped Team 任务创建和执行。公司任务没有文件系统 scope，使用共享工作区且默认无审核；受信任的 `review: buyer` 模式将采购方 participant 固定为审核人。浏览器创建不接受 task／executor 配置。行政 owner 在自身 effect 生命周期内注册精确场景策略，保留原模板解析结果，并沿用串行 timer 和检查点准入推进任务。

场景恢复只在旧 writer 已物理退休、原效果已对账后开始新 attempt。效果发生前重试任务；原转移兑现采购后，以新输入和 epoch 记录不产生操作的确认。Native 独立要求此 `continuation` 的转移证据来自原任务已退休的 assignee，并拒绝新的世界提案。完成引用原转移，保留旧失败 attempt，不改写已关闭承诺。尝试耗尽、取消、未知结果或不支持的效果明确停止。已受理目标完成只对账，不再创建 attempt 或请求任务模型。

受信任报告工作流可在最新中断 attempt 已物理退休后，通过 `reportContinuation` 恢复已应用报告。Native 验证同一运行、原创建来源、执行者、participant、Session、原 prepared context 指纹与持久接收回执。新 attempt 将 selector 记录在 required input 中，仅允许无提案确认；完成复用原报告，不重新发布。返工选择新报告，不能借用更早完成 attempt 的报告。任务决策采用精确单 slot 有序窗口，已提交提案在暂停时保留，冷恢复在证明物理退休后取消它们。参见[结算决策](../../../.agents/notes/implemented/architecture/2026-09-30-simulation-task-completion.zh.md)。

采购方审核场景将首次库存转移与报告分为两个有界决策。每次返工尝试记录规范审核反馈，仅发布修订报告，并以自身持久接收回执结算；原已执行转移保留为业务证据。此类任务不关联交互执行，因此该模式不放宽已履约转移的 continuation 校验。世界效果或接收回执尚未结算时，后续认知等待对账。

<a id="administrative-task-review"></a>

## 受信任报告工作流

安装的 `driver.scenario` 使用 `kind: task-workflow`、版本 `1`，以最多 64 个顺序报告步骤替代采购。每个唯一命名步骤固定任务创建者、执行者、接收者、频道、可选审核人、任务说明、报告文本、lease、尝试上限和重试模式。公司基础提供 `buyer`／`supplier` 与 `purchase`；可选受信任 `scenario.topology` 添加最多 30 个 actor（`id`、`name`）和 31 个频道（`key`、含 `entityId`／`role` 的不同 `members`），总量各不超过 32。额外 actor 继承唯一安装的进程内 participant preset／model，capabilities 为空，频道 limits 固定为空。加载时校验全部路由身份及报告发送者／接收者的频道成员资格；执行者不能接收或审核自己的报告。工作流需要两个驻留实体，不能与 `driver.tasks` 同时配置。公开创建只接受安装模板身份及许可参数。目录公开 `kind: task-workflow`、`cognition: deterministic`；任一步骤配置审核人时，公开 `review: participant`。

准备、准入和单目标 ingress 使用同一完整 topology 解析。实体额度必须容纳全部安装 actor；顺序报告送达和独立人工审核只需两个驻留名额。原 driver 与 preparation 保留匹配 topology，后来修改部署名称／路由不会改变已有运行。初始准备无推理地对账每个 actor／频道 reservation，完整 checkpoint／restore 包含全部 participant Session 和频道。审核人必须与执行者不同，可以是独立第三个 actor。

工作流只支持确定性认知。创建、报告及通知确认提案在计算前作为授权上下文持久记录；不准入任意模型提案或普通 Team 工具。完成检查 attempt 的唯一精确已受理报告及匹配的 Native outbox／接收者 Session receipt。审核人来自原不可变步骤，只公开报告操作／送达元数据，不含库存证据或报告文本。rework 创建含规范反馈的新有界 attempt。后续步骤等待前一任务规范完成。中断 attempt 只使用 `never` 或 `before-effects` 恢复；已受理效果不能通过新 attempt 重复。

已完成的报告任务不会丢弃已受理的未来输入。存在待处理 ingress 时，driver 继续使用精确十进制 tick 推进至最早的待处理原生事件，再为选定实体持久记录空确认。暂停运行只在显式恢复调度后消费输入。重试原已消费输入保留 receipt 和 decision，不创建另一报告、任务或资源效果。

## 行政任务审核

受信任模板可启用 `driver.tasks.review: buyer`；公开 catalog 返回 `review: none | buyer`。该场景需要至少两个驻留 actor，只允许已认证的产品运行所有者审核路由给采购方的规范任务；不授予普通 Team 人工修改或任务正文权限。driver 在 `review-required` 停止推进，保留调度 phase 和原库存效果，等待批准或返工。

Host `simulation.tasks.review.list`（`listTaskReviews`）返回有界的运行所属创建／attempt ID、规范 revision、phase、尝试上限及动作提示，固定场景证据标明单次已应用的一单位采购转移，以及当前 attempt 已持久接收的报告；只有冻结的审核完成策略版本及精确供货方→采购方采购频道 receipt 满足该证据，缺证据则阻止审核。任意任务指令、报告文本、结果正文、余额和审核人 grant 仍不公开。`maxReviewPageSize` 默认 32；`maxBytes` 限制完整响应和加密续页。续页绑定当前认证、原生 revision 及规范任务／审核人元数据。冷列表使用检查和规范读取，不打开 writer、挂接 actor 或推理；其动作要求显式恢复。

`simulation.tasks.review.resolve`（`resolveTaskReview`）在规范修改前持久化原 `commandId`、operation／attempt、预期规范 revision、结果和原因。owner 排空当前 driver 批次，并将审核与管理／维护串行执行；每次等待后复查认证、场景权限和目标事实。`request()` 保留原 `review` 输入及 `kind: review` receipt。精确重试不能改 payload 或重复规范审核。已证明的准入拒绝保留 `review-failed`；规范响应或终态发布丢失时保留 `accepted`，直至同命令对账。重启后须显式恢复 owner，再重试该精确命令；恢复可与中断的审核意图并存。

审核完成先发布原终态 receipt，再恢复生产调度。running 意图恢复 timer；paused 意图仍暂停，直到显式 start。返工授权新的规范 attempt，不重复已购库存转移。历史请求读取不依据当前任务 phase 推断成功，也不启动模型。

## 行政任务取消

`listTasks()`／`simulation.tasks.list` 有界读取自有任务身份、规范任务 revision 和当前 attempt（分配前明确为 `null`），不授予任务正文或普通 Team 修改权限。任务推进后须刷新绑定 revision 的游标与动作提示；冷历史在明确恢复 owner 前保持只读。

`cancelTask()`／`simulation.tasks.cancel` 要求原 operation、预期规范 revision、必填可空的 `expectedAttemptId`、command 身份及 reason。格式 2 在 Native IO 前持久化不可变输入。Native 在物理清理前记录取消，拒绝晚到提案、模型派发、分配和结果受理。产品完成等待清理；未确认退休保留受理的原请求和执行责任，既有世界效果不变。重启后的原查询／重试保持同一目标；明确准入拒绝保留 `cancel-task-failed`，不分配替代命令。

## Model Experience

### 产品浏览

#### What the model sees

`ctx.simulationProducts.list()` 和 `inspect()` 不贡献模型输入或推理。登记、浏览和检查不打开执行所有者、不恢复历史、不改变 phase，也不激活 actor。

#### Token effect

直接 token 影响为零。

#### KV Cache effect

不改变模型请求前缀。

### 公司采购

#### What the model sees

明确 running 的 driver 通过既有 Session 上下文机制准备 identity、authority、input、goals 与 commitments。只选择 actor 自有余额及协议账户元数据，不包含私有 profile 或无关资源；supplier 转移证据在报告交付后才进入 buyer 上下文。角色提供 `simulation_observe`、`simulation_stage` 与 `simulation_submit`。此场景视图不代表完整请求历史或工具前缀。

#### Token effect

模型回合消耗原生 run 预算及 integration 的主机共享 permit。必需上下文超额和预算耗尽会停止工作；driver 不增加无界模型队列。

#### KV Cache effect

阶段输入与来源 revision 随决策变化。原生已记录上下文替换及保留的 Session 历史决定请求复用；不承诺固定前缀节省。

### 自动任务执行

#### What the model sees

模型路径收到场景授权上下文，以及包含精确来源、attempt 和说明的 Native 必需任务输入。只提供现有 Simulation 工具。确定性路径消费已记录授权视图，不请求模型。

#### Token effect

模型路径保留 Native token 预算和主机共享模型 permit。任务说明计入上下文字节额度。确定性认知和结果评估不请求模型；结果重试不重复推理。

#### KV Cache effect

任务、attempt 及有序决策身份改变必需上下文。保留 Session 历史及 Native 上下文替换控制模型前缀复用。

## Known Limitations and Deferred Work

- 每个不可变登记只允许所属已认证主体访问。ACL 变化、共享角色和删除登记需要单独设计持久操作。
- 目录列表携带未观察的元数据，不声称当前世界状态。检查重放有界的完整原生历史，因此不承诺性能改善或支持规模。
- 其他实体类型、任意 participant grant／provider、其他效果／完成类型、模型驱动报告工作流及新增场景完整 Web／进程退出恢复矩阵仍待完成。模型驱动工作流须在世界效果应用前，由 Native 对精确场景操作实施准入。公开创建选择已安装场景，不修改其冻结策略。[产品目录决策](../../../.agents/notes/implemented/architecture/2026-09-29-simulation-product-directory.zh.md)负责元数据授权与删节。
