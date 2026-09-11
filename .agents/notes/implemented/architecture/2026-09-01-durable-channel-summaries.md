# Agent Note: Durable channel summaries

Status: implemented

English | [中文](2026-09-01-durable-channel-summaries.zh.md)

## Problem

A summary affects model-visible channel history. Read-time text truncation cannot prove which accepted messages it represents, retain a stable retry result, or protect a private subset message from becoming a globally visible summary. Generation therefore needs an explicit authorized command and a durable source relationship.

## Decision

`clocky-team` defines the selection, source-read and summary-commit methods. `clocky-team-channel-summary` is the shipped deterministic extractive Consumer: it reads a bounded source range through the Hub, extracts outside the Hub queues, retains the selected adapter and view-policy implementations, and issues a short-lived canonical output proof. The current coordinator tool and authenticated human Host API call that Consumer. A separate requester proof binds a current coordinator activation or a human's exact `send` input; the system output proof alone grants no caller authority.

A new command requires an active Team/channel, no closure or cancellation intent, an allowed explicit channel policy and an exact channel cursor. Every selected message must be visible to every immutable manifest member. Sender visibility and the accepted Envelope audience establish this relation. Private subset sources fail before generation without exposing hidden text. The channel-wide record format deliberately carries no per-viewer visibility mask.

The durable record stores the source WAL range, exact ordered Envelope ids, a SHA-256 fingerprint of their canonical complete values, text, policy identity and channel-scoped idempotency key. The Hub rereads that range and checks identity, visibility, fingerprint and authority before append. WAL/checkpoint recovery validates the same source relationship. Summary provenance pins the source range against compaction. Channel WAL version 6 and checkpoint version 9 require the fingerprint; old formats are rejected.

Matching key/range retries return the original summary, even with a stale cursor or after restart. Conflicting range or low-level payload reuse is rejected. New identities require a fresh cursor. The `summarized-window` policy projects the latest durable summary and its uncovered ordered raw tail; without a summary it projects raw messages. Default TeamRun directed channels support explicit commands returning the summary text while retaining their original directed projection. They do not automatically shorten model history.

## Alternatives considered

**Read-time synthesis or a local cache.** Neither establishes durable provenance or stable restart idempotency. A view only projects accepted facts.

**A summary as an ordinary participant message.** This would enqueue recipient work and give generated control text the identity of conversational input. A dedicated record keeps delivery and receipt state unchanged.

**An unbounded or implicit model summarizer.** The shipped Consumer uses configurable history, source-byte, source-count and output-byte bounds. Text extraction requires no model call or synthetic usage. Any future model implementation must own a Team Task and log its request through a real Session.

**Private text in a globally readable summary.** A per-viewer projection cannot undo a leak already persisted in channel-wide text. Such ranges are refused; private summaries require a distinct durable visibility design.

## Consequences

The explicit tool and human API return usable text with durable retry identity. JSON/SQLite Loader snapshots exercise the real default coordinator, tool executor, human binder, Host fetch carrier, Hub and AgentClient. They independently reread storage fingerprints and reconstruct the summary-plus-tail delivery from persisted Session events. Provider regressions cover visibility, stale cursors, bounded Unicode extraction, proof revocation and malformed durable provenance.

Extraction handles text payloads and text-only content arrays. It does not schedule automatic compaction, summarize images, infer facts or generate model requests. Source retention costs storage. Model-generated summaries, property/model-based testing, browser/GIF and load evidence remain outside this implementation.
