# Agent Note: Principal-scoped Team discovery and byte reads

Status: implemented

English | [中文](2026-09-28-principal-team-directory-and-readers.zh.md)

## Problem

Unfiltered discovery exposes other principals' Team metadata. Raw storage cursors can reveal hidden journal names even after rows are filtered. Channel-only requests need an ownership lookup before membership can be checked, and artifact providers can finish reading after their caller loses authority.

## Decision

The human binder issues a revocable, non-serializable principal reader for discovery. It records the principal, issuer, subject and credential generation but grants no membership or mutation. The Hub examines a configured bounded number of physical names, resolves canonical read membership and publishes safe summaries under all selected Team and ancestor queues. Final publication rechecks the reader and membership; revoked authentication rejects the response. Metadata excludes grants, goal budget bodies and physical scan counts. Titles have explicit truncation, and directory rows carry Host-authorized member or parent-inspection access.

Product continuations encrypt the storage position with a per-Hub key and bind all four authentication facts through authenticated data. Node's [authenticated cipher API](https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options) supplies AES-256-GCM; cursors contain no clear storage position and no server-side cursor cache. Tampering, another reader, changed credentials or a replaced provider expires the cursor and requires an explicit first-page read. Complete response admission includes the encrypted token; a row which exceeds the page allowance retains its original scan position or rejects if indivisible.

`getChannelOwner()` returns only an attached Team/channel tuple within the provider allowance. Product raw reads and waits resolve that tuple, retain current membership proof throughout their read and revalidate before returning. Rejection conceals derived Team identity. Artifact byte reads use the same before/after checks while preserving provider selection, visibility and byte limits. An expired proof can return no previously read bytes.

The [parent inspection decision](2026-09-28-parent-team-product-inspection.md) retains canonical ancestry and mutation isolation; the [bounded-read decision](2026-09-01-bounded-team-control-plane-pages.md) retains internal replay pages and scan accounting. Product discovery is a separate consumer with encrypted cursors and safe metadata. Internal provider discovery and the existing SDK management reader still have separate authorization contracts.

## Alternatives considered

**Filter rows while returning the raw provider cursor.** Hidden storage names remain recoverable from the continuation.

**Store every continuation in a server map.** This adds retention, expiry and capacity obligations for positions that fit in authenticated ciphertext.

**Check membership only before provider IO.** Revocation during IO can expose a completed read under expired authority.

## Consequences

Discovery has bounded work and responses without loading every page in the browser. A provider replacement expires outstanding cursors. Permission lookup can hydrate the selected Team journals; response bounds do not establish a cold-history performance guarantee. [Session reads and retained observers](2026-09-28-team-session-product-readers.md) own Team content, workspace references, exports and per-frame authority. That decision also owns Session-forwarded event authority and explicit authentication-loss cache cleanup. [SDK readers](2026-09-28-sdk-principal-team-readers.md) cover its directory and selected reads; SDK notifications retain a separate audit.

## Verification

JSON and SQLite delegation tests verify member/parent directory access. Host tests cover cross-principal filtering, continuation reuse, authentication loss, raw channel rejection and withholding artifact bytes. Cipher/page tests cover context changes, provider replacement, tampering, empty continuation, scan advancement and complete byte admission with per-file 100% coverage. Real-Host keyless collection and child navigation scenarios exercise the product directory without additional model requests.
