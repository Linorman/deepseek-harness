# Agent Note: Conserved Native resource reservation ledger

Status: implemented

English | [中文](2026-10-13-native-resource-reservation-ledger.zh.md)

## Problem

An immediate transfer cannot protect money promised before later execution. Testing the balance without subtracting other holds permits overbooking; a one-use grant can otherwise authorize two concurrent obligations. Wall-clock inference or task leases do not implement simulated reservation expiry. Cancellation and expiry must release a hold without undoing an already committed payment.

## Decision

Native owns a required resource reservation map and the strict [resource operations](../../../../packages/simulation/simulation/src/business.ts): reserve freezes the exact transaction/read-set, authenticated actor, one-use grants and finite simulated deadline; commit and cancel select the original hold/revision. [One ledger owner](../../../../packages/simulation/simulation-local/src/resource-ledger.ts) performs the same authority, unit and conservation checks for immediate and reserved transfers. Available amount is the actual balance minus all active debit holds. Grants used by a live hold cannot authorize another hold or immediate transaction; revoking an original grant blocks commitment without reviving it on release.

The complete history uses the explicit frozen `maxResourceReservationHistory` bound. Terminal entries are retained and never refund history. Reusing the same ID/body/actor returns the original hold; changed input rejects. Ordinary payments can use only unheld funds. Commitment rechecks original account revisions, control, grants and expiry before atomically updating balances, consuming grants and recording settlement. Conserved transaction evidence also remains usable by the existing interaction owner.

A [source-owned scheduler event](../../../../packages/simulation/simulation-local/src/resource-reservation.ts) retains the original applied reserve operation and exact time/phase. Consumption expires the local hold and releases spendable funds in one Native fact. At `time == expiresAt`, commitment rejects even before the later deadline phase consumes the event. An active expiry cannot be administratively cancelled; an explicit commit/cancel cancels only its already-settled deadline in the same batch. Paused wall-clock time never advances expiry. Native stream83 rejects earlier formats and missing required state/spec fields.

This extends the resource ownership portion of the [durable simulation proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md), which remains active for its broader and unfinished domains. No active implemented note owns this specific ledger/expiry decision; none is superseded or archived.

## Alternatives considered

**Only check the original balance.** Multiple plans can promise the same spendable units, and unrelated immediate transfers bypass reservation ownership.

**Delete cancelled or expired entries.** New IDs recover the history allowance and original requests lose their durable identity.

**Expire by wall-clock timer.** Paused runs and replay gain different economic outcomes despite identical simulated traces.

**Reuse a grant while leaving balances held.** Sufficient free balance still permits the same one-use permission to authorize multiple obligations.

## Consequences

Resource input schemas live in a dependency-free leaf to prevent operation/scheduler import cycles. Existing immediate transfers keep their authority and conserved arithmetic; only actual held debit units are unavailable. An unrelated account revision makes the original hold stale rather than silently replacing its transaction. The same actor must explicitly cancel or retain responsibility until the original expiry.

The [one-time hiring feature](../feature/2026-10-13-one-time-hiring-resource-reservations.md) shares this ledger through a strict World-owned source and settlement. Ordinary resource tools cannot settle those holds. Unknown preparing identity IO retains money/grant locks until its business owner confirms cleanup; neither owner advances a quiescent maintenance clock or treats a planning operation as a fabricated applied transfer.

## Verification

[Owner tests](../../../../packages/simulation/simulation-local/tests/resource-reservation.spec.ts) cover overbooking by new IDs, grant locks/revocation, actor/body mismatch, units, exact expiry timing, terminal history, stale reads, forged deadlines and unchanged balances on rejection. [The real Loader scenario](../../../../examples/simulation-company/tests/resource-reservations.snapshot.ts) uses canonical Agent/Session observe-stage-submit, simulated expiry and conserved payment/cancellation with new-process paused recovery on both media. Prior stream versions remain explicit rejections in [Native tests](../../../../packages/simulation/simulation-local/tests/run.spec.ts). The original grant, interaction, scheduler and task evidence regressions protect the existing business contracts.
