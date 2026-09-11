# Agent Note: Team telemetry correlator

Status: implemented

English | [中文](2026-09-01-team-telemetry-correlator.zh.md)

## Problem

The Team Hub already exposed operational counters and post-commit Team/channel events, while local Participant Sessions carried the model and tool lifecycle. There was no shared capture seam that correlated those sources without making telemetry a second authority or allowing a reporting failure to interrupt an append or model step.

## Decision

`@clocky/clocky-team` now owns the optional `TeamTelemetryBackend` Service Definition and `TeamTelemetryCoordinator` capture Consumer. The coordinator observes the typed `team/changed` and `channel/changed` feeds plus Session event, flush, and disposal boundaries. It emits detached records for Team journal facts, channel WAL facts, Session model/tool/lifecycle events, and Session disposal signals.

Each record copies known primitive correlation fields into attributes: Team, Participant, Activation, Channel, Envelope, Task, Attempt, Session, provider, model, trace, causation, and correlation identities. Session events are labelled as model, tool, input, or lifecycle spans; Team and channel records retain their source cursor. Bodies are structured clones of the source event and are never handed to a sink by reference. The `team-telemetry/record` waterfall is the deployment redaction/enrichment point and must delegate with `next()` to preserve lower layers.

The sink contract owns queueing, batching, retry, loss, export, and alert policy. The coordinator contains waterfall and sink exceptions per record, forwards Session flush hints without awaiting them, and awaits sink shutdown during its owning fiber disposal while logging a shutdown failure. No Team or Session business operation depends on telemetry success.

## Alternatives considered

**Put telemetry fields into Team business records.** Rejected because operational dimensions and exporter policy do not belong in the authoritative Team journal or channel WAL.

**Make the Session telemetry package infer Team state.** Rejected because Team/channel facts have their own source cursors and lifecycle; inference from copied Session messages would lose delivery, receipt, task, and policy provenance.

**Let a telemetry listener run directly on the append hot path without containment.** Rejected because a redaction or exporter failure would be able to starve later authoritative observers or interrupt a model loop.

**Make the coordinator provide batching and alert thresholds.** Rejected because those choices vary by deployment and reporting SDK; the capture seam only defines detached records and the non-blocking handoff boundary.

## Consequences

Deployments can add one typed Team telemetry backend without importing the Hub or Agent loop, and receivers can join Team control events with model/tool spans using stable primitive attributes. The explicit OTLP provider consumes this seam and applies deployment-owned threshold alerts; the coordinator remains free of exporter and alert-window policy. Since records contain source bodies, deployments exporting outside a trusted boundary must install redaction rules. Observer and sink failures are visible in logs but do not roll back committed business facts.

Core Team tests cover cross-source correlation, source cursors, model-span attributes, body detachment, waterfall containment, flush hints, and shutdown ordering; the provider adds real local OTLP collector and alert-window tests. Keyed real-model, distributed, load, and final release evidence remains pending under the native multi-agent work-system proposal.
