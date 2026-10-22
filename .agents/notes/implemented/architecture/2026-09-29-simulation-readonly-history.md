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

Personnel inventory uses a separate read-only provider method and the original installed Native domain manifest. It pairs the bounded report with its replayed snapshot without opening or restoring a run. The Team service combines that inventory with actual task, attempt, activation, workspace and Channel delivery books, then rechecks Native and canonical source prefixes. Source movement, missing canonical coverage and overflow remain incomplete; service shutdown and cancellation prevent late publication. Product obligation pages bind their continuation to the complete report fingerprint as well as the Native revision and authenticated reader/disclosure lifetime. Rows retain exact typed owner references, original states and uncertainty; only actual navigable targets receive links. Metadata and a complete inventory grant no cancellation, transfer or departure authority. People lists retain unknown obligation counts until a complete inventory is explicitly read.

## Alternatives considered

**Open history as another run.** It conflicts with coordinator ownership and may materialize storage.

**Use immutable SQLite mode for live runs.** Mutable WAL state needs ordinary consistent reads and locking.

**Read only an unchecked cached summary.** It cannot validate history or reconstruct entity/decision detail.

## Consequences

Complete history replay and copying remain bounded but potentially expensive; this adds no performance claim or unlimited scale promise. Oversized or incomplete history rejects rather than truncating a world snapshot. Product registration and authenticated metadata projection belong to the [product directory](2026-09-29-simulation-product-directory.md); mutable ACLs, owner coalescing, administrative restoration, driver and Web/SDK integration remain separate work. Reading a persisted running phase neither resumes it nor establishes a live product owner.

## Verification

Storage tests cover missing media without materialization, live-writer reads, detached values, physical/stream versions, malformed JSON, continuity, UTF-8 bounds, checkpoints, compaction and medium-size changes. Simulation tests retain phase/revision while local or foreign ownership is held and after release, reject wrong specs/media, and preserve missing directories. A keyless runnable-example snapshot boots actual Loader processes for JSON and SQLite: one holds the coordinator while another inspects identical running history, then rereads after release without opening execution ownership.

[Provider inventory tests](../../../../packages/simulation/simulation-local/tests/personnel-inspection.spec.ts) preserve actual owned and cold JSON/SQLite obligations without execution open. [Team inventory tests](../../../../packages/simulation/simulation-team/tests/personnel-readonly.spec.ts) read real canonical task responsibility, reject late cancelled results and report Native movement as partial. [Product inventory tests](../../../../packages/simulation/simulation-product/tests/world-personnel-inventory.spec.ts) retain required nullable references and reject an old cursor after an actual Channel acknowledgement while Native confirmation is held. Python tests cover every reference variant, missing required fields, unknown fields and required-null serialization. These owner tests do not establish a complete browser or real-model acceptance matrix.

## Derived inspection index

Explicit maintenance publishes `inspection-index.json` only after strict schema validation and file sync, using a private same-directory staging file and atomic rename. The versioned manifest retains contiguous sequence/kind/hash references and an exact source-prefix hash. A pre-publication failure preserves the prior file; an interrupted staging file is never selected. A post-rename directory-sync failure requires reading the published manifest again. No business record is deleted or rewritten.

Inspection always validates the original complete prefix under its existing row/byte allowance. Matching source hashes permit reuse of reference metadata; every observation replays the original reducer and final invariants with the exact installed domain implementations. Missing, malformed or stale persistent indexes fall back to this bounded path. Persisted references never supply business values, authorization or counts. The provider retains no second full business projection: full JSON documents already require source decoding, so a detached snapshot cache adds memory without removing that scan. SQLite detail replay uses consistent bounded pages; JSON remains an explicitly bounded complete document. Complete snapshot byte accounting sums exact entry encodings and wrappers without constructing another full-journal JSON string. None of these paths claims constant-time history reads.

The authenticated Product, Host fetch, Client runtime and both SDKs expose exact-revision index rebuilding. Transport identity, run ownership and policy generation are rechecked after source IO and before publication admission. Collection cursors include policy generation, and late results are discarded after its replacement. Repeated rebuild requests create no business effects or model calls.
