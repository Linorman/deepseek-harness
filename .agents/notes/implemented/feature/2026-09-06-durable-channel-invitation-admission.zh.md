# Agent Note: 持久 channel invitation admission

Status: implemented

[English](2026-09-06-durable-channel-invitation-admission.md) | 中文

## Problem

Active 的逻辑 Participant 或已注册 channel adapter，不能证明接收 endpoint 支持新打开的协议。立即激活 channel 会让 dispatch 早于 endpoint 对 manifest 的接受。如果在后续 consent 或 expiry 后重新计算 recipient membership，optional participant 还会令广播恢复产生歧义。

## Decision

Channel creation 原子提交 opened、pending 和逐成员 invitation。Hub 冻结 role、channel visibility、required status、deadline、endpoint expectation、revision 与规范化 manifest fingerprint。当前 activation、authenticated human call 或具名 endpoint owner 为完整 acknowledgement payload 提供短期 proof。最后一个 required acknowledgement 与 active phase 位于同一 WAL append。Notification、callback 返回或插件注册都不能代替持久 acknowledgement。

每条 Envelope record 存储其实际有序 `DeliveryIntent[]`。Commit 与 replay 将该数组与保留 adapter 的 plan、准确 WAL 位置上的 admission state 比较。Recipient id 必须是无重复的 manifest 成员，引用该 Envelope，并保留协议 delivery treatment。历史 pending delivery 使用这些已存 intent；较晚的 optional acknowledgement 不能为旧广播增加 recipient。只有 direct-v4 广播能省略尚未确认的 optional endpoint；其他协议要求每名计划 recipient 都已 consent。

Optional invitation expiry 要求保留 adapter 显式作出 `allowParticipantRemoval()` 决定。Direct v4 在至少保留两名 invitation 成员时允许移除；没有该能力的固定角色协议明确失败。Channel close 先进入 closing，再结束 pending invitation，最后写 terminal record。迟到 acknowledgement 不能重新激活 terminal channel。Required expiry 记录结构化原因和 expired channel。Recovery 与 checkpoint data 将 invitation 和 message receipt 分别保留。

Admission Consumer 使用当前时钟与准确 expiry proof 扫描有界持久 page，并提供支持取消的 active-channel 等待。Local 与 WebSocket v6 Link 只重放尚未确认的 endpoint invitation。Agent Client 在确认前验证实际 binding 与支持的 manifest。Scheduler wake/review operation 和 TeamRun creation/workflow compilation 会在 dispatch 前等待。Endpoint 等待期间不持有锁。

TeamRun 为 principal-owned human 接受仅限运行时的 `admitHumanChannel` 能力。Host 与 SDK Consumer 保留当前 authenticated call，验证准确的 direct-v3/directed-v1 产品 manifest，并签发 payload-bound human proof。该能力不跨越 JSON，也不进入 start fingerprint。失败沿用 creation cleanup；已接纳的同 key start 返回原结果。System result Consumer 独立确认其支持的 human endpoint。

## Alternatives considered

**根据 adapter 注册激活。** 拒绝，因为 Hub 上代码可用不能证明实际接收 Agent、human transport 或 service 的能力。

**在 optional expiry 后修改 manifest。** 拒绝，因为这会改变历史广播 recipient 与协议解释。Manifest 保持不可变，由 invitation transition 与逐 Envelope 的固定 intent 携带变化。

**在返回 start 前等待浏览器确认。** 拒绝，因为浏览器无法检查尚未返回的 channel。Authenticated Host/SDK endpoint 在该 call 内确认支持的 admission；display acknowledgement 独立处理。

## Consequences

新的 channel storage 拒绝旧 WAL/checkpoint format，remote peer 使用 frame v6。默认 TeamRun 保持 direct v3，直到剩余产品和 remote-tool Consumer 支持 direct v4。Generic Host/SDK invitation method 与 human display/final inbox 仍为独立接入；本决策不将整个 channel 工作包标记完成。[Direct v4](2026-09-06-direct-v4-recipient-delivery.zh.md)保留其显式 message/final 规则。

Keyless JSON/SQLite Loader 运行验证实际 local 与 WebSocket endpoint acknowledgement、admission 前 dispatch 拒绝、有序图片消息和 Session receipt。既有默认 TeamRun、worker、workflow 与 worker-pool 示例也经过 admission 等待。Host fetch 与 authenticated SDK creation 验证 principal callback。公开 Hub 测试验证 deadline recovery、optional removal、晚 consent 不改变历史 recipient、重启持久性和 close-before-ack 行为。
