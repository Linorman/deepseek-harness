# Agent Note: Current World scope disclosure

Status: implemented

English | [中文](2026-10-13-world-scope-disclosure.zh.md)

## Problem

A historical content query must not revive a former member's access. Assignment dates alone also fail to account for inactive positions and organizations. A second race exists after preparation: a frozen context can contain authorized scoped bodies that have not yet entered a Session or model when membership is withdrawn. Ordinary knowledge checks do not cover automatically selected WorldFact and Norm material.

## Decision

[Current membership](../../../../packages/simulation/simulation/src/world-membership.ts) is shared by request admission, scope-member fact/institution projection and newly created announcement audiences. It reads the supplied Native prefix's current time and active reader, position and organization. Content time/cursor select immutable versions; they do not select historical authorization. Supplying an original historical prefix still reproduces its original selection.

The [context producer](../../../../packages/simulation/simulation-local/src/context.ts) derives `worldScopeAccess` from the WorldFact/Norm bodies it actually selects. Native rechecks those memberships on prepared-context retries, reads, model admission, report materialization and submission. Missing required evidence or revoked access rejects; it never rewrites the frozen view. Team checks cover the same original selection without parsing arbitrary model text. A synchronous check of the current Native snapshot immediately precedes Session insertion, after downstream pre-step listeners and presentation validation have finished. A second synchronous check precedes entry into the model waterfall, after asynchronous admission; refusal remains proven not-dispatched for token settlement. These boundaries do not revoke IO already dispatched downstream.

Goal preparations also retain their original assignment and operation-grant references. Live disclosure requires each original relation to remain current; expired grants cannot reuse a cached goal, even when fact audience membership remains valid. Hiring fees, candidate/assignment opportunities and committee rules use the same current target, active endpoint and declared relation-rule check as request admission. One valid grant cannot disclose another expired target’s material.

Every attached governance proposal retains its exact proposal revision/hash, original vote-operation pin and relation references in `governanceAccess`. This requirement applies to request/result selections as well as goals. Current disclosure rechecks the original electorate and each exact grant; another permission or an unrelated live role cannot replace the missing witness. Frozen preparation and previously consumed history remain intact after refusal.

New scoped announcements exclude already-ineligible members. Accepted announcement recipients remain frozen responsibilities. Existing consumed Session history remains retained; the change does not promise to erase an actor's past memory or reinterpret explicit actor/public audiences.

## Alternatives considered

**Use the requested past time for membership.** This would turn historical content selection into an access bypass.

**Check only during preparation.** Permissions can change before Session insertion or while a real model permit is queued.

**Rewrite the old view after revocation.** This would destroy the exact historical input and conceal why its original dispatch was refused.

## Consequences

Native stream 94 rejects previous prepared-disclosure semantics; compiler 9 is unchanged. Dual-backend tests cover expired membership, inactive endpoints, historical queries, unchanged old prefixes, preparation retry, first input, real model-pool waiting, downstream pre-step waits, and preserved Session history. A real Loader probe refuses an undispatched scoped canary before Session/model exposure and retains it only in the original Native context through cold recovery.

Real Loader company/laboratory probes revoke only vote permission on a prepared non-goal request, preserving employment and proposal permission. Cached reads and downstream pre-step dispatch refuse before the proposal body is appended or sent to a provider; new turn/error metadata can still record the refused attempt. JSON/SQLite source and plain-Node lib runs retain the original views through fresh-process paused restoration. Three-role Fact/Norm source/lib evidence and authenticated browser body-grant/revocation evidence are recorded in the [completion checklist](../../../plans/2026-10-11-world-simulation-completion/checklist.md); SDKs preserve the complete context-view and opaque JSON text through their shared wire corpus. These checks establish recorded role-specific disclosure; they do not erase legitimate past knowledge or prove arbitrary low-permission conversation text free of covert disclosure.
