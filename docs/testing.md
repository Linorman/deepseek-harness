# Testing policy

English | [中文](testing.zh.md)

This policy defines test tiers and the evidence each tier owns. Commands are in root [AGENTS.md](../AGENTS.md); Agent Notes carry rationale.

## Tiers

- **Unit** (`pnpm run test`): vitest runs package/example specs and repository script specs. Tests stay with the code they exercise; every registry tests HMR cleanup. Prefer edge cases, error paths, ordering, races, and permanent contract-regression tests (see `packages/core/agent-loop/tests/contract-regressions.spec.ts`).
- **Coverage gate** (`pnpm run test:coverage`): requires per-file 100% on `packages/*/*/src`. Uncovered code is often dead code to delete. Line coverage proves execution, not shipped behavior. `packages/shell/pwsh-local/src` needs real `pwsh`; pwsh-less hosts self-skip and are exempt, while CI enforces the full bar.
- **Real-model e2e** (`pnpm run test:e2e`): with-key tests call their configured model/provider route; the headless Team, headless-agent, and text ACP suites accept the local OpenAI-compatible route through `CLOCKY_LOCAL_MODEL_BASE_URL`, `CLOCKY_LOCAL_MODEL_ID`, and `CLOCKY_LOCAL_MODEL_API_KEY`, while provider-specific and image suites retain their own credentials. Each suite self-skips when its route is unavailable so keyless CI stays green ([Agent Note](../.agents/notes/implemented/testing/2026-06-19-real-api-e2e-ci.md), [local Team route](../.agents/notes/implemented/testing/2026-09-04-local-team-real-model-e2e.md)).
- **Snapshot** (`pnpm run test:snapshot`): keyless expected outputs cover transport/presentation and persisted logs cover assembled behavior. ACP replays a recorded automation-server session and diffs normalized JSON-RPC plus the re-persisted log ([Agent Note](../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md)); headless scenarios use their explicit JSONL driver, while `apps/cli` owns product `clocky --profile headless` acceptance. Use `test:snapshot:record` after model-transcript changes or `test:snapshot:refresh` when replay input remains valid, and review every diff. `text-turn` pins full prompt/tool-schema content; other fixtures tokenize it ([pinned-header Agent Note](../.agents/notes/archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)).
- **Web browser snapshot** (`pnpm run test:web`; required Linux PR gate): Chromium compares replayed output with `apps/web/tests/snapshots/`. CI uses read-only `CLOCKY_SNAPSHOT=replay`; record/refresh stay local and diffs are reviewed ([web e2e lane](../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md), [CI gate decision](../.agents/notes/implemented/testing/2026-07-30-web-browser-snapshot-ci-gate.md)). `test:web` [builds first](../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md) for plugin CSS.

Session fixtures keep headers and payloads but omit body sequence/time envelopes. Replay synthesizes them; runtime persistence is unchanged. Fixtures use canonical packed rows; [the migrator](../scripts/migrate-packed-session-fixtures.ts) rewrites old layouts.

The Team Hub load lane covers 4,096 SQLite records by default; set `CLOCKY_TEAM_HUB_LARGE_LOAD=1` for the opt-in 16,384-record bounded replay benchmark. Neither establishes a production latency budget.

## The with-key policy: inference is cheap here

Real-API coverage is part of the harness contract: no-key tests prove plumbing, while with-key runs prove model integration. Cover file writes, multi-turn conversations, tools, and mid-stream cancellation. Highest-value are **smoke tests** that boot the real example, send one prompt, and inspect the world ([postmortem 0001](postmortem/0001-acp-default-export-drops-inject.md)). Self-skip keeps secretless CI unblocked, and every example ships both keyless and with-key smokes ([examples/AGENTS.md](../examples/AGENTS.md)).

## Prefer the real implementation over a mock

Mock only expensive or non-deterministic boundaries (LLM adapter, network, clock); keep downstream code real. A stand-in proves bytes crossed a bridge, not that the shipped tool behaves correctly. Bridge tests use the scripted model with the real tool and executor: `makeBridgeHarness({ withBash: true })` plugs in `clocky-bash-local` and `clocky-tool-bash`, then runs `echo`.

Recovery tests separate pre/post-chunk failures by step and prove failed chunks derive no message or tool side effect. Cover exhaustion, cancellation, policy composition, persistence, status, wire counts, transport-closing idle timeouts, and shipping Loader composition.

## Verify the world, not the self-report

An e2e assertion re-runs commands or re-reads files externally; probing agent output can let a cheating agent pass. Assert untouched files are byte-identical. Tests own resources: create the harness in the test and dispose it in `afterEach`; shared fixtures belong in `tests/harness.ts`, not another `*.e2e.ts`, whose import duplicates real API calls.

## Test the real entry path

- Product-visible plugins require a non-unit REAL-composition test. Hand-built `ctx.plugin(...)` suites are insufficient: boot test-only `cordis.yml` through Loader and app/process, mock only external services or nondeterministic inputs, and assert model-visible request/log, durable state, or user-visible output. Keep opt-ins out of shipped defaults.
- A guard only guards if the regression actually fails it. For a plugin without `inject` (bundle/composition plugins), a Loader smoke stays green when a default export replaces the required named exports — add an explicit `expect('default' in mod).toBe(false)` plus an `unwrapExports` round-trip assertion, and prove it: introduce the regression, watch red, revert.
- "Real entry path" means the published artifact: a package `bin` runs built `lib/bin.js` under plain `node`, exposing failures tsx masks (settle races, module resolution, swallowed load failures). The same applies to non-index runtime entries (the worker-thread sibling `lib/worker.cjs`) and singleton modules shared across bundles (`packages/sdk/server/tests/built-scope-carrier.e2e.ts`). Keep the built-artifact smokes green (`packages/examples/*/tests/built-bin.e2e.ts`, `packages/code-runtime/code-runtime-worker-thread/tests/built-lib.e2e.ts`), and assert a genuinely-missing config exits non-zero.

## Test resolution: source plane only

- Every vitest config points vite-tsconfig-paths at `tsconfig.base.json`; bare workspace imports resolve to `src` ([layout](development.md#typescript-project-layout)), never through package `exports` to built `lib/` — stale artifacts there load a second copy of module singletons. Built artifacts are consumed only explicitly: `lib`-mode subprocesses and the built smokes below.

## Test subprocess launch modes

- CI and build-having test lanes run every example or Cordis-config subprocess from built `lib/` through the shared dual-mode launcher. Do not hand-write `--import tsx` for these subprocesses.
- Protocol and operating-system fixtures that do not load Cordis run erasable `.ts` directly with Node, without tsx or the root paths map.
- Only a test whose subject is source-path resolution may select `src`; state that contract in the test.

## When a snapshot test is required

Every non-trivial model-, protocol-, or human-visible change adds or updates a keyless scenario in the same PR through a runnable example's owning snapshot suite. Package tests, e2e assertions, mock/test-only compositions, and PR rationale do not replace the assembled transcript; extend the harness when needed. ACP automation scenarios use `examples/<name>/tests/snapshots/`, a scenario table over the [`clocky-acp-snapshot`](../packages/test-support/acp-snapshot/README.md) suite factory (`examples/acp-agent` is primary); `examples/headless-agent` owns the internal canonical-event JSONL snapshots and replay fixtures. The `pwsh-tool-turn` ACP scenario boots real `pwsh` and skips where it is absent. Completed interactive-terminal journeys use JSONL-driven scenarios under `apps/cli/tests/snapshots/`; transient presentation uses the package-local semantic matrix, with a PTY case when input, Loader selection, or terminal teardown changes. Browser-rendered web GUI journeys use `apps/web/tests/snapshots/`. The two SDKs project the agent loop, session lifecycle, and `SessionEventMap` independently, so changing any of those updates both: `examples/jsonrpc-agent/tests/snapshots/` owns the TypeScript client; `scripts/snapshots/python-sdk-single-exe/` owns the Python client, which only the required `python-runtime` CI job runs. New capability seams, lifecycle variants, or transcript surfaces name every coverage tier at plan time and verify the harness can express it before implementation.
