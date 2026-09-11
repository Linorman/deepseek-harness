# @clocky/clocky-team-artifact-local

English | [中文](README.zh.md)

`@clocky/clocky-team-artifact-local` registers a content-addressed `ctx.teamArtifacts` provider for Team task outputs. It stores files, patches, logs, screenshots, and reports as private regular files, returns a hash-verified `TeamArtifactReference` carrying its provider name, and never embeds bytes in the Team journal or channel Envelope.

## Configuration

`root` is an absolute directory created with owner-only permissions. `maxBytes` bounds one object and `maxArtifactsPerAttempt` bounds distinct content hashes retained for one task attempt. `providerName` is the registry prefix used in references; every value is validated before registration. An optional `retention` section enables a Team-aware reachability owner: `graceMs`, `maxObjectsPerDrive`, and `disposalTimeoutMs` are required there, while `pulseIntervalMs` is an optional recurring drive.

The provider writes with exclusive creation and reuses an existing object only when its bytes match the requested SHA-256 digest. Reads reject path escapes, symlinks, missing objects, and hash mismatches. Direct `delete()` remains a retention no-op because content-addressed objects may have multiple Team references. The configured retention owner pages through every non-archived Team, traces task-attempt artifacts from both ordinary and integration result fields, keeps newly unreachable objects for the configured grace, and calls the provider's bounded cursor sweep only for still-unreachable ids. Its in-memory grace ledger is deliberately conservative across restart: a restarted process observes an object again before it can be removed. A repeated or rewound Team-list cursor fails the retention drive with `TEAM_CURSOR_CONFLICT` rather than rescanning the same page.

## Model Experience

### Team artifact references

#### What the model sees

This package registers no prompt section, tool, model input, or model output. Task-report Consumers include `TeamArtifactReference` values in structured results, while authorized UI and API Consumers resolve bytes through the provider.

#### Token effect

Zero direct token effect; only a reference may enter a model-visible task result.

#### KV Cache effect

This provider owns no model-request prefix.

## Known Limitations and Deferred Work

- The provider is local to one host and does not replicate objects between Hub processes.
- Remote/object-store providers and cross-host retention remain deployment-specific implementations of the same artifact service.
- Without `retention`, this package mounts storage only; collection must be driven by another Team-aware Consumer.
