# @clocky/clocky-team-channel-task-assignment

[English](README.md) | 中文

`@clocky/clocky-team-channel-task-assignment`会在 `ctx.teams` 上注册版本一的 `task-assignment` `TeamChannelAdapter`。请在 `TeamRuntime` provider 之后挂载它。该 adapter 表示一个绑定 Agent 的 task attempt 的持久 owner-notification record；它不分配 task，也不启动 Agent。

## Task-assignment 协议

manifest 恰好包含一名角色为 `assignee` 的 participant。它严格的 adapter limits 为 `{ taskId, activationId, sessionId }`，在 Hub 生成 attempt 前冻结 task 和预期的持久 Agent binding。adapter 的 initial fold state 会复制这些不可变 fact，并期望该 participant 提供唯一的 assignment turn。

唯一可接收的 Envelope 是自寻址的 `assignment` turn：sender 和唯一的显式 audience 都是 `assignee`，顶层 `taskId`等于 manifest task，且没有 `causationId`。其 payload 严格为 `{ taskId, attemptId, assignedRevision, activationId, sessionId }`；task 和 binding field 必须等于 manifest limits，而 attempt id 和 assigned revision 则围栏保护 channel 打开后创建的 lease。第二条 Envelope 或 adapter-owned record 都会被拒绝。接收的 Envelope 会为 assignee 创建一条带 `turn` treatment 的 `DeliveryIntent`。

本包导出稳定的 adapter、role 和 Envelope-kind constant，以及 `parseTaskAssignmentChannelManifest()`和 `parseTaskAssignmentEnvelope()`。delivery Consumer 可以解析 replay 后的 channel manifest 和 Envelope，无需重复不受检查的 JSON access。parser 在返回带品牌的 task、attempt、activation、Session 和 recipient fact 前，会检查 manifest ownership、自寻址、task/binding equality 和精确 payload。

## 模型体验

### Task-assignment channel 协议

#### 模型所见

本包不注册 prompt section、tool、model input 或 model output。只有独立的 Agent delivery Consumer 将持久 `assignment` Envelope 准入为已记录的 turn 时，它才会到达模型。

#### Token 效果

零直接 token 效果。

#### KV Cache 效果

本包不拥有 model request prefix。

## 已知限制与延后工作

- **不处理 lease mutation 或 owner start**——Hub 必须原子地将自己的 lease 绑定到 channel，后续 delivery Consumer 必须在启动 attempt 前 claim 准确的 Envelope。
- **不处理 transport、inbox admission、receipt、heartbeat、settlement、workspace 或 review**——Link、Agent Client、Team Hub、workspace 和 task-policy Consumer 拥有这些彼此独立的 effect。
