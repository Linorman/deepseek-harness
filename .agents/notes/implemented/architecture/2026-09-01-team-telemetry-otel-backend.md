# Agent Note: Team telemetry OTLP backend and threshold alerts

Status: implemented

English | [中文](2026-09-01-team-telemetry-otel-backend.zh.md)

## Problem

The Team telemetry seam could correlate authoritative Team/channel facts with Participant Session spans, but no deployment-owned exporter or configurable alert policy consumed those detached records. Integrators would otherwise need to rebuild capture, correlation, batching, and threshold behavior outside the repository.

## Decision

The repository now ships an explicit `@clocky/clocky-team-telemetry-otel` provider for deployments that need OTLP/HTTP Team telemetry. It composes the OpenTelemetry JS logger pipeline (`LoggerProvider`, `BatchLogRecordProcessor`, and `OTLPLogExporter`) and consumes the detached records produced by `TeamTelemetryCoordinator`. The provider defaults to `DISABLED`; `FULL` requires an HTTP(S) logs endpoint and validates the outer shutdown deadline before constructing SDK state.

Alerting is a provider-owned concern. Configured rules match the record channel, exact `event.type`, and minimum severity, then count matches in a rolling `windowMillis`. The provider emits one `ops` alert record when `threshold` is crossed and rearms only after the window falls below that threshold. This keeps alert policy deployment-configurable without making alerts part of Team authority or durable business state.

The OpenTelemetry SDK retains ownership of batching, retry, queueing, export timeout, and transport loss. Team Hub commits and the Team telemetry coordinator remain unaffected by exporter failure; shutdown is bounded by the provider's outer deadline and late SDK rejection remains observed. The package is an explicit provider and is not added to default product bundles.

## Alternatives considered

**Put OTLP export in the Team Hub.** Rejected because transport batching, retry, loss, and collector credentials are deployment concerns; exporter failure must never become Team authority.

**Make the capture coordinator own alert windows.** Rejected because alert thresholds and incident semantics vary by deployment, while the coordinator must remain a small non-blocking capture seam.

**Use one alert for every matching record.** Rejected because sustained failures would flood the collector; rules cross once and rearm only after their rolling window drops below the threshold.

## Consequences

- Deployment configuration can export correlated Team, channel, Session, and operational records without writing a second capture implementation.
- Alert thresholds and windows are explicit configuration, and repeated threshold breaches are suppressed until the rule rearms.
- Export remains at-least-once and best-effort at the provider boundary; durable audit and Team state do not depend on telemetry availability.
- Real local HTTP collector tests cover OTLP delivery, alert records, disabled transport, fail-loud configuration, and loader unwrapping.

## Evidence

- `packages/team/team-telemetry-otel/tests/alerts.spec.ts`
- `packages/team/team-telemetry-otel/tests/otel.spec.ts`
