# acp-agent example

English | [中文](README.zh.md)

Automation-oriented [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. It is intended for parent agents, subagent providers, and other programmatic clients, not as the product UI.

```sh
pnpm run demo:acp             # needs the configured provider key (repo-root .env or env)
pnpm run demo:code-mode       # same protocol with the Code Mode tool transport
# For text-only live e2e, select the local OpenAI-compatible route:
#   CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1
#   CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
#   CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
```

When `CLOCKY_LOCAL_MODEL_BASE_URL` is non-empty, the live text ACP tests use
the static `local-vllm` route and the configured local model; otherwise they
use the DeepSeek route. The local route sends `max_tokens`, keeps the
unsupported developer role out, and maps canonical reasoning levels to the
tested endpoint (`high` becomes `xhigh`; `minimal` and `max` use the nearest
supported level). Set `CLOCKY_LOCAL_MODEL_REASONING_EFFORT` only when needed;
omitting it preserves the provider default. Image-specific and
provider-specific overlays retain their own route contracts.

The leaf loads the ACP app, configured provider adapter, sandboxed bash and filesystem stacks, one-shot approval policy, compaction, hooks, a derived session-query index, and repeat guard. Each `session/new` creates one local TeamRun task with a human, coordinator, and inactive worker; JSONL retains the internal coordinator transcript, while the ACP id remains opaque. Optional overlays add session queries, filesystem spill storage, Code Mode, web fetching, or durable image storage. Test-only overlays retain direct subagent and workflow coverage.

## Protocol channel

Stdout carries only newline-delimited ACP JSON-RPC. `@clocky/clocky-acp-demo` installs no stdout logger; leaf additions must use stderr for diagnostics.

The automation contract — supported methods, baseline prompt content, committed-text output, and the intentionally absent UI surfaces — lives in [`@clocky/clocky-acp`](../../packages/acp/acp/README.md).

## Session workspaces and permissions

Each `session/new` supplies an absolute `cwd`. The Team coordinator Session records that root, and sandboxed bash and filesystem mutations resolve `workspace-write` against it, so concurrent Team tasks can use separate project roots; platform temporary roots remain shared writable scratch space ([sandbox contract](../../packages/sandbox/sandbox/README.md)). `CLOCKY_PERMISSION_MODE` selects `workspace-write` or `danger-full-access` for the deployment.

Under `workspace-write`, a model retry requesting wider sandbox access triggers `session/request_permission` with `allow_once` and `reject_once`. The client decides programmatically; dismissal or an unavailable answer fails closed. The selected outcome applies only to that retry and is recorded through the normal tool-result/audit path. The server never exposes a permission picker or persists client policy.

Image scenarios load `@clocky/clocky-attachment-local` through their overlay. Base configurations have no attachment store and correctly advertise image input as unavailable.
