# @clocky/clocky-acp

English | [中文](README.zh.md)

Automation-only [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. ACP projects each client session onto one local Team run: it accepts human text/image input, streams committed coordinator output, receives the explicit Team final result, relays one-shot permissions, and requests soft interruption. The primary in-repository client is [`clocky-subagent-acp`](../../compat/subagent-acp/README.md).

This package is a transport adapter, not a UI integration or a capability seam. It does not expose editor navigation, transcript replay, commands, modes, configuration pickers, elicitation, reasoning, plans, titles, or tool presentation. Interactive rendering and human questions belong to the Web host and client modules.

## Plugin

`apply(ctx, config)` opens an `AgentSideConnection` on stdin/stdout and requires `ctx.teamRuns`, `ctx.teams`, and `ctx.agentDefaultModel`. Stdout is reserved for protocol frames. TeamRun selects the coordinator's model through the current default-model selection.

| Config | Default | Meaning |
|---|---|---|
| `interruptRetryAttempts` | `3` | Positive bounded fresh-read attempts after a Team journal cursor conflict while accepting a soft interrupt. |

## Protocol contract

| Method | Behavior |
|---|---|
| `initialize` | Negotiates the supported version. Image prompts are advertised only when the current default provider/model and durable attachment store explicitly support images; audio and embedded context stay false. No editor, terminal, filesystem, MCP, or session-management capability is advertised. |
| `authenticate` | No-op because the server advertises no authentication methods. |
| `session/new` | Validates one absolute `cwd`, creates the default local TeamRun topology, and returns a random ACP id distinct from the Team id and coordinator Session id. Empty `additionalDirectories` and `mcpServers` are accepted; non-empty values reject. |
| `session/prompt` | Admits ordered text and supported inline image blocks before posting one trusted human direct-v3 Envelope. It waits for `team_final`, its durable human receipt, coordinator release, and Team completion. A missing final or model failure rejects. A completed ACP session rejects later prompts. |
| `session/cancel` | Aborts local content/final waits and asks TeamRun to issue one durable human-to-coordinator soft-interrupt proof. Unknown and completed ids are no-ops. |
| `session/update` | Emits committed coordinator text/image blocks in order. The explicit final text is emitted after earlier output only when that exact ending was not already emitted by the coordinator. Raw deltas and non-message events are omitted. |
| `session/request_permission` | Offers one-shot allow/reject choices for bridge-owned approval requests with a tool-call id. |

One connection may own several ACP sessions, each representing one Team task. ACP records are keyed by opaque wire id and reverse-mapped by exact coordinator Agent identity, so coordinator Session events and permission requests cannot be misrouted through a matching wire id.

## Lifecycle

Client disconnect and Cordis disposal share one memoized teardown. The bridge rejects new work, aborts outstanding ACP waits, then calls `ctx.teamRuns.cancel()` for every owned run and awaits ordered output projection. This transitions active or quiescing Teams to `cancelled` before releasing their coordinator leases. An individual successful prompt instead lets TeamRun receipt its final Envelope and complete the Team.

## Model Experience

### Prompt text and images

#### What the model sees

The coordinator receives a Team-provenanced direct message: a sender prefix followed by the ordered text and durable image references admitted from `session/prompt`. Resource links become bracketed text references. Inline image base64, ACP wire ids, permission choices, and transport metadata do not enter the model request. The TeamRun coordinator prompt requires `team_final` on its direct channel; an assistant message alone is not a final result.

#### Token effect

The direct-v3 message and coordinator system prompt enter the coordinator Session history. Text and image costs are data-dependent; final-result tool and receipt records remain reconstructable from Team and Session logs.

#### KV Cache effect

Input appends after the reusable coordinator prefix. The final-output instruction remains stable for the Team run.

### Permission decisions

#### What the model sees

Nothing directly. The owning tool records its allowed, rejected, cancelled, or unavailable outcome through the normal tool-result path.

#### Token effect

Only the owning tool result contributes tokens.

#### KV Cache effect

Append-only through the owning tool result.

## Known Limitations and Deferred Work

- **Fresh local Team runs only** — load, list, resume, archive, and per-session close are unsupported.
- **One final task per ACP session** — `team_final` completes and releases the coordinator; clients create another ACP session for another Team task.
- **Raster images and one workspace only** — image prompts require durable storage and a default route that declares image input; only PNG, JPEG, WebP, and GIF are accepted. Audio, embedded resources, non-empty additional directories, and MCP servers reject; resource links flatten to text rather than fetched content.
- **Committed answers only** — live progress, reasoning, tool activity, plans, titles, and usage stay off the wire.
