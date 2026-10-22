# @clocky/clocky-storage

Read-only snapshot allowance failures carry `StorageError.code = read-limit`; invalid observation configuration remains `invalid-value`. Version mismatch and corrupt-medium failures retain their own codes.

English | [中文](README.zh.md)

`LogReadLimits` and `LogReadSnapshot` define bounded detached history for consumers that must not acquire writer handles. The JSON and SQLite providers export medium-specific readers; descriptor/config validation precedes IO, and complete returned JSON plus retained-row allowances reject overflow. These observations grant no application authorization or compaction authority.

Storage hub (`ctx.storage`) for non-session data: a named backend registry plus mounted data-form facilities. The hub performs no IO itself — backends own media, and data forms own semantics. The [storage family overview](../README.md) maps those packages; the [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) records the design rationale.

## Shape

- `ctx.storage.backend` — name → backend table. Multiple backends stay mounted side by side (`json`, `sqlite`); which backend serves a consumer is that consumer's configuration (the domain layer's route table), never a hub-global choice. `register()` returns the disposer; duplicate names and unknown lookups fail loud.
- `ctx.storage.mount(form, facility)` / `ctx.storage.form(form)` — data-form mounting. `StorageForms` is merge-extensible; the domain and log layers merge `domain` and `log`, reached as `ctx.storage.domain` and `ctx.storage.log`.
- A backend owns one medium and exposes the data-shape facets it supports. `kv` stores current records; `log` supplies expected-tail append streams, checkpoints, and checkpoint-gated prefix compaction. `src/backend.ts` owns both contracts.

## Model Experience

### Backend and form registrations

#### What the model sees

Nothing. `ctx.storage` is a host-side registration table; the hub registers no tools, injects no prompts, and writes no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the hub never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

- **Forms resolve lazily** — reading `ctx.storage.domain` or `ctx.storage.log` before its plugin mounts throws `form-not-mounted`; assemblies order plugins accordingly (misconfiguration fails loud rather than silently deferring).

`captureLogArchive(stream, cursor, limits)` exports a complete original prefix under its domain owner's serializer. It requires first sequence zero, exact tail, contiguous entries and finite aggregate entry/byte/page limits; it does not acquire ownership or compact history. The archive keeps original stream names, format versions and sequence numbers for owner-validated restoration.
