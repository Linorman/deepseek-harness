# @clocky/clocky-acp-demo

English | [中文](README.zh.md)

ACP automation server app: the default agent spine, local TeamRun topology, JSONL coordinator transcripts, Team journals, semantic checkpointing, and [`@clocky/clocky-acp`](../../acp/acp/README.md) behind one JSON-RPC stdio bin. Each ACP `session/new` returns an opaque handle for one Team task; the coordinator Session remains an internal transcript.

## Composition

| Plugin | Role |
|---|---|
| `@clocky/clocky-agent-spine-demo` | Providerless Agent spine with no pre-created Agents. |
| `@clocky/clocky-session-persistence-jsonl` | Durable session logs used by checkpointing, observability, and snapshot replay. |
| `@clocky/clocky-session-checkpoint-policy` | Durability barriers before model calls and top-level tool effects, plus completed-step checkpoints. |
| `@clocky/clocky-session-query-sqlite` | Derived exact/FTS session-query service, opened before the ACP transport so leaf consumers are ready for the first model request. |
| `@clocky/clocky-agent-default-model` | Selects the local coordinator route from this app's `provider` and `model` config. |
| `@clocky/clocky-storage`, `-json`, `-log`; `@clocky/clocky-team-hub`; `@clocky/clocky-team-channel-direct` | Persist the Team journal and direct v3 human/coordinator channel. |
| `@clocky/clocky-agent-runtime`, `-in-process`; `@clocky/clocky-team-activation-controller`; `@clocky/clocky-team-link`, `-local`; `@clocky/clocky-team-agent-client` | Activate the local coordinator and deliver durable channel Envelopes to its Session. |
| `@clocky/clocky-tool-team`, `-goal`; `@clocky/clocky-team-run` | Install scoped `team_final`, `get_goal`, and `update_goal`; own the default human/coordinator/worker topology. |
| `@clocky/clocky-acp` | Automation-only ACP transport over stdin/stdout, backed by TeamRun. |

The app does not install commands, user interaction, session navigation, configuration pickers, or a stdout logger. Its ordered effect keeps Team storage, coordinator delivery, and JSONL persistence available until ACP work quiesces. Leaf configurations supply LLM, executor, sandbox, approval, filesystem, and model-facing tool plugins.

## Config

| Key | Default | Routed to |
|---|---|---|
| `provider` | required | Default provider route for each Team coordinator. |
| `model` | required | Default model for each Team coordinator. |
| `interruptRetryAttempts` | ACP default (`3`) | Fresh Team projection reads allowed while committing a coordinator soft interrupt. |
| `maxParallelToolCalls` | agent-loop default | Positive-integer tool-call concurrency cap; `1` is serial. |
| `persona` | — | Deployment persona template for `clocky-system-prompt`. |
| `toolOrder` | lexicographic | Explicit model-facing tool order for `clocky-system-prompt`. |
| `tools` | `{ mode: 'native' }` | Native, Code Mode, or combined model tool transport. |
| `clockyHome` | `$CLOCKY_HOME` or `~/.clocky` | Harness home shared by bash and local skill discovery. |
| `sessionTitle` | spine example limits | Durable fallback-title limits; titles remain off the ACP wire. |
| `persistenceRoot` | `./.sessions` | JSONL backend root and parent directory of the derived `session-query.db` index and default Team storage root. |
| `teamStorageRoot` | `<persistenceRoot>/team-storage` | JSON storage root for Team journals and channel WALs. |
| `packChunks` | `true` | Pack consecutive delta-chunk events in storage. |
| `persistenceCompression` | `zstd` | Checksummed Zstandard frames or raw `none`. |
| `workspaceContext` | required | Workspace-instruction byte budget/config, or `false`. |
| `skills` | owner defaults | Skill registry, local provider, and model-facing skill tool. |
| `toolBash` | owner defaults | Model-facing bash tool config. |
| `jobs` | `{ maxConcurrentJobsPerOwner: 10 }` | Process-local per-owner active-task admission. |
| `toolJobs` | owner defaults | Generic background-job control config, or `false`. |
| `goals` | removed | Rejected at load; ACP tasks are Team-owned. |

The shipped [`examples/acp-agent/cordis.yml`](../../../examples/acp-agent/cordis.yml) adds the pi-ai adapter with its configured provider profile, sandboxed bash and filesystem providers, one-shot approval policy, compaction, hooks, and model-facing tools. Image overlays explicitly add `@clocky/clocky-attachment-local`; without it, ACP advertises no image input. The app supplies the derived session-query index, while the model-facing query consumer remains an explicit leaf opt-in. Direct subagent and workflow packages belong only in explicit custom compositions.

## Bin

`clocky-acp-demo [--config path-to-cordis.yml]` (short form `-c`; default `./cordis.yml`) loads the gitignored `.env`, except in replay mode; `CLOCKY_SNAPSHOT=replay` selects the sibling `cordis.snapshot.yml`; stdin EOF disposes the context and flushes sessions before exit. Loader's installed optional `node-addon-require-builtin` peer resolves bare plugin specifiers for the built bin under plain Node. Diagnostics use stderr because stdout is the ACP wire.

## Model Experience

Indirectly, through `clocky-agent-spine-demo`, `clocky-team-run`, and the leaf's model-facing plugins.

#### KV Cache effect

The TeamRun final-output instruction and scoped `team_final`, `get_goal`, and `update_goal` schemas are stable for one coordinator activation. Human content and tool results remain dynamic Session suffixes.

## Known Limitations and Deferred Work

- **JSONL coordinator persistence is fixed** — a different Session backend requires another composition.
- **Sibling plugins can corrupt stdout** — the app cannot prevent another entry from writing non-protocol bytes.
- **Fresh automation Team tasks only** — resume and human interaction belong to other entry points.
