# @clocky/clocky-product-principal

English | [中文](README.zh.md)

`ctx.productPrincipals` is the authenticated product-principal seam. A transport selects a named provider at its credential boundary, receives a revocable lease, and runs each protected dispatch through a fresh runtime-only `AuthenticatedProductCall`.

Providers expose only non-secret principal facts: a branded stable id, issuer, subject, assurance, and credential generation. The registry never serializes credentials or provider errors; it stops new work when a provider retires and revokes each lease after its admitted calls settle.

## API

- `registerProvider(provider)` contributes an effect-scoped named authenticator.
- `bootstrapCredential(provider)` returns a provider-owned bootstrap secret only to a trusted transport owner.
- `authenticate({ provider, credential, signal? })` returns an `AuthenticatedProductPrincipalLease`.
- `lease.withCall(operation, signal?)` supplies the only `AuthenticatedProductCall` a protected dispatcher should receive.

## Model Experience

### Product authentication

#### What the model sees

No product principal, credential, digest, or `AuthenticatedProductCall` is model-visible.

#### Token effect

This seam adds zero model tokens.

#### KV Cache effect

It adds no model-request prefix.

## Known Limitations and Deferred Work

- This seam authenticates and revokes runtime calls only; Team principal ownership and human actor-proof binding belong to its Consumers.
