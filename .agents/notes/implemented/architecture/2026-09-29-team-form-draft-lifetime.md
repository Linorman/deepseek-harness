# Agent Note: Team task-form draft lifetime

Status: implemented

English | [中文](2026-09-29-team-form-draft-lifetime.zh.md)

## Problem

Task forms keep input and creation retry identity in component state. Dismissal or Team replacement discards both; reopening against a newer task can also replace the revision from which the user edited. A transport failure can conceal an accepted creation, so losing its identity permits duplicate work.

## Decision

The registration-owned viewing store retains task-form fields under exact Team, operation and task identities. Create, edit, review and integration have independent slots. Raw text, dependency and member IDs, execution choices, review reason, integration source and target, and creation fingerprint/key remain input. Initial editable fields and the reviewed revision support disposal and stale-edit detection; current task records, histories, permissions and capability observations remain in runtime.

Task forms share the channel/human-answer count and complete UTF-8 quota. A rejected update preserves every previous draft and cannot send a command whose retry identity was not stored. Views with drafts remain pinned within the existing view limit. Closing retains registered input, explicit discard confirms actual loss, and confirmed submission releases its slot. Page departure warns while task input remains; reload and account/permission replacement clear these memory-only form drafts.

URLs carry only operation and object identities. Restoration reads the exact task through the Host before displaying restored input. The original draft revision survives closing and navigation; a changed task disables submission until explicit current-version confirmation. A blank form waits for its initial runtime record rather than treating unloaded fields as an empty task. Creation retries preserve the same key for the same semantic payload; Host authorization and idempotency remain authoritative.

The task inspector opens retained edit input independently of the new-edit menu, including deletion tombstones and tasks with active execution. Team-page eligibility separately gates submission and original retry, requiring the active Team phase already enforced by the mutation owner. Stalled, quiescing and terminal Teams preserve the retained input and original-result lookup with an explicit read-only explanation. Read-only canonical-parent inspection, terminal Teams and deployments without a management callback can inspect an original result without writing. The dialog still requires its exact authorized task record; stale or disconnected facts cannot enable submission. A failed version read disables confirmation and writes while leaving its refresh action available after pending IO settles, so an error cannot make its own recovery unreachable.

## Alternatives considered

**Keep every form mounted.** It retains background observation lifetimes and makes input retention depend on layout.

**Persist drafts in localStorage.** It adds sensitive-data location, quota, expiry and authorization-clearing decisions which this memory-only feature does not promise.

**Store complete task snapshots as drafts.** Histories and permission facts become competing UI business state.

## Consequences

Reopening forms requires current authorized inspection and can fail while preserving input. The shared quota may reject another form until the user discards unneeded input. The [update admission decision](2026-09-29-task-update-command-admission.md) owns durable edit identity and original acceptance lookup. The [reference/conflict decision](2026-09-29-task-reference-status-and-conflict-review.md) owns current field comparison. The [workspace decision](2026-09-11-team-workspace-ui.md) retains composition and navigation ownership.

## Verification

Component tests cover raw creation fields, same-key retries after dismissal, independent Team/operation slots, review and integration input, source attempts, stale revision confirmation, capacity rejection, explicit discard and initial inspection. The real Host/keyless task-draft scenario covers modules, Teams, history, reconnect, accepted creation with a dropped response, page departure, credential replacement and narrow layout. Its production scheduler uses a configured waiting threshold; no task attempt or model request is started.
