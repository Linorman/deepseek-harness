# @clocky/clocky-compat-subagent-clocky-sdk

English | [中文](README.zh.md)

The SDK provider runs each subagent as a complete Clocky runtime in a fresh subprocess, driven over stdio JSON-RPC through the [TypeScript SDK client](../../sdk/client/README.md). It is the second out-of-process backend beside [`subagent-acp`](../subagent-acp/README.md), differing in the wire and the child contract: the ACP backend drives any Agent Client Protocol agent; this backend drives specifically a harness SDK runtime (`clocky-jsonrpc-agent` bin or packaged executable), so the child is a full peer harness — own `cordis.yml`-decided composition, session persistence, model route, and tools.

## Start and ownership

`start(request)` resolves the child's working directory, spawns the runtime through `Clocky`, and completes the `initialize` handshake (with the configured `provider`/`model` route and optional `maxTokens` output cap) before it fulfills. Fulfillment therefore means the child runtime is ready and ownership has transferred to the caller. A spawn, handshake, or pre-publication cancellation failure rejects only after the subprocess has been reaped; a working-directory resolution failure rejects before anything is spawned.

The working directory resolves exactly like the ACP backend, through the seam's shared out-of-process helpers ([`clocky-subagent`](../subagent/README.md)): the configured `cwd` override when set (validated once at load), else the delegating parent session's cwd — never the server process's own cwd. The resolved path becomes the child process cwd and the workspace cwd of its SDK-created Team coordinator.

The returned run id is minted in the parent namespace. After publication the provider creates one default Team through `Clocky.createTeam()`, waits for its explicit final result, and reads its coordinator's session events: the last complete non-empty `assistant/message` (an empty-content message that records usage is skipped), or the accumulated `text-delta` stream when no such message exists. The explicit final text is the fallback when the coordinator committed no output. Partial output remains available after cancellation or an error.

Cancellation requests `HarnessTeam.cancel()` for a published Team and settles the result locally as `aborted`; `dispose()` is idempotent and then closes the runtime through a bounded protocol `shutdown` request followed by the shared stdin-EOF → SIGTERM → SIGKILL ladder to actual exit.

## Team-final mapping

A successful `HarnessTeam.waitForFinal()` maps to `completed` regardless of an individual coordinator turn's ending. Local cancellation maps to `aborted`. A failed Team operation or transport failure after publication flattens to `stopReason: 'error'` through the `onError` diagnostic sink (wired to `ctx.logger.warn`); the seam contract forbids `result` rejecting.

## Capabilities and context

The provider advertises no start-time capabilities (`outputSchema`/`depthLimit`/`toolFilter`/`persona` all false) and `inheritsParentContext: false`: the child is a fresh runtime in another process, and the only parent-derived input is the workspace cwd. `clocky-tool-subagent` deployments over this provider set `maxDepth: 'provider-managed'` — the child harness owns its own recursion budget.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `clocky-sdk` | Registry name on `ctx.subagents`. |
| `command` | required | Executable spawned per run (the child runtime bin or packaged exe). |
| `args` | `[]` | Command arguments (typically the child's `cordis.yml` path). |
| `cwd` | parent session cwd | Working-directory override; same validation as [`subagent-acp`](../subagent-acp/README.md). |
| `provider` | required | Provider route sent in the child's `initialize`. |
| `model` | required | Model sent in the child's `initialize`. |
| `maxTokens` | adapter/provider route default | Per-request output-token cap sent in the child's `initialize`; it applies to the Team coordinator and its in-process descendants. |
| `env` | `{}` | Explicit child environment layered over a credential-scrubbed parent environment (e.g. the child's own `DEEPSEEK_API_KEY`, or `CLOCKY_CORDIS_CONFIG`). |
| `shutdownTimeoutMs` | `1000` | Bound on the protocol `shutdown` exchange during dispose. |
| `disposeEofGraceMs` | `6000` | Grace after stdin EOF before platform termination. |
| `disposeGraceMs` | `3000` | Exit-confirmation grace after termination; POSIX also waits this long after SIGTERM before SIGKILL. |

```yaml
- id: subagent-clocky-sdk
  name: '@clocky/clocky-compat-subagent-clocky-sdk'
  config:
    providerName: clocky-sdk
    command: node
    args: ['./packages/examples/jsonrpc-demo/lib/bin.js', './examples/jsonrpc-agent/cordis.yml']
    provider: child-provider
    model: child-model
    maxTokens: 49152
    env:
      DEEPSEEK_API_KEY: !!js process.env.DEEPSEEK_API_KEY
- id: tool-subagent
  name: '@clocky/clocky-compat-tool-subagent'
  config: { provider: clocky-sdk, toolName: legacy_subagent, maxDepth: 'provider-managed' }
```

## Process boundary

The child environment is the [`clocky-subprocess`](../../subprocess/README.md) seam's `scrubbedParentEnv()` base — ambient credential-shaped and `CLOCKY_*` names dropped — with explicit `config.env` values merged after the scrub. The child is spawned by the SDK client rather than through `ctx.subprocess` (the subprocess README's documented exception for SDK-managed transports), which is why this backend applies the scrub itself. The JSON-RPC wire is the real serialization boundary.

The package has no default export. Cordis loader unwrapping would otherwise hide the named `inject` metadata; see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md).

## Model Experience

### Child-agent request

#### What the model sees

The child runtime's Team coordinator receives the standalone task as durable direct-v3 human content plus that runtime's own configured system prompt, tools, and fresh Session. It receives no parent conversation. This provider advertises no optional start-time capabilities, so the local service rejects requests for persona, tool filtering, depth enforcement, or structured output instead of silently omitting them.

#### Token effect

The child pays for an independent full context and its own multi-step history. These tokens never enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Each SDK child can reuse only prefixes identical under its own provider, model, composition, and history; child steps otherwise grow append-only.

### Parent tool result, indirectly

#### What the model sees

Through `clocky-tool-subagent`, the parent receives committed coordinator output (or accumulated partial text), falling back to the explicit Team final text, or that consumer's exact stop-reason error. It receives no intermediate messages or tool traffic.

#### Token effect

Parent input grows only by the final result or error, which is data-dependent and retained until compaction. This provider adds no parent schema itself.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **A fresh runtime process per run** — no pooling; a harness runtime boots a full plugin tree, so per-run spawn cost is higher than the ACP backend's typical child.
- **No optional start-time capabilities** — the parent cannot enforce `outputSchema`, depth, tool filters, or persona inside the child process; configure the child's own `cordis.yml` instead.
- **The child Team's transcript stays in the child's own session root** — the parent log records only the delegation tool call/result (the seam's child-isolation rule); the streamed coordinator `session.event` channel is consumed for output extraction, not bridged into the parent log.
- **Local child processes only** — the resolved cwd is a local path; a remote runtime would need its own backend.
