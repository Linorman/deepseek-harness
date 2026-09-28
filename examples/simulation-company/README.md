# Simulation company

English | [中文](README.zh.md)

This opt-in composition runs a buyer and supplier through real Agent turns with a scripted model. They request one inventory unit, wait for delayed delivery, accept a commitment, transfer inventory, send evidence and observe the result. The role preset exposes only Simulation tools.

Run the keyless scenario from the repository root:

```sh
pnpm run test:snapshot examples/simulation-company/tests
```

The tests cover JSON and SQLite, including process termination before/after proposal acceptance and after the inventory effect, followed by recovery in the same Sessions. An unaccepted decision remains cancelled while a new decision retries the work; an accepted decision is never inferred again. They verify actual quantities, commitments, delivery receipts, hidden profiles and decision retries. Set `CLOCKY_EXAMPLE_MODE=lib` after `pnpm run build` to exercise built packages.

The [scenario](tests/scenario.ts) supplies explicit authorized decision inputs. `executeDecision()` returns only after the selected model input’s turn ends, its proposal is accepted and the Session is flushed. `run.snapshot()` inspects durable state; `connection.drive()` advances to an explicit horizon; `run.setPhase('paused', revision)` and `run.setPhase('running', revision)` control admission. These APIs do not infer persona knowledge or automatically select decisions. The [development plan](../../.agents/plans/2026-09-18-durable-simulation-coordination/development-plan.md) tracks remaining acceptance and scheduling work.

To disable Simulation, pause each run and close its connection and run before removing the Simulation composition entries. Retain the run, Team and Session stores. Older binaries must use a matching consistent backup if they reject retained formats or required events; do not delete events or edit version markers to force a rollback.

The window scenario runs two model actors concurrently against the last inventory unit. Reversing model completion preserves slot acceptance and resource outcomes. A kill during collection retains cancelled old slots and retries in a new window after writer recovery. Deadline cases abort a slow model, preserve a completed later-slot proposal and recover an already recorded timeout. Conflict scenarios refresh observations or exhaust repeated stale reads, and recover at queued, claimed and exhausted boundaries. The successful first transfer is not repeated. Ingress cases receive text during a frozen window and recover after receipt, claim, context flush, input consumption or acceptance. They verify ordered visibility and one accepted decision per input.

Capacity cases keep a two-actor window while limiting the service to one model stream. They verify FIFO progress and that connection shutdown retains the occupied permit until model cleanup completes.

Population cases enforce one resident actor, retain its charge through delayed cleanup and process death, and reject bypass through direct controller activation. Entity termination releases live population capacity without deleting historical identities.

The company scenario hibernates the supplier with a receipted input, then resumes the same Session before its decision. Population cases use the hibernation API while teardown is delayed and verify explicit resume without inference.

The [five-role procurement scenario](tests/procurement-scenario.ts) adds CEO, Warehouse, Purchasing, Finance and Supplier with only two resident actors. It checks office-hour admission, quote visibility, independent money/inventory conservation, exact dual authorization for reservation, timed receipt/payment, finance rejection, late fulfillment, unresolved overdue delivery, duplicate quotes, atomic manager reassignment, hibernation and restart after reservation or reassignment. CEO reports contain verified changes, blocked dependencies, risks, required decisions, evidence and the next update time. Unresolved cases retain a scheduled update wake; completed reports have no further update. Financial and supplier private history stays private.

The storage baseline measures retained text ingress (`--workload ingress`) or Entity profile updates (`--workload world`) without resident actors, model calls or Team message delivery. Run from the repository root:

```sh
pnpm run benchmark:simulation --backend sqlite --workload ingress --entities 1000 --operations 100000 --duration-ms 15000 --timeout-ms 120000 --sample-every 100 --entity-batch-size 100 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

`--replay-page-size` explicitly bounds recovery pages in both workload and cold-recovery processes. World-event benchmarks require an explicit `--world-batch-size`; each atomic batch retains one journal event per update. The `write-batch` latency phase measures whole batches, while throughput counts individual updates. Each run keeps raw latency samples, progress, stderr, source hashes and a hardware-qualified JSON report beside its durable data. `duration-ms` stops each workload phase between operations; `timeout-ms` kills a child that exceeds the total process allowance. Time-budget and timeout outcomes do not certify the requested size. The report separates accepted inputs, consumed events and unresolved wakes, and verifies checkpoint restoration against the full retained projection.

Use `--workload actors` with `--residents`, `--models` and `--model-delay-ms` to measure scripted cognition. `--operations` counts accepted decisions; each performs three real model/tool steps (observe, stage an empty proposal, submit). The persistent queue selects windows, and residency management evicts idle actors and resumes their canonical Sessions. The runner sets dedicated Team participant/activation-history limits from the requested workload size.

`--workload actors-world` first writes `--world-events` profile updates in explicit `--world-batch-size` batches, then runs the bounded cognition phase in the same run. It binds participants on demand before nomination; the report distinguishes logical entities, bound participants, served actors and observed concurrency. Completion requires both world-event and decision targets; cold recovery checks the combined state.

```sh
pnpm run benchmark:simulation --backend sqlite --workload actors --entities 40 --operations 80 --residents 20 --models 10 --model-delay-ms 100 --duration-ms 30000 --timeout-ms 180000 --sample-every 20 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

The report distinguishes configured limits from observed model/resident peaks, queue observations, starts/resumes and unserved entities. Scripted token usage verifies accounting; it is not real-provider usage or cost. Empty-proposal decisions do not measure Team message throughput or business effects.

`--workload messages` measures serial delivery around a ring of direct channels. Use at least two residents and exactly one model permit. Each operation includes a sender decision, due outbox publication, durable recipient input/receipt, a recipient decision that reads the Envelope, and duplicate publish/receive probes. WAL Envelope/receipt counts and physical Session input identities must match completed messages.

```sh
pnpm run benchmark:simulation --backend sqlite --workload messages --entities 20 --operations 40 --residents 2 --models 1 --model-delay-ms 5 --duration-ms 30000 --timeout-ms 120000 --sample-every 10 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

Report version 2 also launches a fresh recovery process within the original total timeout. A measured result requires identical replay with no model calls or publication. `result.restoreMs` retains same-process timing; `coldRecovery.restoreMs` includes fresh owner boot and restore, while `coldProcessMs` includes process startup and shutdown. Serial delivery measurements do not establish concurrent message throughput.

`--workload parallel-messages` couples parallel sender and recipient decision windows with ordered Team IO. Each batch uses distinct sender/recipient pairs, completes due delivery, then collects only wakes sharing one time/microstep/phase key before opening the recipient window. It requires at least four resident slots and `models <= floor(residents / 2)`. A soft deadline is checked between complete batches; `transport` latency samples describe batches, while `message` samples describe completed messages.

```sh
pnpm run benchmark:simulation --backend sqlite --workload parallel-messages --entities 40 --operations 80 --residents 20 --models 10 --model-delay-ms 100 --duration-ms 60000 --timeout-ms 180000 --sample-every 10 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

Model streams run concurrently; publication and receipt still follow the coordinator's deterministic order. The final partial batch uses only its remaining message count.

`--workload organization` measures deterministic work orders through real Team actors without model calls or Team messages. `--entities` includes employees, managers and departments; require `--operations = (entities - managers - departments) * days`. Each day atomically rotates department managers; new requests use current organization relations, while next-day resource fulfillment retains each accepted commitment’s original debtor. The report records handoffs, retained debtors, pending commitments, frozen-context bytes, memory/disk growth and same-process/cold recovery. The soft deadline is checked between request/accept pairs and deliveries; unfinished commitments remain in the checkpoint. This layer does not measure model context compaction or message throughput.

```sh
pnpm run benchmark:simulation --backend sqlite --workload organization --entities 570 --departments 20 --managers 50 --days 30 --operations 15000 --residents 20 --duration-ms 60000 --timeout-ms 180000 --sample-every 100 --entity-batch-size 100 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

## Budgeted live-model sample

`live-model` runs one observer decision through an OpenAI-compatible endpoint, records reported tokens and request latency, and verifies independent checkpoint recovery without inference. Export `SIMULATION_MODEL_API_KEY` explicitly; the benchmark does not load `.env`. Choose the endpoint, model, context limit, reasoning effort (`off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`), thinking format (`openai` or `deepseek`) and budgets before running:

```sh
pnpm run benchmark:simulation --backend sqlite --workload live-model --entities 1 --operations 1 --duration-ms 30000 --timeout-ms 120000 --sample-every 1 --entity-batch-size 1 --replay-page-size 1000 --output .tmp-simulation-development/live --endpoint "$MODEL_ENDPOINT" --model "$MODEL_ID" --context-window "$MODEL_CONTEXT" --reasoning-effort "$REASONING_EFFORT" --thinking-format "$THINKING_FORMAT" --token-budget "$TOKEN_BUDGET" --tokens-per-request "$REQUEST_RESERVATION" --max-output-tokens "$OUTPUT_LIMIT" --max-model-calls "$CALL_LIMIT"
```

Each request reserves `tokens-per-request` from the run budget and reconciles provider usage. This is admission accounting, not a provider billing ceiling: a provider may exceed its reservation; the sample then fails and retains its usage. The output limit is sent to the provider; exhausted call/token admission or unknown usage prevents further requests. Missing or zero input/output usage does not count as measured cost. Currency cost is not inferred from tokens. Local HTTP test results do not count as live-model evidence.
