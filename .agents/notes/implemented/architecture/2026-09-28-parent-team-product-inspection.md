# Agent Note: Parent-authorized Team product inspection

Status: implemented

English | [中文](2026-09-28-parent-team-product-inspection.zh.md)

## Problem

A delegated child has a parent service endpoint rather than the parent user's human participant. Requiring local human membership for every display-name query prevents that user from inspecting delegated work. Unprotected collection reads expose unrelated Teams to other authenticated principals; creating a synthetic child human would also imply unsupported mutation and consent authority.

## Decision

`resolveHumanReadAuthority()` selects the nearest active principal-owned human along a canonical delegation. Each parent link must match the child's depth and parent task, the task's reserved child ID and creation identity, and any published child binding. The Hub loads the finite lineage, then rechecks it under ancestor-first queues. Missing membership or a missing Team yields the same inspection refusal; ambiguous membership rejects without selecting another ancestor.

The human binder anchors identity, readiness, channel-list and channel-content read proofs to that membership Team. The fingerprint retains the complete target payload. The Hub rechecks current membership, uniqueness, the reserved lineage and the exact operation/payload when resolving a proof. Mutation, execution-profile, task-capability and invitation-consent proofs continue to require membership in the target Team. Parent inspection grants none of those operations.

Host selected-Team metadata, member bindings, task/workflow inspection, collections, human-action reads, audit and quiescence reads retain an active proof through the read and revalidate before returning success or failure. The product selection includes the Host-computed `readAccess`; caller-authored access metadata is rejected. The provider includes that field in its complete selection byte allowance. The workspace presents parent inspection as read-only and removes mutation, cancellation and resume callbacks while retaining identity and execution inspection.

The [identity-cache decision](2026-09-28-team-identity-resolution.md) retains cache lifetime and principal-generation rules. The [closure decision](2026-08-31-team-closure-authority-and-detail-inspection.md) retains cancellation admission and quiescence. Host cancellation reconciles only known pending-cleanup errors against its exact durable TeamRun cancellation key and rechecks read authority; it returns the observed phase without promising terminal cleanup. A missing intent or unrelated implementation failure still rejects.

## Alternatives considered

**Add the parent's human to every child.** Membership would create endpoint, consent and mutation responsibilities that inspection does not require.

**Allow any declared parent ID.** A parent field alone does not prove the canonical task reservation or delegation identity and cannot grant data access.

**Use unprotected reads for child views.** They bypass current principal membership and permit unrelated object reads.

## Consequences

Inspection follows durable delegation ownership while execution remains with its existing owner. Product discovery, raw channel and artifact reads follow the [principal directory decision](2026-09-28-principal-team-directory-and-readers.md). Global event broadcasts, Session APIs and SDK management reads still require their separate authorization audit.

## Verification

JSON and SQLite delegation tests cover parent inspection, exact target fingerprints, revoked proofs, forbidden child mutations and indistinguishable missing/private Teams. Host tests reject unauthenticated and foreign-principal reads before storage work, reject authored access metadata and retain revocation checks. Selection tests cover exact byte capacity. The real-Host browser scenario supplies a cancellable child model, inspects the live child and members, restores its deep link and observes parent/child cancellation without fabricating execution facts.
