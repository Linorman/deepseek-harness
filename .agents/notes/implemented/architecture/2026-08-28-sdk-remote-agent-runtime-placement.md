# Agent Note: SDK remote AgentRuntime placement

Status: implemented

English | [中文](2026-08-28-sdk-remote-agent-runtime-placement.zh.md)

## Problem

A remote Team participant needs one exact activation epoch that can be published, observed, interrupted, and released without sharing a process or local `Agent` with the Team Hub. The pre-existing SDK session prompt path lazily creates a Session and emits generic Session status, so it cannot prove ownership of a particular Team/Participant/Session epoch or safely drive its durable residency.

## Decision

`clocky-sdk-protocol` adds strict `activation/open`, `activation/link-enroll`, `activation/status`, `activation/interrupt`, and `activation/dispose` messages. Every lifecycle message names the complete activation, Team, Participant, and Session target. A state repeats that target, carries a closed residency status, and advances a per-epoch `statusSequence`. Post-bind enrollment repeats that target with its placement provider and a short-lived credential. The SDK server materializes paired Team/Participant Session provenance before a fresh publication, verifies it on resume, prevents direct prompts to activation-owned Sessions, and emits only exact activation status notifications.

`clocky-agent-runtime-sdk` registers a remote placement provider. It accepts an active `remote-agent` with a fresh or resume seed, requires explicit provider/model options, and creates one SDK child process for the accepted epoch. Its handle has `localAgent: undefined`, verifies every returned target and status progression, contains listener failures, retains `stopping` after transport or protocol loss without exact termination proof, and releases the child only after remote disposal and process settlement. Provider unload closes admission without revoking a returned handle.

The Team activation controller binds this handle through the same durable transaction used by local placement. It records the remote epoch only after the handle publishes, mirrors its status stream, and releases it on failure.

An SDK deployment that configures one recovery profile and host identity starts each child in an isolated process group and returns a non-secret recovery plan with its process identity. Recovery is enabled only where the local inspector can prove creation identity; macOS rejects this configuration rather than fencing its coarse process timestamp. The matching fencer validates provider, profile, host, and identity before it signals. Its durable quiescence source remains `fenced` if wake cleanup is interrupted, so a later startup scan can finish cleanup through `coldReplace()` and open a new activation id with the same Session and `resume` seed; a locally settled epoch is never resumed.

## Alternatives considered

**Reuse `session/prompt` as a remote activation API.** Rejected because a Session id does not identify one activation epoch, and generic Session status can belong to unrelated SDK activity.

**Adapt the one-shot SDK subagent provider.** Rejected because it creates a child task with private Session identity and closes its complete runtime at task settlement rather than retaining a reusable participant epoch.

**Include Link enrollment in `activation/open`.** Rejected because the Hub cannot authorize attach until the activation controller commits the durable binding, which happens only after placement publishes. The post-bind operation is owned by the [SDK post-bind Team Link enrollment decision](2026-08-29-sdk-post-bind-team-link-enrollment.md).

**Reattach the old activation id after a Hub restart.** Rejected because the new Hub cannot prove that the old process, credential, task lease, or receipt stream is still current. Cold replacement fences the old epoch and creates a new id instead.

## Consequences

An SDK process can host a durable-bound remote Participant epoch with fresh/resume provenance and exact lifecycle observation. After durable bind, it can receive direct and task-assignment input through an activation-local fixed Link, flush its Session source, acknowledge the durable delivery, report a task outcome, and post an explicit final output. A same-host deployment can cold-replace a fenced child after a Hub restart. The explicit startup-recovery Consumer scans the latest matching unfinished or `fenced` epoch for replacement and retries wake cleanup only for a locally `quiesced` epoch; remote supervision is owned by the [versioned endpoint decision](2026-09-08-owned-activation-supervisor-endpoints.md).

The [AgentRuntime service-definition decision](2026-08-27-agent-runtime-service-definition.md) remains the authority for the registry and in-process provider. The [durable activation binding decision](2026-08-28-durable-local-activation-binding.md) remains the authority for Team journal admission. The [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed because delivery, scheduling, workspace, and product phases are unfinished.

## Verification

SDK protocol, client, server, and fencer tests cover strict wire parsing, target matching, fresh/resume provenance, detached-group teardown, PID/start fencing, profile mismatch, post-bind enrollment, status ordering, interruption, disposal, and process loss. Activation-recovery tests cover current-state revalidation, startup proof invalidation, single-flight pulse cleanup, invalid interval rejection, and interrupted wake cleanup across restart; its focused source suite reaches 100% statement, branch, function, and line coverage. A real SDK child survives the first Hub's shutdown only until the second Hub fences it, then resumes the same Session under a new binding and writes a receipt through a new Link.
