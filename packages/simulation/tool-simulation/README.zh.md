# Simulation 决策工具

[English](README.md) | 中文

`simulation_observe` 只返回当前决策冻结的已授权分节。`simulation_stage` 替换完整提案列表，不产生世界效果。`simulation_submit` 将窗口提案持久记录为 `submitted`，或接受串行决策，然后结束回合。已提交提案等待有序接受；已接受操作 id 等待执行。 模型可见的 stage schema 包含参与者执行的 `task/create` 与 `task-completed` 履约策略；创建者和 Team 身份来自当前决策，不由提案字段指定。

`simulation-team` 从实际 Agent 及其已消费的准备输入推导 run、实体、writer 和决策。其执行守卫拒绝 Simulation 角色调用其他工具。暂存只属于当前 writer epoch。writer 替换会取消未接受决策；已收集的窗口提案保留在 run 历史中。已接受决策及操作独立于旧 writer 保留。

作用域入口 `@clocky/clocky-tool-simulation/role` 只选择已注册的三个 Simulation 工具，并固定为原生工具展示。宿主须先加载基础工具插件，缺少任一工具会拒绝挂载 preset。[公司模拟 preset](../../../examples/simulation-company/presets/simulation/agent.cordis.yml) 使用此入口；首次激活和恢复激活都通过 `agent.preset` 传入其名称。

## Model Experience

### Simulation 决策

#### What the model sees

`simulation_observe`、`simulation_stage` 和 `simulation_submit` 分别提供授权观察、完整提案替换和提交。结果区分暂存、提交与接受，不在执行前宣称世界效果成功。卡片使用通用读取/操作展示，没有文件位置。

#### Token effect

工具 schema 和请求的观察内容消耗 token。观察只重复已存储的选中分节，不检索隐藏世界状态。

#### KV Cache effect

工具结果追加到 Session，不替换既有历史或改变已准备的上下文前缀。

## Known Limitations and Deferred Work

- 重试上下文与知识选择仍由调用方拥有；工具不重放先前提案。
