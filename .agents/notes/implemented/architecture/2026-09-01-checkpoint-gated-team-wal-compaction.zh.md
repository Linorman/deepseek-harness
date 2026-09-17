# Agent Note：由 checkpoint 保护的 Team WAL compaction

Status: implemented

[English](2026-09-01-checkpoint-gated-team-wal-compaction.md) | 中文

## 问题

Team 与 channel stream 已有 checkpoint，却没有物理 retention operation。因此大型 closed channel 会永久保留完整 WAL；而不受约束的 prefix delete 可能让 checkpoint 无法重建剩余 state，或让旧 product cursor 跨过不可见 gap 看起来继续前进。

## 决策

`clocky-storage` 增加 `LogStream.compact({ throughSequence, expectedCheckpointSequence })`。provider 只有在准确的后续 checkpoint 已持久化、checkpoint 位于请求 prefix 之后、且请求不会移除全部 retained history 时才会删除 prefix。JSON 在 stream header 中记录非零 retained `firstSequence`；SQLite 从第一条 retained row 推导同一边界。若 read 从 compacted prefix 之前开始，会返回 typed storage error `compacted`；append 与 checkpoint read 继续使用原有单调递增 sequence。

共享 storage package 拥有两个 backend 共用的 compaction-fence validation，因此 checkpoint 与 bounds contract 不会在格式之间漂移。共享 contract 会在 JSON 与 SQLite 上执行 compaction、checkpoint、suffix read、append、restart 以及 invalid fence case。路由层的 `storageLog` handle 委托该 operation，并保持相同的 caller-owned lifecycle。

`clocky-team` 暴露 provider-owned `compactChannel()` 与 `compactTeam()` maintenance command。本地 Hub 要求匹配的 identity 与 cursor、source 已处于 terminal phase、maintenance actor 已获得授权，并且 audit projection 是 current；channel compaction 还要求没有 pending delivery，并会扫描 retained suffix，避免移除 causal predecessor。它会先在 source current cursor 强制写入 checkpoint，再 checkpoint 并 compact audit projection，最后按请求边界 compact source WAL，同时保留配置的 `auditRetentionTail`。Team/channel projection state 不变，因为各自 checkpoint 已包含完整 state；restart 会从 retained checkpoint 恢复。Channel 与 audit read 会明确报告 compaction，不会静默返回不完整 history。

`team-scheduler-dag` 可以同时配置 `terminalChannelRetentionTail` 与 `maxCompactionsPerDrive`，以 opt in 到有界 retention drive。每次 drive 会提出 terminal Team-journal 与 channel prefix，并将 checkpoint、audit、cursor、policy 以及 channel 的 pending-delivery gate 委托给 `compactTeam()` 或 `compactChannel()`；省略这一对配置时，compaction 仍只能由显式 maintenance command 触发。Pending delivery 或 policy denial 会让 channel 留到后续 drive，而不会被视为 scheduler failure。

人工操作 responder 完成后也必须重新验证当前 principal，才可返回 accepted 或 unavailable 操作数据。调用方失去权限不会撤销已持久提交的回答。

## 考虑过的替代方案

**直接从 Team 或 channel medium 删除 prefix。** 否决，因为 Team projection、checkpoint、pending-delivery state 与 audit provenance 需要 durable rebuild boundary；raw file/database delete 会绕过这些校验。

**Compact active channel 或仍有 pending delivery 的 channel。** 否决，因为未确认 Envelope 或 causation-reachable delivery 仍可能需要 replay 与 receipt semantics。本切片只允许没有 pending delivery 的 terminal channel。

**把 retained suffix 重新编号为零。** 否决，因为 source cursor、receipt、summary range 与 audit entry 使用稳定 sequence。Compaction 保留原 sequence，并在 JSON backend 中明确 retained first sequence。

**让旧 cursor 读取 compaction 后的第一条 retained record。** 否决，因为这会把不连续 history 呈现为合法 suffix。Storage boundary 与 Team Hub 返回 `compacted`，要求调用方从 retained range 建立新 cursor。

## 后果

Closed Team、channel 与 audit storage 现在可以回收 obsolete prefix，同时不削弱 restart recovery、cursor monotonicity 或 audit/source separation。Compaction 仍由 provider 负责；它要么通过 maintenance command 显式触发，要么通过 opt-in 的有界 scheduler drive 触发。压缩后的 channel snapshot 与 audit page 会通过 Host 与 SDK read 公开 first retained cursor，让 client 可以从已知 boundary 恢复。配置的 audit tail 属于 deployment choice，source compaction caller 选择准确 prefix fence。跨 stream compaction 不具备原子性：如果一个 stream 已 compact 后另一个失败，另一个仍可重建且状态可观察，绝不回滚 business state。

Principal inbox 的`retention`只有配置 stream、record、字节和 tail 上限后才开启。Owner 在 inbox serializer 下读取有界候选前缀，释放 serializer 后检查当前 human-action 状态，再重新核对准确 tail/checkpoint 后迁移。未读记录与未答 action 保留在 inbox。每个选定 admission 先索引到按身份寻址的不可变 stream，再发布`indexedThroughCursor`，最后压缩。Index format 2 保留 final 元数据及 JSON 编码正文的 SHA-256；Hub 授权的重试必须提供匹配正文，才能恢复原序号。JSON 编码区分孤立 UTF-16 代理字符。Message/action anchor 保留原 payload，普通 message receipt 恢复需要其已保存 view。Version-one anchor 明确拒绝。每条选定记录按序列化 source/anchor 字节数的较大者消耗 drive 预算。复制失败保留展示前缀；checkpoint 或 compaction 的响应丢失可在重启后重试。显示确认先提交 inbox 日志，再写 checkpoint。读取与确认重放 suffix，保留 admission 水位并修复旧 checkpoint；checkpoint 失败不会回退显示位置，也不会确认后续未读投递。显示确认在 inbox serializer 内选择记录，在队列外检查 Team 可见性，再于追加前复验记录身份与 live principal。这样保持 Team-to-inbox 锁顺序；即使 retention 已移除选定行，也不会回退并发确认推进的新位置。该流程回收已读 final 正文并保留重试证据。Message/action payload 与逐 admission 元数据仍保留，因此总存储仍随交付历史增长。 已压缩 inbox 的 read/watch 返回`TEAM_INBOX_COMPACTED`及保留的`firstCursor`，Host 和 SDK 保留该边界。浏览器保留当前页，并提供从`firstCursor - 1`显式读取的操作，沿用未提交答复的丢弃确认。这些恢复读取不授权删除前缀，也不修复任意 compaction 后的交付幂等性。

Storage contract 测试覆盖 JSON 与 SQLite 的物理 retention、checkpoint gating、非零 retained sequence、append/restart 与 compacted cursor error。Team Hub 测试覆盖 terminal-channel 与 Team-journal check、audit-tail retention、JSON/SQLite restart、typed old-cursor error、actor policy admission、causal-predecessor protection 以及 compaction/checkpoint metric；SDK server test 会通过其 wire projection 保留首个 audit cursor；scheduler 测试覆盖有界 opt-in retention drive。Hub load suite 保留 4,096-record default regression，并通过 `CLOCKY_TEAM_HUB_LARGE_LOAD=1` 提供独立的 16,384-record bounded SQLite page replay；生产性能 budget 与 operational alert 仍属于 native multi-agent work-system proposal。
