# Agent Note: Owned activation supervisor endpoints

Status: implemented

English | [中文](2026-09-08-owned-activation-supervisor-endpoints.zh.md)

## Problem

A Hub cannot prove execution stopped from transport loss, and an authenticated remote caller must not select arbitrary process ids to kill. The existing SDK process fencer supplies exact process-tree evidence on its own host, but recovery needs a versioned remote owner and durable enrollment before it can use that evidence across a network.

## Decision

The [supervisor registry](../../../../packages/core/activation-supervisor/README.md) resolves an exact name/version and validates the complete activation-generation descriptor on each returned observation. Health has four outcomes; only `terminated` permits a fence result. Provider retirement blocks new operations while admitted operations retain their implementation.

The [HTTP endpoint](../../../../packages/agent-runtime/activation-supervisor-http/README.md) enrolls only process identities produced by a trusted local SDK provider before activation publication. Its durable stream records the Team, Participant, Session, runtime provider, process creation identity, and supervisor generation. HTTP exposes health and fence only; credentials cannot enroll another process. The endpoint compares each request with its persisted owner record before invoking the existing SDK process-tree fencer. Confirmed termination is persisted before the response, preserving repeatable fencing after restart.

The activation controller resolves supervision independently of its transport. Missing versions, unreachable endpoints, and unknown execution produce an exact current-epoch Team stall; they never mark an activation offline. A cold-replacement caller's `AbortSignal` is passed through the supervisor-backed fence, so cancellation can stop an in-flight remote fence request; caller cancellation itself propagates without recording a fence-failure stall. Recovery discovers Teams through bounded pages and accepts explicitly configured supervisor hosts. The SDK provider still owns process placement and Session availability for replacement.

## Alternatives considered

**Treat disconnection as termination.** Rejected because remote tools may continue changing external state after the Link closes.

**Accept any authenticated process descriptor.** Rejected because a credential proves the requesting deployment, not ownership of an arbitrary process. Only local runtime enrollment establishes that relation.

**Select a newer registered supervisor version after restart.** Rejected because process identity and fencing semantics are versioned execution contracts.

## Consequences

Remote supervision adds no model loop or prompt. Exact process creation identity remains mandatory; macOS retains its fail-closed limitation. The [SDK placement decision](2026-08-28-sdk-remote-agent-runtime-placement.md) retains fresh/resume and local process ownership authority; this decision owns its remote supervision extension. Neither record is fully superseded. The [native Team proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) retains cross-host placement, E2B loss, and complete distributed acceptance requirements.

## Verification

Focused tests cover registration retirement during an accepted fence, generation mismatches, unknown/unreachable results, durable owner restart, credential rejection, process-identity substitution, version selection, remote recovery without the local fencer, and invalid recovery-stall authority. The Linux-only HTTP process test launches and terminates a real detached child and replays termination after endpoint restart; it is skipped on the current macOS host. Cross-host deployment and E2B loss acceptance remain unverified by these local tests.
