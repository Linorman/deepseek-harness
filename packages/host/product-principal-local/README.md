# @clocky/clocky-host-product-principal-local

English | [中文](README.zh.md)

The shipped local provider persists one stable non-secret product principal below the Harness home. Every open replaces the current credential with a fresh 256-bit bootstrap credential, persists only its SHA-256 digest and monotonically increasing generation, and rejects every earlier credential.

`bootstrapCredential()` exposes the plaintext only to a trusted transport-bootstrap owner. `authenticate()` accepts that same credential for browser bootstrap or an SDK connection, returns a distinct revocable provider lease, and never includes the supplied value in diagnostics or persisted state.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `local` | Registry name for this provider. |
| `path` | `<CLOCKY_HOME>/product-principal.json` | Private state filename. |
| `clockyHome` | resolved Harness home | Home used when `path` is omitted. |

## Model Experience

### Local credentials

#### What the model sees

This provider registers no prompt, tool schema, result, credential, or `ProductPrincipal` model input.

#### Token effect

This provider adds zero model tokens.

#### KV Cache effect

It adds no model-request prefix.

## Known Limitations and Deferred Work

- Browser cookie issuance, loopback bootstrap exchange, and SDK handshake carriage are transport Consumers and are not mounted by this provider alone.
