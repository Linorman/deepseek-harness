# Agent Note: Durable activation binding

Status: implemented

[English](2026-08-28-durable-local-activation-binding.md) | 中文

## Problem

AgentRuntime provider 可能在 Team provider 记录其 epoch 前发布 activation。仅依据 Session provenance 的投递可能在 Team 标识该 epoch 前接收模型可见输入，而被拒绝的 binding 会留下没有 Team lease 所有者的 live raw handle。只按 Participant 建索引的投影也无法让 cold-resumed epoch 保留先前 offline epoch。

## Decision

`clocky-team`定义 `ActivationBindingSnapshot`、bind/status/read 操作和 `TEAM_ACTIVATION_NOT_FOUND`。`clocky-team-hub`把 `activation/changed` record 存入 Team journal，并按 `ActivationId`索引投影。agent Participant 会保留 offline epoch，每个 epoch 命名相同 Session，且最多一个 epoch 为 resident。Team journal format 7 与 checkpoint format 8 会持久化该投影。

`clocky-team-activation-controller`是 Team Consumer：它读取 active local-agent 或 remote-agent Participant，在 placement 前拒绝另一 Session 或 resident epoch，请求 `ctx.agentRuntimes`返回 handle，通过 `ctx.teams.bindActivation()`记录返回 epoch，并且只在此后返回 `TeamActivationLease`。binding 失败会释放 raw handle。lease 拥有中断、health 同步和 stopping/offline 释放。controller 会订阅准确 handle 的 status stream，并通过串行 cursor-conflict 重试更新持久 epoch。

Activation request 的 cursor 保护初始接纳。Provider 在 Team queue 外启动，因此其他任务可以在准备 handle 期间推进 journal。Controller 在绑定已准备的 handle 前重新读取 cursor；Hub 仍在 Team queue 内校验 proof、membership 和 admission。启动期间的其他进展不再要求释放并重新创建同一 residency。

`clocky-team-agent-client`会在 Link connection 或 inbox admission 前将 Session provenance 与持久 binding 同步。它只接收准确的 running 或 idle epoch，并把 Link claim 用作最终的 inbox authorization。Link 会在 post 和 receipt operation 中携带准确的 activation 与 Session，因此 Hub 会在 Team-to-channel lock 下拒绝 stopping、offline 或已替换 epoch。

## Alternatives considered

**让 Team Hub 创建 AgentRuntime activation。** 不予采纳，因为 Hub 拥有可回放的 Team fact，而 placement 和 handle teardown 属于 AgentRuntime provider 及其由调用方拥有的 handle。

**从 `agent-runtime/activation-changed`绑定。** 不予采纳，因为该 event 在发布后触发，不携带 handle 或 Session binding，不能让持久 binding 成为公开 lease 的条件。

**只信任投递的 Session provenance。** 不予采纳，因为 provenance 标识逻辑 Participant，却不能证明某个 activation epoch 已到达 Team journal。

## Consequences

本地投递只能在持久 activation binding 存在后开始。offline epoch 可以在不丢失先前审计性的情况下，以新的 ActivationId cold resume 相同 Session。controller 拥有已接收 handle，并在 shutdown 时释放它们；provider unload 仍不会撤销已经返回给 controller 的 handle。

`claimChannelDelivery()`现在会将本地 direct delivery 与其准确的持久 activation 和 pending channel admission 线性化。远程 binding 仍不会授权 direct delivery；远程 Link 需要自己的已认证 framing 与跨进程 claim 和 receipt path。

## Verification

Concurrent-start 回归在真实进程内 provider 准备 handle 期间推进真实 Team journal，随后验证只有一个 activation 和一次 provider 调用。可运行的 mixed-resource 示例先启动 workflow 再创建 reviewer，达到 running/pending/review task 与 pending approval 同时存在的状态，并验证当前 owner 的 cancellation 和资源结算。

core 和 Hub 测试验证 activation schema、lifecycle edge、local-agent 与 remote-agent binding、不可变 Session/provider binding、JSON 与 SQLite restart recovery、多个 offline epoch、malformed journal/checkpoint 拒绝以及 delivery-claim causal receipt。controller 测试覆盖 bind-or-dispose 失败处理、并发 join、handle-status 同步、shutdown 和 fresh-to-resume epoch。local client 测试证明未绑定 provenance Agent 在匹配持久 binding 提交前不会获得 inbox input 或 receipt，并且 claim 会阻止 stopping epoch 赢得新的 direct admission。
