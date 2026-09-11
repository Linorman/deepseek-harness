# Agent Note: WebSocket Team Link 传输

Status: implemented

[English](2026-08-29-websocket-team-link-transport.md) | 中文

## Problem

本地 Team Link 无法在进程之间传递 activation-bound channel 连接。远程 client 不得通过可变 frame 字段选择 sender、participant、Session 或 activation；实时 WebSocket 也不能取代 channel WAL 或 recipient receipt 作为投递 authority。

## Decision

`@clocky/clocky-team-link`拥有严格、带版本的 frame 词汇：attach、subscribe、bound operation、nack、response 和 notification。`@clocky/clocky-team-link-websocket`是一个 Link provider：它从配置的环境变量读取不透明 capability、附接一个不可变 activation identity，并校验 response 顺序和 frame 大小。其 terminal Link state 允许既有 Consumer 为同一个 current binding 重新连接。

v4 frame 词汇新增 Hub 发起的 `cancel` request 和端点返回的 `cancelled` result。`TeamLinkConnectRequest` 可以保留 `onTerminate` callback；WebSocket client 会在确认 cooperative stop 前等待该 callback 完成，Hub 则在收到结果或有界 close timeout 到期后关闭 socket。传输层不声明进程已经终止；拥有该 activation 的 AgentRuntime provider 仍必须证明 hard disposal，或让 Team 保持 stalled。

`@clocky/clocky-team-link-websocket-hub`注册 HTTP upgrade endpoint 和 enrollment issuer。静态配置可以将环境 capability 映射到一个不可变 activation identity。动态 enrollment 拥有按 provider 命名的持久 ledger，其中只包含 binding、credential hash、generation 和签发／撤销时间；其 recovery 与 rotation mechanics 由[持久 enrollment ledger 决策](2026-09-01-durable-websocket-enrollment-ledger.zh.md)拥有。已配置的 connection cap 和 attach/subscribe deadline 会限制未认证 socket；heartbeat 只在 subscription 后开始。attach 会以 constant time 比较 capability、重新读取持久 activation，并要求连接存在前 binding 必须精确且 active。post、claim、receipt 和 task operation 从该 bound identity 推导 authority；Hub 从不信任 request input 中的 authority 值。

订阅后，Hub 通过 Team runtime 发现持久 pending recipient delivery 和精确 target 的 soft interrupt，再发送有界 notification。receipt 清除匹配的 outstanding notification；可重试 nack 释放它，以便经过配置的延迟重新 claim。每条 interrupt wake 都会把一个串行 replay drain 标为 dirty，因此在前一条 durable query pending 时已接收的 command 会在 drain 结束前被查询。每个 Link post 都携带 sender-scoped 不透明 idempotency key。Team channel WAL 和 checkpoint 会将该 key 与 accepted Envelope 一起保留，因此匹配 retry 可以跨 Hub restart 和 stale cursor，而冲突的 key reuse 会失败。client 会限制每个 attach、subscribe 和 operation response；Hub 会配置 backpressure retry advice 和 ping/pong 半开连接 deadline。reconnect 从持久 pending state 而不是 connection memory 重放。双方都会限制 frame size、request、queue 和 notification retention。TLS 由 HTTP server deployment 选择（`wss:` client endpoint 或 terminating proxy），而不是由第二个 transport protocol 选择。

## Alternatives considered

**将 WebSocket frame 作为投递真相来源。** 不予采用，因为断连、重复 frame 和 Hub restart 会丢失持久 append → Session flush → receipt 顺序。

**在每个 operation 接受 client 提供的 participant 或 sender。** 不予采用，因为泄露的连接随后可以冒充其他 Team member。capability 选择一个不可变 binding，而 Hub 推导所有 operation ownership。

**在一个永久 socket object 内隐藏 reconnect。** 不予采用，因为 stale activation 不得静默恢复。Consumer 已知道其持久 binding 何时仍为 current，并通过 Link registry 重新连接。

## Consequences

远程进程可以使用与本地 Consumer 相同的 Team Link operation，而不共享 Session storage。[Team Link 注册表决策](2026-08-28-team-link-registry.zh.md)拥有共享 API，[本地 Team Link recovery 决策](2026-08-28-cancellable-local-team-link-recovery.zh.md)拥有本地 provider，[SDK post-bind Team Link enrollment 决策](2026-08-29-sdk-post-bind-team-link-enrollment.zh.md)拥有 SDK child delivery，[持久 participant 软中断决策](2026-08-29-durable-participant-soft-interrupt.zh.md)拥有 command authority。单个 Team Hub 仍保持 authoritative；multi-Hub consensus 和 hard participant cancellation 仍是独立工作。Hub 到端点的 cooperative termination 会在 credential rotation、revocation 或 provider retirement 关闭 transport 前停止 Link-owned admission 和当前 model work。一条共享 local/WebSocket contract 覆盖 notification、reconnect replay、claim、显式 receipt 和 cooperative termination；聚焦 protocol test 覆盖 malformed、duplicate、out-of-order、oversized、unauthorized、disconnected、slow-consumer、nack、response-loss retry、interrupt acknowledgement、cancellation acknowledgement、有界 no-ack close、dynamic generation rotation、完整 Hub restart recovery 和 durable-replay path。一个派生 SDK child 通过动态 credential 接收 direct Envelope，并在没有共享 Hub 状态的情况下写入 receipt；同一个 child-process fixture 还证明 v4 cancellation request 会在 dynamic revocation 关闭 socket 前到达 endpoint。
