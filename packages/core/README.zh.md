# core/ — 产品 API 主干

[English](README.md) | 中文

构成 harness 默认控制主干的会话日志、系统提示词组装、工具注册表、agent（智能体）词汇、部署默认模型选择和具体循环。这些是**产品**包，即插件和消费方构建所依赖的稳定接口。

| 包 | 职责 | ctx key |
|---|---|---|
| [`scope/`](scope/README.zh.md) | 作用域上下文注册原语 | 库，不使用 ctx key |
| [`session/`](session/README.zh.md) | 事件溯源会话日志和内存存储 | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.zh.md) | 提示词和工具 schema 组装注册表 | `ctx.systemPrompt` |
| [`tools/`](tools/README.zh.md) | 作用域工具注册表和执行流水线 | `ctx.tools` |
| [`agent/`](agent/README.zh.md) | Agent 接口、注册表和事件词汇 | `ctx.agents` |
| [`agent-runtime/`](agent-runtime/README.zh.md) | Participant 绑定 Agent 激活 provider 注册表 | `ctx.agentRuntimes` |
| [`product-principal/`](product-principal/README.zh.md) | 认证产品 principal provider 注册表 | `ctx.productPrincipals` |
| [`team-link/`](team-link/README.zh.md) | Activation 绑定 Team Link provider 注册表 | `ctx.teamLinks` |
| [`team-workspace/`](team-workspace/README.zh.md) | Team task execution-root provider 注册表 | `ctx.teamWorkspaces` |
| [`team-artifact/`](team-artifact/README.zh.md) | 与 provider 无关的 Team artifact storage 注册表 | `ctx.teamArtifacts` |
| [`agent-default-model/`](agent-default-model/README.zh.md) | 各 Agent 入口共享的默认模型选择 | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.zh.md) | 默认具体 agent 驱动器 | `ctx.agentLoop` |
| [`team/`](team/README.zh.md) | Team 工作系统 Service Definition | `ctx.teams` |

`scope` 提供共享作用域原语。`agent` 负责公开约定，`agent-loop` 是其默认实现；扩展插件依赖该 seam，从而保持驱动器可替换。`agent-runtime`拥有 activation provider 注册，独立挂载的进程内 provider 拥有本地 placement 而不拥有 Team 权限。`product-principal`拥有认证产品身份和可撤销调用 lease，而不拥有传输或 Team 权限。`team-link`拥有 activation-bound Link provider 注册，而不拥有 Team journal 或 Agent inbox admission。`team-workspace`拥有 execution-root provider 注册，而不拥有 task lease 或 filesystem resource。`agent-default-model` 负责部署选择，Agent 入口仅在会话自身没有选择时使用它。`team`定义 Team 操作，独立挂载的 `team-hub` provider 拥有本地持久 Team 状态。

可运行组合属于 [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.zh.md)；该分组只负责可替换的主干组件。

子系统参考——逐包循环图、`Agent` 句柄及其投递／拦截约定——见 [docs/subsystems/core.md](../../docs/subsystems/core.zh.md)；默认可运行组合是 [`examples/agent-spine-demo`](../examples/agent-spine-demo/README.zh.md)。
