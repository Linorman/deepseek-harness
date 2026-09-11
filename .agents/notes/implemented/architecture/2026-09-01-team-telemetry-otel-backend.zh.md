# Agent Note: Team telemetry OTLP backend 与 threshold alert

Status: implemented

[English](2026-09-01-team-telemetry-otel-backend.md) | 中文

## Problem

Team telemetry seam 已经能够关联权威的 Team/channel fact 与 Participant Session span，但没有 deployment-owned exporter 或可配置的 alert policy 来消费这些 detached record。集成方如果需要导出或 threshold 行为，只能在仓库外重复实现 capture 与 correlation。

## 决定

仓库现在提供显式的 `@clocky/clocky-team-telemetry-otel` provider，供需要通过 OTLP/HTTP 导出 Team telemetry 的 deployment 使用。它组合 OpenTelemetry JS logger pipeline（`LoggerProvider`、`BatchLogRecordProcessor` 和 `OTLPLogExporter`），消费 `TeamTelemetryCoordinator` 发出的 detached record。Provider 默认是 `DISABLED`；`FULL` 要求 HTTP(S) logs endpoint，并在创建 SDK state 前校验外层 shutdown deadline。

Alerting 属于 provider-owned concern。配置的 rule 可以按 record channel、精确的 `event.type` 和最低 severity 匹配，并在 rolling `windowMillis` 内计数。达到 `threshold` 时 provider 发出一条 `ops` alert record；只有窗口内数量低于 threshold 后 rule 才会重新 armed。这样 alert policy 保持 deployment-configurable，不会成为 Team authority 或 durable business state。

OpenTelemetry SDK 仍拥有 batching、retry、queueing、export timeout 和 transport loss。Team Hub commit 与 Team telemetry coordinator 不会受到 exporter failure 影响；shutdown 受 provider 外层 deadline 限制，SDK 的延后 rejection 仍会被观察。本包是显式 provider，不加入默认产品 bundle。

## Alternatives considered

**把 OTLP export 放进 Team Hub。** 否决，因为 transport batching、retry、loss 和 collector credential 属于 deployment concern；exporter failure 绝不能成为 Team authority。

**让 capture coordinator 拥有 alert window。** 否决，因为 alert threshold 与 incident semantics 随 deployment 变化，而 coordinator 必须保持小型、non-blocking 的 capture seam。

**每条匹配 record 都发一条 alert。** 否决，因为持续 failure 会淹没 collector；rule 只在 crossing 时发出，并且要等 rolling window 低于 threshold 后才重新 armed。

## 影响

- Deployment 可以导出带 correlation 的 Team、channel、Session 和 operational record，不需要再实现一套 capture。
- Alert threshold 和 window 是显式配置，重复 threshold breach 会被抑制，直到 rule 重新 armed。
- Export 在 provider boundary 仍是 at-least-once 和 best-effort；durable audit 与 Team state 不依赖 telemetry 可用性。
- 真实本地 HTTP collector 测试覆盖 OTLP delivery、alert record、disabled transport、fail-loud configuration 和 loader unwrap。

## 证据

- `packages/team/team-telemetry-otel/tests/alerts.spec.ts`
- `packages/team/team-telemetry-otel/tests/otel.spec.ts`
