# Agent Note: AgentRuntime Service Definition

Status: implemented

[English](2026-08-27-agent-runtime-service-definition.md) | 中文

## Problem

当前 continuable subagent 生命周期在一个父级作用域实现中混合了稳定子级身份、父级权限、Session 谱系、placement、activation、inbox 投递和 teardown。Team participant 需要一个可 provision、resume、interrupt 和 dispose 的 activation epoch，而不应从父 Agent 或 Session 推导权限。

## Decision

`@clocky/clocky-agent-runtime`提供 `ctx.agentRuntimes`，即 activation provider 的具名 effect-scoped 注册表。activation request 携带 Team 已解析的 Participant 和 Session 身份、fresh/fork/resume seed、Agent 组合与发布前取消信号。fork 会命名其复制事件的源 Session。provider 只有在发布自己的 activation epoch 后才返回 `ActivationHandle`。注册表会验证返回的 activation 与 Session 是否匹配请求的 Team 和 Participant、释放被拒绝的 handle，并为每个已接收 handle identity 发出一次不可变的 `agent-runtime/activation-changed` 通知。

`@clocky/clocky-agent-runtime-in-process`是第一个 provider。它只接收 local-agent Participant，在 root-owned activation scope 中创建 fresh/fork Agent，在发布前实体化成对 opaque Session Team／Participant provenance，保留 fork 谱系，并在 cold resume 发布前验证 provenance。请求的具名 Agent preset 会在 Agent factory setup 中挂载，并记录在新的 Session header；缺失或不可用的 preset roster 会在发布前以 typed provider error 拒绝。其 handle 报告不可变的本地 running、idle、stopping 和 offline health，通知之后的 status 变更，拥有取消和 dispose，在 provider reload 后仍由调用方拥有，而结构性 AgentLoop dispose 会释放过期 placement 槽位并使其变为 offline。

注册表拥有 provider 发现、request dispatch、request／handle 身份校验、初始 residency 校验、符合生命周期的 status 观察和受控诊断。provider 拥有其已接收的 handle；`stopping` 和 `offline` 不能作为可发布的初始状态，重复或非法的后续 status 边也不会被发出。[`clocky-team-activation-controller`](../../../../packages/team/team-activation-controller/README.zh.md)拥有到 Team journal 的 bind-or-dispose handoff。Team 成员关系、父级权限、channel 投递、回执、task 调度和 workspace 分配都在这些包之外。该定义不导入 Team Hub、subagent runtime、模型工具或 Agent loop。

## Alternatives considered

**扩展 `SubagentRuntime` 以支持 Team activation。** 拒绝，因为它的稳定身份和权限模型是一个活跃父 Agent 及其直接 Session 后代。添加 Team 参数会保留这些隐藏的所有权假设。

**让 Team Hub 拥有本地 Agent handle。** 拒绝，因为持久 Team 权威与易变的进程 placement 会独立演进。Hub 将已解析的 Team 值传给 provider，而不依赖具体 placement 实现。

**在定义注册表前先创建 in-process provider。** 拒绝，因为 ACP、SDK 和本地 placement 在公开实现特定的 Session 组合或投递语义之前需要一个统一 provider 约定。

## Consequences

仓库有了一条不依赖父 Session 关系的本地 Participant activation 路径，具备持久 Session provenance、可选的具名 preset 组合、cold resume、并发 handle 共享、中断和完全停稳的 dispose。`parentSession`只保留 fork 谱系含义，绝不授予 Team 权限。[持久 activation binding 决策](2026-08-28-durable-local-activation-binding.zh.md)拥有 Team-journal binding 和 status 同步。投递、调度和 ACP placement 仍是独立决策。[SDK 远程 placement 决策](2026-08-28-sdk-remote-agent-runtime-placement.zh.md)在该注册表下添加独立远程 provider。

[本地 Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)仍是持久 Team 投影的权威。[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍为 proposed，因为 placement provider、投递、调度、workspace 和产品阶段尚未完成。现有 subagent 决策仍适用于当前 parent-scoped 实现；本定义不归档或整合任何记录。

## Verification

注册表和进程内 provider 测试覆盖 effect-scoped 注册、重复拒绝、过期 disposer 安全性、被拒绝 handle 清理、handle 观察去重、fresh/fork/resume provenance、fork 谱系、成功 scoped preset 挂载、不可用 preset 拒绝、并发 activation、running／idle／stopping／offline health、活动 turn 中断、provider／AgentLoop reload、Session 不匹配、不支持的 Participant 以及完全停稳的 dispose。JSONL、SQLite 和 query-index 测试会在重启时保留成对 header 字段和仅 header 的实体化。controller 测试覆盖之后的持久 Team binding。
