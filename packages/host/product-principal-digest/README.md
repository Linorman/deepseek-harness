# @clocky/clocky-host-product-principal-digest

English | [中文](README.zh.md)

`@clocky/clocky-host-product-principal-digest` authenticates a product credential by comparing its SHA-256 digest with a configured non-secret digest. It retains no plaintext credential, writes no state, and issues a revocable lease for each accepted authentication.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `sdk-digest` | Registry name selected by the SDK server. |
| `credentialSha256` | required | Lowercase SHA-256 hex digest of the initialization credential. |
| `principalId` | required | Stable non-secret product principal id. |
| `subject` | required | Stable non-secret provider subject. |
| `credentialGeneration` | `1` | Non-secret generation associated with accepted leases. |

The bundled Python SDK runtime receives `CLOCKY_PRODUCT_CREDENTIAL_SHA256`; its parent derives that value from the explicit initialization credential after removing plaintext credentials from the child environment. A configured digest that differs from the initialization credential rejects before child launch.

## Model Experience

### Product authentication

#### What the model sees

This provider registers no `prompt`, tool schema, model input, or model output.

#### Token effect

This provider adds zero model tokens.

#### KV Cache effect

It does not modify a model-request prefix.

## Known Limitations and Deferred Work

- Digest, principal, and generation changes require provider replacement; disposal revokes the provider's live leases.
