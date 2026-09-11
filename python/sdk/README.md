# Clocky Python SDK

English | [中文](https://github.com/Linorman/clocky/blob/master/python/sdk/README.zh.md)

Python subprocess SDK for driving Clocky over JSON-RPC stdio. The
runtime inherits the environment named by the selected Cordis composition, so
callers can use real model endpoints directly or point those variables at a
local proxy.

Install the `clocky-sdk` distribution from PyPI; the import module remains `clocky`:

```sh
python -m pip install clocky-sdk
```

Installing `clocky-sdk` installs the exact same-version `clocky-runtime-bin` platform wheel. The normal entry point therefore needs no executable argument:

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="test-provider", model="test-model") as harness:
    result = harness.run("Say hi.")
```

`Clocky` keeps its lazily started runtime subprocess for reuse across calls. Use it as a context manager, as above, or call `close()` explicitly when finished.

By default, the SDK launches the bundled single-file `clocky-jsonrpc-agent` executable from the `clocky-runtime-bin` package and injects that package's default configuration (the stdio JSON-RPC server, agent core, a dormant generic provider route, JSONL session persistence, and the local Team Hub/Link/Agent Client/TeamRun stack) via `CLOCKY_CORDIS_CONFIG`. To run a plugin composition of your own, keep the `@clocky/clocky-sdk-jsonrpc-server` entry in the config and pass the Cordis config path.

```py
from clocky import Clocky

with Clocky(
    provider="test-provider",
    model="test-model",
    credential="product-credential",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`credential` is an opaque product credential supplied directly to `Clocky`. The SDK sends it only in the initialization handshake, never in later Team requests, the runtime environment, or launch arguments. For the bundled default configuration, the parent supplies only its SHA-256 digest as `CLOCKY_PRODUCT_CREDENTIAL_SHA256` after credential scrubbing. `provider` selects a provider route registered by the chosen Cordis composition; `model` is the model id resolved by that adapter. `max_tokens` is an optional positive output-token cap for each SDK-created Team coordinator request; omission leaves the provider default in control. Compaction summaries keep the separate limit configured by their compaction plugin. The bundled default composition registers the inert `test-provider` route for keyless boot and scripted verification. A custom composition can mount `llm-pi-ai`, configure provider-specific credentials/endpoints there, and select any provider/model present in pi-ai's installed catalog.

The [Python SDK tutorial](https://github.com/Linorman/clocky/blob/master/docs/user/guide/python-sdk.md) provides an ordered installation and first-run path without the Web UI. The [`jsonrpc-agent` example](https://github.com/Linorman/clocky/blob/master/examples/jsonrpc-agent/README.md) owns the complete standalone Cordis file used there.

The bundled runtime also includes an explicit `local-vllm` route for the canonical local OpenAI-compatible server at `http://127.0.0.1:18000/v1`. Select it without a custom Cordis file by setting `CLOCKY_LOCAL_MODEL_ID` and `CLOCKY_LOCAL_MODEL_API_KEY` (use `EMPTY` for the supplied unauthenticated endpoint), then pass the route and model to `Clocky`; `CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high` is translated to the tested Qwen endpoint's `xhigh` spelling. A different base URL belongs in an explicit Cordis config supplied through `CLOCKY_CORDIS_CONFIG`.

```sh
CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high
```

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="local-vllm", model="Qwen3.8-27B-AWQ-4bit") as harness:
    result = harness.run("Make the requested code change.")
```

`Clocky.create_team(input, objective=...)` creates the default human/coordinator/worker Team and returns a `Team` handle with `id` and `coordinator_session_id`. `Clocky.resume_team(team_id)` and `Team.resume()` read the current durable Team cursor before sending an authenticated actor-free resume request; pass `expected_cursor=` to use an explicit observed fence, or use `HarnessClient.resume_team(TeamResumeRequest(...))` at the low-level boundary. A stale cursor remains a `JsonRpcError`, so reread state before retrying. Strings become one direct-v3 text block; explicit input preserves ordered direct-v3 text/image blocks. A string supplies the objective by default, while image-only input requires `objective`.

`Clocky.list_teams()` and `Clocky.get_team(team_id)` expose durable Team projections without activating a coordinator. `Team.state()` reads its latest projection; lifecycle changes use typed Team operations rather than a generic phase mutation.

`Clocky.list_teams()`, `Clocky.list_team_members()`, `Clocky.list_team_tasks()`, and `Team.channel()` return bounded pages. Pass `after_cursor` and `limit` to continue from `nextCursor`; the SDK forwards these fields unchanged over the shared JSON-RPC protocol, and omitting them uses the runtime's bounded default.

`Clocky.team_metrics()` (or `Team.metrics()`) returns process-local Team operational counters and gauges, including active admissions, checkpoint/compaction counts, audit-projection repair/failure counts, and cumulative task/receipt latency histograms, for dashboards and alerts.

`HarnessClient.read_team_artifact()` and `Team.read_artifact()` read one visible provider-backed artifact by its durable id and return the exact reference, byte count, and base64 data. Private, ambiguous, provider-less, missing, and oversized artifacts remain unavailable through this SDK surface.

`Team.wait_for_final()` returns `TeamFinalReceipt(team_id, channel_id, envelope_id, text)` only while the runtime still owns that TeamRun, after the coordinator's explicit `team_final` Envelope has a human receipt and the local topology settles. `Team.cancel()` has the same ownership condition and returns after the terminal Team phase settles. `Team.archive()` binds a terminal Team and cursor to the authenticated active human proof, so it also works for detached or restarted Teams; an active Team is rejected and a repeated archive remains idempotent. `Clocky.run()` returns `RunResult(team_id, final_response, final, events, notifications)`, where `final_response` equals `final.text` and `events` and `notifications` contain coordinator session facts in wire order.

`HarnessClient` retains generic notification subscriptions and low-level authenticated Team methods including `create_team()`, `resume_team()`, `wait_for_team_final()`, `cancel_team()`, `archive_team()`, member, channel, goal, and task mutations. Closing a notification subscription drops queued items and wakes every parked `next()` with `TransportClosedError`; runtime failure remains observable through the same subscription. `HarnessError`, `JsonRpcError`, `SdkProtocolError`, `TransportClosedError`, and `NotificationSubscription` are exported from the `clocky` package for callers that need typed handling. Resume derives the active human from the initialized credential and requires its explicit cursor fence; a stale fence returns `JsonRpcError` rather than being retried with a fabricated cursor. Team ids, cursors, and participant ids do not prove authority, and all mutation payloads remain actor- and proof-free. The runtime derives the active human from the initialized credential and enforces its immutable grant, revision or cursor fence, and review policy. Bounded list/read/watch, quiescence, audit, and metrics remain available. Sessions remain transcript sources and are not product run targets. Malformed Team receipts or coordinator events raise `SdkProtocolError`. The [authenticated product-principal Team control note](../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.md) records the connection binding; the [Team actor-proof control-plane proposal](../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) remains the broader proof owner.

The same behavior can be selected for the runtime subprocess with `CLOCKY_CORDIS_CONFIG`. `HarnessClient.initialize()` launches the child only after receiving its credential, so the low-level client's default launch gets it too: when the launch resolves to the bundled runtime and neither `cordis` nor a non-empty `CLOCKY_CORDIS_CONFIG` is set (the runtime treats an empty value as absent, and so does the injection check), the bundled default configuration is used; an explicit `runtime_bin`, `bridge_bin`, or `launch_args_override` disables the injection entirely. See the [sdk-runtime README](https://github.com/Linorman/clocky/blob/master/python/sdk-runtime/README.md) for the runtime carriers (production exe vs dev-only node closure) and how to obtain them.

`cwd` and `runtime_cwd` are resolved to absolute paths before subprocess launch, environment injection, and the wire handshake. The public API exposes only applied options: deployment persona and persistence belong in `cordis.yml`, while `session_root` remains the high-level convenience that sets `CLOCKY_SESSION_ROOT`.


`Clocky` and `HarnessClient` expose `inbox_read(after_cursor=None, limit=None)`, `inbox_watch(...)`, and `inbox_acknowledge(through_cursor)`. Reads return `TeamHumanInboxPage`; acknowledgement returns `TeamHumanInboxAcknowledgement`. These exported models preserve exact final provenance and the shared durable display cursor. The initialized principal selects the inbox, and display acknowledgement remains independent of channel receipts. The [inbox Consumer](../../packages/team/team-human-client/README.md) defines permissions, pagination, restart behavior, and current limitations.

## Single-task cancellation

`HarnessClient.cancel_team_task()` and `Team.cancel_task()` accept `teamId`, `taskId`, `expectedRevision`, and optional `reason` (the Team helper supplies its own Team id). `value.cancellation` retains the exact intent; assigned or running phases mean termination is pending. Observe the task until cancelled while the Team continues. [Cancellation ownership](../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.md).
