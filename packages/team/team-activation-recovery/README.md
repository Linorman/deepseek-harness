# @clocky/clocky-team-activation-recovery

English | [中文](README.zh.md)

`@clocky/clocky-team-activation-recovery` is an explicitly mounted Consumer for same-host SDK or ACP recovery through local fencers or exact remote supervisors. During startup it delegates selected unfinished or externally fenced epochs to `ctx.teamActivations.coldReplace()`; an optional pulse repeats the same latest-binding scan for activations created after startup. It registers `team-activation-recovery` and asks `ctx.teams.quiesceActivation()` only through a one-shot proof for wake cleanup on a locally settled epoch; it never calls a fencer itself.

## Startup selection

The scan considers an active `local-agent` or `remote-agent` participant's latest durable activation only. Its plan kind, binding provider, and recovery profile must exactly match the configured values; the default kind is `sdk-local-cold-replace`, and ACP uses the explicit `acp-local-cold-replace` kind. A local plan matches `hostId`; a supervised plan may also match an explicitly listed `supervisorHosts` execution host. It accepts any unquiesced activation status, including `offline`, because the controller owns process fencing and durable replacement.

`quiescenceSource: 'quiesced'` is a completed local shutdown and is never replaced; a nonterminal retained wake retries only `quiesceActivation()`. `quiescenceSource: 'fenced'` proves the old process was stopped and remains eligible for cold replacement, whose controller-owned fence path retries wake cleanup before binding the new epoch. Each candidate is re-read before action and candidates run sequentially. An already owned controller epoch is skipped. A controller recovery failure that records a named `SUPERVISOR_*` or `AGENT_RUNTIME_*` durable stall leaves the remaining Team scan available; generic controller or persistence failures reject startup.

## Configuration

`provider`, `profile`, and `hostId` are required non-empty values without surrounding whitespace. `kind` defaults to `sdk-local-cold-replace` and must match the provider's durable plan. `pulseIntervalMs` optionally enables bounded recurring scans. `pageSize` defaults to 128 Team identities; `supervisorHosts` adds exact remote execution hosts. Accepted pulse work settles before proof ownership is released on unload. Mount this Consumer after the matching runtime provider and activation controller during a controlled Hub-start window. A repeated or rewound Team-list continuation fails startup recovery with `TEAM_CURSOR_CONFLICT` instead of rescanning the same page.

## Model Experience

### Startup recovery

#### What the model sees

This package registers no `prompt`, tool, model input, or model output. A resumed Agent receives only inputs delivered by separate Team Link Consumers.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package does not modify a model request prefix.

## Known Limitations and Deferred Work

- Each mount selects one SDK provider/profile. Remote supervision requires its exact registered version and a replacement provider able to resume the selected Session; a stalled Team requires explicit lifecycle recovery.
- Without `pulseIntervalMs`, the scan runs once at explicit mount time. With it, a single-flight recurring scan retries failed recovery and notices newly created activations.
