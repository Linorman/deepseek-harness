# Agent Note：持久 Team audit projection

Status: implemented

[English](2026-09-01-durable-team-audit-projection.md) | 中文

## 问题

此前 `readAudit()` 会直接读取 Team journal 或 channel WAL，并在每次 request 中把 raw record 转换为 `TeamAuditEntry`。这使 audit surface 变成另一个 read-time business data interpretation，没有独立 audit cursor 或 durable projection，也没有 post-commit audit write failure 的修复路径。

## 决策

本地 Team Hub 为每个 source 拥有一条可重建的 audit stream：Team journal 使用 `audit/<TeamId>`，channel WAL 使用 `audit/<TeamId>/channel/<ChannelId>`。每条 stream 使用 audit projection format `1`，每个 source record 保存一个已校验的 `TeamAuditEntry`，并使 source cursor 与 audit-stream sequence 对齐。business record 仍是 authority；audit entry 保存 source kind、可选 channel identity、source cursor、timestamp、discriminator 和 structured facts。

Team 或 channel business append 成功后，Hub 会 best-effort repair 并追加对应的 audit suffix。audit failure 会被记录，不会回滚已提交的 business record。之后的 audit read 或 post-commit maintenance 会重新打开 projection、将已有 prefix 与 source facts 对账、发现 audit tail 超过 source，或按 `recoveryPageSize` batch 追加缺失的 source record。遇到 storage sequence conflict 时会丢弃旧 audit handle，使下一次 pass 可以按当前 durable tail 重新打开。

`TeamMetricsSnapshot` 会在现有 event 与 delivery counter 之外，分别统计 audit projection maintenance 成功与失败次数。这样可以通过已有 Host 与 SDK metrics path 看见 audit degraded 状态，同时不会把 operational metrics 变成 Team business authority。

`readAudit()` 会先修复选定的 audit projection，再读取有界的 `limit + 1` page。它只解析 audit entry，校验 stream identity、cursor 对齐以及精确 source facts，并返回 source-specific continuation cursor；绝不会退回到把 raw business record 解释成 public audit model。Team 与 channel audit stream 会随 Hub 一起关闭，并与 source 使用相同的 JSON/SQLite storage-log route。

## 考虑过的替代方案

**继续在每次 read 时投影 raw Team/channel record。** 否决，因为 public audit model 没有独立的 durable state 或 repair watermark，每个 consumer 还可能产生不同的 interpretation。

**让 audit append failure 拒绝 business mutation。** 否决，因为 audit 是可重建的 operational projection；独立 storage stream 之间无法回滚已提交的 Team 或 channel fact。

**把所有 channel source 放入一条混合 Team audit stream。** 否决，因为 channel read 必须筛选 global stream，无法在不重新扫描其他 channel 的情况下用 source cursor 做有界 continuation。按 source 分 stream 可以保持 cursor 对齐与 ownership。

**保留 process-local audit cache。** 否决，因为 restart 会抹掉 projection，并发 Hub writer 也没有 durable repair boundary。audit stream 是 durable 的；内存 map 只保留 open handle 并串行化本地 maintenance。

## 后果

Audit read 现在拥有独立、已校验、有界分页的 projection，并可跨 Hub restart 保留。缺失 audit suffix 可以 repair；malformed、facts mismatch 或 ahead-of-source 的 audit data 会 loud failure，而不会静默退回 raw business interpretation。audit write 会在 business commit 后增加第二次 storage append，可能增加 write latency；failure 可通过 log 与现有 metrics route 观察，并且仍可重试。Terminal Team 与 channel 的 source/audit prefix 只有在 current checkpoint、配置的 audit tail 与 Hub retention gate 之后才能 compact；完整 replay-watermark policy、telemetry 与 operational alert 仍属于 native multi-agent work-system proposal。

Team Hub 测试覆盖持久 Team 与 channel audit read、source-specific cursor、JSON/SQLite restart、缺失 Team audit suffix repair、source facts validation、独立 audit stream materialization，以及 JSON audit stream version 不兼容时 business 仍成功。property/model-based、distributed conflict、load 与 browser evidence 仍是 pending。
