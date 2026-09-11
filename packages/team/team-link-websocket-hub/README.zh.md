# @clocky/clocky-team-link-websocket-hub

[English](README.md) | 中文

`@clocky/clocky-team-link-websocket-hub`在 `ctx.webServer`上挂载一个精确的 upgrade route，供远端 Team Link client 使用。它是 Hub listener，不是 `ctx.teamLinks` provider：远端 provider 连接此 route，并向其 Agent client 暴露与本地 `TeamLink`相同的 contract。

V6 socket 只重放其绑定 participant 尚未确认的 channel invitation，其中包含不可变 manifest 与 fingerprint。Invitation revision 共用 outstanding-delivery 上限。`invitation-ack` 在 JSON 外添加 socket 私有 activation proof；terminal update 会清除 pending notification state。Pending channel watch 会持续到 acknowledgement 或 terminal admission；普通 Envelope replay 只在 active 后开始。

## 配置与认证

credential-authenticated `attach`重新验证其持久 binding 后，listener 会生成一条私有运行时 `TeamActorProof` lease。proof 永远不会进入 frame、log 或 diagnostic，并会在该 socket 结束时撤销。

静态 `bindings` entry 将一个 `capabilityEnv`绑定到一个不可变的 `(activationId, teamId, participantId, sessionId, provider)` tuple。listener 在加载时读取每个环境变量，只保留其 SHA-256 digest，并拒绝空、重复或缺失 entry。动态 enrollment 使用配置的公开 `endpoint` 与 `enrollmentProviderName`：在暴露 issuer 或 upgrade route 前，listener 会恢复按 provider 命名的 `storageLog` ledger，其中只保留 binding、SHA-256 digest、单调 generation 以及签发／撤销时间。`reserve()`只接受当前精确且为 `idle` 或 `running` 的持久 binding，生成 32-byte base64url credential，并返回调用方拥有的 revoker。为 active binding reserve 会轮换 generation、使旧 credential 失效并关闭其 attached socket；revoker 只能影响其准确的当前 generation。client 必须在 `attach`中发送相同 tuple；listener 用 `timingSafeEqual`比较提供的 digest，随后重新读取 `ctx.teams.getActivation()` 并要求当前持久 binding 匹配。一个不可变 binding 只能拥有一个 live socket，且 listener 只在该 socket 关闭时释放它。listener 会在每个 pending-delivery page 和每个 `notify`前重新检查持久 binding；offline 或被替换的 binding 会关闭，且不会写入 receipt。capability plaintext 永远不会进入 diagnostic、wire response、保留的 configuration object 或持久 ledger。

`path`默认是 `/team-link`。`pageSize`限制每次 pending-delivery query。`maxConnections`和 `handshakeTimeoutMs`会限制认证前的已接受 socket；attached client 必须在 deadline 前 subscribe。`maxFrameBytes`、`maxPendingRequests`、`maxQueuedBytes`、`maxOutstandingDeliveries`、`requestWindowMs`、`maxRequestsPerWindow`和 `closeTimeoutMs`限制不可信 input、replay、rate、outbound buffer 与 shutdown。subscription 后，`heartbeatIntervalMs`和更短的 `heartbeatTimeoutMs`会关闭未响应 pong 的半开 socket。`maxOutstandingDeliveries`是 Envelope delivery、未确认 interrupt command 与保留的幂等 interrupt acknowledgement 共用的总上限；新的 live delivery 会先逐出最早的 acknowledgement cache，仍超限才关闭 socket。`retryableNackDelayMs`默认值为 `100`，延后可重试 nack 的 replay；`backpressureRetryAfterMs`默认值为 `100`，随 backpressure rejection 返回。queued-byte 或保留的 live delivery 超限时，socket 会关闭且不会记录 receipt。

该 route 只接受 [`@clocky/clocky-team-link`](../../core/team-link/README.zh.md) 定义的 version 7 frame；更早 frame 会作为 invalid 关闭。`attach`返回 `attached`。`subscribe`返回 `{ subscribed: true }`后，重新检查精确 target 的 soft interrupt，并将 Envelope delivery 作为 `notify`重放。第一条 pending-delivery page 从 durable `ChannelSnapshot.replayWatermark`开始；后续 page 使用其返回的 cursor。Team journal change 会将 interrupt replay 标记为 dirty；一个串行 drain 会重复 durable query，直到观察到每一条 wake。replay 会加载每个 Team channel manifest，并跳过 roster 中不含已绑定 Participant 的 channel。`post`、`direct-final`、`claim`、`task-start`、`task-settle`、`task-heartbeat`、`receipt`和 `interrupt-ack`只接受 caller-controlled operation field。`claim`只携带 channel 和 Envelope identity；`task-start`只携带 task、attempt、assignment-revision、channel 和 Envelope identity；`receipt`只携带 channel、Envelope 和 observed-cursor identity；`task-heartbeat`只携带 task、attempt 和已观测 revision；`task-settle`额外携带 typed outcome。对于 `direct-final`、`claim`、`task-start`、`receipt`、`task-heartbeat`和`task-settle`，listener 会在 frame 外传递 attached socket 私有 lease 中的 proof。在 Team/channel queue 内，Hub 会解析并重新校验该 binding，为 receipt 派生当前 recipient、为 claim 派生 recipient 与 delivery intent，并为 task-start admission 派生 Team、Participant、activation 和 Session。对于 heartbeat 和 settlement，它会从 proof 选择 Team，在 Team lock 内重新校验 binding，并在 mutation 前派生精确的当前 task-attempt owner。普通 `post`保留各自类型化的 request path。`task-review`只携带 task/revision/decision 字段，listener 会提供 attached socket 的私有 activation proof；receipt admission 是 proof-only，两条路径都不授予 Team-closure authority。

`post`要求在 cursor 和 draft 之外提供非空、不透明的 `idempotencyKey`。Hub 会将 sender/key pair 与已接受 Envelope 一起持久化，在判断过期 cursor 前为匹配的 retry 返回原 Envelope，并拒绝用同一 key 复用语义不同的 draft。`direct-final`只需要 channel id、text 和 key；Hub 在 channel lock 内导出 peer 与当前 cursor。只有 `receipt`会推进持久 recipient admission，attached socket 的 proof 会在 Hub 检查 pending delivery 或 cursor 前派生该 recipient。`nack`绝不写入 receipt 或 cursor：可 retry 的 nack 会等待 `retryableNackDelayMs`、重新检查持久 binding，然后重新声明并发出 pending delivery；socket 关闭时会清除其 timer。重复、过期或不可 retry 的 nack 保持持久 pending state 不变。若已接受的 `post`的 `causationId`标识一个 outstanding notification，只有 Hub 提交该 reply 后才会释放对应 socket-local delivery slot。
重复或回退的 Team 或 channel watch cursor 会关闭 Link，而不会重复 replay 同一 continuation。

`direct-final`会携带该私有 proof 以及 channel id、text 和 key，因此 Hub 会在 channel lock 内导出 sender、peer 和当前 cursor，而不会接受任何调用方身份。

`interrupt` frame 携带一个 Hub-committed soft command 和 Link-issued `deliveryId`。client 只能发送 `request { op: 'interrupt-ack', input: { deliveryId, interruptId } }`；不能为任何 peer 请求 interrupt。listener 要求保留的 delivery、interrupt id 和每个 target binding field 都匹配，然后通过 `ctx.teams`记录 exact-target acknowledgement。重复一个仍保留的 acknowledgement 会返回同一持久 interrupt。listener 或 connection failure 会让 command 保持未确认状态，以便 reconnect 后精确 target replay。Credential rotation、credential revocation 和未来的 provider-owned retirement 会先发送带结构化 reason 的 v7 `cancel` frame；注册了 `onTerminate` 的 endpoint 可以停止 Link-owned admission 和当前 model work，再返回 `cancelled { accepted: true }`。Hub 在收到 response 或有界 timeout 到期后关闭 transport，拥有该 activation 的 AgentRuntime provider 仍负责证明 process termination。

host process 或 reverse proxy 负责 TLS termination。静态环境 credential 通过 configuration reload 轮换；动态 credential 则通过为同一 binding 再次 `reserve()`轮换。

已 attach 的 socket 会私有持有其 `TeamActorProof` lease。严格的 `receipt` frame 只包含`channelId`、`envelopeId`和`expectedCursor`；`task-heartbeat`只包含`taskId`、`attemptId`和`expectedRevision`；`task-settle`额外带有 typed outcome。listener 在每个此类 frame 外加入 proof。Hub 会在 Team/channel queue 内重新校验 binding 来派生 receipt recipient，并用它选择 Team queue，在续期或结算前派生精确 task-attempt owner。普通 `post`保留各自类型化的 contract。`task-review` frame 只携带 task/revision/decision 字段，并在 frame 外获得私有 proof；Team closure 不属于该 transport authority。

`task-integrate`只携带 integration task id、attempt id、expected revision 和可选 verification。listener 提供 attached socket 的私有 proof；Hub 从 durable integration task 派生 source task、source attempt artifact、workspace provider、target 和 mode，然后将 provider result settlement 到该 attempt。Provider 可以返回 proposal、integrated target version 或 conflict path；source allocation 不必继续 live。

## 模型体验

### 远端 Team Link listener

#### 模型所见

此 listener 不会向 `ctx.webServer` 注册 prompt section、tool、model input 或 model output。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

此 listener 不拥有 model request prefix。

## 已知限制与延后工作

- **单一 authoritative Hub**——此 listener 假定每个远端 client 都访问同一个 `ctx.teams` authority；Hub federation 和 consensus 不在其 contract 内。
- **远端 task outcome 需要 child 组合**——SDK child 可通过固定 delivery consumer 接纳 direct 和 task-assignment input，并在其 runtime 挂载 borrowed-Link `tool-team` report/final consumer 后使用它们；此 listener 只负责 transport 认证，不拥有 model tool。
- **Transport termination**——TLS certificate、reverse-proxy policy、network ACL 与 environment-variable rotation 都是 deployment-owned control。
- **没有 hard remote process cancellation**——listener 可以请求 cooperative endpoint termination 并限制 acknowledgement wait，但从不强制终止 Agent 或 process；拥有该 activation 的 AgentRuntime provider 必须证明 termination，否则 Team 会保持 stalled。

### 单任务取消

Frame version 7 将 pending Task cancellation 重投给 capability 绑定的精确 activation。这些通知共用 `maxOutstandingDeliveries`；acknowledgement 重新检查选定 attempt，并使用保留的 activation proof。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
