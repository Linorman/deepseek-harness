# @clocky/clocky-team-placement-default

[English](README.md) | 中文

`ctx.teamPlacement.prepare(teamId)` 会为 ready task 启动显式路由的 active Agent participant，之后由 DAG scheduler 分配 lease。同一 Team 的调用会合并；activation controller 负责 participant/session 唯一性与持久发布。已取消或删除的 work 不会保留启动过程中发布但已无用的 activation。

## Configuration

`routes` 包含完整的 runtime provider、roles、preset、`modelProvider`、`modelId`、`model`（`provider/model`）、`cwd` 与 `maxTokens` 选择。Participant 必须声明匹配的 provider、preset 和 model。缺失或有歧义的 route 不会回退到 ambient Agent default。空 route list 会把 provisioning 留给其他显式 owner。`maxActivationsPerDrive` 与 `maxCursorRetries` 限制每轮 preparation。

Task `placement` 限制 participant id、role、provider、preset 和 model。省略的集合不增加限制；空集合不接受任何 candidate。Child-Team task 交给 `team-delegation`，不会启动 Participant activation。挂载 workspace registry 时，可选 provider preflight 可以在 activation 前拒绝不兼容 route；placement 仍会根据 provider eligibility predicate 检查返回的 activation，并在 route 无法执行 task 时立即释放。Hub 在 assignment 时检查实际 activation selection，replay 会拒绝改变后的 task restriction 或不匹配的 attempt。未结算的旧 epoch 交给 activation recovery，不会被新 Session 静默替换。

## Model Experience

### Task-driven activation

#### 模型所见

该 Consumer 不产生 model input。`ctx.teamPlacement.prepare(teamId)` 只准备 activation；assignment 后的持久 task input 由既有 task-assignment delivery Consumer 负责。

#### Token 影响

Placement 不直接消耗 model token。

#### KV Cache 影响

Placement 不改写 Session transcript 或 request prefix。

## 已知限制与延后工作

- Placement 使用显式配置的 active participant descriptor。Template 创建与 membership provisioning 由其产品 owner 负责。
- Activation recovery 负责围栏未 quiesced 的旧 epoch。缺失 route 或 pending fence 不能授予 execution authority。
