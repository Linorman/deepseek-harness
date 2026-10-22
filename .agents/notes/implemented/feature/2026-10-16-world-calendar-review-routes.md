# Agent Note: Finite calendars and immutable composite governance

Status: implemented

English | [中文](2026-10-16-world-calendar-review-routes.zh.md)

## Problem

Periodic triggers and single-committee approvals do not express bounded shifts, schedule replacement, independent review routes or explicitly delegated ballots. Changing their historical interpretation would redirect accepted work or reuse an approval for a different document.

## Decision

The existing Native journal remains the sole owner. Calendar recurrence supports simulation ticks and civil schedules using exact moment-timezone 0.6.5 with bundled IANA tzdb 2026e (MIT). Civil input freezes timezone, UTC origin, tick size, weekdays, local shifts, exception dates and additions; DST gaps/folds require reject/earlier/later. Compilation never uses host Intl or local timezone. Both clocks require finite bounded expansion. Priority orders equal-time/phase occurrences before their stable slots. Unknown room/equipment reservation fields reject; wakes do not reserve resources. A paused calendar edit retains its original command, expected rule revision and authenticated Host principal; one append cancels only pending occurrences and creates the new rule's first successor. Sources include the rule revision, so old bodies and frozen recipient wakes remain reconstructable. Director-authority calendars cannot be edited through this operation.

`governance.define-review-route` is an immutable pre-ballot operation requiring explicit authority for every committee. Its canonical hash binds every original proposal, frozen electorate, voting rule, deadline and dependency. Dependent ballot contexts must already contain passed prerequisites. Completion proofs use exact resolution references; OR proofs retain explicit null references for pending branches. Route-bound Norm requests cannot bypass the route by using one committee approval alone. Every step resolves to actual committee originals with the same body, target and scope; dependency ordering and AND/OR outcomes are checked at admission and replay. Electorates retain creation-time membership, and one actor cannot appear in multiple route steps. A route cannot recursively substitute another route for an original committee decision.

Proxy authority is an independently accepted `governance.delegate-vote` operation, with principal derived from the actual Decision and Session. Its exact proposal/revision/hash, delegate and simulated expiry are durable. Revocation/supersession closes new proxy admission; prior ballots remain valid at their original acceptance cursor. Proxy grants confer neither content-reading nor operation permission and are limited to existing frozen electors. Native uniqueness remains proposal plus principal.

Calendar administration quotes actual affected events without inference. Native first retains one unresolved original quote per author/run, then accepts a separate execution call. A lost retention acknowledgement never triggers late execution. Author-scoped read-only lookup recovers the same original after browser refresh without execution ownership; cancellation preserves an already applied racing receipt. The browser runtime owns one bounded active view of this Native original; timeout remains unknown, retries preserve the complete payload, run navigation retains the responsibility, and authentication loss withdraws private state. Current rule bodies follow ordinary disclosure permissions. Norm planning and the Product/SDK proposal impact read expose complete future rule ranges, including lazy successors, actual outstanding cases/tasks/commitments/holds/operations/wakes and the installed all-applicable-hiring-approvals rule. Private case and operational responsibility disclosures are checked independently; an inaccessible duty withholds the complete report instead of presenting a silently incomplete list; unsupported obligation migration remains blocked. Read projections link real vote, effective-boundary and notification-consumption records.

## Alternatives considered

Rewriting a bootstrap calendar would invalidate old wake bodies and recipients. A second mutable calendar/governance store would introduce conflicting ownership. Inferring proxies from relationships would allow impersonation. Resolving textual policy conflicts with a model would not produce an enforceable authorization rule.

## Consequences

Native journal 98 and checkpoint manifest 8 refuse older artifacts. Delegation, pre-ballot route, retained calendar-command and calendar-revision originals have individual content-bound checkpoint references. Session format remains unchanged because consumed model material is retained by existing context events. Calendar replacement requires an already restored paused owner; it does not silently restore or acquire execution. Pinned civil compilation rejects unsupported tzdb versions and ambiguous times without an explicit resolution. Same-electorate delegation rejects external proxy authority. Propose uses schema4/native4 generation3; vote uses schema3/native5 generation4; enact/revoke use schema2/native2 generation2; replay rejects obsolete installed pins.

## Testing

[Native calendar recovery](../../../../packages/simulation/simulation-local/tests/world-bootstrap.spec.ts) verifies JSON/SQLite reopening, CAS and exact retry. [Independent governance recovery](../../../../packages/simulation/simulation-local/tests/world-governance-proxy-recovery.spec.ts) uses Loader, canonical Team/Session acceptance, two committees, proxy revocation and cold replay. [Runtime tests](../../../../packages/client/runtime/tests/simulation-calendar.client.spec.ts) cover response loss, timeout, run navigation, authority withdrawal and complete payload bounds. [Product administration tests](../../../../packages/simulation/simulation-product/tests/world-management.spec.ts) exercise the actual authenticated browser transport. The [work-package evidence](../../../plans/2026-10-16-world-post-mvp/evidence/a3-core.json) records commands and source hashes; broader integration gates remain separately reported.

The [runnable snapshot](../../../../examples/simulation-company/tests/world-post-mvp.snapshot.ts) boots production Cordis configuration for each JSON/SQLite proxy/route flow and verifies its original governance and institutions in a separate recovery process without inference.
