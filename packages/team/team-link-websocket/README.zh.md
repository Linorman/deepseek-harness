# @clocky/clocky-team-link-websocket

[English](README.md) | 中文

`@clocky/clocky-team-link-websocket`在 `ctx.teamLinks` 上注册一个远程 provider。它连接权威 Team Link Hub 的 WebSocket，用不透明 capability 对一个不可变 activation binding 认证，并暴露普通 `TeamLink` API，而不导入 Hub、Agent client 或 Session store。

V6 invitation notification 共用有界 notification 容量，并按 channel 独立派发。准确 acknowledgement result 会移除保留项，terminal invitation update 也会清除它。其他 sender 的 null-audience Envelope 可进入 claim；Hub 验证的 manifest 与固定 recipient intent 仍是最终投递依据。因此 v4 广播可被接收，同时不会授予较晚成员历史 delivery。

远端明确的 `unauthorized` 拒绝、缺少 capability、无效配置、binding 不匹配、畸形 frame/result、意外或乱序协议帧属于不可重试的连接失败。传输超时和断线仍可重试。仅凭 remote request rejection 不判定永久失败，因为远端原因可能是暂时的准入状态。

## Provider 约定

`providerName`默认值为 `websocket`。`endpoint`是完整的 `ws:` 或 `wss:` Hub URL，不能包含 URL credential 或 fragment。`capabilityEnv`是必填的 POSIX 环境变量名。provider 仅在 `connect()`开始时读取该变量，仅在字面量 v7 `attach` frame 中发送其值，且从不记录或存储它。`connectTimeoutMs`默认值为 `5000`，限制 socket 打开、attach 和 subscribe；`responseTimeoutMs`默认值为 `30000`，限制每个 attach、subscribe 和 operation response。`maxFrameBytes`默认值为 `1048576`；`maxPendingRequests`和 `maxBufferedNotifications`均默认 `64`。后者会限制排队的 Envelope notification 以及每条保留到 acknowledgement 成功的 interrupt delivery。

`createCapabilityWebSocketTeamLinkProvider(config, capability)` 为一个动态 enrolled activation 创建同一种 provider。它把 credential 保留在返回 provider 的闭包中，而不是环境变量，因此并发 SDK activation 不能读取彼此的 credential。endpoint 与限额来自 `CapabilityProviderConfig`；调用方只在 activation-local child context 注册返回的 provider。

client 会在 `attach` 中准确发送请求 binding 的 activation id、Team、Participant、Session 和 AgentRuntime provider；仅当返回身份一致时才接受 `attached`。随后它要求成功的 `subscribe` response 且结果严格为 `{ "subscribed": true }`，才会发布 Link。每个 post、direct-final、claim、task-start、task-settle、task-integrate 与 receipt request 都获得唯一 client id，并与对应 response 多路复用。`postDirectFinal()`依赖 Hub 原子导出 peer 与当前 cursor。无效、未知、重复或乱序 frame 会终止 Link。缺少 response 也会终止 Link、清除 pending request 并拒绝 `done`；远程 operation rejection 仍是单个 operation 的失败。显式 `close()`会释放 socket 并 resolve `done`。

在各自首个 listener 之前接收的 Envelope notification 与 interrupt notification 共用 `maxBufferedNotifications`限制。已投递的 interrupt 在 `acknowledgeInterrupt()`成功前也持续占用该限额。Envelope notification 若指向另一个 Team、显式 audience 不含绑定的 Participant，或广播 sender 就是该 Participant，client 会终止 Link。其他 sender 的广播会进入权威 claim。`onInterrupt()`只接收 target 与 Link binding 完全一致的 v7 `interrupt` frame。`acknowledgeInterrupt(deliveryId, interruptId)`会发送唯一的 client-issued interrupt operation `interrupt-ack`；response 必须携带同一精确 target 和 acknowledgement time。interrupt listener rejection 会在未确认时终止 Link，使持久 command 可在重连后 replay。client 从不发起 interrupt request。Envelope listener 失败会发送可 retry 的 `nack`；接收 notification 不会确认持久 Envelope。远程 Hub 仍负责 pending-delivery replay、持久 receipt 和 interrupt persistence。client 会禁用 WebSocket compression，同时施加本地和 `ws` payload limit，且不提供 TLS validation bypass；可从受信任本地网络之外访问的部署应使用证书校验的 `wss:` endpoint。

## Model Experience

### WebSocket Team Link provider

#### 模型可见内容

本包不会向 `ctx.teamLinks` 注册 prompt section、tool、模型输入或模型输出。其 consumer 决定接收的 Envelope 是否进入 Agent。

#### Token effect

直接 token effect 为零。

#### KV Cache effect

此 provider 不拥有模型请求前缀。

## Known Limitations and Deferred Work

- **没有自动重连** — terminal Link 由其 consumer 负责重连仍然 current 的持久 binding、保留不确定 post 的 idempotency key，并接收 Hub replay。
- **没有 Agent inbox delivery** — `clocky-team-agent-client`或其他 consumer 负责 claim、Session durability、acknowledgement 和模型唤醒。
- **没有 hard process cancellation** — v7 通过 `onTerminate` 支持 cooperative endpoint termination，但 transport 不会强制终止远端 Agent 或 process；拥有该 activation 的 AgentRuntime provider 必须证明 termination，否则 Team 会保持 stalled。

### 单任务取消

Frame version 7 单独传输精确 task cancellation，与 Link termination 区分。Pending task 通知共用 `maxBufferedNotifications`；重连会再次从 Hub 的 durable Task 状态取得通知。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
