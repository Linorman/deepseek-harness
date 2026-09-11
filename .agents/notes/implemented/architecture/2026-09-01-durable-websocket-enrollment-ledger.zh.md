# Agent Note: 持久 WebSocket enrollment ledger

Status: implemented

[English](2026-09-01-durable-websocket-enrollment-ledger.md) | 中文

## 问题

动态 WebSocket enrollment credential 之前只存在于 Hub 进程内。Hub 重启会清除所有动态 credential，尽管远端 activation binding 和未确认 delivery 仍是持久的。重启后任意重新签发 credential 要么要求 child 在 Team authority 之外协调，要么有接受陈旧 credential 的风险。现有 WebSocket replay path 还会从每个 channel WAL 的开头扫描，而不会使用 Hub 的 durable pending-delivery boundary。

## 决策

`clocky-team-link-websocket-hub`为每个 `enrollmentProviderName`拥有一条带版本的 `storageLog` stream。它记录准确 binding、SHA-256 credential digest、单调 generation、签发时间和撤销时间。credential plaintext 永远不会进入 ledger、configuration、Team journal、Session log、wire response 或 diagnostic。

listener 会在注册 enrollment issuer 或 HTTP upgrade route 前完整验证并 fold ledger。当前动态 credential 只能认证其当前的 issued generation。为已 issued binding reserve 会追加 replacement generation、使旧 digest 失效并关闭旧 attached socket。revoker 只能影响它准确的当前 generation；replacement 后旧 revoker 是 no-op。restart 会从 ledger 重建最新 state，并且只接受恢复后的当前 credential。

WebSocket pending-delivery reader 会在第一次 page 使用 `ChannelSnapshot.replayWatermark`，与 local Link 相同。之后的每条 delivery 仍保留既有的 claim、notification、Session flush 和 receipt 顺序。

## 考虑过的替代方案

**将动态 credential 保留在 listener map 中。** 不予采用，因为进程 restart 会丢失授权，但 durable binding 与 pending delivery 仍需要恢复。

**在 Team journal 中持久化 credential plaintext 或加密内容。** 不予采用，因为 Hub 只需相等性比较；保留可复用 secret 会扩大持久攻击面，并把 transport credential 与 Team business authority 耦合。

**让所有 provider name 复用一条全局 enrollment stream。** 不予采用，因为独立 provider registry 需要独立的 recovery 和 revocation domain；按 provider 命名的 stream 会让冲突 record 明确失败。

**reconnect 后从 `-1` 重扫每条 channel。** 不予采用，因为 durable watermark 能证明每个 recipient 可以跳过哪些已确认 prefix，且不会削弱至少一次 delivery。

## 后果

动态 credential recovery 现在可以在 JSON 与 SQLite log backend 上跨完整本地 Hub restart 保留，包括两个独立 Hub process 共享同一个 SQLite durable root 的 restart。静态环境 credential 仍由 configuration 持有；v4 cancellation frame 会在 revoked 或 rotated socket 关闭前提供 cooperative endpoint stop，而 hard remote termination 和 multi-Hub consensus 仍是独立工作。enrollment ledger 畸形、格式不受支持或无法恢复时，listener 会在暴露前失败。

## 验证

Enrollment-ledger test 覆盖 JSON 与 SQLite recovery、generation rotation、准确 generation revocation、plaintext absence、malformed record 和 unsupported format。WebSocket Hub test 覆盖 rotation 关闭旧 socket、cooperative cancellation acknowledgement、restart 后拒绝 revoked credential、动态 credential recovery 携带 pending delivery replay 及 claim/ack（包括共享 SQLite 的 Hub child 与 Link child、进程内 restart 与两个独立 Hub process），以及第一条 pending page 从 durable replay watermark 开始。
