# Agent Note: Team 拥有的产品任务入口

Status: implemented

[English](2026-08-29-team-owned-product-task-entry.md) | 中文

## Problem

公开的 `session.create` 与 `session.fork` 让 Session 成为用户创建的任务根。即使 Team 已成为产品工作系统，这条路径仍会绕过 Team identity、默认 human/coordinator topology、持久 channel 接纳和最终结果 policy。

## Decision

已发布产品的任务创建归 Team 所有。Web 先创建局部 Team 草稿，首次提交调用 `team.start`；Team state 只把 coordinator Session 解析为需要展示的转录。Host 从 API、HTTP carrier、client facade、fixture transport 和默认 client control 中移除公开的 `session.create` 与 `session.fork`。这两个未知 HTTP 路径按普通 unknown-route 响应处理。

本次移除不会臆造 `team.fork` 替代。分叉协作 authority 需要明确 membership、channel、task 与 policy 语义；只复制一条 coordinator 转录并不能提供这些语义。

`Session` 仍是本地执行与转录 primitive。`ctx.sessions.create()` 与 `fork()`、`ctx.agents.create()` 与 `resume()`、AgentRuntime placement、持久化恢复和测试搭建仍是受信的内部 API。通用 Host Agent/Session 解析会在恢复前拒绝带 Team provenance 的 Session，`session.updateQueue` 也会拒绝它们，而不会修改 coordinator inbox。对于正在运行的 Team coordinator，`session.prompt` 与 `session.cancel` 继续可用，因为它们分别经 human channel 和 soft-interrupt authority 路由，而不会创建独立工作。

## Alternatives considered

**将废弃的公开 Session 路由保留为 adapter。** 不予采用，因为缺少 Team template、human participant、channel 和 completion policy 的请求无法被忠实转换。兼容路径只会以另一名字保留绕过通道。

**新增 `team.fork`。** 不予采用，因为尚未定义 Team 层的 fork contract。它会要求决定 participant membership、pending delivery、task attempt、budget、workspace allocation 与 final-output authority，而 Session prefix 无法回答这些问题。

**删除 Session 与 Agent 的创建 primitive。** 不予采用，因为 Team activation、恢复和本地转录测试拥有这些受信操作。移除产品 RPC 不能抹除 provider 层能力。

## Consequences

默认 Web 导航列出 Team，并通过 `team.start` 开始工作；Workspace UI 仍是现有 Session record 的非产品管理界面。显式 custom composition 仍可挂载该浏览器管理 Workspace registry，但 shipped roster 不会挂载。Team activation 之后，client Session scope 仍会渲染 coordinator 转录，但不能创建或分叉用户任务。

direct-entrypoint inventory 保留明确受信的 Session/Agent 操作与 shipped Team task 工具。Headless、ACP 和 Web coordinator preset 默认不挂载同 Session Goal model control；ACP 会拒绝已移除的 `goals` app config，Web 也会禁用同 Session Goal service、automatic driver、command 和 GoalBar，改为在 coordinator transcript 中使用 `command-team-goal`。显式 custom composition 仍可通过 generic spine 选择启用。Host carrier 测试证明已删除路径不可用；Team、client 与 assembled Web 测试证明产品启动会创建 Team、接纳首条 human input，并打开 coordinator 转录。本决定实现 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 的产品入口部分，并补充 [local Team product-run owner](2026-08-29-local-team-product-run-owner.zh.md)。

Team-owned coordinator Session 也不会挂载通用 Session command UI：当前 command RPC 会有意封锁 Team ownership，因此通用 launcher 会被禁用，plan 与 permission selector 等依赖命令的装饰会保持缺席，直到 Team control operation 提供带认证的路径。这样可避免 Session descendant 显示出它无权执行的命令。
