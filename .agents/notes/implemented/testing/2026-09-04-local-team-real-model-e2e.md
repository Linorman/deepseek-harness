# Agent Note: Local keyed Team real-model e2e

Status: implemented

English | [中文](2026-09-04-local-team-real-model-e2e.zh.md)

## Problem

The Team product spine had keyless replay and focused provider tests, but no keyed test drove a real model through the shipped Team start path, coordinator tool calls, durable worker assignment, worker filesystem evidence, and final human-addressed output. The text ACP entry also had no local-model path for its live prompt and sandbox-escalation tests.

## Decision

`apps/cli/tests/real-team.e2e.ts` owns one opt-in real-model scenario over the headless Team product entry. The coordinator must start one default-worker task, wait for the worker, and publish a final Team result; the test verifies the worker's exact file bytes and the final stdout marker rather than trusting model prose. The scenario accepts the existing DeepSeek route, or an explicit local OpenAI-compatible route through `CLOCKY_LOCAL_MODEL_BASE_URL`, `CLOCKY_LOCAL_MODEL_ID`, and `CLOCKY_LOCAL_MODEL_API_KEY`. The local overlay keeps the endpoint and model environment-driven, uses `max_tokens`, disables the unsupported developer role, maps canonical reasoning levels to the tested endpoint (`high` to `xhigh`, `minimal` and `max` to the nearest supported level), and never stores a credential or machine-specific path. The text ACP example and the Python SDK bundled runtime use the same local route contract for live development; image-specific and recorded snapshot overlays keep their own provider contracts.

## Alternatives considered

**Use only the external provider.** Rejected because model availability, quota, and network behavior would make the Team acceptance signal expensive and nondeterministic for local development.

**Replace the real model with a fixture replay.** Rejected because the acceptance gap is model-to-tool orchestration and worker admission; a replay proves transport reconstruction but not that a live coordinator can select and wait for the durable task.

**Make the local route the unconditional default.** Rejected because deployments still choose their provider through explicit composition; the local route is a test opt-in and the existing external route remains the fallback.

## Consequences

The repository now has a reproducible local keyed Team e2e path without placing a secret in source, fixtures, or the test command. The same environment-selected route is also reused by the existing headless live harness, text ACP example, Web smoke scaffold, and Python SDK bundled runtime, so real file edit, bash, todo, Code Mode, compaction, resume, ACP prompt, sandbox-escalation, browser smoke, and Python client runs can exercise a local endpoint without duplicating provider setup. The Qwen route translates canonical `high` reasoning to the endpoint's accepted `xhigh` spelling. These scenarios remain outside keyless CI unless the local endpoint is available, while their real-model contracts cover behavior that replay alone cannot establish. More complex compiled workflow plans, image overlays, and remote endpoint behavior still need their own keyed or transport-specific evidence.

## Verification

With `CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1`, `CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit`, and `CLOCKY_LOCAL_MODEL_API_KEY=EMPTY`, `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/real-team.e2e.ts --reporter=dot` passed 1/1 test in about 285 seconds. The worker produced exactly `TEAM_WORKER_PROOF` followed by a newline, and the coordinator emitted `TEAM_REAL_MODEL_FINAL`.

With the same local variables, `pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/real-model.e2e.ts examples/headless-agent/tests/full-loop.e2e.ts examples/headless-agent/tests/coding-task.e2e.ts examples/headless-agent/tests/todo-write.e2e.ts examples/headless-agent/tests/code-mode.e2e.ts examples/headless-agent/tests/compaction.e2e.ts examples/headless-agent/tests/resume.e2e.ts --reporter=dot` passed 13/13 tests. The local harness keeps the endpoint's default reasoning behavior unless `CLOCKY_LOCAL_MODEL_REASONING_EFFORT` is explicitly set; canonical `high` is translated to the current Qwen endpoint's accepted `xhigh` spelling.

With the same local variables, `pnpm exec vitest run --config vitest.e2e.config.ts examples/acp-agent/tests/acp.e2e.ts examples/acp-agent/tests/escalation.e2e.ts --reporter=dot` passed 6/6 tests, including real ACP prompt/file verification and the sandbox approval/rejection flows.

With `CLOCKY_EXAMPLE_MODE=lib` and the same local variables, the same ACP command passed 6/6 tests through the built `lib/` entries.

With `PYTHONPATH=python/sdk/src:python/sdk-runtime/src`, `python -m pytest python/sdk/tests -q` passed all runnable Python SDK tests; 12 carrier-dependent tests skipped because the local runtime artifacts were unavailable. The bundled-runtime local-route cases include `CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high` and complete without making a model request.
