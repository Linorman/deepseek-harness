# jsonrpc-agent

[English](README.md) | 中文

面向 Python SDK 内置 JSON-RPC 运行时的无人值守编码 agent（智能体）组合。它有意不加载终端 UI、控制台日志记录器、批准界面或用户交互工具，因为 stdout 属于 SDK 协议，轮次由 SDK 驱动。

面向模型的工具为：

- `bash`，仅前台
- `read`、`write` 和 `edit`
- `todo_write`

周边运行时还加载 JSONL Session 持久化、本地 Team Hub/Link/Agent Client/TeamRun stack 和自动上下文压缩（context compaction）。每个 SDK 请求都会创建一个 Team，coordinator 通过 direct v3 接收输入，并且只能经由 `team_final`返回结果。

## 运行时环境

| 变量 | 用途 |
|---|---|
| `TEST_API_KEY` | 传给已配置 OpenAI 兼容端点的凭据 |
| `cordis.yml` 中的 `baseURL` | 配置的提供方 profile 使用的宿主端点；部署时请编辑该 profile |
| `CLOCKY_CWD` | bash 和文件系统工具使用的 agent workspace |
| `CLOCKY_CONTEXT_WINDOW` | 极简变体中为 `CLOCKY_MODEL` 目录项记录的上下文容量 |
| `CLOCKY_PROVIDER` | `minimal.py` 使用的提供方路由；`--provider` 优先 |
| `CLOCKY_MODEL` | `minimal.py` 使用的模型；`--model` 优先 |
| `CLOCKY_SESSION_ROOT` | JSONL 会话目录 |
| `CLOCKY_SYSTEM_PROMPT` | 由部署提供的编码人格 |

通过 Python SDK 的 `cordis` 选项或 `CLOCKY_CORDIS_CONFIG` 传入配置路径。内置可执行文件已携带此文件中指定的每个插件；目标机器无需 Node.js。

## 极简变体

[`minimal.cordis.yml`](minimal.cordis.yml) 是 Web `minimal` preset 的完整独立版本。`CLOCKY_SYSTEM_PROMPT` 选择它的系统提示词，未设置时使用 `You are a helpful software engineer assistant.`。它为新建会话抑制每个 system-prompt runtime-context 贡献，且不挂载上下文压缩插件。面向模型的工具严格只有：

- 所有者作用域内持久化的 `bash`
- 提供 `view`、`create`、`str_replace` 与 `insert` 的 `str_replace_editor`

它组合了内置运行时所需的本地 PTY、裸 `fs-local` 后端、供持久 Bash 使用的 danger-full-access 策略、未压缩的 JSONL 持久化，以及相同的本地 Team stack。Bash 和编辑器绝对路径可以修改运行时进程有权访问的任何路径，因此只能针对可丢弃的 checkout 或容器运行该变体。持久 PTY 需要 POSIX 终端环境，因此不适用于 Windows agent 接口。

[`minimal.py`](minimal.py)通过 Python SDK 运行该组合，并要求从 `--provider`/`--model` 或 `CLOCKY_PROVIDER`/`CLOCKY_MODEL` 提供提供方和模型。[Python SDK 教程](../../docs/user/guide/python-sdk.zh.md)介绍安装、运行、workspace 选择与 session 标识；[SDK 参考](../../python/sdk/README.zh.md)归属运行时生命周期与结果语义。
