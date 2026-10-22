# Agent Note: Reference-preserving world archives

Status: implemented

English | [中文](2026-10-19-world-reference-archive.zh.md)

## Problem

Checkpoint references identify owner prefixes but do not carry the bytes needed for offline recovery. Moving only a Native journal leaves Session input, Channel evidence and images dependent on the original machine.

## Decision

[Sealed collection export](../../../../packages/simulation/simulation-team/src/archive.ts) copies full Native, Team, Channel and Session prefixes plus referenced images through their actual owner capabilities. Unmaterialized Sessions remain references without fabricated logs. Full prefixes conservatively preserve all earlier references and capacity accounting; no source deletion or compaction is offered. Cross-Team ancestry and unsupported external Session parents reject rather than produce an incomplete archive.

Immutable archive bodies and attachment bytes have SHA-256 checks. Verification also compares complete Session headers and image reference metadata against retained references: a matching identity alone cannot prove the archived content will satisfy the original reader. Location publication follows copy, readback verification and fsync. A location contains the original reference pins; incomplete or missing locations are not readable archives. Restore validates opaque records through their original installed owner parsers in isolated staging, requires explicit cwd relocation, preserves the original package, and publishes only after owner closure. The target publishes a legal new checkpoint for relocated headers; original checkpoint manifests and journal prefixes remain unchanged. A receipt records the source hash, header path mappings and new checkpoint identity. The old checkpoint correctly rejects mapped Session fingerprints, while the new anchor supports ordinary restore and explicit resume. Successful retries revalidate existing owner data; failed unpublished staging is disposable after owners close.

[Full private bundles](../../../../packages/simulation/simulation-team/src/backup.ts) add a strict content-bound manifest without rewriting owner evidence. Package hashes include all metadata and bytes; per-owner hashes, versions and cuts support inspection before target preparation. The only offline conversion is `world-archive/1` to `world-backup/1`, using the fixed `archive-envelope/1` converter and exact input/output hashes. It wraps original records with no losses and cannot repair missing semantic evidence. Unknown required Session events reject; explicitly ignorable originals remain. New business-schema conversions require their own evidence-preservation tests and are not inferred from this envelope conversion.

Publication uses an exclusive content-address link after staging verification and fsync, so concurrent retries cannot overwrite an earlier successful package. Full packages contain private historical text and use owner-only plaintext storage; deployments can encrypt outside the format and must keep keys separately. A redacted dataset cannot claim writable equivalence. Historical cwd remains provenance, with explicit target routing required before execution; credentials and runnable Host configuration are excluded. Import validates installed owner parsers in staging and never starts actors or real adapters. Full Product bundles additionally bind original completed creation or branch-command frames as distinct families; branch imports never invent a world-create preflight approval. The Host-only Product restore helper validates the exact original Native prefix and same principal, imports those original frames in one journal append, and registers paused discovery before directory publication. Target routing remains deployment-owned; other Product administration request history is outside this creation-provenance contract.

Ordinary `world-backup/1` packages reject federation-time evidence anywhere in the current run or retained provenance, including journal evidence hidden by an inconsistent supplied snapshot. Raw owner archives remain composable components, but a self-contained federated restore requires the complete federation checkpoint and its mailbox prefix proofs. Envelope migration cannot remove this dependency or supply fabricated time authority.

## Alternatives considered

**Native-only copy** omits canonical cognition and delivery evidence, so it cannot justify reference-aware retention.

**Deleting the hot prefix immediately** would require archive-aware implementations of every current owner reader. The initial API instead retains both copies and claims no capacity reclamation.

**Rewriting old business records during envelope conversion** could fabricate approval or delivery evidence. The supported converter only adds metadata, leaving business-version migration unsupported.

## Consequences

The [two-backend recovery tests](../../../../packages/simulation/simulation-team/tests/archive.spec.ts) take the source path offline before loading empty target owners. They cover actual images, empty materialized and unmaterialized Sessions, pending plans, cwd relocation, failed staging, retry, missing closure and corrupted objects. Archive formats reject unknown versions; there is no partial retention, descendant-Team export or automatic hot-storage deletion. Hosts must supply an isolated target composition and validate the restored closure before publication; raw opaque JSON is not semantic validation.

Product retention commands use a separate authenticated journal: accepted records contain the original input and complete archive bytes, and completion publishes that exact hash. Retries after accepted publication failures resume from original bytes. Private archived record pages reuse the current whole-record grant, independently of run ownership. Quiescent preview never calls phase management or actor retirement.

The [backup-format tests](../../../../packages/simulation/simulation-team/tests/backup.spec.ts) cover complete byte bounds, manifest tampering, redacted/config rejection, exact converter plans and required unknown events. The two-backend Loader recovery test also exercises full-bundle publication, concurrent retries, corrupt-destination refusal, offline conversion and source preservation before restoring from inaccessible source paths. Missing custom domain/provider reference contracts reject rather than claiming portability.

The [Product Loader and process tests](../../../../packages/simulation/simulation-product/tests/backup-import.spec.ts) kill an actual target process after Product journal/directory registration but before publication, then restore into a new staging root and reopen paused discovery. Source paths are offline, the original command remains readable, and explicit restore uses the new import anchor.
