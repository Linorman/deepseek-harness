# Agent Note: Team and Simulation workspace hierarchy

Status: implemented

English | [中文](2026-10-01-webui-workspace-hierarchy.zh.md)

## Problem

Durable Team and Simulation capabilities need a readable operational workspace. Crowded headers and technical fields can hide the next action; retained drafts can make a failed destination appear to be an earlier object; an accepted local receipt can conflict with completed request metadata. Presentation must resolve these ambiguities without changing execution or authorization.

## Decision

Use existing Cordis slots, framework-bound hooks, runtime services and semantic tokens. Team and installed Simulation are parallel workspace entries. Domain selection, filters, scroll positions and bounded private drafts retain their existing owners. Components do not keep a second business-response cache.

Workspace roots fill the content stage. Identity, primary actions, status and navigation have separate space. Human attention and pending execution remain distinct. Simulation collections share filtering, pagination and inspector geometry but retain domain-specific columns. Exact simulated time stays a string; business results, publication and delivery are separate facts. Existing bounded summaries supply rows without per-row inspection requests.

Directory, overview and request history use workspace scrolling. Collections and non-modal inspectors own their reading regions, with one primary panel at narrow widths. Wide forms keep a stable action position; viewports no taller than 420px scroll the whole dialog so fixed chrome cannot consume the field area. Native modal layers own focus isolation, including image previews above Session inspection. The first-work composer is an inline region. Writable coordinator communication and read-only execution records share one stable conversation subtree; closing viewing does not cancel execution.

Requested targets, displayed objects and source routes are separate. Rejected, missing, invalid-binding and failed reads have their own destination body. Source history retains bounded same-document view parameters, not private input. Returning revalidates the source and restores a surviving control or heading; hidden views cannot consume that focus marker. Clearing a previous selection happens before Team-start IO, so a late acknowledgement cannot close a later explicit inspection.

Runtime compares retained receipts with independently observed request-journal metadata, only within the matching run and journal revision. Metadata never synthesizes a receipt or authorizes a replacement command. Terminal observations and conflicts remain query-only. A reserved capacity marker reports an observation that cannot fit, preserves the original input and query, and blocks retry/release until fresh metadata fits. Off-page absence is not failure and cannot clear that marker.

Request history is a secondary More destination, separate from world-event Records. Durable rows and warm originals appear once; off-page originals and management/ingress identities remain recoverable. Workspace owns request reads on entry to both overview and history, preserving reconciliation when the history presentation is hidden. Unknown creations without an assigned run remain reachable from the directory. Inspecting a retained maintenance original first selects its exact run, then opens the original command-key dialog; viewing never allocates a replacement or repeats execution.

Automatic-task capability comes from the immutable execution mode projected from the retained creation driver. Confirmed cognition-only runs omit automatic-task controls; empty counts and unavailable reads do not establish capability absence. Known native record types have localized labels, while exact custom filters and unknown or truncated type strings keep their original meaning.

The [Team workspace decision](2026-09-11-team-workspace-ui.md) retains Team composition, artifact and mutation authority. The [Simulation viewing decision](2026-09-29-simulation-browser-viewing.md) retains read families, private-content permissions, durable identities and recovery semantics. Neither is fully superseded. [DESIGN](../../../../DESIGN.md) and [UX-CONTRACT](../../../../UX-CONTRACT.md) own current presentation conventions.

## Alternatives considered

**Cosmetic restyling alone.** Color and spacing cannot resolve destination identity or conflicting observations of one request.

**Rewrite the frontend and state management.** Existing cancellation, authority, draft retention and command recovery already encode the required business boundaries. Replacing them adds regression risk without improving those boundaries.

**One universal administrative table.** Entities, decisions, operations and checkpoints answer different questions. Shared geometry does not justify flattening their semantics or fetching full objects for each row.

## Consequences

Progressive disclosure reduces the initial reading burden, while details and recovery require explicit navigation. Shared layout changes affect every consumer, so viewport geometry, keyboard focus, late callbacks and authorization retirement require assembled-browser evidence. Native modal previews avoid body-portal content being trapped below another dialog.

The [implementation plan](../../../../design/webui-review-2026-10-01/implementation-plan.md) and [verification record](../../../../design/webui-review-2026-10-01/evidence/implementation/verification.json) identify coverage and limits. Real Host tests use isolated JSON/SQLite storage and scripted inference where execution is required. They cover original-request recovery, source revocation, exact bindings, bilingual themes, native zoom, keyboard behavior and retained drafts. A 20/200-entity comparison pins bounded DOM and request fan-out; it is not a production-load or cross-device latency guarantee. Keyless evidence does not stand in for a live-provider GUI PR recording.

Native zoom evidence uses `chrome.tabs.setZoom` and independently reads `chrome.tabs.getZoom` from a browser-context-owned extension document. An MV3 worker may retire while Playwright retains its object, so an idle worker is not the controller owner. The [retirement regression](../../../../apps/web/tests/browser-native-zoom.e2e.ts) stops the real worker and verifies subsequent 100% and 400% zoom. Chromium may retain unresolved `finished` promises after CSS transitions finish, so rendering readiness observes finite animations’ current running/pending state with the existing polling bound. Pagination evidence waits for the exact next-page task identity before opening its draft; a retained previous page cannot stand in for a committed continuation.

Workspace draft actions publish complete maps, viewing order and draft counts before subscribers run, including reentrant observers. Each pinned view owns a counted draft; the validated `maxViewStates > maxDrafts` bound therefore guarantees an unpinned eviction candidate. Numeric selector comparisons follow successful native safe-integer validation, and synchronous portal effects consume refs attached by the same committed render. Asynchronous retirement guards remain with their owners.
