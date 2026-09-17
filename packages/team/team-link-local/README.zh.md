# @clocky/clocky-team-link-local

[English](README.md) | 中文

`@clocky/clocky-team-link-local`为 `ctx.teamLinks` 注册 `local` 提供方。它为精确的持久 activation binding 暴露一个本地 `TeamLink`，并将 Team authority 委托给 `ctx.teams`；它不导入 Agent client 或 transport protocol。

`onInvitation()` 与 Envelope subscription 使用同一 channel discovery/watch 周期，只重放绑定 participant 的 pending invitation。Pending channel 会继续被观察，直到 acknowledgement 或 terminal admission。`acknowledgeChannelInvitation()` 携带准确 fingerprint、revision、retry key 和 Link 私有 activation proof；notification 或 registry availability 都不表示已同意。

## 提供方约定

连接时，提供方从 `ctx.teams` 读取 activation，要求其 activation id、Team、Participant、Session 和 AgentRuntime-provider 字段均与请求相等，并且只接受当前为 `idle` 或 `running` 的 status。residency status 不是 Link identity，因此连接期间 idle-to-running update 仍然有效。返回的 Link 会冻结请求 binding。提供方卸载会阻止新连接，但不会撤销已返回的 Link。

返回的 Link 还会持有从已验证的当前 binding 签发的私有、可撤销 `TeamActorProof` lease。提供方卸载会阻止新连接并关闭 issuer 的新 lease，但不会撤销已返回的 Link；Link close 会撤销自己的 lease。

其公开 binding 是已验证的当前 binding，而不是可变的 caller object 或 request 的瞬态 residency status。

`post({ expectedCursor, idempotencyKey, draft })`从绑定的 Participant 导出 `senderId`、activation id 和 Session。非空的 sender-scoped key 标识可重试 post，并原样进入持久 Team Hub。`claim(channelId, envelopeId)`会携带其私有 lease 中的 proof 以及仅这两个 identity；在 Team/channel serializer 内，Hub 会解析并重新校验 binding，再派生 Team、activation、Session、recipient 和 delivery intent。`claimTaskAttemptStart()`会携带该 proof，以及只含 task、attempt、assignment-revision、channel 和 Envelope 的 identity；Hub 会在校验 assignment delivery 前派生 Team、participant、activation 和 Session。`acknowledge(channelId, envelopeId, expectedCursor)`只携带这些 receipt-selection field 与私有 proof，因此 Hub 会重新校验 binding 并派生 recipient，而不会接受 Link 提供的 recipient、activation id 或 Session。channel operation 都会先确认 channel 属于绑定的 Team；heartbeat 与 settlement 不含 channel target，因此 Link 会检查自身 lifecycle，再向`ctx.teams`传递其私有 proof。普通 `post`保留 binding-derived request form。`resolveTaskReview()`会携带同一条私有 activation proof 和仅含 task/revision/decision 的字段，因此没有 caller 提供 Team 或 reviewer identity。

`postDirectFinal()`只传递该私有 proof 以及 channel、retry key 和 text，因此 final sender、activation 或 Session 值不会跨越 Link API。

首个 `onNotify()` subscriber 会在 pending-delivery recovery 前启动本地 Team 和 channel cursor watch。Link 会读取每个附加 channel 的 manifest，只 watch 包含其绑定 recipient 的 channel；它使用 `pageSize`通过 `listChannelPendingDeliveries()`枚举这些 channel，并会在读取下一个 page item 前等待每个 listener handoff。已关闭的 channel 只会结束其本地 watcher。通知是 at-least-once wake-up，因此允许重复；consumer 在投递前声明。listener 的 throw 和 rejection 会被记录，但不会中断其他 listener；只有失败的 subscriber 与 Envelope 会在 `notificationRetryDelayMs`后 retry，但 Hub 对失效投递给出的终态拒绝会取消 retry。首个 `onInterrupt()` subscriber 会独立 watch Team journal，按其精确 activation 和 Session 列出 pending command，并为每个 command 保留一个 Link-local delivery id，直至确认。`acknowledgeInterrupt()`会导出精确 binding，并拒绝未知或不匹配的 delivery id。移除最后一个 subscriber 会取消本地 recovery、watch 和延迟 retry；之后的 subscriber 会启动新的 recovery cycle。失败的 replay/watch 会 reject `done`、后续操作和 `close()`。

`providerName`默认为 `local`；`pageSize`默认为 `128`；`notificationRetryDelayMs`默认为 `100`；`disposalTimeoutMs`默认为 `5000`。`pageSize`不得超过已挂载 Team provider 的 pending-delivery page 限制。Link close 会取消其本地 wait 和延迟 retry、停止通知接纳，并在 `disposalTimeoutMs` 内等待已接收的 replay 和 notification 工作。

首个 pending-delivery scan 会在 provider 提供时使用 channel 的 durable `replayWatermark`。这样可以跳过已经确认的 prefix，同时保留所有仍 pending 的 Envelope，继续通过 claim 与 receipt 完成 recovery。 重复或回退的 Team 或 channel watch cursor 会让 Link 关闭，而不会重复尝试同一 continuation。

`heartbeatTaskAttempt()`会携带其私有 lease proof 以及仅有的`taskId`、`attemptId`和`expectedRevision`；`settleTaskAttempt()`额外带有 Link 允许的 `released`、`failed`或`completed` outcome；`integrateTask()`使用同一条 task/attempt fence 调用 Team workspace registry，由 durable integration task 派生 source artifact 与 target fact。Hub 解析 proof 以选择 Team queue，在持有该 lock 时重新校验 binding，并在续期、integration 或结算前派生 Team、Participant、activation、Session 与精确 lease owner。普通 `post()`保留独立的 binding-derived contract；`resolveTaskReview()`使用同一条 proof-only path，这些 operation 都不授予 Team-closure authority。

## 模型体验

### 本地 Team Link 提供方

#### 模型所见

`ctx.teamLinks`不注册提示词片段、工具、模型输入或模型输出。在本地组合中，`clocky-team-agent-client`消费这些通知，并决定已声明的 direct Envelope 是否以及如何进入 Agent。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

该提供方不拥有模型请求前缀。

## 已知限制与延后工作

- **没有内置 Agent delivery**——该 provider 从不导入 Agent 或 Session 代码；`clocky-team-agent-client`会单独声明、启动、持久接纳并确认本地 direct 和 task-assignment Envelope。
- **没有远端 transport**——WebSocket authentication、reconnect replay、backpressure protocol frame 和跨进程 Link provider 仍是独立工作。

### 单任务取消

Task cancellation subscriber 观察 Team journal，只重投选中当前 binding attempt 的 intent。Acknowledgement 在提交 owner 的 cancelled outcome 前重新验证 durable intent 与 binding。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
