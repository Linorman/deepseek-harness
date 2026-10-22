# Agent Note: Complete World v1 deployment commitments

Status: implemented

English | [中文](2026-10-13-world-v1-deployment-commitment.zh.md)

## Problem

Effective limits cannot reconstruct the defaults and ceilings that a user reviewed. A change above an explicit requested limit can leave the effective number unchanged. Reconstructing a retained catalog from effective limits or invented template default Personas also discards original deployment decisions. Host Team bounds and configured scenario bounds have different owners.

## Decision

[Compiler version 7](../../../../packages/simulation/simulation-scenario/src/v1-compiler.ts) retains the complete strict `catalog` and independent `teamCeilings` observation. The catalog preserves Native settings, profiles/model versions, full templates/default Personas, policies, domain implementation/generation pins and every configured default/ceiling. A pure compilation without a Host Team observation stores explicit null. The public creation owner observes the actual Team ceiling before metadata IO, rechecks it afterwards and supplies it to compilation without overwriting the configured catalog.

Effective Team limits use the stricter configured and observed ceiling; explicit excess rejects before command acceptance. The reviewed preview hash covers the entire resolved artifact, including defaults, unused metadata and both ceiling sources. Changes affect the commitment even when the resulting effective limits remain equal. Portable definition hashes remain independent of deployment metadata.

The [private parser](../../../../packages/simulation/simulation-scenario/src/v1-resolved.ts) validates every retained field against the deterministic projection of that original catalog and observation. The [creation parser](../../../../packages/simulation/simulation-product/src/world-creation.ts) checks the definition/preview commitments and exact Native specification. Recovery never consults a newer catalog to fill missing original data. Compiler versions other than 9 or missing catalog/observation fields reject; pre-release artifacts have no migration promise. Native stream 94 retains finite director eligibility and source-triggered cases, rejecting earlier shapes.

## Alternatives considered

**Retain only effective limits.** This cannot distinguish changed defaults or higher ceilings and loses review provenance.

**Reconstruct template defaults.** Empty choices are invented metadata rather than the actual installed template's default Persona.

**Overwrite configured ceilings with live bounds.** This merges independently owned inputs and prevents later verification of the original configured ceiling.

## Consequences

The private accepted artifact is larger; the existing serialized-result and journal-entry limits apply without increases. Preflight may require renewed review for metadata that does not change current effective values. Public export still contains only the original authored definition and requires a new preflight for a new run. Existing accepted original commands retain their exact identities and metadata while the installed catalog changes or disappears.

## Verification

The [resolution tests](../../../../packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts) cover metadata-only default/ceiling changes in Native, Team and World groups, independent observed bounds, explicit excess, unchanged portable hashes and obsolete/incomplete artifact rejection. [Product tests](../../../../packages/simulation/simulation-product/tests/world-v1-schema.spec.ts) reject a changed metadata-only artifact under the old preview commitment. The [real Loader scenario](../../../../examples/simulation-company/tests/world-v1-resolution.snapshot.ts) exercises actual public preflight/create, accepted-command SIGKILL, missing/changed current catalog, paused cold preparation and separately accounted public checkpoint restore on JSON/SQLite.

## Scene authority

The original compiled declaration and installed capability jointly authorize an environmental request. Model role text and a calendar body alone cannot grant this authority. An independent per-declaration request allowance bounds repeated scheduling without increasing the shared World/Agent limits. Native records actual occurrence eligibility and the accepted Decision source; a case without an ordinary recipient uses a Native planning duty, not a fabricated self-post. Separate causal views preserve the original request, plan and result in the Session. The ordinary notification chain keeps its existing consumption contract.

Treating every director goal as role authority would bypass employment and operation permissions. Requiring a self-Channel would invent communication evidence rather than recording an environment trigger. The selected contract therefore requires an explicit domain opt-in and restricts each occurrence to its exact selector, scope, target and business key; rejected and cancelled cases do not refund its independent allowance. The shared finite queue still serves ordinary actors. Source replay reconstructs the original declaration/occurrence and rejects edited or missing history.

[Declaration tests](../../../../packages/simulation/simulation-scenario/tests/v1-director-events.spec.ts), [Native source tests](../../../../packages/simulation/simulation-local/tests/world-bootstrap.spec.ts) and the [real Agent scenario](../../../../examples/simulation-company/tests/world-director-events.snapshot.ts) own strict capability/budget/refusal, source integrity, ordinary service and cold replay coverage.
