# @clocky/clocky-agent-runtime

[English](README.md) | 中文

`@clocky/clocky-agent-runtime`定义了用于 Participant 绑定 Agent 激活的具名 `ctx.agentRuntimes` 注册表。它将稳定的 Team 成员关系与由 provider 拥有的激活 epoch 分开，并且不导入 Team Hub、模型工具、subagent runtime 或具体 Agent loop。

## Provider 约定

`AgentRuntimeProvider`以一个 placement 名称注册，并接收已解析的 Team、participant、Session、fresh/fork/resume seed 模式、Agent 组合与发布前取消信号。fork seed 包含其源 Session id 与复制事件。其 `activate()` 只有在激活已发布后才返回 `ActivationHandle`；加入同一 epoch 的并发调用会返回完全相同的 handle。该句柄报告当前不可变 health projection，让调用方订阅之后的不可变 status 变更，拥有该 epoch 的中断和静默释放；它不决定 Team 成员关系、task 分配、channel 投递或父级权限。

`AgentRuntime.activate()`要求返回的 activation 与 Session 匹配请求，拒绝以 `stopping` 或 `offline` 作为初始 residency，释放被拒绝的返回 handle，并只为初始发布和之后符合生命周期的 status 变更发出不可变的 `agent-runtime/activation-changed` 通知。重复或非法的 status 边会在受控诊断后忽略。provider 注册由 effect 约束：卸载 provider 会阻止未来的激活请求，但此前返回的句柄仍归其调用方所有。

`AgentRuntimeFencer`会为一个 provider 名称独立注册。`validate()`会在不发送信号时证明部署拥有持久 plan；`fence()`只有在旧 epoch 已不能发送或结算 Team 工作后才会返回。它不启动或替换 activation。

[`clocky-agent-runtime-in-process`](../../agent-runtime/agent-runtime-in-process/README.zh.md)提供第一个本地 provider。它会在 Agent 发布前物化 fresh 和 fork Session header 及其 opaque Team／Participant provenance、保留 fork 谱系、在 cold resume 时验证 provenance，并让已接收的 handle 独立于 provider reload。

## 模型体验

### 激活注册表

#### 模型所见

`ctx.agentRuntimes`不注册提示词片段、工具或模型可见事件。未来的 Team client 负责任何通过已激活 Agent 接收的模型输入。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有模型请求前缀。

## 已知限制与延后工作

- **没有 ACP placement**——存在 `ctx.agentPresets`时，进程内 provider 会组合请求的 `agent.preset`；SDK provider 拥有远程 placement。ACP placement 仍然缺失。
- **没有 Team 投递或持久 activation 注册表**——注册表将 Team 已解析值作为数据接收。[`clocky-team-activation-controller`](../../team/team-activation-controller/README.zh.md)拥有本地 bind-or-dispose handoff 和持久 health 更新；Envelope 投递、回执、调度和产品入口仍在此 Service Definition 之外。

[AgentRuntime Service Definition 决策](../../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.zh.md)记录所有权拆分；[AgentRuntime 子系统参考](../../../docs/subsystems/agent-runtime.zh.md)定义公开注册表操作和事件。
