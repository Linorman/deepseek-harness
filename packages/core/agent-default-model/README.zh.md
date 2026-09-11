# @clocky/clocky-agent-default-model

[English](README.md) | 中文

该部署默认值供受信任所有者激活尚无显式模型选择的 Agent 时使用。`AgentDefaultModelConfig` 提供 `ctx.agentDefaultModel`；[`TeamRun`](../../team/team-run/README.zh.md) 将它作为 coordinator 后备值读取，自定义／内部 Agent 所有者也读取同一服务，而不是分别持有平行的提供方／模型默认值。

插件配置可选地接受 `{ provider, model }`。空组合与不完整的 settings 分节都不产生默认值；挂载的设置提供方会在组合配置项之上叠加完整用户选择，更改会在下一次调用 `currentSelection()` 时可见。`reasoningEffort` 属于该 Settings 分节，但特意不属于插件配置：完整保存的选择必须能在下一个选定模型没有推理（reasoning）强度时清除旧值，而组合配置值会再次被继承。

- `ctx.agentDefaultModel.currentSelection()` 返回一份独立的 `{ provider, model, reasoningEffort? }` 选择，供没有显式选择的 Agent 激活使用。
- `ctx.agentDefaultModel.saveSelection(selection)` 保存完整的用户选择。未挂载设置提供方时，此调用不执行任何操作，组合配置项仍为当前值。

该服务不校验目录成员关系。提供方路由可以服务未在目录中公布的模型；实际发起模型请求的消费方负责可用性诊断。

## 模型体验

通过 TeamRun 或自定义／内部 Agent 所有者提供的提供方／模型选择间接影响；模型可见请求由请求组装与适配器负责。

#### KV Cache 影响

更改默认值只影响之后从该默认值解析选择的 Agent 激活。请求日志已经指明选择的现有 Participant Session 仍沿用该选择，因此本服务不会使其已建立的前缀失效。

## 已知限制与暂缓事项

- 该服务只拥有一项进程级默认值；每次激活的选择仍由 Team 或自定义／内部所有者负责。
- 未挂载设置提供方时，`saveSelection()` 无法保留选择供后续 Agent 使用。
