# acp-agent 示例

[English](README.md) | 中文

通过 JSON-RPC stdio 提供的面向自动化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 服务器。它面向 parent agent（父智能体）、subagent 提供方和其他程序化客户端，而非产品 UI。

```sh
pnpm run demo:acp             # needs the configured provider key (repo-root .env or env)
pnpm run demo:code-mode       # same protocol with the Code Mode tool transport
# For text-only live e2e, select the local OpenAI-compatible route:
#   CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1
#   CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
#   CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
```

当 `CLOCKY_LOCAL_MODEL_BASE_URL` 非空时，live text ACP 测试会使用静态的
`local-vllm` route 和配置的本地模型；否则使用 DeepSeek route。本地 route
发送 `max_tokens`，不会发送不支持的 developer role，并会把 canonical reasoning level
映射为测试 endpoint 支持的拼写（`high` 映射为 `xhigh`，`minimal` 与 `max` 使用最
接近的支持档位）。只有需要时才设置 `CLOCKY_LOCAL_MODEL_REASONING_EFFORT`；省略它
即可保留提供方默认值。面向图像和提供方专用的 overlay 继续保留各自的 route
contract。

该叶节点加载 ACP 应用、已配置的提供方适配器、受沙箱限制的 bash 与文件系统栈、一次性批准策略、压缩（compaction）、钩子、派生会话查询索引和重复守卫。每次 `session/new` 会创建一个带有人类、协调者和未激活 worker 的本地 TeamRun 任务；JSONL 保存内部协调者转录，而 ACP id 保持不透明。可选 overlay 可添加会话查询、文件系统 spill 存储、Code Mode、Web 抓取或持久图像存储。仅测试用的 overlay 保留 direct subagent 与工作流覆盖。

## 协议通道

Stdout 只携带以换行分隔的 ACP JSON-RPC。`@clocky/clocky-acp-demo` 不安装 stdout logger；该叶节点新增的组件必须使用 stderr 输出诊断信息。

自动化约定（支持的方法、基线提示词内容、已提交文本输出，以及有意缺少的 UI 界面）位于 [`@clocky/clocky-acp`](../../packages/acp/acp/README.zh.md)。

## 会话 workspace 与权限

每次 `session/new` 都提供一个绝对 `cwd`。Team 协调者 Session 会记录该根目录，受沙箱限制的 bash 和文件系统修改会以它为基准应用 `workspace-write`，因此并发 Team 任务可以使用不同的项目根目录；平台临时根目录仍是共享可写暂存空间（参见[沙箱约定](../../packages/sandbox/sandbox/README.zh.md)）。`CLOCKY_PERMISSION_MODE` 为部署选择 `workspace-write` 或 `danger-full-access`。

在 `workspace-write` 下，如果模型重试请求更广泛的沙箱访问权限，就会触发 `session/request_permission`，选项为 `allow_once` 和 `reject_once`。客户端以程序方式决策；客户端放弃选择或无法给出答复时，系统会按拒绝处理。选定结果仅适用于该次重试，并通过常规工具结果／审计路径记录。服务器绝不公开权限选择器，也不持久化客户端策略。

图像场景通过其 overlay 加载 `@clocky/clocky-attachment-local`。基础配置没有附件存储，因此会正确声明图像输入不可用。
