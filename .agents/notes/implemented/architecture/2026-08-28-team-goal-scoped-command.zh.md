# Agent Note: 有 scope 的 Team goal 命令

Status: implemented

[English](2026-08-28-team-goal-scoped-command.md) | 中文

## Problem

面向用户的命令经由 Agent Session 到达，但持久目标属于可以超出该 Session 及其 activation 生命周期的 Team。一个从命令文本接收目标 Team 或 participant 的全局命令无法认证 actor，而复用旧的 same-session 命令会写入错误的 journal 并保留过时的 continuation 语义。

## Decision

`@clocky/clocky-command-team-goal`只会在准确 live Agent Session header 能解析出 `TeamId`时，在该 Agent scope 中安装 `/goal`。在 product cutover 期间，它的 scope 内注册会覆盖该 Team-bound Agent 上的旧全局 `/goal`，而非 Team Session 仍会看到旧命令。

该命令只会为状态读取当前 Team。它会在不调用 `ctx.teams`的情况下拒绝每种 mutation form，因为 Session header 会路由 command，却不能认证 Team actor。[Team actor proof control-plane 提议](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)拥有重新启用已认证 mutation 所需的 proof source。

grammar 提供状态查看、显式目标编辑、pause、resume、complete 和结构化 block transition。它有意不提供 create、clear、隐式替换、image attachment、model tool 或自动 continuation 行为。Team journal 仍是目标状态的唯一来源；命令 registry 会独立记录普通的 Session lifecycle event。

## Alternatives considered

**立即替换旧的 same-session 命令。** 不予采纳，因为 default product bundle 和 Session entry point 尚未迁移至 Team creation。scope 内命令可以为 Team Agent 覆盖旧命令，不会破坏当前非 Team run。

**使用一条在文本中携带 Team identifier 的全局命令。** 不予采纳，因为命令参数不能认证 participant，也不能证明接收 Session 属于该 Team。

**在接收 Session 中缓存 Team goal。** 不予采纳，因为缓存 revision 会成为第二个可变真源，并可能在 Team state 被其他位置修改后继续存在于 activation 中。

## Consequences

本地 Team-bound command path 在 Host-authenticated actor 可以签发 proof 前保持 status-only。这会移除 Session-header mutation bypass，同时保留持久 objective inspection。[持久 Team goal 决策](2026-08-28-durable-team-goal.zh.md)仍是 persistence 和 replay 的权威；[面向用户的 same-session goal-command 决策](../feature/2026-07-19-human-goal-command.zh.md)仅继续适用于旧的 Session-owned run。

## Verification

command 测试覆盖 Team-scoped registration、command grammar、read-only mutation rejection、teardown，以及一个在 Session-header-only mutation request 后保持 durable objective 和 goal policy 不变的真实 Hub composition。
