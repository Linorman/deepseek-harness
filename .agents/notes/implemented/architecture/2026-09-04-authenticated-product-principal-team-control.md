# Agent Note: Authenticated product-principal Team control

Status: implemented

English | [中文](2026-09-04-authenticated-product-principal-team-control.zh.md)

## Problem

Loopback reachability, a Team id, a participant id, or a Session header cannot prove which product user requested a Team mutation. Durable human ownership also needs a closed representation that survives restart without retaining credentials or reusable proofs.

## Decision

`ctx.productPrincipals` owns revocable authenticated calls. The Web composition uses the rotating local provider and exchanges its credential through an owner-only handoff document, while the bundled Python runtime compares the handshake credential with a configured SHA-256 digest. Credentials, digests, cookies, and proofs remain runtime-only. Transport teardown closes bootstrap admission before revoking retained leases, and an in-flight browser handoff cannot publish a new artifact after disposal. Current-run start retry identity includes the non-secret human owner, so the same key cannot replay another principal's result.

Human Participants retain a closed owner: `{ kind: 'product-principal', principalId }` or `{ kind: 'system' }`. Interactive TeamRun creation derives the first form from the authenticated call; unattended runs retain the system form. Current journal and checkpoint readers reject missing, malformed, reassigned, or duplicate active product-principal owners.

`team-human-actor` selects one active product-principal-owned human and mints a one-shot proof for the parsed operation, payload, and cursor or revision. Host and SDK wire contracts remain actor-free. Their Team mutations use that proof under Hub revalidation, including topology, channels, tasks, goals, detached archive, and resume. Current-run input, final wait, cancellation, coordinator prompt, and SDK run records additionally require the caller to own the run's durable human. Team-bound approval and question responses use the same ownership check before they settle a pending action.

Resume retains a Hub-issued runtime authorization through TeamRun, the resume phase proof, and activation-controller binding. Each durable phase or activation bind rechecks the authorization; a revoked authorization disposes an unpublished raw handle rather than publishing a new coordinator. Host response routes recheck the pending action's exact participant, product principal, active phase, and immutable `human-action` grant after their asynchronous Team read.

This note is the product-authenticated human consumer of the broader [Team actor proof control plane](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.md). The multi-area [P0 safety proposal](../../proposed/architecture/2026-09-04-native-multi-agent-p0-safety-closure.md) remains proposed because its lifecycle, lease, and view decisions have separate scope.

## Alternatives considered

**Treat loopback or `trustedHosts` as a human identity.** Rejected because reachability does not prove possession of a product principal.

**Accept principal ids, participant ids, or proofs on mutation wire payloads.** Rejected because serializable authority is replayable and could enter durable or model-visible data.

**Pass the plaintext SDK credential to the child environment.** Rejected because clients deliberately scrub it from child launch state. The runtime receives only a non-secret digest configuration.

## Consequences

Older Team journal/checkpoint formats reject rather than converting ownership. A deployment that uses the bundled SDK runtime supplies an explicit credential to the client and its SHA-256 digest through `CLOCKY_PRODUCT_CREDENTIAL_SHA256`; a missing or mismatched digest fails at load or initialization. Headless Teams remain system-owned and cannot use generic human control routes.

## Verification

Focused Core/Team, Host/Web, SDK, client-runtime, and Python SDK suites cover credential rotation and redaction, owner/replay validation, proof fencing and revocation, resume kill points, response-action ownership, strict actor-free schemas, and authenticated mutation routes.
