# Agent Note: Simulation read-only history

Status: implemented

English | [中文](2026-09-29-simulation-readonly-history.zh.md)

## Problem

Simulation provider open acquires a coordinator lock and creates backend resources. Product browsing cannot reuse it without becoming another execution owner or changing missing-run behavior. Backend log open has its own writer lifetime and is likewise unsuitable.

## Decision

Storage owns explicit row and encoded/complete-result byte allowances plus detached sequence metadata. JSON reads an existing atomic document through a bounded read-only file descriptor; SQLite reads existing schema/stream state in a read transaction without backend initialization or migration. Both retain version, continuity and checkpoint checks, return missing history distinctly and reject overflow. No backend writer handle is acquired.

SQLite read-only connections can create or reuse WAL/SHM bookkeeping files. Application rows, database format and coordinator owner files remain unchanged. SQLite's [WAL format](https://www.sqlite.org/walformat.html) defines this behavior; immutable mode is inappropriate for a live mutable database. Unsupported media or reader failures remain errors rather than falling back to writer open.

The Simulation registry separates inspection resolution from execution open. A provider without inspection support fails before IO. Local inspection expects the deployment-selected provider and immutable spec, replays complete retained history through existing folds and projection checks, and returns a trusted-native snapshot plus observed ownership. Native consumers own authorization and public redaction; this is not a Web DTO.

`inspectionMaxEntries` and `inspectionMaxBytes` configure observation bounds. An existing kernel owner is probed read-only without acquiring, replacing or deleting its database. Observations distinguish this provider, another coordinator, unowned and unavailable evidence; none grants takeover authority. Owned runs are indexed by immutable run ID, and their index entry retires before a successfully drained owner unlocks. Provider shutdown closes inspection admission and waits for admitted observations before releasing existing runs.

## Alternatives considered

**Open history as another run.** It conflicts with coordinator ownership and may materialize storage.

**Use immutable SQLite mode for live runs.** Mutable WAL state needs ordinary consistent reads and locking.

**Read only an unchecked cached summary.** It cannot validate history or reconstruct entity/decision detail.

## Consequences

Complete history replay and copying remain bounded but potentially expensive; this adds no performance claim or unlimited scale promise. Oversized or incomplete history rejects rather than truncating a world snapshot. Product registration and authenticated metadata projection belong to the [product directory](2026-09-29-simulation-product-directory.md); mutable ACLs, owner coalescing, administrative restoration, driver and Web/SDK integration remain separate work. Reading a persisted running phase neither resumes it nor establishes a live product owner.

## Verification

Storage tests cover missing media without materialization, live-writer reads, detached values, physical/stream versions, malformed JSON, continuity, UTF-8 bounds, checkpoints, compaction and medium-size changes. Simulation tests retain phase/revision while local or foreign ownership is held and after release, reject wrong specs/media, and preserve missing directories. A keyless runnable-example snapshot boots actual Loader processes for JSON and SQLite: one holds the coordinator while another inspects identical running history, then rereads after release without opening execution ownership.
