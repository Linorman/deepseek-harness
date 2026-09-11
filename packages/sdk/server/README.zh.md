# @clocky/clocky-sdk-jsonrpc-server

[English](README.md) | 中文

`jsonrpc` 插件通过 stdio 提供以换行符分隔的 JSON-RPC，使进程外 SDK 客户端能够创建和控制其持有的本地产品 Team。[`HarnessSdkJsonRpcServer`](src/server.ts) 负责协议方法和通知；传输与具名协议类型位于 [`clocky-sdk-protocol`](../protocol/README.zh.md)，与客户端 SDK 共享；[`jsonrpc-demo`](../../examples/jsonrpc-demo/README.zh.md) 提供外围的 `cordis.yml` 应用。

## 组装

`inject: ['agents', 'teamRuns', 'productPrincipals']`。`initialize`会在后续任何 method dispatch 前认证并保留一个 connection-scoped product-principal lease。`team/create`将默认 human/coordinator/worker topology、direct v3 ingress 与 final-result lifecycle 委托给 `ctx.teamRuns`；它绝不创建独立的产品 Session。请求路由的适配器必须由外围组合预先注册；未拥有的提供方会使初始化失败。fresh remote activation 还要求 `ctx.sessionPersistence`，这样成对的 Team/Participant Session header 会在 publication 前持久化。其他能力由外围 `cordis.yml` 提供。

## 配置

`JsonRpcConfig.input`、`output` 和 `exit` 是仅供运行时使用的传输钩子；生产环境使用进程 stdio 和 `process.exit`。

## stdout 即协议

Stdout 只承载 JSON-RPC 帧。部署不得组合 stdout logger；诊断应写入 stderr。

## 关闭与退出语义

插件响应 `shutdown`，刷新响应并 dispose（资源释放）根上下文，使 SDK 持有的 agent、订阅和持久化达到完全停稳，然后以代码 0 退出。EOF 和信号退出由 app bin 处理，后者也会 dispose 根上下文。仅卸载此插件会停止服务，但不会退出进程。

## 协议说明

`initialize` 是运行时就绪边界：服务器由 Loader 组合挂载时，会等待当前插件树完成所有加载任务后再响应，因此首个 Team 能够看到 MCP 初始工具发现等异步同级能力。没有 Loader 的手工组装上下文仍可立即使用。`initialize.serverInfo.name` 的协议稳定值为 `clocky-sdk-runtime`。可选的正整数 `initialize.maxTokens` 会成为每个 SDK 创建的 coordinator 请求输出上限；非法值会使初始化失败，省略时则不发送 SDK 上限，并应用所选适配器或提供方路由的默认值。`team/create`创建默认 Team、接纳初始 direct v3 human content，并返回 Team、coordinator transcript 与初始 Envelope id。`team/wait-final`只在 coordinator `team_final` Envelope 获得 human receipt 且本地 topology 结算后返回；`team/cancel`只终结性地释放当前进程仍持有的 Team。`team/archive`会通过已认证连接 human 的`close`proof 直接到达 Hub，可作用于 detached 或 restarted 的终态 Team。`team/resume`会将必需的 observed cursor 绑定到 active human 的`activate`proof，执行 provider preflight，并在 coordinator publication 中保留该 authorization。成员变更、channel open/post/close、goal update/transition、task create/update/cancel/delete/review 与 archive 在线路上仍不携带 actor，并要求已认证连接的`teamHumanActors` binder；缺少 binder 时以同一代码失败。Team 或 participant id 只能选择持久状态，不能认证调用方。list、get、audit、metrics 与有界的 member/channel/task read 和 watch 仍可用。服务器将每个持久 Session 事实作为 `session.event` 流式发出，并将整个 agent 生命周期的每次状态转换作为 `session.status` 发出；Session 是 transcript source，不是产品运行目标。持久化根目录和 persona 由 `cordis.yml` 提供。

`activation/open` 会保留完整的 Team/Participant/Session/epoch target，发出 `starting`，只在精确 Agent 已发布并报告 `idle` 或 `running` 后返回。fresh 创建会在 publication 前 materialize 成对的 Session header；resume 要求已存 header 完全匹配。一个 resident epoch 只拥有一个 Session 和一个 Team participant。`activation/link-enroll` 随后只接受同一 live target 和带 provider 的匹配持久 binding。相同 enrollment 幂等；变化或第二个 enrollment 会拒绝。server 只保留 credential fingerprint，注册 activation-local WebSocket provider，并为该 Agent 启动固定 delivery。retry、status、interrupt 和 dispose 请求都会重复整个 target；把同一 id 改为另一个 target 会被拒绝。`activation.status` 携带完整 state 和递增的 `statusSequence`；它只由该精确 Agent 的 lifecycle 派生，绝不从无关 `session.status` 推断。interrupt 会保留已排队的 inbox 工作。dispose 会先关闭固定 delivery 并移除其 provider，再发出 `stopping`，等待该 Agent handle 释放，发出终态 `offline`，不会退出 SDK 进程。这些方法是 `clocky-agent-runtime-sdk` 的内部 remote-placement contract。

`team/artifact-read` 是只读的 SDK artifact 路径。它从 completed task result 中选择非 private reference，验证命名 provider 的 bytes，应用与 Host 路径相同的有界 read limit，并返回 canonical base64。它绝不会把 caller 提供的 URI 当作 authority。

## 已认证 human 写操作

初始化后的`team/resume`、`team/member-*`、`team/channel-open`、`team/channel-post`、`team/channel-close`、goal update/transition、task create/update/cancel/delete/review 和 archive 不接收 actor、principal、proof 或 reviewer 字段。server 只会在保留的 credential lease 存活期间派生 connection principal，并要求组合`teamHumanActors` binder；缺少 binder 时以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`失败。它会在 Hub admission 前绑定完整 parsed payload 及其 cursor 或 revision；resume 会将`{ teamId, expectedCursor }`绑定到`activate`，goal 会将完整 input 绑定到`goal-mutate`，task review 从 proof 派生 reviewer，archive 会将同一 cursor fence 绑定到`close`。active human 必须拥有请求 operation 的 immutable grant。SDK 部署必须提供该 binder，以及能把 bootstrap credential 交给 SDK client 的 credential provider；本包不创建 credential carrier。

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
