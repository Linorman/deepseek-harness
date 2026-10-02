# @clocky/clocky-sdk-protocol

[English](README.md) | 中文

`simulation/requests-list` 携带 actor-free 运行选择器，返回互不重复的原 receipt、总数、运行独立 revision 及可选继续游标，不返回私有命令输入。`simulation/requests-retry` 只携带 `runId` 和已有 `commandId`，返回原 receipt 类型；调用方提供替换输入时会被拒绝。已受理命令保留原语义，终态 receipt 保持不可变。

`simulation/runs-preflight` 共用严格产品草稿／结果解析器。草稿省略 `commandId`；`ready` 携带解析后的 `limits`、预算区间、规则／策略／tick 标签及共享模型容量，`invalid` 携带有界字段问题。模拟 `maxTime` 保持规范正十进制字符串。目录配置公开默认值和可编辑额度键；创建只可携带允许的可选 `limits`。

恢复 `diagnostic` 是封闭的 stage／code／subject 契约。Session 对象绑定精确 Session、Team 和 participant；它只允许出现在失败的检查点／恢复 receipt 或失败的检查点详情中。wire 契约不解析私有消息推断类别，也不公开路径或 stack 字段。

`simulation/operation-retry` 要求原 `commandId`、精确 `operationId`、正安全整数 `expectedAttemptCount` 及非空规范化原因。结果属于 `retry-operation`；保留的失败为 `retry-operation-failed`。`simulation/requests-get` 只在该 kind 时携带精确 `retryOperation` 原输入，并将运行／命令绑定到 receipt。额外 actor、配置或伪造结果字段会被拒绝。

`simulation/runs-statuses` 携带有序、独立的 `observed`、`missing` 或 `unavailable` 运行观察，以及一次可选真实时间共享模型池观察。原生指标保留精确十进制模拟区间；token 费用包含预留／未知工作，Host permit 则统计当前基础设施准入。旧 peer 可缺少新的检查／控制字段；提供的字段仍严格校验，unavailable 观察不能携带虚构零数量。

`simulation/task-reviews-list` 与 `simulation/task-reviews-resolve` 复用严格的场景范围产品 DTO。列表只公开规范来源／attempt 元数据；resolve 绑定原命令、operation、attempt、revision、结果和原因。`requests-get` 仅在 `kind: review` 时携带原 `review` payload；receipt 与当前任务 phase 相互独立。

`simulation/sources-inspect` 使用封闭、不含 actor 的来源选择及纯文本结果。missing、withheld、unavailable、searching、found 状态分开，只有 found 携带正文片段；引用序号或已知 Envelope 位置不是授权凭据。

`simulation/records-list` 共享产品日志请求／结果 schema。metadata 与 original 模式分开；原文是独立历史正文策略下的有序 JSON 文本分片。严格结果校验拒绝模式或权限要求删节时的文本。筛选、来源序号、观察 revision 和读取策略版本保持显式。

`SimulationSdkRequestMap` 覆盖已认证的产品元数据、原创建／准备请求、调度控制、检查点／恢复和单实体输入。输入使用不透明 wire 字符串，复用严格的[产品解析器](../../simulation/simulation-product/README.zh.md)；结果保持有界、删节的产品 DTO。provider／spec 选择及主体身份由服务器派生。模拟时间、slot 和 writer epoch 保持规范十进制字符串。管理、命令和输入身份在精确重试中保留；`not-found` 不能证明失败。恢复验证保留历史与当前后缀，不回滚也不推理。

`team/task-update` 要求 `commandId`，受理时返回 `{ value: { receipt, task } }`；receipt 描述原操作，task 是当前状态。`team/task-update-result` 读取精确 Team／task／command 的 `applied` 元数据、终态 `rejected` 元数据或 `not-found`。拒绝原因是封闭联合，保留原 expected／observed revision。查询不含 actor proof、提交输入或私有诊断；未找到不能确立失败。

Clocky SDK 运行时的共享协议格式（wire format）：一个按换行分帧的 JSON-RPC 2.0 传输类，加上协议两端共同使用的具名请求、结果与通知类型。包根枚举协议消费方接口；源模块不支持深层导入。服务端是 [`clocky-sdk-jsonrpc-server`](../server/README.zh.md) 插件；[`clocky-sdk-client`](../client/README.zh.md) 消费 Team 产品接口，[Python SDK](../../../python/README.zh.md) 跟随同一协议迁移。纯库——无插件、无 Config、无注册。

`team/list` 返回已认证主体的安全产品摘要与可选加密续页，不含物理扫描计数、grant 和 goal budget 正文。续页绑定主体与凭据代际；过期要求明确读取首页。选中 Team 的 `readAccess` 由服务器派生，不授予修改权限。


`simulation/tasks-list` 返回有界的运行所属规范任务控制；`simulation/tasks-cancel` 固定原命令、来源操作、任务 revision，以及精确 attempt 或显式无 lease 的 `null`。actor 字段与缺失的 fence 均被拒绝。`cancel-task` 回执确认原请求类型；`requests-get` 用同一运行与命令重建不可变的 `cancellation`。协议不携带私有任务正文或通用 Team 权限。

## 传输

`JsonRpcLineTransport` 在调用方持有的字节流上为 JSON-RPC 2.0 分帧，每行一个紧凑 JSON 帧、以 `\n` 结尾。带 `id` 与 `method` 的帧是请求，仅 `id` 是响应，仅 `method` 是通知；非法 JSON 行被忽略。`start()` 挂接流监听器，`close()` 移除监听器并拒绝挂起请求，但不销毁流。缺失请求处理器时应答 `-32601`；普通处理器拒绝会应答 `-32603`，`JsonRpcRequestError` 则保留其选定的 code 与可选 data。错误响应会以 `JsonRpcResponseError` 拒绝挂起的 `request()` Promise，并保留协议格式中的 `code` 与可选 `data`。`JsonRpcTransportPeer` 是服务器类据以进行类型声明的出站接口（request/notify）。

## 协议类型

Team list、participant list、task list 与 channel-read method 都是 page contract。其 params 接受可选的 exclusive `afterCursor` 与正整数 `limit`；result 最多携带一个有界 page，并可带 `nextCursor`。List cursor 是 provider-order ordinal，channel-read cursor 是 channel-WAL sequence。省略这些字段会使用 server 的有界默认 page；需要其余内容的 caller 必须从返回 cursor 显式续读。

`types.ts` 为 `HarnessSdkJsonRpcServer` 所服务协议的每个载荷命名：

| 方向 | 方法 | 类型 |
|---|---|---|
| client→server | `initialize` | `InitializeParams` → `InitializeResult` |
| client→server | `team/create` | `TeamCreateParams` → `TeamCreateResult` |
| client→server | `team/wait-final` | `TeamWaitFinalParams` → `TeamWaitFinalResult` |
| client→server | `team/cancel` | `TeamCancelParams` → `TeamCancelResult` |
| client→server | `team/archive` | `TeamArchiveParams` → `TeamArchiveResult` |
| client→server | `team/goal-update` | `TeamGoalUpdateParams` → `TeamGoalUpdateResult` |
| client→server | `team/goal-transition` | `TeamGoalTransitionParams` → `TeamGoalTransitionResult` |
| client→server | `team/metrics` | `TeamMetricsParams` → `TeamMetricsResult` |
| client→server | `team/artifact-read` | `TeamArtifactReadParams` → `TeamArtifactReadResult` |
| client→server | `activation/open` | `ActivationOpenParams` → `ActivationOpenResult` |
| client→server | `activation/link-enroll` | `ActivationLinkEnrollParams` → `ActivationLinkEnrollResult` |
| client→server | `activation/status` | `ActivationStatusParams` → `ActivationStatusResult` |
| client→server | `activation/interrupt` | `ActivationInterruptParams` → `{}` |
| client→server | `activation/dispose` | `ActivationDisposeParams` → `ActivationDisposeResult`（终态） |
| client→server | `shutdown` | 无参数 → `{}` |
| server→client | `activation.status` | `ActivationStatusNotification` |
| server→client | `session.event` | `SessionEventNotification`（运行时内每个会话，不过滤） |
| server→client | `session.status` | `SessionStatusNotification`（整个 agent（智能体）的 `running`/`idle` 转换） |

`HarnessSdkRequestMap` 与 `HarnessSdkNotificationMap` 按方法名索引这些类型。`team/create`记录非空 objective、创建本地默认 topology，并接纳一段非空 direct v3 human content；回执暴露 Hub Team id、coordinator transcript id 和初始 Envelope id。`team/wait-final` 与 `team/cancel`只作用于该 server 当前持有的 TeamRun。wire 不携带 actor、principal、proof 或 caller-selected identity。`initialize`认证连接后，组合了`teamHumanActors`的运行时可将 resume、member change、channel open/post/close、goal update/transition、task create/update/cancel/delete/review 以及 terminal archive 绑定到其 active human；缺少该 binder 时会以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`失败。resume 要求观察到的 Team cursor，将完整 input 绑定到`activate`，并在 coordinator recovery 中保留 proof。goal write 会绑定完整 parsed payload 与观察到的 goal revision。archive 直接到达 Hub；active human 具备`close`authority 时，可作用于 detached 或 restarted 的终态 Team。list/get、quiescence/audit、metrics 以及有界的 member/channel/task read/watch 仍然可用。每个 activation 命令都携带精确的 `target`（`activationId`、`teamId`、`participantId`、`sessionId`）；返回或通知的 `SdkActivationState` 会重复该 target、加入封闭的驻留状态，并带有按 epoch 单调递增的 `statusSequence`，供查询与通知排序。`activation/open` 只接受 `fresh` 和 `resume`，协议不传输 fork 历史。`activation/link-enroll` 是 Hub 已提交匹配 binding 后由受信任 placement owner 调用的操作：binding 会重复 target 并命名 placement provider，短期不透明 credential 不得记录或持久化。`JsonRpcRequestError` 让请求处理器保留选定的 wire 错误码与结构化数据，而不把已验证的拒绝压缩为 `-32603`。导出的 zod schema 会严格解析 bootstrap、Team、shutdown、activation 命令、结果和通知封套；可扩展的 `ContentBlock` parser 要求非空 type，并保留部署特有的 block 字段。

`team/task-create`要求调用方提供 idempotency key，并保留可选的 `TeamTaskIntegrationSpec`，其中包含已完成的 source task/attempt、provider、target、expected target revision 以及 proposal 或 integrate mode。server 会将完整 parsed create payload 绑定到 authenticated human proof。`team/task-review`只接纳 team、task、revision、decision 与 reason；Hub 从该 proof 派生 reviewer。

`team/artifact-read` 接受 Team 与 durable artifact id，从已完成 task result 中选择准确的非 private reference，并以有界 byte count 和 canonical base64 返回已验证 bytes。没有 provider、private、ambiguous、缺失或超限的 artifact 会以 typed SDK Team error 失败。

`team/metrics` 返回 active admission、Team event、channel event、policy denial、adapter failure、delivery claim、task assignment、retry 以及 audit projection repair／failure 的进程内计数器。只要 Team provider 支持，Team state response 还会携带持久 pending／settled human-action record 以及 provider 报告的 token／turn／cost usage。archive request 携带调用方观察到的 Team cursor，并将其绑定到 active human 的`close`proof；foreign、stale、active 或 unauthorized Team 会在 Hub 拒绝。[Team actor-proof control-plane proposal](../../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md) 负责通用的已认证重新开放。


`InitializeParams.maxTokens` 是可选的正的安全整数，用于限制每个 SDK 创建的 Team coordinator 请求的模型输出；省略时会应用所选适配器的确切模型默认值，否则提供方行为保持不变。客户端可以通过 `session.event` 与 `session.status`检查 Session 事实，但 Session 不再是产品运行目标。通知载荷类型依赖 `SessionEvent`（`clocky-session`），而 Team input parser 依赖 `ContentBlock`（`clocky-llm`）。`serverInfo.name` 的协议值固定为 `clocky-sdk-runtime`。

## 已认证 human 写操作

`team/resume`、`team/member-*`、`team/channel-open`、`team/channel-post`、`team/channel-close`、goal update/transition、task create/update/cancel/delete/review 以及 terminal archive 在线路上仍不携带 actor。`initialize`认证连接后，组合了`teamHumanActors`的运行时会派生所属的 active human，并在 Hub admission 前绑定每个完整 parsed payload 及其 cursor 或 revision。缺少该 binder 时，这些方法以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`失败。active human 必须拥有该 operation 的 immutable grant。

## 模型体验

无，因为此包定义面向客户端的协议格式；模型可见接口属于组合在对外服务入口 [`clocky-sdk-jsonrpc-server`](../server/README.zh.md) 后方的运行时插件。

#### KV Cache 影响

无；此包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无协议版本协商**——Team lifecycle 和 graph operation 的行为版本由选定 Hub/adapter 固定；握手只携带 `serverInfo.version`（`0.0.1`，客户端不校验），预发布运行时不承诺兼容。
- **没有 fork seed 或 Team binding**——第一版 lifecycle wire 只支持 fresh/resume，既不创建 AgentRuntime provider，也不记录 Team journal binding。
- **remote placement 保持内部化**——`activation/*`是 AgentRuntime SDK contract，而非产品 Team 管理 API。
- **没有 detached run control**——server-owned 的 `team/wait-final`与`team/cancel`仍是狭窄的 TeamRun 操作。
- **server→client 请求是未使用的功能**——传输层支持，但服务器从不发送；Python SDK 的应答接口为未来审批流程预留。

### 单任务取消

Task cancellation 接收 Team/task id、`expectedRevision`和可选 `reason`。响应保留 `TeamTaskSnapshot.cancellation`；assigned 或 running phase 表示 owner 终止仍在等待，并非取消已经完成。Task deletion 不接收取消原因。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
