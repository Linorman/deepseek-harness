# Agent Note: One-time hiring resource reservations

Status: implemented

English | [中文](2026-10-13-one-time-hiring-resource-reservations.zh.md)

## Problem

A hiring permission does not authorize money. Reserving only a position and identity lets a concurrent ordinary transfer spend funds promised for later hiring. Paying through another resource operation separates payment from assignment; releasing funds before uncertain identity cleanup loses the original responsibility.

## Decision

The strict [fee declaration](../../../../packages/simulation/simulation/src/world-hiring-resources.ts) belongs to the original World definition and portable v1 authoring. It selects one hiring operation/position, existing money accounts, unit, positive quantity, exact grants and positive simulated reservation period. Absence declares a free operation. Unknown primitives, incompatible resources and unsupported bounds reject; director rationale never determines a price or payer. Authorized goal and planning views retain these terms in actual Sessions.

The [hiring resource owner](../../../../packages/simulation/simulation-local/src/world-hiring-resources.ts) uses the [single conserved ledger](../architecture/2026-10-13-native-resource-reservation-ledger.md). A World hold retains the actual requester, original accepted plan/resolve operation, fee, approval basis, frozen account reads and original Native reserve sequence. Accepted window plans may precede local operation settlement; they remain real accepted plans, not fabricated applied transfer operations. The actual reserve record owns its scheduled deadline.

Generated hiring reserves canonical identities and money atomically before target IO. Existing-person hiring persists only its original financial/position promise, with no new identity. Both commits recheck current scoped authorization, committee approval, financial account/grant/hold dependencies and simulated validity. The same Native batch settles payment, assignment/readiness, result and wake/deadline responsibilities. Consumed grants reference the actual World commit sequence rather than an invented transfer operation. Ordinary resource tools refuse World-owned holds.

A typed read-set compares exact account authority/values, grant records and debit hold sets; it excludes the original case's own hold, without refreshing frozen transaction revisions. Both hiring paths count unconfirmed reservations against position capacity; an open assignment also respects retained future occupancy. The global history allowance counts local and World holds, including all terminal states. Complete financial/scheduler batches obey the original UTF-8 byte allowance.

A real consumed simulated expiry can release a never-prepared local promise, but uncertain preparing identity IO remains an active money/grant obligation with an exact consumed-expiry marker. Commitment refuses the expired promise. Explicit business cancellation releases known-safe reservations; preparing cancellation waits for canonical cleanup evidence and releases money with the original abandoned identity/result. An already committed payment is never reversed. Quiescent maintenance freezes simulated time; a wall-clock delay cannot expire business funds.

## Alternatives considered

**A second financial ledger.** Ordinary transfers and hiring could disagree about spendable funds and grant ownership.

**Trust the director's payment fields.** Hiring authority would become permission to select another actor's accounts, price or receipts.

**Let ordinary commit/cancel settle any payer-owned hold.** A legitimate requester could bypass atomic assignment or release uncertain identity IO.

**Mark all overdue preparation expired.** Unknown target effects would lose funds and grant locks before cleanup was proven.

**Refresh account reads or TTL on retry.** A stale original promise would silently become a new transaction or longer validity interval.

## Consequences

Native stream83 and v1 compiler7 reject earlier formats/resolutions. The committee approval basis lives in a dependency-free leaf shared by the original approval API and financial holds; schemas avoid operation/scheduler initialization cycles. The existing-person execution handler retains and reconciles its original hold while remaining paused during cold inspection, rather than automatically hiring from a restored promise.

The feature covers one-time conserved payments, not recurring wages, taxes, real payment providers or arbitrary resource changes. The broader [durable simulation proposal](../../proposed/architecture/2026-09-17-durable-simulation-coordination.md) remains active. The original ledger decision still owns local reservations; this feature extends it and supersedes no active note.

## Verification

[Native owner tests](../../../../packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts) use actual Team, Agent, Session and Channel owners to check both media, insufficient funds, stale reads, grant revocation/consumption, history, expiry, append refusal and unknown cleanup. [Compiler tests](../../../../packages/simulation/simulation-scenario/tests/v1-hiring-fees.spec.ts) cover strict references and reviewed commitments. [The Loader workflow](../../../../examples/simulation-company/tests/hiring-resources.snapshot.ts) runs both hiring operations through the actual World driver and three model tools, followed by paused new-process checkpoint recovery. SDK parsers retain explicit authoring terms and fixed resource stop categories.

[Paid retry tests](../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts) exercise reordered original commands, altered-payload rejection, same-business-key goal decisions and Native handle reopen after an actual existing-person payment. They compare the original money, hold, identity, assignment, result and notification rather than accepting another success response as proof of uniqueness. Handle reopen in these tests is not a new process or SDK distribution test.
