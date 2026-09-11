# Clocky Python SDK

[English](https://github.com/Linorman/clocky/blob/master/python/sdk/README.md) | 中文

通过 JSON-RPC stdio 驱动 Clocky 的 Python 子进程 SDK。运行时继承指定 Cordis 组合所声明的环境变量，调用方可以直接使用真实模型端点，也可以把这些变量指向本地代理。

请从 PyPI 安装 `clocky-sdk` 分发包；导入模块仍为 `clocky`：

```sh
python -m pip install clocky-sdk
```

安装 `clocky-sdk` 会同时安装版本完全相同的 `clocky-runtime-bin` 平台 wheel 包。因此常规入口不需要传可执行文件参数：

```py
from clocky import Clocky

with Clocky(credential="product-credential", provider="test-provider", model="test-model") as harness:
    result = harness.run("Say hi.")
```

`Clocky` 会保留其按需启动的运行时子进程，以便在多次调用之间复用。请像上例一样将其用作上下文管理器，或在使用完毕后显式调用 `close()`。

默认情况下，SDK 会启动 `clocky-runtime-bin` 包内置的单文件可执行程序 `clocky-jsonrpc-agent`，并通过 `CLOCKY_CORDIS_CONFIG` 注入该包的默认配置，其中包括 stdio JSON-RPC 服务器、agent core（智能体核心）、一个休眠的通用提供方路由、JSONL 会话持久化，以及本地 Team Hub/Link/Agent Client/TeamRun 栈。要运行自己的插件组合，请在配置中保留 `@clocky/clocky-sdk-jsonrpc-server` 配置项，并传入 Cordis 配置文件路径。

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

`credential` 是直接传给 `Clocky` 的不透明产品凭据。SDK 只在初始化握手中传输它，绝不在后续 Team request、运行时环境或启动参数中传输它。对内置默认配置，父进程会在 credential scrubbing 后只将其 SHA-256 摘要作为 `CLOCKY_PRODUCT_CREDENTIAL_SHA256` 提供给子进程。`provider` 选择指定 Cordis 组合所注册的提供方路由；`model` 是该适配器解析出的模型 ID。`max_tokens` 是一个可选的正整数，用于限制每个 SDK 创建的 Team coordinator 请求的 token 输出；省略该参数时，由提供方的默认行为决定输出上限。压缩摘要继续使用压缩插件单独配置的上限。内置默认组合注册用于无密钥启动和脚本化验证的休眠 `test-provider` 路由。自定义组合可以挂载 `llm-pi-ai`，在其中配置各提供方专属的凭据和端点，并选择 pi-ai 已安装 catalog 中存在的任意提供方/模型组合。

[Python SDK 教程](https://github.com/Linorman/clocky/blob/master/docs/user/guide/python-sdk.md)提供一套无需使用 Web UI、按步骤完成安装和首次运行的流程。该教程所用的完整独立 Cordis 配置文件位于 [`jsonrpc-agent` 示例](https://github.com/Linorman/clocky/blob/master/examples/jsonrpc-agent/README.md)中。

bundled runtime 还包含一个指向 canonical 本地 OpenAI 兼容服务器 `http://127.0.0.1:18000/v1` 的显式 `local-vllm` route。设置 `CLOCKY_LOCAL_MODEL_ID` 与 `CLOCKY_LOCAL_MODEL_API_KEY`（用户提供的未认证 endpoint 使用 `EMPTY`），再把 route 和 model 传给 `Clocky`，无需自定义 Cordis 文件即可选择它；`CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high` 会转换为实测 Qwen endpoint 的 `xhigh` 拼写。其他 base URL 应通过 `CLOCKY_CORDIS_CONFIG` 提供显式 Cordis 配置。

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

`Clocky.create_team(input, objective=...)`创建默认的 human/coordinator/worker Team，并返回带有 `id` 和 `coordinator_session_id` 的 `Team`句柄。`Clocky.resume_team(team_id)` 与 `Team.resume()`会先读取当前持久 Team cursor，再发送经认证且不含 actor 的 resume request；可传入 `expected_cursor=` 使用显式观察到的 fence，或在低层边界使用 `HarnessClient.resume_team(TeamResumeRequest(...))`。过期 cursor 仍会抛出 `JsonRpcError`，重试前应重新读取 state。字符串会成为一个 direct v3 text block；显式输入会保留有序的 direct v3 text/image block。字符串默认提供 objective；仅含 image 的输入必须提供 `objective`。

`Clocky.list_teams()`、`Clocky.list_team_members()`、`Clocky.list_team_tasks()`和`Team.channel()`都会返回有界 page。传入 `after_cursor` 与 `limit` 可以从 `nextCursor` 继续读取；SDK 会通过共享 JSON-RPC protocol 原样转发这些 field，省略时使用 runtime 的有界默认值。

`Clocky.team_metrics()`（或 `Team.metrics()`）返回用于 dashboard 与告警的进程内 Team 运行计数器与 gauge，包括 active admission、checkpoint/compaction count、audit projection repair/failure count，以及累计的 task/receipt latency histogram。

`HarnessClient.read_team_artifact()` 和 `Team.read_artifact()` 按 durable id 读取一个可见的 provider-backed artifact，并返回准确的 reference、byte count 和 base64 data。Private、ambiguous、没有 provider、缺失和超限 artifact 在该 SDK surface 上仍不可用。

`Team.wait_for_final()`只有在运行时仍持有该 TeamRun，且 coordinator 的显式 `team_final` Envelope 获得 human receipt、本地 topology 完全结算后，才返回 `TeamFinalReceipt(team_id, channel_id, envelope_id, text)`。`Team.cancel()`有相同的 ownership 条件，并在终态 Team phase 结算后返回。`Team.archive()`会把终态 Team 和 cursor 绑定到已认证 active human proof，因此 detached 或 restart 后的 Team 也可归档；active Team 会被拒绝，重复归档保持幂等。`Clocky.run()`返回 `RunResult(team_id, final_response, final, events, notifications)`：`final_response`等于 `final.text`，`events`和`notifications`都按协议传输顺序包含 coordinator 会话事实。

`HarnessClient`保留通用 notification subscription，以及低层已认证 Team 方法，包括 `create_team()`、`resume_team()`、`wait_for_team_final()`、`cancel_team()`、`archive_team()`、member、channel、goal 与 task mutation。关闭 notification subscription 会丢弃排队 item，并用 `TransportClosedError` 唤醒每个阻塞的 `next()`；runtime failure 仍通过同一个 subscription 暴露。需要 typed handling 时，`HarnessError`、`JsonRpcError`、`SdkProtocolError`、`TransportClosedError` 和 `NotificationSubscription` 都可以从 `clocky` package 导入。Resume 从已初始化 credential 派生 active human，并要求显式 cursor fence；过期 fence 会返回 `JsonRpcError`，绝不会用伪造 cursor 重试。Team id、cursor 与 participant id 都不能证明 authority，所有 mutation payload 都不携带 actor 或 proof；runtime 从已初始化 credential 派生 active human，并执行其 immutable grant、revision 或 cursor fence 与 review policy。有界的 list/read/watch、quiescence、audit 与 metrics 仍可用。Session 仍是 transcript source，而不是产品 run target。畸形的 Team receipt 或 coordinator event 会抛出 `SdkProtocolError`。[authenticated product-principal Team control note](../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)记录连接绑定；[Team actor-proof control-plane proposal](../../.agents/notes/proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)仍是更广泛的 proof owner。

也可以通过 `CLOCKY_CORDIS_CONFIG` 为运行时子进程指定配置。`HarnessClient.initialize()` 只会在收到凭据后启动子进程，因此底层客户端按默认方式启动时也具有该行为：如果启动方式最终解析为内置运行时，且既没有设置 `cordis`，也没有设置非空的 `CLOCKY_CORDIS_CONFIG`（运行时将空值视为未设置，注入检查也是如此），系统就会使用内置默认配置；显式指定 `runtime_bin`、`bridge_bin` 或 `launch_args_override` 时，则会完全禁用该注入。运行时载体（生产用 exe 与仅限开发的 `node` 闭包）及其获取方式见 [sdk-runtime README](https://github.com/Linorman/clocky/blob/master/python/sdk-runtime/README.md)。

`cwd` 与 `runtime_cwd` 会在启动子进程、注入环境变量和协议握手前解析为绝对路径。公开 API 只暴露由 SDK 直接应用的选项：部署 persona 和持久化配置应在 `cordis.yml` 中定义；`session_root` 则保留为设置 `CLOCKY_SESSION_ROOT` 的高层便捷参数。


`Clocky` 与 `HarnessClient` 提供 `inbox_read(after_cursor=None, limit=None)`、`inbox_watch(...)` 和 `inbox_acknowledge(through_cursor)`。读取返回 `TeamHumanInboxPage`，确认返回 `TeamHumanInboxAcknowledgement`；这些已导出 model 保留准确的 final provenance 与共享持久 display cursor。Inbox 由初始化时认证的 principal 选择，display acknowledgement 独立于 channel receipt。[Inbox Consumer](../../packages/team/team-human-client/README.zh.md) 定义权限、分页、重启行为与当前缺口。

## 单任务取消

`HarnessClient.cancel_team_task()`和`Team.cancel_task()`接收`teamId`、`taskId`、`expectedRevision`及可选`reason`（Team helper 提供自身 Team id）。`value.cancellation`保留精确 intent；assigned 或 running phase 表示终止仍在等待。Team 继续运行，应观察任务直到 cancelled。 [取消归属](../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
