# Agent Note: Original bounded Simulation outbox retry permissions

Status: implemented

English | [中文](2026-10-01-simulation-original-outbox-retry.zh.md)

## Problem

An unknown external outcome may already have committed its target. Repeating a revision-based retry request can add another allowance after response loss, while a cold product replay lacks the current authenticated permission to mutate the run. Static attempt caps do not establish that the exact current operation is retryable.

## Decision

The [native contract](../../../../packages/simulation/simulation/src/outbox-retry.ts) validates an immutable command id, original operation, positive attempt-count fence, normalized reason and original accepted real timestamp. The original grant retains its request, native sequence/time, budget start and unchanged `outboxMaxAttempts` bound under the operation's outbox. A run-wide identity cannot select another payload or operation. Exact retries return the historical grant without another append even after later attempts, results, phases or cold replay.

Fresh grants require the exact current unknown due external intent and its latest recorded attempt; dependencies must have applied and native maintenance must be absent. The mutation fold and read projection share the eligibility function. Grant does not change operation action/fingerprint, publish, infer or resume. Native journal format 45 rejects older structures; the former four-argument CAS API is removed.

The [administration owner](../../../../packages/simulation/simulation-product/src/administration.ts) persists the original normalized product request before queued native IO. Native identity derives from that original product command, and `authorizedAt` is the original `acceptedAt`, independent of later caller wall time. The [company owner](../../../../packages/simulation/simulation-product/src/company-owner.ts) serializes retry with management and maintenance, drains active scene work and checks the current lease around every wait and inside the native queue. Proven pre-admission refusals may finish failed; unknown native or terminal response loss leaves the original request accepted. Queries expose that exact original input and never retry it.

Cold accepted retry commands are excluded from automatic launch and do not prevent an explicit owner restoration. Only an authenticated retry of the same command reconciles them afterward. The grant clears the owner's cached unknown stop but retains the native stalled/paused phase; explicit start resumes the same original intent and target idempotency key.

Product operation details expose exact count/bound and a read-only reason. Native-only history cannot assert product ownership. A disposable process-local administration metadata reader adds current owner, pending-request and capacity admission. Registration identity uses an entry object because contextual Cordis proxies wrap callable service fields. Removal invalidates read observations and prevents late admission hints; no read hint supplies mutation authority.

## Alternatives considered

**Repeat CAS against the current revision.** Response loss and later world progress can issue a second allowance without preserving original permission.

**Trust only the product request journal.** Native target acceptance can survive a lost reply; the mutation owner must retain the same original grant for reconciliation.

**Automatically retry accepted commands during cold load.** Durable intent does not prove that current credentials still authorize mutation.

**Publish immediately after granting.** A retry permission and explicit scheduling intent are separate; an unknown result is never proof that the target did not commit.

## Consequences

New grants remain bounded by the existing outbox policy. Exact retries cannot refund attempts or alter payloads. Target authority and atomic deduplication are still checked during dispatch, including when only reconciliation remains authorized. Original request lookup distinguishes an unknown accepted outcome from a persisted failure and lets clients reuse the same identity after response loss.

## Verification

Native JSON/SQLite tests exhaust real storage-backed publication, retain one original allowance through repeated requests, later terminal state and cold reopen, refuse stale counts and changed payloads, and recheck caller retirement both at the queue and after committed IO. Product JSON/SQLite tests lose real Hub publication responses, reach an unknown operation, lose the committed native grant response, query without publication/inference, cold-read inertly, explicitly restore and reconcile the same command, then explicitly start and recover the original target receipt. Stale first requests and retired credentials retain no new grant. Administration/review remount regressions verify reader disposal and preserve other original request families. Transport and browser verification belong to their consumers.
