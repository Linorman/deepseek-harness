# @clocky/clocky-team-human-actor

English | [中文](README.zh.md)

`withReader()` holds immutable principal, issuer, subject and credential-generation facts for discovery consumers. It requires no existing Team membership and grants no Team access itself; the provider checks every returned object. Completion, call revocation and source unload retire the opaque reader. A reader cannot serve as a member or mutation proof.

`openReader()` returns that reader with a retirement signal and idempotent `close()` for a stream consumer. The consumer owns cleanup; authentication revocation or source unload aborts the lease even while no frames arrive. `session-content-read` uses membership-only authority and binds the complete Team/member/Session tuple; the Hub independently checks its durable binding.

Identity, readiness, Session, channel-list and channel-content inspection can anchor a proof to the nearest active human in a canonically reserved ancestor Team. The callback receives that membership Team, and the complete target payload remains fingerprinted. Other operations still resolve target-Team membership. Missing/private Team inspection uses `TEAM_HUMAN_ACTOR_FORBIDDEN`; ancestry never supplies a mutation or consent grant.

`@clocky/clocky-team-human-actor` binds an `AuthenticatedProductCall` to exactly one active human Team participant whose durable `owner` equals the authenticated product-principal id. It registers the resulting runtime-only proof source on `ctx.teams`.

`resolveHumanActor()` supplies bounded identity and operation names; proof issuance does not copy a full Team snapshot. The membership-only `task-capabilities-read` scope binds the exact submitted paths to a read fence, permits no mutation, and is rechecked by the Hub.

## Semantics

`ctx.teamHumanActors.withProof()` verifies the participant's immutable operation grant, fingerprints the complete JSON-only mutation input with its Team cursor or revision fence, and exposes the proof only to its callback. The proof remains resolvable for repeated Hub checks during that callback, then is revoked. Revoking the authenticated call or unloading the binder invalidates it immediately.

`channel-invitation-read` proofs use a `read` fence and require current human ownership, without requiring a mutation grant. They authorize only the Hub invitation query; explicit acknowledgement still requires its existing consent permission.

## Failures

No matching active human produces `TEAM_HUMAN_ACTOR_NOT_FOUND`; multiple matches produce `TEAM_HUMAN_ACTOR_AMBIGUOUS`; a missing operation grant produces `TEAM_HUMAN_ACTOR_FORBIDDEN`. Forged, expired, revoked, or source-unregistered proofs produce `TEAM_ACTOR_PROOF_INVALID`.

## Model Experience

### Authenticated human proof binding

#### What the model sees

Nothing. `AuthenticatedProductCall` values, proof tokens, fingerprints, and owner matching are runtime-only.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package does not modify model-request prefixes.

## Known Limitations and Deferred Work

- **One active human per principal** — a call with multiple matching active human participants is rejected as ambiguous rather than selecting one.
