# Agent Note: Team artifact storage and provider pricing

Status: implemented

English | [中文](2026-08-31-team-artifact-storage-and-pricing.zh.md)

## Problem

Team task results could name file-like artifacts, but no provider-independent service owned their bytes or verified references. Usage aggregates retained provider cost only when an adapter supplied it, so a deployment could not apply one auditable pricing table to provider reports that carried token counts but no cost.

## Decision

`@clocky/clocky-team-artifact` defines `ctx.teamArtifacts` as an effect-scoped provider registry. A provider saves bounded bytes, returns a content-addressed `TeamArtifactReference`, and verifies hashes on reads. `team-artifact-local` stores regular files beneath an owner-only root for file, patch, log, screenshot, and report references. Worktree `publish()` uses the provider when configured to persist bounded changed files and tracked binary patches; without it, the provider-local reference remains explicit. Content-addressed deletion is a retention no-op until a reachability owner exists.

Provider-backed references carry the named provider used for reads. The Host `team.artifact.read` operation selects an exact reference from the durable Team result, rejects private or ambiguous ids, requires that provider to be mounted, enforces a fixed response byte bound, and returns verified bytes as base64; references without provider provenance remain metadata-only.

The SDK server exposes the same read-only operation as `team/artifact-read`, and the TypeScript and Python clients keep the Team id, artifact id, visibility, provider, byte bound, and base64 response aligned with the Host path. SDK errors distinguish a hidden or missing artifact from an unavailable provider without accepting a caller-supplied URI.

The Team-aware local retention owner traces every artifact slot reachable from a completed attempt, including ordinary result artifacts, integration proposal artifacts, and integration final artifacts, before applying its restart-conservative grace ledger. `TeamUsageSample` records provider/model provenance. `team-hub` snapshots `usageRates` into each Team's rules at creation and prices a sample when its explicit `costUnits` is absent, resolving an exact `provider/model` key, then a provider key, then `*`. Explicit provider cost remains authoritative, and usage replacement retains idempotent turn/step accounting.

Workspace providers expose an optional `integrate()` operation. The worktree provider supports a reviewable proposal and fail-closed merge mode; it never commits, merges, or pushes without a separate integration authority and `workspace-integrate` policy decision.

## Alternatives considered

- Keep artifact URIs as unverified strings. Rejected because a task result could point at a deleted, mutable, or cross-Team path and the UI could not prove provenance.
- Put bytes into the Team journal. Rejected because large outputs would amplify WAL and channel payloads and make retention, deduplication, and authorization inseparable from Team state.
- Trust provider-reported cost only. Rejected because adapters that report token buckets without billing metadata would silently undercount deployment budgets.
- Let a worktree provider merge the main checkout during `publish()`. Rejected because publication is an observation boundary; merge authority must preserve dirty user work and perform conflict/review checks explicitly.

## Consequences

Task results can carry durable file and patch references without copying bytes into model contexts, and local providers can be replaced by remote/object stores without changing Team schemas. A deployment must mount an artifact provider to persist bytes; references from a composition without one remain provider-local and are not a durable read capability. Pricing is deterministic per Team but requires operators to configure route rates; samples from unknown routes retain token counts with zero cost until an explicit cost or matching rate arrives.

The worktree provider can produce a proposal but still does not implement repository merge, branch publication, conflict resolution, or cross-host retention. Those operations remain explicit integration and deployment authority.

## Verification

- `pnpm exec vitest run packages/core/team-artifact/tests packages/team/team-artifact-local/tests packages/team/team-workspace-worktree/tests packages/team/team-hub/tests/team-hub.spec.ts` passes.
- The local retention test retains nested integration proposal and final artifact references instead of treating them as unreachable.
- `pnpm run verify-config-catalog`, `pnpm run verify-cordis-config`, `pnpm run verify-package-invariants`, `pnpm run verify-package-readme-model-experience`, `pnpm run verify-doc-refs`, and `pnpm run verify-md-wrap` pass after regeneration.
- `pnpm exec tsc -b tsconfig.host.json --pretty false` and selected changed-source `oxlint` pass.
- Host API tests cover visible reads, private/missing references, unavailable providers, and cancellation; runtime and Team detail tests cover provider-backed reads, bounded previews, downloads, stale-response suppression, and unmount cancellation.
