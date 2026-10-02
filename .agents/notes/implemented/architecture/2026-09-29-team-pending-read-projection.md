# Agent Note: Team-scoped pending read projection

Status: implemented

English | [中文](2026-09-29-team-pending-read-projection.zh.md)

## Problem

The principal inbox retains one delivery window and its display acknowledgement can remove visible entries. The Team task table also retains one page. Neither window proves the complete Team pending set or provides stable priority across off-page human requests and task reviews.

## Decision

The Web overview uses its independent bounded preview and preserves all-pending navigation from authoritative counts after preview failure. The pending module has separate paging, error preservation, revision feedback and URL restoration. Human links open a dedicated current-request dialog; task and blocker links reuse their exact inspection owners. Session context remains an explicit inspection.

The Hub reads complete current Team task/action maps under its serializer and returns exact pending counts with one bounded summary page. Team stalls and stalled delegations precede human actions, then task reviews; real creation time, opaque identity and kind break ties. Summaries omit action bodies, task instructions, results and grants. Team selection carries the same aggregate counts.

`attention-read` proofs bind the complete parsed input and current direct or canonical parent readership. Parent inspection supplies no mutation authority. Handling hints distinguish permission, lifecycle, accepted responses, obsolete attempt/participant/Session relationships, designated reviewers and delegation recovery ownership. Every later command retains its existing authorization and revision checks.

Continuation pins Team identity, journal revision, ordering version and exact last position. A moved revision requires explicit first-page refresh. Complete UTF-8 capacity includes counts, rows and continuation; an indivisible oversized row rejects. Host `team.attention.read` rechecks readership after provider IO, including failed reads.

Runtime preview and full-list owners cancel superseded requests, retain authorized pages after ordinary IO failure, clear denied data, and stop old generations from publishing after selection or credential replacement. Preview polling reads only its first page. A known newer Team revision disables continuation until refresh. Abort callback reentrancy cannot erase a replacement reader.

`team.action.inspect` returns one retained body, current handling and Team cursor under the same human read proof, including processed requests. Runtime cancels old reads and rejects responses behind observed Team or answer facts. The UI viewing store retains only user input and retry identities under the shared draft quota. Closing and reconnecting preserve input; reload, account replacement or permission withdrawal clear it. Answers require explicit current inspection and retain the Host response fencing.

## Alternatives considered

**Filter the loaded principal inbox or task page.** Off-page or acknowledged entries disappear while their Team responsibility remains pending.

**Fetch every client continuation to construct a total.** It defeats server bounds and combines changing revisions.

**Send complete action and task bodies in the pending list.** Summary capacity becomes dependent on private prompts, result payloads and histories which have separate authorized readers.

**Treat a readable parent or a handling hint as write authority.** Inspection does not inherit the target Team's modification, consent or execution permissions.

## Consequences

The projection bounds response bytes and rows; it does not promise bounded cold hydration or map traversal. Delegation recovery remains owned by its existing executor. The [bounded-page decision](2026-09-01-bounded-team-control-plane-pages.md) retains collection and inspection semantics, and [task creation time](2026-09-29-team-task-creation-time.md) supplies stable task origin. Full permission and visual matrices remain separate acceptance work.

## Verification

Projection tests pin priority, counts, byte limits, exact continuations, handling reasons and wire refusal. JSON/SQLite tests page real durable review facts without changing Team state. Real Host tests prove inbox acknowledgement does not remove pending responsibility, reject unauthorized readers before the provider, and withhold success/failure after authentication retires during IO. Runtime tests cover failure preservation, revision refresh, disconnect/reconnect, denial, watcher replacement and abort reentrancy. The keyless real-Loader collection scenario reads the Host query and compares its counts with Team selection.
