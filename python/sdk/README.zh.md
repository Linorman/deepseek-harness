# Clocky Python SDK

协调者 transcript 严格校验 `compaction/assessment` 估计值和 `compaction/end.noGain` 的摘要、计数及无收益关系；格式错误或成功结束却携带无收益证据的事件会在进入类型化事件前拒绝。

`archive_raw_simulation()` 通过严格解析、鉴权的原始文字分页保留来源原版本。结果明确未执行 Native 验证；SQLite 逻辑记录保留与物理数据库复制明确区分。SDK 不会自动恢复、继续推理或获取全部续页。

归档预览要求来源已暂停且静止，不会退休角色。执行保留一个原 command、revision 和 plan hash，读取用于对账其持久结果。首次归档复制并校验完整 owner 历史，不删除原件或释放历史容量。归档原记录分页需要独立的完整记录读取权限；拥有 run 或归档命令不代表可以读取 Session、Channel 正文。

生成请求、读取、执行、状态转换和 Persona 草稿方法保留原 job 身份，仅显式执行调用模型。产品输入必须为用户撰写；Host 记录实际 principal 来源并限制 runtime、scope 和 audience。Persona 纳入经过已有 A2 预览和提交路径，保留生成草稿的 revision/hash。读取和重试不创建替代 job，未知输出仍是原对账责任。结果属于私有数据，并按当前权限重新检查。

`simulation/generation-input` 和 `simulation/generation-output` 是必读的助手事件。转录读取校验精确输入消息身份、scope/audience、模型/策略版本、原输出及可选 token 计数；额外字段、非法请求字节和 ignorable 标记均拒绝，缺少 usage 仍表示未知。

[English](https://github.com/Linorman/clocky/blob/master/python/sdk/README.md) | 中文

两个 client 提供 `read_simulation_world_management_fields`、`preview_simulation_world_management` 和 `submit_simulation_world_management`。严格模型保留全部原表单选择，包括未启用的生效时间输入，并绑定预览/run/person revision 及 hash。只读预览不恢复、不推理；提交保留唯一命令供查询和精确重试。认证用户的原案件没有模拟 requester 或 Operation。取消要求实际允许取消预览中的 revision/hash；回调确认和业务结果保持独立观察。

案件执行 `observation` 严格解析原计划、回调模式、Native 序号/更新次数、模拟时间和固定原因集合，区分未知回调与前提阻塞。`settled` 必须显式携带 null 原因，wire 序列化保留该值；缺字段、扩展字段和矛盾观察均拒绝。回调结果未知不会替换已存在的业务提交结果。

执行详情中的 `responsibilities` 严格区分人事、代表和联系状态，保留原所属身份与有序版本。共享代表准备可引用较早 intent；联系和人事责任必须属于所选案件。未知状态、重复类别、私密字段及倒退序号均被拒绝。

`HarnessClient` 和 `Clocky` 提供 `preflight_simulation_world`、`create_simulation_world`、`prepare_simulation_world` 和 `export_simulation_world_definition`。严格的 `WorldScenario` 输入只携带已安装的符号引用和已声明额度；预览／导出响应拒绝私有 Native 字段和未知必需协议变体。创建／准备保留原 command 并保持暂停，执行由显式管理和恢复负责。导出是可移植创建定义，不是运行备份。未知必需 Session event 抛出 `SdkProtocolError`；未知且带 `ignorable: true` 的 event 保留为原始通知，但 `validated_coordinator_event()` 返回 `None`，因此不会进入已知 typed transcript。

`limits.world.maxRequestsPerActorPerInterval` 在创作输入中为可选正安全整数，在已解析预览中为必需字段。Native 按人物和来源 decision 所属的模拟 `budgetInterval` 周期累计已受理请求；取消或后续拒绝不退还受理额度，精确业务重试不消耗新的请求额度。

`limits.world.maxBirthsPerInterval` 和 `maxExternalExpansionsPerInterval` 接受非负安全整数；零表示禁用动态出生或外部展开。`maxPendingMutations` 仅接受 `1`，冻结结构变更并发度。三项字段均可在创作输入中省略，但已解析预览必须完整提供。

v1 `organization.hiringFees`只携带显式创作的一次性招聘费用：固定policy、招聘操作、岗位、不同的既有付款/收款账户、单位、正十进制数量、不同grant引用和正模拟预留周期。省略保持未声明，不补费用或付款默认值；空/错误字段和未知属性拒绝。资金、预留历史容量和模拟到期通过闭合的 `resource-capacity`、`resource-history-limit`、`resource-reservation-expired`停止分类观察，控制及运行状态DTO一致保留。账户解析、授权、扣费与恢复由Host/Native拥有；SDK没有新增付款写入API或私有compilerVersion DTO字段。

World 原生额度包含 `maxResourceReservationHistory`：已解析额度必须完整提供正安全整数，场景可请求有界的正整数覆盖。它限制全部保留的资源预留历史；取消或模拟到期不会退还历史额度。资源预留、提交与取消通过既有 operation 元数据和获准读取的原 journal 文本观察，SDK 不提供 Native 交易写入接口；缺失必填字段、未知结构字段和未经授权的正文仍拒绝。

`WorldScenarioV1` 与 `WorldDefinition` 接受完整、显式带版本的 v1 作者分组。`SimulationWorldPreflightV1Ready` 返回实际暂停初始化、领域 pin、带区间权限、委员会规则、制度元数据及来源数量。所有嵌套字段与诊断种类保持封闭。定义、请求、预览与导出的 `model_dump(exclude_none=True)` 仍保留必需的 null 区间终点；未提供的可选字段继续省略。director 事件声明必填严格正整数 `maxRequests`，独立于运行的 world 额度；Host 编译器验证其关联有限日历上限与已安装能力，不支持的声明仍被拒绝。

两端客户端提供 `list_simulation_world_cases`、`inspect_simulation_world_case` 与 `cancel_simulation_world_case`。严格的 `SimulationWorldCasesInput`/`Page`、`SimulationWorldCaseInput`/`Inspection` 与 `SimulationWorldCaseCancelInput` 保留原选择，并拒绝其他身份的结果。详情四个分区区分规划、执行和通知；wake 完成不证明消息已经送达。案件正文和 Persona 分别有披露状态。取消查询保留 `worldCancellation`；传输不确定时查询并显式重试同一命令，不隐式推理或调度。 案件摘要必填 `clocky.world-case/v4`、domain/operation/version 和 `targetEntityId`，拒绝旧岗位专用摘要。只有精确招聘 apply 计划接受 Persona 与招聘预留。必填 `request: null`、`predecessor: null` 和 JSON `payload: null` 在省略可选字段的 wire dump 中仍被保留。 必填 lifecycle 从同一 Native 前缀分离请求、计划、回调/业务与通知，拒绝矛盾详情、缺失状态轨及 v1 响应。

案件结果将共同终态 `outcome` 与必填 JSON `payload` 分开。提交结果的 outcome 为 `{ "kind": "committed" }`；招聘 `entityId` 和 `relationId` 放在 `payload` 中，存在原招聘预留时必须与其匹配。其他领域可返回不含招聘预留的已提交 JSON payload。解析器拒绝旧 outcome 身份字段、缺失 payload 和非 JSON 值。产品方法只接受不含 actor 的选择器；Native 意图创建仍是受信任 owner 的能力。

控制响应公开完整已安装拓扑中最多 32 个已授权输入目标；每个 ingress 命令仍只选择一个实体。

`list_simulation_requests(SimulationRequestsInput(...))` 发现一页有界原 receipt，不含私有命令输入。`retry_simulation_request(SimulationRetryRequestInput(...))` 只接受运行和保留命令身份；仅已受理命令会重放后端保留的原输入，终态 receipt 不变。两个 client 核对运行、命令、所请求 revision 与页大小，不自动遍历分页或重试，并拒绝私有或被替换的结果。

两个公开 client 的 `preflight_simulation(SimulationPreflightInput(...))` 返回当前就绪状态，不携带命令身份，也不预留资源。`SimulationLimitsInput` 只允许可选的部署许可运行额度；`SimulationPreflightResult` 必须携带解析后的配置或有界字段问题之一。目录配置包含默认值和可编辑键。精确十进制 `maxTime` 保持字符串；创建会独立复核并保留原命令。

`SimulationCheckpointDiagnostic` 只携带有限公开 stage／code、精确规范对象身份及可选未确认清理。receipt 与检查点详情模型拒绝成功或无关操作的诊断，并禁止 provider 消息、路径及任意 cause。

`retry_simulation_operation(SimulationOperationRetryInput(...))` 通过两个公开 client 提交一次精确原有 outbox 额度授权。严格输入只规范化原因一次，拒绝命令身份首尾空白及不安全／非正尝试次数。原查询保留 `retryOperation`；不同 payload 不能复用命令，`not-found` 不授权新身份。授权／查询与显式调度及目标对账分开。

`get_simulation_run_statuses(SimulationRunStatusesInput(...))` 通过两个公开 client 读取一次精确、有序的已授权批次。严格原生指标保留规范十进制区间和已计费未知尝试；`modelPool` 分开报告真实时间 Host permit／队列占用及运行预算。场景版本只来自原受信任模板。missing／unavailable 观察保持显式；提供私有或替换字段时拒绝。

`list_simulation_task_reviews()` 与 `resolve_simulation_task_review()` 共用严格的 `SimulationTaskReview*` 模型和已安装场景权限。client 核对精确所属运行、revision／页或原审核命令。`get_simulation_request()` 保留原 `review` 输入；冷修改要求显式恢复。审核不授予普通 Team 修改或正文权限。

`inspect_simulation_source(SimulationSourceInput(...))` 返回严格的 `SimulationSourceInspection`。用不透明 cursor 继续定位，找到后用 cursor 与 `envelope.sequence` 继续正文。选择／revision／位置不符或删节结果携带正文时拒绝。

知识输入接受精确决策 `reference`，严格 model 及 client 关联拒绝版本或来源字段替换。每个返回文本片段仍遵循当前受众和 Host 内容 grant。

`watch_simulation(SimulationWatchInput(...))` 进行一次有界真实时间元数据等待。精确 run 核对和严格 DTO 拒绝被替换或私有结果，reset 使旧策略／正文响应失效。重复观察由调用方决定，不继续模型。

选定运行时挂载产品服务时，`Clocky` 和 `HarnessClient` 提供 Simulation 产品元数据、创建／准备，以及 `get_simulation_control()`、`manage_simulation()`、`get_simulation_management()`、`checkpoint_simulation()`、`restore_simulation()`、`ingress_simulation()` 和 `get_simulation_ingress()`。公开 `Simulation*Input` 模型拒绝执行配置及无效集合／section 筛选；响应模型保留精确十进制时间字符串，并在 Host 标记删节时拒绝正文。`inspect_simulation_object()` 支持独立分页的实体关系与冻结决策上下文。只有明确 Host 上下文 grant 才公开已记录纯文本；来源引用不授予 Team／Session 正文访问，且该视图不是完整模型请求。client 核对选择／revision、命令类型、恢复目标、原调度 phase 和输入目标／时间。断线后保留原命令、管理或输入 ID 与 payload；`not-found` 不证明失败。创建准备 paused 运行，不推理；旧调度重试保留原结果，不撤销后来暂停。检查点／恢复保持暂停，恢复验证当前后缀，不回滚也不推理，输入分配与消费保持独立。这些方法不会自动重试命令或遍历分页。

调用 `update_team_task()` 或 `Team.update_task()` 时保留 `commandId` 与原字段。受理时返回原 `value.receipt` 和当前 `value.task`。`get_team_task_update_result()` 与 `Team.update_result()` 只读取已受理、终态拒绝或当前未找到的结果。严格 model 校验拒绝原因和原 revision 比较，client 核对精确命令身份。`not-found` 仍将延迟请求保留为未确定。

`list_teams()` 只返回已认证主体可读的安全元数据，不含物理扫描计数或授权 grant。加密 `nextCursor` 只对该主体代际有效；过期游标要求明确读取首页。Team 读取要求当前成员权限，不启动模型执行。

通过 JSON-RPC stdio 驱动 Clocky 的 Python 子进程 SDK。运行时继承指定 Cordis 组合所声明的环境变量，调用方可以直接使用真实模型端点，也可以把这些变量指向本地代理。

请从 PyPI 安装 `clocky-sdk` 分发包；导入模块仍为 `clocky`：

```sh
python -m pip install clocky-sdk
```

安装 `clocky-sdk` 会同时安装版本完全相同的 `clocky-runtime-bin` 平台 wheel 包。因此常规入口不需要传可执行文件参数：

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="test-provider", model="test-model") as harness:
    result = harness.run("Say hi.")
```

`Clocky` 会保留其按需启动的运行时子进程，以便在多次调用之间复用。请像上例一样将其用作上下文管理器，或在使用完毕后显式调用 `close()`。

默认情况下，SDK 会启动 `clocky-runtime-bin` 包内置的单文件可执行程序 `clocky-jsonrpc-agent`，并通过 `CLOCKY_CORDIS_CONFIG` 注入该包的默认配置，其中包括 stdio JSON-RPC 服务器、agent core（智能体核心）、一个休眠的通用提供方路由、JSONL 会话持久化，以及本地 Team Hub/Link/Agent Client/TeamRun 栈。要运行自己的插件组合，请在配置中保留 `@clocky/clocky-sdk-jsonrpc-server` 配置项，并传入 Cordis 配置文件路径。

```py
from clocky import Clocky

with Clocky(
    provider="test-provider",
    model="test-model",
    credential="product-credential",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`credential` 是直接传给 `Clocky` 的不透明产品凭据。SDK 只在初始化握手中传输它，绝不在后续 Team request、运行时环境或启动参数中传输它。对内置默认配置，父进程会在 credential scrubbing 后只将其 SHA-256 摘要作为 `CLOCKY_PRODUCT_CREDENTIAL_SHA256` 提供给子进程。`provider` 选择指定 Cordis 组合所注册的提供方路由；`model` 是该适配器解析出的模型 ID。`max_tokens` 是一个可选的正整数，用于限制每个 SDK 创建的 Team coordinator 请求的 token 输出；省略该参数时，由提供方的默认行为决定输出上限。压缩摘要继续使用压缩插件单独配置的上限。内置默认组合注册用于无密钥启动和脚本化验证的休眠 `test-provider` 路由。自定义组合可以挂载 `llm-pi-ai`，在其中配置各提供方专属的凭据和端点，并选择 pi-ai 已安装 catalog 中存在的任意提供方/模型组合。

[Python SDK 教程](https://github.com/Linorman/clocky/blob/master/docs/user/guide/python-sdk.md)提供一套无需使用 Web UI、按步骤完成安装和首次运行的流程。该教程所用的完整独立 Cordis 配置文件位于 [`jsonrpc-agent` 示例](https://github.com/Linorman/clocky/blob/master/examples/jsonrpc-agent/README.md)中。

bundled runtime 还包含一个指向 canonical 本地 OpenAI 兼容服务器 `http://127.0.0.1:18000/v1` 的显式 `local-vllm` route。设置 `CLOCKY_LOCAL_MODEL_ID` 与 `CLOCKY_LOCAL_MODEL_API_KEY`（用户提供的未认证 endpoint 使用 `EMPTY`），再把 route 和 model 传给 `Clocky`，无需自定义 Cordis 文件即可选择它；`CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high` 会转换为实测 Qwen endpoint 的 `xhigh` 拼写。其他 base URL 应通过 `CLOCKY_CORDIS_CONFIG` 提供显式 Cordis 配置。

```sh
CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high
```

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="local-vllm", model="Qwen3.8-27B-AWQ-4bit") as harness:
    result = harness.run("Make the requested code change.")
```

`Clocky.create_team(input, objective=...)`创建默认的 human/coordinator/worker Team，并返回带有 `id` 和 `coordinator_session_id` 的 `Team`句柄。`Clocky.resume_team(team_id)` 与 `Team.resume()`会先读取当前持久 Team cursor，再发送经认证且不含 actor 的 resume request；可传入 `expected_cursor=` 使用显式观察到的 fence，或在低层边界使用 `HarnessClient.resume_team(TeamResumeRequest(...))`。过期 cursor 仍会抛出 `JsonRpcError`，重试前应重新读取 state。字符串会成为一个 direct v3 text block；显式输入会保留有序的 direct v3 text/image block。字符串默认提供 objective；仅含 image 的输入必须提供 `objective`。

`Clocky.list_teams()`、`Clocky.list_team_members()`、`Clocky.list_team_tasks()`和`Team.channel()`都会返回有界 page。传入 `after_cursor` 与 `limit` 可以从 `nextCursor` 继续读取；SDK 会通过共享 JSON-RPC protocol 原样转发这些 field，省略时使用 runtime 的有界默认值。

`Clocky.team_metrics()`（或 `Team.metrics()`）返回用于 dashboard 与告警的进程内 Team 运行计数器与 gauge，包括 active admission、checkpoint/compaction count、audit projection repair/failure count，以及累计的 task/receipt latency histogram。

`HarnessClient.read_team_artifact()` 和 `Team.read_artifact()` 按 durable id 读取一个可见的 provider-backed artifact，并返回准确的 reference、byte count 和 base64 data。Private、ambiguous、没有 provider、缺失和超限 artifact 在该 SDK surface 上仍不可用。

`Team.wait_for_final()`只有在运行时仍持有该 TeamRun，且 coordinator 的显式 `team_final` Envelope 获得 human receipt、本地 topology 完全结算后，才返回 `TeamFinalReceipt(team_id, channel_id, envelope_id, text)`。`Team.cancel()`有相同的 ownership 条件，并在终态 Team phase 结算后返回。`Team.archive()`会把终态 Team 和 cursor 绑定到已认证 active human proof，因此 detached 或 restart 后的 Team 也可归档；active Team 会被拒绝，重复归档保持幂等。`Clocky.run()`返回 `RunResult(team_id, final_response, final, events, notifications)`：`final_response`等于 `final.text`，`events`和`notifications`都按协议传输顺序包含 coordinator 会话事实。

`HarnessClient`保留通用 notification subscription，以及低层已认证 Team 方法，包括 `create_team()`、`resume_team()`、`wait_for_team_final()`、`cancel_team()`、`archive_team()`、member、channel、goal 与 task mutation。关闭 notification subscription 会丢弃排队 item，并用 `TransportClosedError` 唤醒每个阻塞的 `next()`；runtime failure 仍通过同一个 subscription 暴露。需要 typed handling 时，`HarnessError`、`JsonRpcError`、`SdkProtocolError`、`TransportClosedError` 和 `NotificationSubscription` 都可以从 `clocky` package 导入。Resume 从已初始化 credential 派生 active human，并要求显式 cursor fence；过期 fence 会返回 `JsonRpcError`，绝不会用伪造 cursor 重试。Team id、cursor 与 participant id 都不能证明 authority，所有 mutation payload 都不携带 actor 或 proof；runtime 从已初始化 credential 派生 active human，并执行其 immutable grant、revision 或 cursor fence 与 review policy。有界的 list/read/watch、quiescence、audit 与 metrics 仍可用。Session 仍是 transcript source，而不是产品 run target。畸形的 Team receipt 或 coordinator event 会抛出 `SdkProtocolError`。[authenticated product-principal Team control note](../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)记录连接绑定；[Team actor-proof control-plane proposal](../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)仍是更广泛的 proof owner。

也可以通过 `CLOCKY_CORDIS_CONFIG` 为运行时子进程指定配置。`HarnessClient.initialize()` 只会在收到凭据后启动子进程，因此底层客户端按默认方式启动时也具有该行为：如果启动方式最终解析为内置运行时，且既没有设置 `cordis`，也没有设置非空的 `CLOCKY_CORDIS_CONFIG`（运行时将空值视为未设置，注入检查也是如此），系统就会使用内置默认配置；显式指定 `runtime_bin`、`bridge_bin` 或 `launch_args_override` 时，则会完全禁用该注入。运行时载体（生产用 exe 与仅限开发的 `node` 闭包）及其获取方式见 [sdk-runtime README](https://github.com/Linorman/clocky/blob/master/python/sdk-runtime/README.md)。

`cwd` 与 `runtime_cwd` 会在启动子进程、注入环境变量和协议握手前解析为绝对路径。公开 API 只暴露由 SDK 直接应用的选项：部署 persona 和持久化配置应在 `cordis.yml` 中定义；`session_root` 则保留为设置 `CLOCKY_SESSION_ROOT` 的高层便捷参数。


`Clocky` 与 `HarnessClient` 提供 `inbox_read(after_cursor=None, limit=None)`、`inbox_watch(...)` 和 `inbox_acknowledge(through_cursor)`。读取返回 `TeamHumanInboxPage`，确认返回 `TeamHumanInboxAcknowledgement`；这些已导出 model 保留准确的 final provenance 与共享持久 display cursor。Inbox 由初始化时认证的 principal 选择，display acknowledgement 独立于 channel receipt。[Inbox Consumer](../../packages/team/team-human-client/README.zh.md) 定义权限、分页、重启行为与当前缺口。

Team-list 的 `nextCursor` 是 opaque string，`after_cursor=-1` 开始新扫描。存在 cursor 时继续读取空页，并用 `scanned` 统计工作量。Discovery cursor 过期后需要重扫；其他 collection cursor 仍为数值。

`inspect_team_task(team_id, task_id, "record")`返回当前字段及历史计数。使用`"attempts"`或`"reviews"`，配合`after_cursor`、`limit`和`expected_revision`读取有界历史页。响应会校验所选 Team、任务、分区、版本和窗口。版本过期时需要刷新记录；私有产物引用不会返回。


`list_simulation_tasks()` 读取有界的规范运行任务控制。`cancel_simulation_task()` 固定来源操作、任务 revision、原命令与精确 attempt；必填且可空的 `expectedAttemptId` 将显式 `None` 保留为 JSON `null`，要求没有活动 lease。SDK 核对运行／命令／回执类型，拒绝缺失的 fence、actor 字段及无效操作提示。`get_simulation_request()` 仅在匹配的 `cancel-task` 回执下公开原始 `cancellation`；查询不重试，也不推理。

目录与预检 DTO 要求严格的 `readiness` 变体。创建必须传入来自已观察 `ready.model` 的 `expectedModel`，其中 `name` 是提供方模型 ID。缺少模型配置时已安装模板仍可读，但不能伪装为就绪路由。客户端不自动更换路由或重试创建。

`readSimulationWorldDomain`（Python 为 `read_simulation_world_domain`）共用 `simulation/world-domain-read`。严格的 `clocky.world-read/v1` 结果绑定完整原选择及独立有界覆盖范围，拒绝未知字段或替换身份、版本、分区、覆盖信息。续页使用返回的 cursor 及原 revision／readVersion。未知驻留和可空义务计数保持未知；模拟时间及制度／提案版本保持规范十进制字符串。读取不恢复、不 attach、不推理，正文授权不代表 Session 权限。

`read_simulation_draft` 与 `save_simulation_draft` 使用严格的 `ScenarioDraftRead`/`ScenarioDraftSave` 模型。保存重试保留原 ID 与完整 payload，包括创建时显式的 null 父版本。响应必须对应精确草稿/版本或原保存。冲突返回双方定义，不覆盖任一版本；这些操作不调用模型。

## 单任务取消

`HarnessClient.cancel_team_task()`和`Team.cancel_task()`接收`teamId`、`taskId`、`expectedRevision`及可选`reason`（Team helper 提供自身 Team id）。`value.cancellation`保留精确 intent；assigned 或 running phase 表示终止仍在等待。Team 继续运行，应观察任务直到 cancelled。 [取消归属](../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).

`read_simulation_records(SimulationRecordsInput(...))` 返回严格的 `SimulationRecordsPage`，核对精确 run／筛选／模式。元数据不包含原始 JSON 文本；原文需要独立的整运行历史正文授权，以保持 Unicode 完整的有序分片返回，并携带一致重建所需的 revision 与策略版本。

`preview_simulation_world_calendar` 为暂停排班修改生成 quote；`submit_simulation_world_calendar` 在执行前保留精确 quote。`read_simulation_world_calendar_command` 在重启后找回作者限定原件，`cancel_simulation_world_calendar` 保留竞态中已执行的回执。`WorldCivilCalendar` 保留明确的 IANA 数据版本、UTC 起点、星期与 DST 歧义选择，由 Host 转换。提案 domain 读取的 `section="impact"` 接受 `SimulationNormImpactInput`，依独立披露权限返回只读的完整未来日历/义务报告。

## 私密备份导出

`client.backup_export(SimulationBackupExportInput(...))` 读取已完成的原始私密包。严格结果校验验证精确 UTF-8 包字节的 SHA-256，客户端检查原始 run/command 身份。导出需要独立私密记录披露授权，不启动推理或恢复运行。 完整分支导出还要求祖先的当前披露授权，或针对该分支的显式 `includeProvenance: true` 授权；只有分支自身权限不能读取祖先字节。

## 不可变实验 cut

`branch_world`、`read_world_branch`、`query_world_causal` 和 `compare_worlds` 接受严格实验模型。超时后保留原始分支 UUID，读取不会创建新分支。客户端校验所选原始 cut 及完整因果响应的字节、节点上限。分支要求明确记忆策略与独立 start；比较包括实际预算和停止差异，不推造质量、成本或因果效应。
