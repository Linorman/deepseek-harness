# Agent Note：Team telemetry correlator

Status: implemented

[English](2026-09-01-team-telemetry-correlator.md) | 中文

## 问题

Team Hub 已经提供 operational counter 与 post-commit Team/channel event，本地 Participant Session 也保存 model 与 tool lifecycle，但项目没有一个能关联这些 source 的统一 capture seam；telemetry 既不能成为第二个 authority，也不能因为 reporting failure 中断 append 或 model step。

## 决策

`@clocky/clocky-team` 现在拥有可选的 `TeamTelemetryBackend` Service Definition 与 `TeamTelemetryCoordinator` capture Consumer。Coordinator 观察类型化的 `team/changed`、`channel/changed` feed，以及 Session event、flush 和 disposal boundary，并发出 Team journal fact、channel WAL fact、Session model/tool/lifecycle event 与 Session disposal signal 的 detached record。

每条 record 都会把已知的 primitive correlation field 复制到 attribute：Team、Participant、Activation、Channel、Envelope、Task、Attempt、Session、provider、model、trace、causation 和 correlation identity。Session event 会标记为 model、tool、input 或 lifecycle span；Team 与 channel record 会保留 source cursor。Body 是 source event 的 structured clone，sink 永远不会拿到 source 的共享引用。`team-telemetry/record` waterfall 是部署方的 redaction/enrichment 扩展点；必须调用 `next()` 才能保留下层逻辑。

Sink contract 负责 queue、batching、retry、loss、export 和 alert policy。Coordinator 会按 record 隔离 waterfall 与 sink exception，会转发 Session flush hint 但不等待它，并在所属 fiber disposal 时等待 sink shutdown；shutdown failure 只记录日志。任何 Team 或 Session business operation 都不依赖 telemetry 成功。

## 考虑过的替代方案

**把 telemetry field 写进 Team business record。** 否决，因为 operational dimension 与 exporter policy 不属于 authoritative Team journal 或 channel WAL。

**让 Session telemetry package 推断 Team state。** 否决，因为 Team/channel fact 具有独立 source cursor 与 lifecycle；从复制的 Session message 推断会丢失 delivery、receipt、task 和 policy provenance。

**让 telemetry listener 不经隔离直接运行在 append hot path。** 否决，因为 redaction 或 exporter failure 可能饿死后续 authoritative observer，或中断 model loop。

**由 Coordinator 提供 batching 与 alert threshold。** 否决，因为这些选择随 deployment 与 reporting SDK 变化；capture seam 只定义 detached record 与 non-blocking handoff boundary。

## 后果

Deployment 可以加入一个类型化 Team telemetry backend，无需导入 Hub 或 Agent loop；receiver 可以用稳定的 primitive attribute 将 Team control event 与 model/tool span 连接起来。显式的 OTLP provider 消费这个 seam 并执行 deployment-owned threshold alert；Coordinator 仍不拥有 exporter 或 alert window policy。由于 record 包含 source body，向可信边界之外 export 的 deployment 必须安装 redaction rule。Observer 与 sink failure 会在 log 中可见，但不会回滚已提交的 business fact。

Core Team test 覆盖跨 source correlation、source cursor、model-span attribute、body detachment、waterfall containment、flush hint 与 shutdown order；provider 还通过真实本地 OTLP collector 与 alert-window test。Keyed real-model、distributed、load 和最终 release evidence 仍由 native multi-agent work-system proposal 负责。
