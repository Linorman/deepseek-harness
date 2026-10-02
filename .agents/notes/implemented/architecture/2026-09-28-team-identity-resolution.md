# Agent Note: Authorized identity references and cache lifetime

Status: implemented

English | [中文](2026-09-28-team-identity-resolution.zh.md)

## Problem

A task owner or channel participant can be outside the current member page. Fetching every member to obtain a name defeats bounded views. Retaining a previously authorized name after a principal change exposes data from the wrong authentication context.

## Decision

Canonical parent inspection is governed by the [parent inspection decision](2026-09-28-parent-team-product-inspection.md). It extends where a current human read proof can be anchored while retaining this decision’s cache, principal-generation and revocation rules.

`resolveIdentities()` requires a payload-bound active-human read proof. The Hub deduplicates requested IDs, performs direct member lookups under its serializer and returns only display-name prefixes and participation phases. Unknown IDs use an unavailable row. Pages preserve request order and use the Team revision for continuation. Existing row, text and complete-page byte limits apply; the query never enumerates the member collection or starts actors.

The Host adds an opaque principal-generation discriminator to `team.identity.resolve` and `host.describe`. The discriminator hashes principal ID, issuer, subject and credential generation; it is cache metadata, not authority. Identity and member-detail handlers recheck authority after reading. Member inspection retains a proof for the exact referenced participant and validates current human membership before and after reading metadata. A completed connection handshake pins the client scope. Identity responses cannot change it, and responses from cancelled watchers cannot publish.

The runtime owns one bounded identity cache per connection. Keys include Team and participant within the pinned scope. Visible references are deduplicated and queried in bounded batches; all pages must agree on revision and authentication before publication. Cache eviction removes the oldest retained entry. View changes stop polling while preserving scoped names; disconnect retains names with unavailable status. Authorization denial or scope replacement cancels reads and clears cached names and other Team detail projections. Team-list and start responses also check the authorization generation before publishing.

A successful browser credential replacement revokes the session cookie supplied with that bootstrap. Revocation aborts its calls and streams before the replacement session is installed. Invalid bootstrap attempts leave the current session intact. Handshake comparison then clears old principal projections before refreshing the new connection.

Task owners, attempts and channel participants use the same runtime identity observations. A reference remains assigned when its name is absent. Departed members retain their historical names with a departed marker; unavailable identity results suppress stale names. Shared member-reference controls open the authorized inspector from task owners, attempt history, overview and channel details. The inspector exposes the complete ID and reports clipboard success only after an accepted write. Disconnect status is visible while names remain unverified. The UI owns neither the name cache nor member traversal. Polling, batch size and retained identity capacity are validated browser deployment configuration.

## Alternatives considered

**Cache current member pages in React.** Those pages do not cover all referenced identities, and view components cannot own authentication invalidation.

**Accept the scope on the most recently arriving identity response.** Response arrival order does not establish the current principal; an old request may finish after a credential replacement. The handshake pins authority and request generations fence stale work.

**Clear names for every network interruption.** Transport loss alone does not establish changed authorization. Same-scope names remain useful while explicitly unavailable; a changed scope or denied read clears them.

## Consequences

Identity reads remain independent of member pagination and do not alter task ownership. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) continues to own Team attention, task drafts and Simulation product integration. The opaque scope is process-local cache coordination, not a persistent identity format or an independently deployable authentication protocol.

## Verification

Pure projection tests cover direct lookup, Unicode prefixes, request deduplication, continuation and byte bounds. JSON and SQLite tests cover authorized reads without journal writes. Host tests cover foreign principals, changed credentials and revocation during reads. Client tests cover bounded eviction, mixed pages, network failure, scope changes, stale responses and clearing retained details. The real browser scenario keeps a completed task's owner named after paging that member out of the loaded member window.
