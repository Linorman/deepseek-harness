# Agent Note: Task reference status and conflict review

Status: implemented

English | [中文](2026-09-29-task-reference-status-and-conflict-review.zh.md)

## Problem

A dependency missing from a candidate page can be off-page, deleted or outside the inspected Team. The editor cannot infer that distinction from page membership. Revision feedback showing only current instructions also hides a proposed name or dependency overwrite.

## Decision

The Hub resolves only explicitly requested task IDs under its Team serializer. `team.task.references` returns bounded title, revision and lifecycle status, including retained deletion tombstones; unknown and foreign-Team IDs share one unavailable result. Rows omit instructions, results and histories. Requested IDs are unique, offsets address that input vector, and continuation pins the Team cursor. Existing provider row, text, input and complete JSON-byte allowances govern the query.

Trusted native consumers own their authorization as for task inspection. The Host authenticates direct or canonical parent readership before provider work and again after success or failure. A readable dependency or status hint grants no mutation authority.

One runtime reader owns a form's current and proposed reference union. Public browser capacity, batch and refresh limits bound observation. It publishes the complete same-revision result atomically, rejects old or mismatched pages, cancels replaced readers, preserves ordinary failure/disconnect content and clears withdrawn authority. It never enumerates candidate pages to infer references.

After current task refresh, conflict review compares all fields accepted by `taskUpdate`: trimmed name, complete instructions and the exact proposed dependency list. Stale records remain labeled until refreshed. Changed fields are identified before explicit current-revision confirmation. Deleted/unavailable dependencies remain selected and removable; submission stays blocked until the user removes them and current reference status is available. Candidates, drafts and exact reference facts have separate owners.

## Alternatives considered

**Treat candidate absence as deletion.** Pagination and title filters remove valid dependencies from that window.

**Load every candidate page.** It defeats bounds and combines different revisions.

**Read complete task histories for each dependency.** Display/status resolution acquires unrelated payload and competes with selected task inspection.

**Automatically remove rejected dependencies.** It changes the user's dependency graph without confirmation.

## Consequences

Unknown or failed reference reads can delay submission while preserving input and removal controls. Capacity rejects rather than truncates a selected set. The read projection does not add task-update command receipts or unknown-outcome recovery; that protocol remains independent. The [draft lifetime decision](2026-09-29-team-form-draft-lifetime.md) owns retention, quotas and disposal.

## Verification

Core tests prove requested order, tombstones, unavailable IDs, UTF-8 response bounds, exact offsets and wire refusal. JSON/SQLite tests retain the same Team state. Host tests reject unauthorized readers before the provider and withhold success/failure after authentication retirement. Runtime tests cover atomic pages, stale revisions, capacity, replacement, polling, cancellation and reconnect. Component tests compare all three editable fields and require explicit removal of deleted/unavailable IDs. The real-Host keyless task-draft scenario exercises the current comparison and deletion workflow.
