# headless-agent

English | [中文](README.zh.md)

This directory owns replay and real-model test compositions for headless agent behavior. Its primary `cordis.yml` deliberately mounts a configured provider/model route, local bash and filesystem tools, direct subagent delegation, workflows, fresh-Agent Ralph iteration, `todo_write`, and JSONL persistence as explicit custom/internal coverage. It is not the shipped product profile; the shipped headless task entry starts a Team.

## Run it

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
#   CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1  # optional local OpenAI-compatible route
#   CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit                       # optional
#   CLOCKY_LOCAL_MODEL_API_KEY=EMPTY                                # required by the adapter; EMPTY for an unauthenticated local route
#   CLOCKY_LOCAL_MODEL_REASONING_EFFORT=medium                       # optional, endpoint-dependent
pnpm clocky --profile headless "fix the failing test in this workspace"
```

When `CLOCKY_LOCAL_MODEL_BASE_URL` is non-empty, the real-model e2e suites select
the explicit `local-vllm` route and the configured local model; otherwise they
keep the DeepSeek route. The local profile sends `max_tokens`, keeps the
unsupported developer role out, and maps canonical reasoning levels to the
tested endpoint (`high` becomes `xhigh`; `minimal` and `max` use the nearest
supported level). Use the same three `CLOCKY_LOCAL_MODEL_*` variables for
keyed headless tests without placing a credential in a composition or test
fixture. Set `CLOCKY_LOCAL_MODEL_REASONING_EFFORT` only when reasoning is
needed; omit it to preserve the provider default.
The checked-in example composition uses the canonical `http://127.0.0.1:18000/v1`
endpoint; the programmatic and Web smoke harnesses honor a custom base URL.

The command is [`clocky --profile headless`](../../apps/cli/README.md): it accepts one nonblank task, starts and persists a fresh default Team, prints the coordinator's explicit final text, and exits.

Custom-composition snapshot suites run this directory's configurations through [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts), an unexported test-only process that emits canonical session events as JSONL before its result record. The shipped Team profile is covered by [`tests/headless-team-run.snapshot.ts`](tests/headless-team-run.snapshot.ts), which asserts durable Team journals and participant Session provenance. Neither stream is a supported CLI output format; child-Session diagnostics remain test-only coverage.

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) replaces the local filesystem and subprocess providers with one shared E2B sandbox while retaining `clocky-bash-local` and the same model-facing tools. Put `E2B_API_KEY` beside `DEEPSEEK_API_KEY` in the gitignored root `.env`, then run the credential-gated live composition, which drives FS, Bash, PTY, and LSP in one sandbox and proves final deletion:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

The overlay creates the same absolute cwd inside the sandbox, but it does not upload or mount the host workspace. File and Bash mutations exist only in E2B; Cordis, model calls, agent/session state, session logs, skills, and SDK buffers remain on the host. The composition kills its sandbox on timeout and disposal. It is a provider-composition POC, not a whole-harness migration or a workspace-sync feature.

## Advanced configuration

[`advanced.cordis.yml`](advanced.cordis.yml) adds Code Mode and the Cordis tools to the test composition.
