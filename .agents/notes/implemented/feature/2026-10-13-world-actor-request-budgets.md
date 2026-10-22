# Agent Note: World request and structural admission budgets

Status: implemented

English | [中文](2026-10-13-world-actor-request-budgets.zh.md)

## Problem

A global history allowance does not reserve independent request limits for actors in each simulated interval. In addition, checking history only when a trusted caller prebuilds an intent leaves ordinary goal admission able to create new business identities past that bound. Neither changing a business key nor cancelling an accepted case should restore consumed admission. Dynamic identity preparation also needs a bounded rate and shared structural ownership: business settlement alone cannot prove that canonical maintenance or cleanup has finished.

## Decision

The [frozen World definition](../../../../packages/simulation/simulation/src/world.ts) requires positive `maxRequestsPerActorPerInterval`. The scenario catalog supplies explicit defaults/ceilings; portable input may request a permitted reduction. V1 compiler8 retains the chosen value with Native `budgetInterval`; no runtime default fills older records.

The [budget owner](../../../../packages/simulation/simulation-local/src/world-request-budget.ts) derives usage from each retained request's actual accepted decision, actor and simulated time. It counts across domains, including open, committed, rejected and cancelled cases. Exact original retries retain the existing request and do not add a charge. Periods use the common BigInt simulation clock calculation, not wall time, Session identity or mutable role text. Model-visible usage is selected at the original decision snapshot and attributed to that Native prefix; acceptance uses the complete latest projection.

[Common admission](../../../../packages/simulation/simulation-local/src/world.ts) checks actor quota before request insertion and during authoritative fold. Projection validation independently checks every retained actor/interval group. The global `maxRequests` check belongs to creation of a new business identity, so both trusted prebuilt intents and ordinary goals share it. Crossing a period does not release history, positions, funds or original cleanup responsibilities.

Excess model submission retains the existing `SIM_WORLD_LIMIT/requests` hard stop and its Session input evidence. That hard stop requires inspection and a new scenario; it does not automatically clear when wall time passes. Within-bounds scheduling can reach a later simulated interval normally. Model decisions and tokens retain their independent limits, including unsuccessful attempts.

Native stream85 rejects earlier records rather than inventing the new frozen bound. SQLite schema and Session envelope versions stay unchanged. Current scenario fixtures state the new allowance explicitly; cases that previously declared a higher global workload limit retain that same bound explicitly for actors, without raising any original global/model/resource allowance.

The [structural owner](../../../../packages/simulation/simulation-local/src/world-structure-budget.ts) derives birth and external expansion usage from retained reservations. `maxBirthsPerInterval` and `maxExternalExpansionsPerInterval` are nonnegative safe integers; zero disables the corresponding dynamic creation. Generated hires and external representatives consume birth quota; only representatives consume expansion quota. An original intent is charged once in each simulated interval containing its Native `reservedAt`, first `prepared.time` or terminal `result.time`, including cancellation. Unsettled reservations carry forward into the current interval. Exact retries add no charge, and cancellation never refunds its settlement interval.

`maxPendingMutations` accepts only `1`. Generated hires, external representatives, personnel reservations, active World funding holds and unsettled contacts share that slot, deduplicated by original intent. Business-terminal reservations retain it while their original maintenance is active. The original owner may continue; another owner must wait for canonical settlement. Existing-person hiring and contact reuse consume no new birth but still respect shared structural admission. Recorded model contexts carry frozen `worldLimits`; knowledge of a limit grants no executor authority.

## Alternatives considered

**Count decision IDs instead of business requests.** Exact receipt retries and planning turns would consume unrelated quota, while accepted case history already provides a durable unique identity.

**Reset counters on cancellation or at reopen.** New business keys or process restarts would recover consumed capacity. Usage is derived from immutable acceptance history instead.

**Keep history checks only in the administrative seed method.** Ordinary model goals also create intents and must pass the same owned admission boundary.

**Release capacity at business commit or cancellation request.** Canonical maintenance and unknown topology cleanup can remain active after business state changes, so the next mutation must not overlap them. Terminal results retain their simulated interval charge.

**Make pending concurrency arbitrarily configurable.** Current maintenance and recovery serialize structural ownership. A literal bound of one rejects unsupported concurrency instead of exposing a misleading knob.

## Consequences

[Native owner tests](../../../../packages/simulation/simulation-local/tests/world-request-budget.spec.ts) cover independent actual actors, cancellation, exact retries, snapshot selection, corrupted source refusal, 99/100 interval boundaries, continued historical exhaustion and reopen. [Compiler tests](../../../../packages/simulation/simulation-scenario/tests/v1-actor-request-limit.spec.ts) cover explicit defaults/ceilings, invalid input, reviewed commitments and JSON/YAML equivalence. The [Loader booking workflow](../../../../examples/simulation-company/tests/world-booking.snapshot.ts), with its explicit actor-quota probe, uses actual model tools and Session evidence to refuse a new key despite spare history and a free target interval, then restores paused without inference. That Loader evidence covers actor request quota, not the structural quota matrix.

[Public schema tests](../../../../packages/simulation/simulation/tests/world.spec.ts) and [structural compiler tests](../../../../packages/simulation/simulation-scenario/tests/v1-structure-limits.spec.ts) validate zero, literal concurrency, missing fields, preparation evidence and JSON/YAML commitments. [Adapter tests](../../../../packages/simulation/simulation-world/tests/structure-stops.spec.ts) preserve typed quota stops without widening decision submission failures. Python quota and SDK stop tests, product control parsing and bilingual status rendering pass. The formal [external quota](../../../../examples/simulation-company/tests/world-external-limits.snapshot.ts) and [paid hiring](../../../../examples/simulation-company/tests/hiring-resources.snapshot.ts) Loader matrix passes 128 cases across source/lib, company/laboratory and JSON/SQLite: 384 processes, 1,056 keyless warm model calls and zero cold model calls. The input manifest remains unchanged before and after execution. This validates the structural quota/recovery matrix, not all World completion requirements or a real provider.
