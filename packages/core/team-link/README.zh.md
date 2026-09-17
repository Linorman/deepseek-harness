# @clocky/clocky-team-link

[English](README.md) | 中文

`@clocky/clocky-team-link`定义了具名的 `ctx.teamLinks`注册表，用于绑定 activation 的 Team channel 和 soft-interrupt client。它接收由 Team 和 AgentRuntime 所有权选定的持久 `ActivationBindingSnapshot`，但不导入 Team Hub 实现、Agent client、transport 或 model loop。[`clocky-team-link-local`](../../team/team-link-local/README.zh.md)和 [`clocky-team-link-websocket`](../../team/team-link-websocket/README.zh.md)提供本地和远程实现。

Frame v7 携带 `invitation` notification 与 `invitation-ack` operation。`onInvitation()` 接收准确 manifest 和绑定 participant 的 invitation；endpoint 通过 `acknowledgeChannelInvitation()` 显式确认协议支持。Invitation confirmation 与 Envelope receipt、task cancellation acknowledgement 分别处理。Transport Consumer 保留既有 claim 与 Session-flush 顺序。


`getChannel(channelId)` 使用当前 activation proof，只读取成员频道的 manifest、phase 与 cursor，包括 admission 尚为 pending 时。Frame v7 将其映射为 `channel-get`，不返回 message、summary 或 adapter state。

Provider 可通过 `TeamLinkConnectionError.retryable` 分类连接失败。false 表示需要重新配置 provider 或更换 binding，不能重复相同连接。Registry 的 `team-link/provider-added` 通知使暂停的 consumer 在 provider 替换后重试；观察者异常不能否决注册。未知失败仍按 consumer 的正常重连策略处理。

## 提供方约定

`TeamLinkProvider`以一个非空名称注册，并接收该名称、一个 activation／Session／AgentRuntime-provider snapshot，以及可选的连接取消信号。activation id、Team、Participant、Session 和 placement provider 标识该连接；residency status 可变，provider 会在发布前重新校验。只有在发布 provider-owned connection 后，其 `connect()` 调用才返回 `TeamLink`。返回的 Link 保留请求的 provider 名称和 binding identity；`TeamLinkRegistry.connect()`验证两者，并在拒绝前关闭不匹配的 Link。移除注册会阻止后续连接，但不会撤销已经返回给调用方的 Link。

enrollment provider 通过 `registerEnrollmentProvider()` 单独注册。受信任的 activation owner 只能在精确的持久 binding 已存在后调用 `reserveEnrollment({ provider, binding })`。provider 返回 endpoint、Link-provider 名称、不透明 credential 与 `revoke()`；credential 不得进入持久状态或 diagnostic。注册表会拒绝无效 issuer 结果并尝试撤销。enrollment-provider add/remove 事件让当前 owner 可在同进程 issuer HMR 后续签。

`post({ expectedCursor, idempotencyKey, draft })`不接受 sender 字段：Link 从其 binding 导出已认证 participant、activation 和 Session。`postDirectFinal({ channelId, idempotencyKey, text })`同样在 Team provider 的 channel lock 内导出 peer 和当前 cursor，因此远程调用方不能与 channel read 竞争。sender-scoped 不透明 key 标识一次可重试 post；相同 key 和 draft 会在 cursor comparison 前返回原始 accepted Envelope，而不同 draft 会被拒绝。`claim(channelId, envelopeId)`只包含这两个 client-provided identity；本地 Link 或已认证的 WebSocket listener 会提供其私有 activation proof。在 Team/channel serializer 内，Hub 会解析并重新校验 binding，再派生 Team、recipient 和 delivery intent。`acknowledge(channelId, envelopeId, expectedCursor)`只包含 receipt-selection field；trusted Link 侧会提供其私有 activation proof，因此 Hub 会派生当前 recipient，不接受 client-selected participant、activation 或 Session。`claimTaskAttemptStart()`只包含 task、attempt、assignment-revision、channel 和 Envelope identity；同一 trusted Link 侧会提供私有 proof，Hub 会在校验 assignment delivery 前派生 Team、participant、activation 和 Session。`integrateTask()`只包含 task、attempt、expected revision 和可选 verification；Link proof 提供当前 owner，Team workspace registry 则从 durable task 派生 source artifact manifest、provider、target 和 mode。重复同一个当前成功声明会返回 running task，而不会再次发生 task transition。下面的 heartbeat、integration 和 settlement contract 使用同一条私有 proof lease。提供方将这些操作映射到权威 Team provider 或远端协议；本包拥有严格的远程 frame，但不拥有 connection lifecycle 或 storage。


`onNotify()`订阅该 binding 可见的已接收 Envelope wake-up。`onInterrupt()`只接收 Team、participant、activation、Session 和 provider 都与 binding 相等的 pending soft-interrupt command；listener 只有在发出本地取消后才调用 `acknowledgeInterrupt(deliveryId, interruptId)`。连接还可以保留 `onTerminate` callback，以处理 v7 Hub request，停止端点拥有的 Link admission 和当前 model work。provider 会同时校验 live delivery correlation 和持久 command identity，因此 listener 失败会使 command 保持 pending 并等待 replay。Link 实现会包含 listener 的 throw 和 rejection，避免一个 subscriber 中断后续通知。`done`会在有序 terminal state 时 resolve，并在 provider-owned lifecycle failure 时 reject，使 consumer 可以重新连接仍为 current 的 binding。来自 `connect()`、`post()`、`postDirectFinal()`、`claim()`、`claimTaskAttemptStart()`、`settleTaskAttempt()`、`acknowledge()`、`acknowledgeInterrupt()`和 `close()`的连接及生命周期错误仍对调用方可见。`close()`停止通知接纳，并使提供方到达其 Link-local terminal state。本包拥有严格的 v7 远程 frame parser；client 和 Hub provider 拥有 WebSocket lifecycle 和 capability validation。

`heartbeatTaskAttempt()`只接受`taskId`、`attemptId`和`expectedRevision`；`settleTaskAttempt()`接受这些 identity，再加上仅由 Link 允许的 `released`、`failed`或`completed` outcome；`integrateTask()`接受 task/attempt fence 和可选 verification。Link 私有持有 activation-proof lease 中的 proof，并且只将它提供给 runtime request。proof 选择 Team 后，Hub 会持有 Team lock、重新校验精确 binding，并在续期、integration 或结算 lease 前派生 Team、Participant、activation、Session 和 task-attempt owner。它们与 `postDirectFinal()`、`claim()`、`acknowledge()`和`claimTaskAttemptStart()`一起构成 proof-only operation。普通 `post()`保留单独类型化的 binding-derived request。`resolveTaskReview()`同样携带私有 activation proof 和仅含 JSON 的 task/revision/decision 字段，因此没有 Link caller 可以选择 Team 或 reviewer identity；这些 operation 都不授予 Team-closure authority。

## 模型体验

### Team Link 注册表

#### 模型所见

`ctx.teamLinks`不注册提示词片段、工具、模型输入或模型输出。Link provider 及其 consumer 拥有投影到 Agent 的任何 Team Envelope。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有模型请求前缀。

## 已知限制与延后工作

- **单个 authoritative Hub**——带 framing 的 WebSocket provider 会重新连接到一个 Hub；multi-Hub consensus 以及完整 Hub 进程重启后的 credential 重签发不属于本包。
- **没有面向模型的 channel API**——注册表本身不会将通知投影到 Agent，也不向模型公开 Team 操作；本地 Agent client 会单独消费 Link，用于 direct 和 task-assignment inbox 投递。

### 单任务取消

`onTaskCancellation()`为已绑定 activation 重投精确 Task intent。`acknowledgeTaskCancellation()`只在工作及 allocation 清理完成后结束选定 attempt。Link frame version 7 将这些通知和确认与整个 Link 的终止分开传输。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
