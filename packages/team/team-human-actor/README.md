# @clocky/clocky-team-human-actor

English | [中文](README.zh.md)

`@clocky/clocky-team-human-actor` binds an `AuthenticatedProductCall` to exactly one active human Team participant whose durable `owner` equals the authenticated product-principal id. It registers the resulting runtime-only proof source on `ctx.teams`.

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
