# @clocky/clocky-team-artifact

English | [中文](README.zh.md)

`@clocky/clocky-team-artifact` defines the provider-independent `ctx.teamArtifacts` registry. The Team Hub records only immutable artifact references and task provenance; a mounted provider owns byte persistence and verified reads for files, patches, logs, screenshots, and reports.

Providers register through an effect-scoped `registerProvider()` call. Consumers select a provider explicitly for `save()`, `read()`, and optional retention `delete()` or bounded `collect()` operations. A readable reference may carry its named provider; references without one remain metadata-only for consumers that cannot derive a safe route. A reference is not an authorization grant; callers enforce Team visibility and policy before reading bytes. Collection accepts the current reachable references and provider-owned ids that already passed a grace policy, so a content-addressed provider never treats a direct single-object delete as garbage collection.

## Model Experience

### Artifact storage

#### What the model sees

This package registers no prompt section, tool, model input, or model output. Task and workspace Consumers decide which `TeamArtifactReference` values enter a model-visible result.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This service owns no model-request prefix.

## Known Limitations and Deferred Work

- The service has no default provider; each composition must mount a storage implementation.
- Retention policy remains a Team Consumer responsibility; providers only implement bounded, provider-owned collection when they can do so safely.
- Replication and remote/object-store collection remain deployment-specific.
