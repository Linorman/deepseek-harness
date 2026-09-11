# @clocky/clocky-team-channel-workflow

[English](README.md) | 中文

`@clocky/clocky-team-channel-workflow` 在 `ctx.teams` 注册 v1 声明式 `workflow` 通道适配器。其 manifest 固定 JSON `TransitionGraph`，包含初始 target、有序 condition、可选 default target 以及必需的 `maxTurns` 上限。Target 可以选择 participant、`round-robin`、`stay`、`return-to-initiator` 或 `terminate`。本包还挂载 `ctx.workflowExtensions` effect-scoped registry，供部署注册带版本的 condition/target 实现；HMR 移除扩展只阻止新的 graph admission，不改变已有 channel。

适配器在通道打开前校验所有 participant target，依据已接纳的 Envelope 计算 condition，推导接收意图，并在终止 target 或轮次上限到达时原子关闭。它不执行模型或传输工作。

## Model Experience

### Workflow 通道协议

#### 模型看到的内容

本包不拥有提示词或工具。Team 投递 Consumer 将已接纳的 workflow Envelope 转换为已记录的模型输入。

#### Token effect

直接 token effect 为零。

#### KV Cache effect

本包不拥有模型请求前缀。

## Known Limitations and Deferred Work

- **不提供 graph 编辑 UI** — 调用方提供版本化 JSON graph，并负责为回放保留完全相同的 manifest。
- **不执行投递** — Link 和 Agent Client Consumer 负责 inbox 接纳、receipt 和模型调度。
