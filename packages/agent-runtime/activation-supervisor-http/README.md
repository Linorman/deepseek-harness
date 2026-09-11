# @clocky/clocky-activation-supervisor-http

English | [中文](README.zh.md)

Mount `/endpoint` on an SDK execution host and `/client` beside the authoritative Hub's supervisor registry. Both select the same `name`, `version`, `hostId`, and `endpointId`; the client resolves its configured URL and credential environment variable without persisting either in Team state. The client requires HTTPS unless `allowInsecureHttp` explicitly permits an isolated HTTP deployment. The listener's TLS/reverse proxy remains deployment-owned.

The endpoint also requires `storageLog`, `runtimeProvider`, `profile`, `bindHost`, `port`, `credentialEnv`, `fenceGraceMs`, `requestTimeoutMs`, `maxPayloadBytes`, and `maxConcurrentOperations`. The client requires `url`, `credentialEnv`, `timeoutMs`, and `maxPayloadBytes`. These limits bound payloads, admission, network waits, and process termination. Both sides read the configured credential for each request, so rotating the environment value takes effect without recreating the client or listener; an empty value fails closed as unavailable.

An SDK runtime configured with `recoverySupervisor: { name, version, endpointId }`, `recoveryProfile`, and `recoveryHostId` enrolls its exact activation/Team/Participant/Session/process identity through the local registry before publishing its handle. Each enrollment occupies a versioned `activation-supervisor/<digest>` stream. HTTP exposes only authenticated health and fence operations; an absent enrollment or changed process fingerprint rejects before signaling. A confirmed termination is appended before returning success, so replay does not need to infer a disappeared Windows process tree.

The endpoint uses the existing exact SDK process inspector and bounded tree fencer. Linux, macOS, and Windows supply exact creation identities; an inspector without them is rejected. Closing the listener drains accepted operations, and credentials never appear in descriptors or response diagnostics. `unreachable` and `unknown` never imply process termination.

## Model Experience

### Remote execution ownership

#### What the model sees

No prompt or tool is registered. The activation controller records unavailable supervisor evidence as a `Team stall`.

#### Token effect

No direct model-context tokens.

#### KV Cache effect

No request-prefix changes.

## Known Limitations and Deferred Work

- **Scope** — This provider supervises already placed SDK processes; remote placement and replacement Session availability remain the selected AgentRuntime provider's responsibility.
- **Deferred deployment coverage** — E2B loss settlement needs its own supervisor provider, ownership streams have no automatic enrollment-retention drive, the real process HTTP fence test requires Linux, and cross-host deployment acceptance requires two configured hosts.
