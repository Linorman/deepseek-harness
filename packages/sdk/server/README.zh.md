# @clocky/clocky-sdk-jsonrpc-server

`simulation/raw-archive` 使用当前鉴权调用委托 Product 读取所有者；Product 在 IO 前与发布前检查整记录正文权限。原始保留不请求执行或恢复。

`simulation/runs-run-control` 将严格鉴权的停止更新交给 Product administration，不从输入推导用户权限，也不启动推理。传输保留显式 null 解除。

[English](README.md) | 中文

World preflight／create／prepare／export 分发复用原产品 administration owner 和当前已认证 call 的存续期。每种方法在解析完整严格输入后才解析可选服务。读取和预检不分配 writer；创建／准备保持暂停，原 command 重试保留已接受定义，冷恢复需要显式请求。公开 World 响应不包含私有编译执行配置或 Native snapshot。

`simulation/requests-list` 与 `simulation/requests-retry` 先解析精确 actor-free 选择器，再解析当前 administration。元数据发现公开原 receipt，不公开保留输入，也不获取原生执行 owner。显式重试仅执行已受理的后端保留语义，保持终态结果不变，并复核原操作准入。冷的已受理审核或 outbox 授权重试仍要求显式恢复 owner。

`simulation/runs-preflight` 先解析 actor-free 草稿，再解析当前已认证 administration。读取不分配运行或持久命令，不启动推理；安全就绪问题与认证、未部署服务及意外内部失败分开。创建会在记录原命令前独立复核就绪状态。

原维护结果只转发所属管线显式 typed 的安全来源诊断。主要失败与未确认清理保持独立；普通私有异常继续使用既有删节路径。

`simulation/operation-retry` 在严格解析输入后使用当前认证的行政 owner。原受理授权独立于传输等待者存续，但排队／原生准入复查当前授权。该方法及原结果查询都不发布目标或启动推理。冷原 receipt 仍可读取；冷新授权需要显式恢复 owner。发布只通过显式调度继续。

`simulation/runs-statuses` 在解析服务前校验有界精确批次，优先使用已安装行政服务补充元数据，否则使用原生产品读取器。每个运行在当前凭据 lease 下独立观察，完整批次保留授权及字节限制。行政元数据不授予控制或正文权限，也不取得冷执行 owner。

`simulation/task-reviews-list` 与 `simulation/task-reviews-resolve` 通过已安装行政 owner 和当前认证 lease 分发。模板启用只授予该场景的运行所有者审核权限；普通 Team 人工修改仍独立拒绝。冷原结果只读命令日志；冷审核修改要求显式恢复。

`simulation/sources-inspect` 解析当前产品来源读取器并传递已认证调用。该所有者分别核对冻结选择／正文策略以及来源 IO 前后的当前 Team 人工读取资格；SDK 不回退到未授权原始频道读取。

`simulation/records-list` 路由到已认证的目录读取所有者。精确原始序号检查与元数据复用只读原生历史，不打开执行所有者，也不因来源引用授予访问权。独立的整运行历史正文授权控制原始 JSON 文本，并在 provider IO 前后核对。

已认证的 `simulation/*` 分发解析当前挂载的产品目录或行政服务，将连接 lease 传给每次产品操作，并在凭据替换或退役后拒绝后到响应。可选服务缺失返回 `SIMULATION_PRODUCT_UNAVAILABLE`；已知产品失败保留公开 code，未分类诊断则删节。元数据与原结果读取不打开原生 writer。已受理创建、准备和维护属于行政服务，SDK 等待者断开不会取消它；停止运行时进程通过 Cordis teardown 排空该 owner。调度使用原有序意图，检查点采集后保持暂停，恢复验证保留历史／当前后缀，不回滚也不推理。输入只指向一个允许的实体，归属由服务器派生，分开返回分配与消费事实。

`team/task-update` 将原命令身份、revision 和可编辑字段绑定到当前 human 权限。受理响应公开原 receipt 和移除私有产物的当前任务；已提交语义拒绝保留原失败的原生 code。`team/task-update-result` 在 provider 成功／失败前后校验 Team read guard，读取受理／拒绝元数据。规范父团队读取权限允许查询，不授予编辑权限。

`jsonrpc` 插件通过 stdio 提供以换行符分隔的 JSON-RPC，使进程外 SDK 客户端能够创建和控制其持有的本地产品 Team。[`HarnessSdkJsonRpcServer`](src/server.ts) 负责协议方法和通知；传输与具名协议类型位于 [`clocky-sdk-protocol`](../protocol/README.zh.md)，与客户端 SDK 共享；[`jsonrpc-demo`](../../examples/jsonrpc-demo/README.zh.md) 提供外围的 `cordis.yml` 应用。

`team/list` 使用当前主体的安全元数据与加密续页，不含 grant、goal budget 正文和扫描计数。选中 Team 管理读取在 IO 期间保留直接成员或规范父团队权限，并在发布前复查，包括失败读取。原始频道读取／等待私下解析归属。Selection 显示成员或父团队只读状态；缺失／私有 Team 使用 `SDK_TEAM_FORBIDDEN`。产物结果共用 Host 的私有引用投影。参见 [SDK reader 决策](../../../.agents/notes/implemented/architecture/2026-09-28-sdk-principal-team-readers.zh.md)。


`simulation/tasks-list` 与 `simulation/tasks-cancel` 在当前传输 credential 下分派给当前组装的行政 owner。取消要求精确原操作、revision、attempt 或显式无 lease 的 `null`；严格解析在查询 owner 前拒绝 actor 字段。持久回执与 `requests-get` 在响应丢失后保留原取消输入。部署缺失、权限拒绝与输入无效保持独立；该路由不授予普通 Team 修改权限。

## 组装

`inject: ['agents', 'teamRuns', 'productPrincipals']`。`initialize`会在后续任何 method dispatch 前认证并保留一个 connection-scoped product-principal lease。`team/create`将默认 human/coordinator/worker topology、direct v3 ingress 与 final-result lifecycle 委托给 `ctx.teamRuns`；它绝不创建独立的产品 Session。请求路由的适配器必须由外围组合预先注册；未拥有的提供方会使初始化失败。fresh remote activation 还要求 `ctx.sessionPersistence`，这样成对的 Team/Participant Session header 会在 publication 前持久化。其他能力由外围 `cordis.yml` 提供。

## 配置

`maxPendingNotificationFrames`（默认 4096）与 `maxPendingNotificationBytes`（默认 8388608）限制鉴权和输出排空期间的通知，包括当前帧和完整 UTF-8 JSON-RPC 编码。超限或未预期发布失败关闭传输、释放根运行时，并以代码 1 退出。`JsonRpcConfig.input`、`output` 和 `exit` 是仅供运行时使用的传输钩子；生产环境使用进程 stdio 和 `process.exit`。

## stdout 即协议

通知在写出前复查当前 Team 成员权限；Session 事实要求持久成员绑定或服务器持有的精确远程 Agent。重新初始化丢弃旧代际包。凭据／provider 退役停止空闲及待处理通知流；关闭时先移除退役监听器，再释放 lease。参见[通知归属](../../../.agents/notes/implemented/architecture/2026-09-29-sdk-principal-notification-ownership.zh.md)。

Stdout 只承载 JSON-RPC 帧。部署不得组合 stdout logger；诊断应写入 stderr。

## 关闭与退出语义

插件响应 `shutdown`，刷新响应并 dispose（资源释放）根上下文，使 SDK 持有的 agent、订阅和持久化达到完全停稳，然后以代码 0 退出。EOF 和信号退出由 app bin 处理，后者也会 dispose 根上下文。仅卸载此插件会停止服务，但不会退出进程。

## 协议说明

`initialize` 是运行时就绪边界：服务器由 Loader 组合挂载时，会等待当前插件树完成所有加载任务后再响应，因此首个 Team 能够看到 MCP 初始工具发现等异步同级能力。没有 Loader 的手工组装上下文仍可立即使用。`initialize.serverInfo.name` 的协议稳定值为 `clocky-sdk-runtime`。可选的正整数 `initialize.maxTokens` 会成为每个 SDK 创建的 coordinator 请求输出上限；非法值会使初始化失败，省略时则不发送 SDK 上限，并应用所选适配器或提供方路由的默认值。`team/create`创建默认 Team、接纳初始 direct v3 human content，并返回 Team、coordinator transcript 与初始 Envelope id。`team/wait-final`只在 coordinator `team_final` Envelope 获得 human receipt、本地 topology 结算且已受理通知完成发布后返回；`team/cancel`只终结性地释放当前进程仍持有的 Team。`team/archive`会通过已认证连接 human 的`close`proof 直接到达 Hub，可作用于 detached 或 restarted 的终态 Team。`team/resume`会将必需的 observed cursor 绑定到 active human 的`activate`proof，执行 provider preflight，并在 coordinator publication 中保留该 authorization。成员变更、channel open/post/close、goal update/transition、task create/update/cancel/delete/review 与 archive 在线路上仍不携带 actor，并要求已认证连接的`teamHumanActors` binder；缺少 binder 时以同一代码失败。Team 或 participant id 只能选择持久状态，不能认证调用方。list、get、audit 与有界 member/channel/task read 和 watch 要求当前主体读取权限；进程级 metrics 保留 Host 元数据语义。服务器将当前获准的 Session 事实作为 `session.event` 流式发出，并将其整个 agent 生命周期的状态转换作为 `session.status` 发出；Session 是 transcript source，不是产品运行目标。持久化根目录和 persona 由 `cordis.yml` 提供。

`activation/open` 会保留完整的 Team/Participant/Session/epoch target，发出 `starting`，只在精确 Agent 已发布并报告 `idle` 或 `running` 后返回。fresh 创建会在 publication 前 materialize 成对的 Session header；resume 要求已存 header 完全匹配。一个 resident epoch 只拥有一个 Session 和一个 Team participant。`activation/link-enroll` 随后只接受同一 live target 和带 provider 的匹配持久 binding。相同 enrollment 幂等；变化或第二个 enrollment 会拒绝。server 只保留 credential fingerprint，注册 activation-local WebSocket provider，并为该 Agent 启动固定 delivery。retry、status、interrupt 和 dispose 请求都会重复整个 target；把同一 id 改为另一个 target 会被拒绝。`activation.status` 携带完整 state 和递增的 `statusSequence`；它只由该精确 Agent 的 lifecycle 派生，绝不从无关 `session.status` 推断。interrupt 会保留已排队的 inbox 工作。dispose 会先关闭固定 delivery 并移除其 provider，再发出 `stopping`，等待该 Agent handle 释放，发出终态 `offline`，不会退出 SDK 进程。这些方法是 `clocky-agent-runtime-sdk` 的内部 remote-placement contract。

`team/artifact-read` 是只读的 SDK artifact 路径。它从 completed task result 中选择非 private reference，验证命名 provider 的 bytes，应用与 Host 路径相同的有界 read limit，并返回 canonical base64。它绝不会把 caller 提供的 URI 当作 authority。

## 已认证 human 写操作

初始化后的`team/resume`、`team/member-*`、`team/channel-open`、`team/channel-post`、`team/channel-close`、goal update/transition、task create/update/cancel/delete/review 和 archive 不接收 actor、principal、proof 或 reviewer 字段。server 只会在保留的 credential lease 存活期间派生 connection principal，并要求组合`teamHumanActors` binder；缺少 binder 时以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`失败。它会在 Hub admission 前绑定完整 parsed payload 及其 cursor 或 revision；resume 会将`{ teamId, expectedCursor }`绑定到`activate`，goal 会将完整 input 绑定到`goal-mutate`，task review 从 proof 派生 reviewer，archive 会将同一 cursor fence 绑定到`close`。active human 必须拥有请求 operation 的 immutable grant。SDK 部署必须提供该 binder，以及能把 bootstrap credential 交给 SDK client 的 credential provider；本包不创建 credential carrier。

## 私密备份导出

`simulation/backup-export` 委托给已认证的产品管理 owner。owner 独立检查私密记录披露授权，并且只导出已完成的不可变原件；传输身份不提供执行权限或 provider 凭证。 完整分支导出还要求祖先的当前披露授权，或针对该分支的显式 `includeProvenance: true` 授权；只有分支自身权限不能读取祖先字节。

## 模型体验

### Team human input

#### 模型看到的内容

对于每个已接受的 `team/create`，coordinator 会通过持久 direct v3 Team Envelope 和带 provenance 的 `user/message` 接收调用方提供的 text/image content。coordinator 的作用域提示词要求显式 `team_final` Envelope；此包不会在 `cordis.yml` 所组合的 Team stack 之外添加系统提示词文本或工具 schema。

#### Token 影响

依数据而定的用户消息 token 会进入保留的会话历史，并在后续轮次中重复发送，直至另一个包将其压缩（compaction）。JSON-RPC 帧、会话通知和服务器内部记录不会增加模型上下文 token。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **没有跨进程 Team recovery**：挂载的本地 Hub 已提供 list/get、quiescence、audit、metrics，以及有界 participant/channel/task read 和 watch；自动多主机 Hub 恢复仍不属于此服务器。
- **没有 detached run control**：`team/create`，以及服务器仍持有的 active TeamRun 的 `team/wait-final` 与 `team/cancel`，保持为当前 run 操作。terminal archive 与 resume 都通过 active human proof 到达 Hub。[Team actor-proof control-plane proposal](../../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md) 负责其余通用重新开放。
- **stdout 纯净性由部署保证**：外围配置仍可能加载 stdout logger 并破坏 JSON-RPC 通道；此插件不会检查或否决同级 logger。
- **服务器不挂载适配器**：外围组合必须在 `initialize` 之前注册每个提供方路由，使 SDK 传输与提供方选择保持解耦。
- **不挂载 AgentRuntime provider 或 Team binding**：该服务器拥有的是进程本地 activation record，不是 remote placement policy 或持久 Team authority。
- **不接受 fork activation seed**：未来协议版本必须先定义有界且经验证的 event transfer。

### 单任务取消

Task-cancel route 将可选 `reason`绑定到 authenticated human proof 的完整 payload。它返回 Hub Task snapshot，包括 pending cancellation 和精确 attempt 目标，不会关闭 Team。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).

实验分发在严格解析参数后，将 `simulation/world-branch`、`world-branch-read`、`world-causal` 和 `world-compare` 路由到同一已认证 Product administration owner。来源标识不可变 retention 原件；服务端不接收归档正文、Host 工厂或调用者选择的执行身份。分支创建和查询保持独立，检查不启动推理。
