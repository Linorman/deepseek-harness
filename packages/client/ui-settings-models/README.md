# @clocky/clocky-client-ui-settings-models

English | [中文](README.zh.md)

Provider-neutral Models settings surface for the browser client. It joins the `llm.providers` directory, redacted `settings.describe` views, and value-free credential descriptors into one snapshot, then renders one editor at a time without treating route liveness as provider identity.

The page lists configured provider profiles and labels a row as custom only when the LLM directory says its adapter has no installed catalog entry. A dormant catalog route can be added deliberately; the page never selects a vendor, creates a hidden adapter, or supplies a default provider or model.

The pi-ai editor writes only the fields it owns through path-addressed `settings.mutate` operations. It supports the provider endpoint, display name where applicable, model ids and names, model capacities, and the provider protocol exposed by the schema. Fields outside that set survive edits. A model list is materialized only when the user changes it; resetting it removes the user-layer override.

Credential inputs are write-only. The page resolves the profile's credential reference, shows only the configured/writable state, and sends a typed value through `credentials.set`; it never puts a secret in settings responses or local drafts. Empty input keeps the existing credential. Invalid model ids, capacities, and key text are rejected before a write or endpoint interrogation.

The page refreshes after settings, credential, provider-topology, or connection-reset notifications. A failed credential read degrades the badge while preserving the settings page; a failed settings or provider read preserves the last usable snapshot and reports the failure. Read-only settings disable edits without hiding the provider directory.

## Model list and endpoint interrogation

The model list editor shows one row per model, with optional context-window and output-cap fields. A configured provider can ask its adapter for models using the endpoint and key currently shown in the form; returned candidates remain staged until the user selects and adds them.

Adding a custom provider requires a unique route id, a supported protocol, an endpoint, and at least one model. The profile write and credential write use separate operations, so a failed credential write can be retried without replaying a stale settings revision.

## Model Experience

None, as this package renders configuration UI and does not assemble or send provider requests.

#### KV Cache effect

None; provider adapters own request construction and cache behavior.

## Known Limitations and Deferred Work

- **The editor is intentionally curated** — advanced adapter fields remain available through the settings document and are preserved when the page updates the fields it owns.
- **Endpoint interrogation is protocol-specific** — the page delegates discovery to the owning adapter and leaves models editable when that adapter cannot interrogate the endpoint.
- **Provider ids are stable keys** — changing a route id is a delete-and-add operation because sessions, settings paths, and credential references address it.
