# @clocky/clocky-storage-json

English | [中文](README.zh.md)

JSON backend for the [storage hub](../storage/README.md): human-readable KV-unit and append-log files under a configured root, registered as backend `json`. Design: [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md).

## Model

- The in-memory unit state is authoritative; every write primitive republishes the whole file via temp-write + fsync + atomic `rename()` replace. A unit file is always the complete current net state — legibility is this backend's reason to exist; scale is the SQLite backend's job.
- A missing file opens as an empty unit and materializes on the first write. A foreign or unparsable file rejects with `malformed-medium`; a stored version differing from the descriptor rejects with `version-mismatch` (no migration, pre-release stance).
- Write ordering across calls belongs to the caller (the domain layer's write chain); each single call is atomic and durable once resolved.
- Log streams live in `logs/<base64url-name>.json`. An expected-tail append rewrites the complete stream document atomically, so an accepted batch is visible together; checkpoints cannot move backward or exceed the tail.
- The log facet takes one root-wide owner record before any log operation. A second local Hub fails with `writer-locked`; a dead same-host owner is quarantined before recovery, while a different-host owner fails closed.

## Config

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | required — no default (a cwd fallback would scatter files) | Directory holding unit files; created `0o700` on demand |

## Model Experience

### Stored host data

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session records and append logs behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

- Windows durability relies on libuv's `rename()` (`MoveFileExW` with replacement) without an explicit write-through flag.
- The JSON log facet is deliberately single-Hub. It rejects a live foreign or same-host owner rather than coordinating distributed writers; SQLite is the log backend for concurrent writers.
