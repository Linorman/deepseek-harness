# Agent Note: Authoritative Simulation runtime status observations

Status: implemented

English | [中文](2026-10-01-simulation-runtime-status-observations.zh.md)

## Problem

Static run caps and retained history counts cannot explain current interval consumption, held reservations or unreleased writers. Opening a run to populate a directory can take execution ownership or initiate recovery. One failed journal must not erase observations for other authorized rows, while credential retirement must discard every held result.

## Decision

The Simulation Definition owns [interval accounting](../../../../packages/simulation/simulation/src/budget.ts) and [runtime metrics](../../../../packages/simulation/simulation/src/metrics.ts). Local admission and product observations reuse these functions. Token buckets and aggregate charges sum through BigInt, then convert only safe totals; unsafe totals reject rather than round. Unknown and reserved attempts retain at least their reservation or higher observed cost, and explicit grants apply only to their original interval.

Resident capacity uses the same unreleased-writer predicate in reservation admission, projection validation, population and public metrics. Reserved, active and revoked writers remain charged; this does not establish physical process liveness. Nonactive writers need confirmation, and unowned/unavailable observations cannot confirm any retained writer. Pending decisions include queued/reserved nominations and open/submitted decisions. Pending external work includes communication and task creation without a terminal native result; explicit unknown outcomes remain separately countable.

The [product directory](../../../../packages/simulation/simulation-product/src/index.ts) exposes safe metrics through `inspect()` and a finite `runStatuses()` batch. Distinct owned registered identities, deployment row limits and complete request/result bytes are validated. Independent read-only provider IO is drained through all-settled collection. Per-run provider or accounting failure becomes a fixed safe unavailable summary, while missing history remains missing. Each IO rechecks the principal, and final credential retirement rejects the entire batch. No open, restore, inference or recovery action occurs.

Observed output bounds tick/rule/policy labels and projects only fixed scheduler-stop categories, without raw specs, stall references or private bodies. Native reads explicitly lack administrative driver and shared-pool facts. An administration consumer may supply those separate current observations from its original registration and live owner; native history alone cannot infer them. New DTO fields are optional only for older peers, while current producers supply observations or explicit unavailability. Missing fields are never zero usage.

## Alternatives considered

**Derive usage in the browser or copy the provider algorithm into Product.** Either can drift from admission, especially after grants, cancellation, unknown usage or writer retirement.

**Open or restore each directory run.** Listing would obtain ownership or mutate retained recovery responsibility.

**Reject all rows on one provider failure.** An independent inaccessible journal must not hide other authorized histories. Authentication failure still invalidates the entire response.

**Return as soon as one parallel read rejects.** Teardown could close the directory while another admitted provider read remains active.

## Consequences

Usage is an observation from one native revision and simulation interval; model-pool activity is a separate real-time owner observation. Charged tokens can exceed a cap after observed overruns, but never become rounded numbers. Resident slots count held admission capacity rather than active inference. A finite batch preserves requested ordering and refuses complete-response overflow without partial rows.

## Verification

Real JSON and SQLite Native tests compare metrics with budget admission and population, retain unknown costs after writer release, include explicit grants and queued decisions, preserve decimal interval precision beyond Number range, and reject unsafe token sums. Product tests observe real held history without takeover, isolate a private provider failure, return unavailable for unsafe totals, reject malformed supplied metrics and invalid identity/count/byte requests, and drain another admitted read when credentials retire. Existing budget, token and product read regressions preserve admission and inspection behavior. Transport and UI verification belong to their consumers.
