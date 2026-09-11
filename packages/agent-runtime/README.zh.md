# agent-runtime/ — Participant activation 提供方

[English](README.md) | 中文

本家族包含 Team 已解析的 Participant activation placement 提供方。Service Definition 仍位于 [`core/agent-runtime`](../core/agent-runtime/README.zh.md)，因此提供方拥有易变的 Agent 驻留状态，而不会成为 Team journal、channel transport 或面向模型的控制平面。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-runtime-in-process/`](agent-runtime-in-process/README.zh.md) | 本地 fresh/fork/resume placement 提供方 | 默认 `ctx.agentRuntimes` provider `in-process` |
| [`agent-runtime-sdk/`](agent-runtime-sdk/README.zh.md) | 面向远程 agent 的 fresh/resume 生命周期 placement 提供方 | 默认 `ctx.agentRuntimes` provider `sdk` |
| [`agent-runtime-acp/`](agent-runtime-acp/README.zh.md) | 面向 remote/local Participant 的 ACP 子进程生命周期提供方 | 默认 `ctx.agentRuntimes` provider `acp` |

进程内提供方与 [`clocky-agent-runtime`](../core/agent-runtime/README.zh.md)、[`clocky-agent`](../core/agent/README.zh.md)以及一个 `SessionPersistence` 提供方显式挂载。它会为每个已接收的 activation 创建持久本地 Session，但不挂载 Team Hub、channel client、调度器或模型工具。

SDK provider 通过 SDK 生命周期／状态协议，为活跃的 `remote-agent` Participant 提供 fresh 或 resume activation placement。其 handle 不公开本地 `Agent`；不提供远程 Link 或 Envelope 投递。

ACP provider 为每个 activation 启动一个 ACP server 子进程，在发布前完成 ACP initialize/session 握手，提供 idle/running/stopping/offline 状态，向 `session/cancel` 转发中断，并在 EOF 或有界升级后回收子进程。配置 Team Link enrollment issuer 后，它会拥有一个临时 activation-bound WebSocket Link，把已 claim 的 Team Envelope 串行转为 ACP `session/prompt`，完成后才确认；ACP output 仍是私有的，绝不会被隐式视为 Team 消息。

公开注册表类型和事件定义于 [docs/subsystems/agent-runtime.md](../../docs/subsystems/agent-runtime.zh.md)。[AgentRuntime 决策](../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.zh.md)记录所有权拆分。
