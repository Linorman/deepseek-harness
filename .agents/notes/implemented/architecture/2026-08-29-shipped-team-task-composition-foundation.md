# Agent Note: Shipped Team task composition foundation

Status: implemented

English | [中文](2026-08-29-shipped-team-task-composition-foundation.zh.md)

## Problem

The local Team task protocol, shared workspace provider, and deterministic scheduler existed outside the shipped Headless and Web compositions. A later task producer could otherwise add a private child-Agent route or choose an ambient working directory instead of exercising durable assignment delivery.

## Decision

`clocky-headless` and `clocky-web-app` mount `clocky-team-workspace`, `clocky-team-workspace-shared`, `clocky-team-channel-task-assignment`, and `clocky-team-scheduler-dag` beside their local Team Hub, Link, Agent Client, and Team-run rows.

Both shared workspace rows pass `process.cwd()` to `shared-local`. The provider resolves that directory through `fs.realpath`; an assigned local Agent whose durable Session header has another `cwd` is ineligible, and allocation rejects without changing either path.

The scheduler records one-hour leases, one assignment, expiry, and wake repair per drive, four conflict rereads, one active attempt per Participant, `shared` work only, and a five-second disposal bound. The bundle `team-run` rows select `workerPreset: minimal` and `reviewerPreset: minimal`, then mount `tool-team-task`. Headless mounts `agent-presets` with `standard` as its roster default, then profile boot supplies the shipped root; the coordinator names no preset and retains the base composition. The task tools register only for the exact live default coordinator, TeamRun activates the worker for its accepted task, and mutating tasks route through the lazily provisioned reviewer. TeamRun retries the whole worker/reviewer activation and task-create sequence after a concurrent Team cursor advance, bounded by the configured receipt retry count. The Agent Client consumes the selected workspace allocation, retains its root and pre-disposal settler in a process-local registry keyed by the exact Agent, and task reporting publishes provider-owned changed paths/artifacts before settlement. Base and the shipped `standard`, `code`, and `cordis` presets omit direct subagent, legacy script-workflow, and Ralph tools; the shipped Team workflow-plan tools remain owned by `tool-team-task`, and an explicit custom composition may mount the legacy packages with their providers.

## Alternatives considered

**Mount task features only with the first model tool.** Rejected because the default product composition needs the durable assignment path available before a tool can exercise it, and a late tool-only mount would conceal composition failures.

**Use an Agent Session cwd as the shared root.** Rejected because a Session header is not a provider-owned execution-root identity. The shared provider must retain one canonical configured root and reject a mismatched Session.

**Select the roster default for the worker.** Rejected because a worker must retain the non-delegating composition even when the coordinator names another preset. `workerPreset` selects `minimal` explicitly.

## Consequences

Headless and Web validate the same task protocol rows, scheduler configuration, minimal worker/reviewer presets, allocation consumption, and report-only workspace publication through their bundle manifests. Both disable the base same-Session Goal domain, driver, command, and tools; Web mounts `command-team-goal` only in a Team coordinator scope. The existing shared-workspace provider tests retain the exact-cwd refusal and allocation rejection contract. Provider-specific integration, automatic or multi-host recovery, and hard cancellation remain outside the shipped local composition. The [compiled Team workflow-plan decision](2026-08-31-compiled-team-workflow-plan-consumer.md) owns the new declarative workflow path; the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains the owner of the remaining distributed execution and release evidence.

A coordinator may successfully use the scoped `team_message` tool to answer a non-final channel turn; TeamRun keeps the Team active after that completed turn and waits for later input or an explicit final Envelope. A completed turn without a successful Team message still follows the missing-final lifecycle.
