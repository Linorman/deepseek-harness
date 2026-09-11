# @clocky/clocky-team-telemetry-otel

[English](README.md) | 中文

Team telemetry seam 的 OpenTelemetry Service Provider。仅应在拥有 OTLP/HTTP logs collector 且明确选择 `mode: FULL` 的 deployment 中加载；默认值是 `DISABLED`，不会创建 SDK transport，也不会共享 record。

`OpenTelemetryTeamBackend` 直接组合 SDK 的 `LoggerProvider`、`BatchLogRecordProcessor` 和 `OTLPLogExporter`，不会重新拼装它们的 option object。`TeamTelemetryCoordinator` 仍负责 Team/channel/Session correlation 与 redaction waterfall。Backend 负责 exporter resource 和外层 shutdown deadline；Team Hub 仍是业务 authority。

可选的 `alerts` 列表是本地 rolling policy。每条 rule 可以按 detached record 的 channel、精确的 `event.type` 和最低 severity 过滤；当窗口 `windowMillis` 内的匹配数达到 `threshold` 时发出一条 `ops` record。只有窗口内数量降回 threshold 以下后 rule 才会重新 armed，因此持续噪声不会为每条 record 重复发出 alert。Alert threshold、window、exporter header、compression、batching 和 shutdown bound 都是 deployment 配置；本包不会记录 credential。

本包是显式 provider，不属于默认 Team bundle。Deployment 可以额外注册 `team-telemetry/record` listener，在本 backend 接收前 redaction 或 enrichment record。Export 遵循 OpenTelemetry SDK processor 的 at-least-once 语义；provider 不宣称 telemetry durable delivery 或 alert exactly-once。

## 配置

```ts
const config = {
  mode: 'FULL',
  exporter: { url: 'https://collector.example/v1/logs' },
  alerts: [
    { name: 'team-errors', channel: 'session', severity: 'error', threshold: 3, windowMillis: 60_000 },
  ],
}
```

SDK 拥有完整的 `exporter` 和 `processor` option vocabulary。本 provider 在创建 SDK state 前校验必需的 HTTP(S) endpoint、正 batch size 和有界 shutdown timeout。

## 模型体验

### Team telemetry 转发

#### 模型看到的内容

无；本 provider 与模型无关，只导出 `ctx.teamTelemetry` 已产生的 record，不贡献 prompt、tool 或 model input。

#### Token 影响

没有直接 token 影响；export 发生在 source record 已经创建之后。

#### KV Cache 影响

无；本 provider 不组装或发送 model request。

## 已知限制与暂缓事项

- **Telemetry 是 best-effort**：OTLP batching、retry、queue limit 和 transport loss 遵循 OpenTelemetry SDK；Team business state 与 audit 不依赖 exporter 成功。
- **Alert window 只在进程内**：provider 重启后 alert count 会重置；durable incident correlation 属于下游 telemetry system。
- **没有 multi-Hub aggregation**：多个 process 或 host 的 record 需要 collector-side aggregation policy；本 provider 不宣称 distributed exactly-once alerting。
