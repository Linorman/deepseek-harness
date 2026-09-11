# `@clocky/clocky-tool-team-goal`

[English](README.md) | 中文

面向一个 live 默认 TeamRun coordinator 的持久 objective 的 scope 内 `get_goal` 与 `update_goal` tool。它们替代已发布 Team 产品中的同会话 model goal control；Team creation 已提供初始 objective，因此没有 `create_goal`。

## 工具

- `get_goal()` 返回当前 Team objective 的 `{ revision, objective, phase, blocker?, budgets }`。
- `update_goal(revision, objective)` 执行 compare-and-set edit。coordinator 必须 live，且当前 turn 必须包含一条准确、可信 human 的 direct-v3 Team Envelope。

两个 tool 都不接收 Team、Participant、Session、activation 或 provider 标识。TeamRun 从 coordinator lease 派生这些 fact；Team Hub 会在提交 edit 前重新检查准确的 active binding。

## 模型体验

### Tool schema 和结果

#### 模型看到的内容

两条 scope 内的 [`get_goal`和 `update_goal`](../../../docs/tool-catalog.zh.md#clockyclocky-tool-team-goal) schema 及紧凑的持久 objective 结果。`update_goal`只编辑 objective text；phase transition、goal-round limit 和 autonomous completion 不属于此 tool。

#### Token 影响

一对小 schema，以及每次调用一条紧凑 JSON 结果。

#### KV Cache 影响

coordinator scope 与 tool definition 不变时，schema 保持 prefix-stable。

## 已知限制与暂缓事项

- **没有 phase mutation**：pause、block 和 complete 需要 Team scheduler 与 completion-policy 语义。
- **仅默认本地 coordinator**：remote coordinator support 需要 Link-level goal operation 和同一 activation fence。
