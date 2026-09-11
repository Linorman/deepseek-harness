# Agent Note：ACP activation Team Link bridge

Status: implemented

[English](2026-08-31-acp-team-link-bridge.md) | 中文

## Problem

ACP placement activation 没有本地 Clocky `Agent`，因此普通 local Agent Client 无法消费 Team channel notification。如果没有 Team delivery path，remote Participant lifecycle 只能被带外调用方使用。

## Decision

`agent-runtime-acp` 接受可选的 `teamLinkEnrollmentProvider`。AgentRuntime controller 提交准确 activation binding 后，provider 会申请临时 enrollment，注册 capability-scoped WebSocket Link provider，并用相同的 Team、Participant、activation、Session 和 placement-provider identity 连接。该 Link 由 ACP activation handle 拥有，并在 child process teardown 前撤销。

被 claim 的 Team Envelope 会带 Team/channel/Envelope/sender/kind provenance 与 JSON payload text，串行转成 ACP `session/prompt` request。在发送 request 前，provider 会将准确的 rendered input 追加到 Team 解析出的 `SessionId` 对应的 durable Clocky proxy Session，并等待 `ctx.sessions.flush()`。非 cancelled response 会追加 completion fact 与 completed turn，flush 两者，然后才确认 source Envelope；失败或 cancelled prompt 不确认，等待 Link replay。resume 时，已完成的 proxy fact 允许 provider 直接确认 source 而不再次 prompt；已接纳但未完成的 turn 仍可 replay。针对当前 activation 的 soft interrupt 会先取消 ACP session，再确认 Link interrupt。Link 失败时，只要 activation 仍 current，就先撤销旧 credential，再重新 enrollment。ACP assistant output 保持私有，绝不会自动 post 到 Team channel。

Enrollment issuer 与 WebSocket Hub 仍是可选部署能力。不配置该选项时，ACP placement 保持只负责 lifecycle 的行为。Provider 只会在 Clocky proxy Session 中记录 Team-derived prompt admission 与 completion ledger；不会复制 child transcript，也不会把 enrollment credential 暴露给模型内容。

ACP child disposal 会在 EOF 后证明完整 process tree，然后通过 subprocess provider 的 termination rung escalation。Escalation 后的 observation window 会包含该 provider-owned SIGTERM-to-SIGKILL grace，因此 child 不会在恰好达到 escalation boundary 时被误报为 unconfirmed；如果仍无法证明 tree 已停止，activation 会保持 stopping，并返回 typed unconfirmed-termination error。

ACP disposal 与 reconnect delay 会拒绝超过 Node 安全 timer 范围的值，escalation 后的 termination wait 也会把 double interval 限制在同一范围内。

## Alternatives considered

**把 ACP assistant output 当作隐式 Team message。** 不予采用：它绕过 channel audience、causation、receipt 和 explicit-send policy，并会默认广播私有 reasoning。

**把 enrollment credential 写入 ACP prompt。** 不予采用：credential 会变成 model-visible，并可能被保留在 child transcript；bridge 将它保存在 activation-owned Link provider closure 中。

**要求每个 ACP child 都实现 Clocky WebSocket Link protocol。** 不予采用：ACP 是独立的互操作协议；provider 把持久 Link 适配到标准 ACP `session/prompt` operation，同时保留 Hub 的 receipt authority。

**只把 prompt admission 保留在 remote ACP transcript 中。** 不予采用：child transcript 不是 Clocky persistence source，无法在 provider restart 后为 Team receipt 提供 fence。小型本地 proxy Session 只记录准确 input 与 completion fact，不把 child transcript 纳入 Team authority。

## Consequences

挂载 enrollment issuer 与 WebSocket Hub 后，ACP placement 可以消费 Team input，并具备有界 prompt 串行化与 reconnect。不接受标准 ACP prompt flow 的 child 无法通过该 provider 消费 Team Envelope。远程 child transcript 持久化和自动 output publication 仍位于 bridge 之外；Proxy Session 是 durable admission ledger，而不是第二份 model transcript。

## Verification

provider 已通过带 Team Link/WebSocket 与 Session-persistence dependency 的 typecheck 与 lint；persistence catalog 已包含 completion fact。Keyless provider lifecycle test 会使用真实 ACP child 覆盖 concurrent activation、EOF-driven flush 与 trapped-SIGTERM escalation，termination unit test 继续保留 unconfirmed branch 与 timer-overflow clamp。Configuration test 会拒绝不安全的 timer value。既有 ACP lifecycle 和 WebSocket Link suite 仍为绿色。bridge 使用与 local、SDK remote delivery 相同的 claim／acknowledge contract，在 acknowledgement 前 flush proxy admission，并将 credential value 排除在 durable record 与 diagnostic 之外。
