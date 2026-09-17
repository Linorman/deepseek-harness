# subagent/：subagent 能力家族

[English](README.md) | 中文

本家族允许一个 agent（智能体）将工作委派给子 agent。多个具名提供方可在同一上下文中共存。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`subagent/`](../compat/subagent/README.zh.md) | 定义提供方注册、委派和继续执行 | `ctx.subagents` |
| [`subagent-inprocess/`](../compat/subagent-in-process-driver/README.zh.md) | 提供共享的进程内运行驱动器 | 无 |
| [`subagent-spawn-in-process/`](../compat/subagent-spawn-in-process/README.zh.md) | 启动全新的进程内子 agent | 注册到 `ctx.subagents` |
| [`subagent-fork-in-process/`](../compat/subagent-fork-in-process/README.zh.md) | 从父 agent 已完成的历史记录启动进程内子 agent | 注册到 `ctx.subagents` |
| [`subagent-acp/`](../compat/subagent-acp/README.zh.md) | 通过 ACP（Agent Client Protocol）启动进程外子 agent | 注册到 `ctx.subagents` |
| [`subagent-clocky-sdk/`](../compat/subagent-clocky-sdk/README.zh.md) | 通过 TypeScript SDK 启动进程外 Harness 子 agent | 注册到 `ctx.subagents` |
| [`tool-subagent/`](../compat/tool-subagent/README.zh.md) | 向模型公开委派操作 | 注册到 `ctx.tools` |
| [`tool-subagent-control/`](../compat/tool-subagent-control/README.zh.md) | 向模型公开子级消息发送和列举操作 | 注册到 `ctx.tools` |
| [`tool-subagent-report/`](../compat/tool-subagent-report/README.zh.md) | 提供从子级到父级的报告通道 | 注册到子级作用域 |

参见有关[能力家族](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.zh.md)、[可继续执行的子级](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.zh.md)和[控制工具](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.zh.md)的决策。

子系统参考——启动请求、结果、实时运行、提供方约定、可续跑后台子 agent——见 [docs/subsystems/subagent.md](../../docs/subsystems/subagent.zh.md)；设计依据见 [subagent 能力 seam](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.zh.md)、[可继续子 agent 对话](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.zh.md)与[合并 subagent 控制服务](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.zh.md) Agent Note。
