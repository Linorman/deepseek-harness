# Agent Note: Direct v4 收件人投递

Status: implemented

[English](2026-09-06-direct-v4-recipient-delivery.md) | 中文

## Problem

两方产品 channel 无法表达向选定群组发送消息，也无法为多个 recipient 保留独立投递进度。把 assistant output 当作隐式回复，还会在没有显式 participant command 的情况下发送内容。

## Decision

Direct v4 接受至少两个不同成员，以及有序文本/图片消息。消息可发送给显式非空子集，也可用 null audience 发送给其他所有成员。不可变 manifest、Envelope 和无状态 adapter 为每名 recipient 确定一条 delivery intent。现有 channel WAL 和 recipient receipt 持久化该进度，无需额外的可变 delivery map 或 wire format。Hub admission 在持有 Team/channel 锁时检查所有被寻址 participant 均为 active。

Activation-bound Link 和 Agent Client 分别消费每名 recipient 的输入。Inbox admission 保留 sender 与 Envelope provenance、内容顺序和 delivery treatment，并在 receipt 前 flush Session。延迟激活的 recipient 会重放尚未投递的消息，不会收到私有子集消息，也不会重开另一名 participant 已结算的 receipt。本地 `team_message` tool 准备 v4 text content payload。普通 assistant output 不会创建 channel Envelope。

Final 只允许恰好两方的 coordinator/human channel、实际 coordinator Agent sender、实际 human recipient、显式单一 audience 和 turn delivery。Adapter validation 检查 manifest role；Hub 检查实际 Team 身份。接受 final 不会编造 human receipt 或完成 Team。

## Alternatives considered

**将 v3 重新定义为群组协议。** 拒绝，因为已持久化的 v3 channel 保留其恰好两方的解释。V4 须显式选择；默认 TeamRun 创建仍使用 v3，直到其 admission 和 final Consumer 支持完整协议。

**记录第二套 recipient-intent log。** 拒绝，因为不可变 v4 规划和现有 WAL 已能重建独立的 pending recipient。第二套 authority 会在恢复时引入分歧。

## Consequences

群组消息使用与[直接投递](../architecture/2026-08-28-direct-envelope-admission-and-local-agent-delivery.zh.md)相同的 claim、Session persistence 和 receipt 机制，不增加自动会话路由。[持久 channel admission](2026-09-06-durable-channel-invitation-admission.zh.md)拥有 invitation 和 acknowledgement；active Team participant 不能证明已同意邀请。没有本地 channel metadata 的远程 text tool 保留显式 audience 的 text 协议；调用方可通过已认证 Link post API 选择 v4 content。

Keyless headless Loader 示例使用 fixture 拥有的初始 topology，以及实际 activation、tool、Link、Agent Client、attachment 和 Session provider。JSON 与 SQLite 运行验证显式 model-tool 子集消息、有序图片广播、延迟激活重放、三条独立 receipt 和无自动回复。Hub 测试还验证重启重放、非 active recipient 拒绝与准确的 human final admission。
