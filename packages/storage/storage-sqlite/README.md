# @clocky/clocky-storage-sqlite

`readSqliteRawLogArchive()` captures original stream version, sequence and stored payload bytes in one read transaction. It preserves entries, checkpoint and optional summary as base64 logical frames and retains the physical schema stamp as metadata. This is a bounded logical archive, not an exact physical database/WAL copy or consumer-state validation; opening a current-version backend is unnecessary.

`readSqliteLogPages()` holds one read transaction and captures the stream tail before yielding contiguous entry pages. `maxEntries` and `maxBytes` bound the aggregate observation; `pageEntries` and complete-envelope `pageBytes` bound each page. Sizes are checked before payload decode; an indivisible oversized row yields `read-limit` with `entry-bytes`, actual and limit. Later appends are excluded from the captured prefix. Consumers must finish or close the async iterator to release its read connection.

Read-only snapshot allowance failures carry `StorageError.code = read-limit`; invalid observation configuration remains `invalid-value`. Version mismatch and corrupt-medium failures retain their own codes.

English | [中文](README.zh.md)

`readSqliteLogSnapshot(path, descriptor, limits)` uses an existing read-only connection and one read transaction without schema initialization, migration, backend ownership or journal mutation. It checks physical/stream versions and encoded row/checkpoint sizes before decoding, then validates complete response bounds. SQLite may create or reuse WAL/SHM bookkeeping files during a read-only connection; these are [SQLite WAL semantics](https://www.sqlite.org/walformat.html), not an accepted application write. Immutable mode is unsuitable for a concurrently mutable journal.

SQLite backend for the [storage hub](../storage/README.md): registers as backend `sqlite`, serving `kv` and append-log facets over one `node:sqlite` database file (or `:memory:`). Design and trade-offs: [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md).

Log-name discovery seeks one row at a time through the stream-name index, with a UTF-8 prefix range and exclusive last-name key. It does not read log entries or checkpoints. New names after the current key can join a scan; a fresh scan discovers insertions before that key.

The log summary column is updated in the same transaction as entries and the tail. Bounded summary reads query only the stream metadata row, reject oversized UTF-8 values before returning them, and do not read entries or checkpoints. The physical schema version is 3; older stamped databases reject.

## Storage model

Document-per-row: each unit table becomes a physical `"u_<unit>_<table>" (key TEXT PRIMARY KEY, value TEXT)` STRICT table whose `value` is the record's JSON text, so one key updates one row (the reason to route a high-churn domain here instead of the JSON backend). Unit identity lives in two metadata tables — `units` stamps each unit's format version at first open and rejects a differing descriptor with `version-mismatch`; `unit_globals` holds each unit's global singleton row. The physical layout version lives in `PRAGMA user_version`; any other stamped value rejects (unreleased format, no migrations). Unit and table names are validated against the hub's `UNIT_NAME_RE` before they reach DDL, so no external input is ever interpolated into SQL identifiers.

Every write primitive is a single prepared statement — SQLite's per-statement atomicity satisfies the KV contract without explicit transactions, and write ordering stays the caller's responsibility (the domain layer's write chain). Missing directories and database files are created owner-only (`0o700`/`0o600`), matching the session-persistence SQLite backend.

Append logs use `log_streams`, `log_entries`, and `log_checkpoints`. A log append opens `BEGIN IMMEDIATE`, compares the durable tail, inserts the complete batch, advances the tail, and commits; a stale tail rejects with `sequence-conflict`. Checkpoints are monotonic and cannot exceed the current tail. Stream names are bound SQL values rather than identifiers, so Team and channel stream names remain opaque.

## Configuration (schemastery)

```ts
interface Config {
  path: string   // SQLite database file path, or ':memory:' for an in-process DB
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'   // journal_mode pragma; default 'wal'
}
```

## Model Experience

### Stored host data

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists non-session records and append logs behind `ctx.storage` for host-side consumers only.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None — the backend never touches live request prefixes.

## Known Limitations and Deferred Work

- **`DatabaseSync` is synchronous** — each write blocks the event loop for its statement or append transaction duration.
- **No busy-wait or retry policy** — another connection holding a write transaction rejects the operation immediately; callers retry a `sequence-conflict` or SQLite lock failure through their own durable command logic.
- **Only the current `STORAGE_SQLITE_SCHEMA_VERSION` opens** — any other stamped version is rejected rather than migrated (pre-release stance).
- **`openDatabase` duplicates the session-persistence SQLite open sequence** — extraction into a shared media layer is deferred to the planned session-backend migration (see the Agent Note's reuse audit).
