# Agent Note: 退役隐式 Lead Agent Teams

Status: implemented

[English](2026-08-29-retire-implicit-lead-agent-teams.md) | 中文

## 问题

私有 Agent Teams 包把隐式 Team 身份保留在 Lead Session 中，并拥有直接子级授权和独立的模型工具集合。稳定 Team 包负责独立的 Team 身份、持久 journal、channel 投递、activation binding 与显式 final output。两个实现并存会保留互不兼容的授权、事件、目录和 snapshot 表面，但没有随附产品组合使用私有包。

## 决策

仓库移除 `@clocky/clocky-experimental-agent-team` 与 `@clocky/clocky-experimental-tool-agent-team`，以及其 Headless fixture、仅测试用的 legacy importer、Session-event 参考页、工具／目录注册、workspace 引用和 inventory 条目。`ctx.teams` 及其稳定提供方是源代码和生成目录中唯一的 Team 协调实现。

此项移除不删除 `ctx.sessions`、`ctx.agents` 或直接 subagent 基础设施。AgentRuntime 仍使用这些可信原语创建和恢复 Team Participant 的本地 transcript。同 Session goal、workflow、直接 subagent 和 Web Session 入口在其 Team 替代实现交付前，仍由各自当前 owner 负责。

原实现的决策记录作为历史证据归档。[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍对未完成的产品切换与分布式 Link 工作保持活跃。

## 验证

workspace 类型检查、直接入口 inventory 验证器、Team Hub 测试、Headless snapshot、生成的 Cordis／工具／持久化／模块文档和打包产物探测共同覆盖此次移除。生成目录中不含 `ctx.agentTeams`、实验性 Team 包、旧 Team Session 事件或隐式 Lead Team 工具条目。

## 曾考虑的替代方案

**保留这些包作为仅测试用的迁移 oracle。** 不予采纳，因为稳定 Team 的 contract、重启、投递和产品 snapshot 直接覆盖受维护语义。第二套可执行 Team 实现会继续向未来调用方暴露过时的 Session 身份和模型工具。

**为旧 Team Session 记录提供兼容适配器。** 不予采纳，因为预发布格式策略不提供这种兼容性。稳定 Team journal 使用独立的品牌化身份，并拒绝不受支持的持久格式，而不是把 Lead-Session 记录猜测为新的授权域。

**在同一改动中移除直接 Session 编排。** 不予采纳，因为 Web task-first 入口、Team task-control、workflow 编译和 Team 原生 fork 语义仍有独立 owner。没有替代实现就删除这些路径会移除受支持的产品行为。

## 后果

仓库失去可选的隐式 Lead Team 模拟及其十个模型可见协调工具。稳定 Team 包保留 headless、ACP、JSON-RPC 和两套 SDK 已使用的持久协作机制和面向产品的 topology。未来产品工作只扩展一套 Team 实现，并在需要旧有理由时查阅一个历史归档。
