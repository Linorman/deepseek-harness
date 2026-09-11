# @clocky/clocky-team-telemetry-otel

English | [中文](README.zh.md)

OpenTelemetry Service Provider for the Team telemetry seam. Load it only in a deployment that has an OTLP/HTTP logs collector and explicitly selects `mode: FULL`; the default is `DISABLED`, which creates no SDK transport and shares no records.

`OpenTelemetryTeamBackend` composes the SDK's `LoggerProvider`, `BatchLogRecordProcessor`, and `OTLPLogExporter` without rebuilding their option objects. `TeamTelemetryCoordinator` remains responsible for Team/channel/Session correlation and redaction waterfalls. The backend owns the exporter resource and an outer shutdown deadline; the Team Hub remains the business authority.

The optional `alerts` list is a local rolling policy. Each rule filters the detached record's channel, exact `event.type`, and minimum severity, then emits one `ops` record when its matching count reaches `threshold` inside `windowMillis`. A rule rearms only after its window falls below the threshold, so a noisy stream does not create one alert per record. Alert thresholds, windows, exporter headers, compression, batching, and shutdown bounds are deployment configuration; no credentials are logged by this package.

This package is an explicit provider, not part of the default Team bundle. A deployment may register additional `team-telemetry/record` listeners to redact or enrich records before this backend receives them. Export is at-least-once according to the OpenTelemetry SDK's processor semantics; the provider does not claim durable telemetry delivery or exactly-once alerts.

## Configuration

```ts
const config = {
  mode: 'FULL',
  exporter: { url: 'https://collector.example/v1/logs' },
  alerts: [
    { name: 'team-errors', channel: 'session', severity: 'error', threshold: 3, windowMillis: 60_000 },
  ],
}
```

The SDK owns the complete `exporter` and `processor` option vocabulary. This provider validates the required HTTP(S) endpoint, positive batch size, and bounded shutdown timeout before constructing SDK state.

## Model Experience

### Team telemetry forwarding

#### What the model sees

None; this provider is model-agnostic. It only exports records already produced by `ctx.teamTelemetry` and contributes no prompt, tool, or model input.

#### Token effect

Zero direct token effect; export happens after the source record has already been created.

#### KV Cache effect

None; the provider does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Best-effort telemetry** — OTLP batching, retry, queue limits, and transport loss follow the OpenTelemetry SDK; Team business state and audit do not depend on exporter success.
- **Process-local alert windows** — alert counts reset when the provider restarts. Durable incident correlation belongs to the downstream telemetry system.
- **No multi-Hub aggregation** — records from multiple processes or hosts need a collector-side aggregation policy; this provider does not claim distributed exactly-once alerting.
