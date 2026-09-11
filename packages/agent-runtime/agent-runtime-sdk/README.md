# @clocky/clocky-agent-runtime-sdk

English | [中文](README.zh.md)

`@clocky/clocky-agent-runtime-sdk` registers an out-of-process remote placement provider on `ctx.agentRuntimes`. It requires `clocky-agent-runtime`, `clocky-sdk-client`, `clocky-subprocess`, and `clocky-subprocess-local`; its default provider name is `sdk`, and `providerName` changes that registration name. `command`, `args`, `cwd`, `env`, and disposal limits select the child runtime explicitly.

## Activation semantics

Only an active `remote-agent` Participant can use this provider. A request supports `fresh` or `resume`, requires explicit Agent `provider` and `model` options, and creates one SDK child process for its accepted activation epoch. Fresh activation materializes paired Team/Participant Session provenance in the remote runtime; resume verifies that stored provenance. Fork seeds and named presets reject before a child process is allocated.

Every SDK operation carries the exact activation, Team, Participant, and Session target. The returned handle exposes `localAgent: undefined`, verifies target echoes and monotonic status sequences, and forwards only `activation.status` lifecycle observations. A stale status cannot revive an epoch. `offline` is published only after an exact remote offline response or the owned child process closes; if neither proves termination after a lifecycle or transport failure, the handle remains `stopping` and `health()` / `dispose()` surface `AGENT_RUNTIME_TERMINATION_UNCONFIRMED`. Concurrent requests for one Team/Participant share one handle only when they select the same Session.

When `teamLinkEnrollmentProvider` is configured, the provider waits for the Team controller's matching durable `activation/changed` binding, reserves an opaque credential from that issuer, and sends post-bind enrollment to the SDK child. The child owns fixed Link delivery; the parent owns credential revocation. Disposal closes child delivery before remote disposal and waits for a termination proof. Provider unloading blocks new requests without revoking accepted handles.

Configuring `recoveryProfile` and `recoveryHostId` together enables same-host cold replacement where the local inspector exposes an exact creation identity on Linux, macOS, or Windows. The provider records that profile, model route, and process identity, starts the child in an isolated POSIX group, and registers a matching fencer. A profile or host mismatch fails before replacement; macOS uses the kernel creation time including microseconds rather than the rounded `ps` timestamp.

`recoverySupervisor: { name, version, endpointId }` additionally records an exact supervisor descriptor and durably enrolls the owned process through the local `activationSupervisors` registry before publishing its handle. Mount the [execution-host endpoint](../activation-supervisor-http/README.md) before this provider. The provider declares `terminationMode: 'owned-process'`; remote health and fencing do not change its local process launch behavior.

## Model Experience

### Remote placement

#### What the model sees

`ctx.agentRuntimes` adds no prompt section or tool. This package does not expose a local Agent. With configured enrollment, the SDK child receives durable direct or task-assignment input through its activation-local fixed Link delivery.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no request prefix.

## Known Limitations and Deferred Work

- **No fork or named-preset composition** — only fresh and resume activation requests are supported.
- **Same-host provider only** — startup recovery orchestration and multi-host supervision remain separate Consumers.

The [SDK remote placement decision](../../../.agents/notes/implemented/architecture/2026-08-28-sdk-remote-agent-runtime-placement.md) and [subsystem reference](../../../docs/subsystems/agent-runtime.md) define the shared placement behavior.
