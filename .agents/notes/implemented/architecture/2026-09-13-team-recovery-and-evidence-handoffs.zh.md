# Agent Note: Team 恢复与证据交接

Status: implemented

[English](2026-09-13-team-recovery-and-evidence-handoffs.md) | 中文

## 问题

恢复到新 turn 时丢失任务来源、一个调度阶段耗尽整轮工作机会，或者 review 频道已经存在但首个请求尚未保存，都可能使持久任务失去进展。正常工具结果若省略工作证据，coordinator 就无法验证 worker 结果；接手 worker 也不能依赖另一 worker 的对话来理解返工要求。

## 决策

[Team Agent Client](../../../../packages/team/team-agent-client/README.zh.md) 在确定性续跑消息中保留 assignment 来源。Session inbox 记录拥有每个 attempt 的累计续跑次数，delivery 替换后仍有效；进行中的 turn 操作防止并发重复恢复。输入经过现有 flush 屏障。输出截断和未报告提醒分别有可配置上限；模型请求重试耗尽后结算准确的当前 attempt。取消、过期、结算和替换仍有权拒绝恢复。部署可用零关闭正常结束后的报告提醒，而不关闭输出上限恢复。

[Scheduler](../../../../packages/team/team-scheduler-dag/README.zh.md) 为 wake 恢复、review 派发和新任务分配分别提供有界进展机会。Review 派发有独立可配置额度。[Hub](../../../../packages/team/team-hub/README.zh.md) 从 Team、task、attempt 和 reviewer 派生每个 review 频道身份，复用时重新验证 scheduler proof 和策略。已 attached 的空频道可直接恢复，无需内存预留或第二个频道。

[Task wait](../../../../packages/team/tool-team-task/README.zh.md) 保留已有的 evidence、artifact 引用、变更路径、verification 和 integration 事实。失败结果保留准确 outcome kind。超大渲染结果由现有 tool spill policy 处理。Assignment 输入只携带最近一个已结算 attempt 及对应 review reason，受 UTF-8 上限限制，并明确标记截断；不复制 worker 全部对话或整个 attempt 历史。

Workflow 输入完整暴露嵌套参数和可执行的依赖示例。Coordinator prompt 提供已配置的 worker capability，并统一拥有委派策略：有独立价值且可验证的工作才值得委派，不要求任意的最小任务数量。Task 工具描述操作行为，不重复策略。依赖任务的 brief 明确下一任务所需的 artifact 或输入。

[Team Link](../../../../packages/core/team-link/README.zh.md) 定义由 provider 拥有的连接可恢复性。Consumer 遇到已知不可重试故障时暂停，直到 provider 注册变化或新的 activation；未知失败保留正常重连行为。WebSocket provider 将明确的配置和协议错误标记为不可重试。远端操作拒绝本身不证明永久失败。Provider-added 观察者不能否决注册。

Shared workspace 观察排除部署显式配置的 runtime 目录。产品 bundle 选择实际 Clocky home，避免 Harness 自身的 Session 和数据库写入变成 worker 变更证据；排除规则不会隐藏相邻用户文件。

Workflow 在创建 channel 前通过现有 placement owner 就绪角色。compiling plan 在重试时保留已完成的激活工作，其任务仍不可调度。已授权但未驻留的角色使用显式部署路由并保留原 Session；未确认终止仍由 activation recovery 处理。这样 workflow 编译器不必维护第二套 provisioning 策略。 Placement 通过 `ctx.effect()` 注册关闭流程，卸载时等待已接纳的角色启动与 controller 拥有的终止过程，再完成卸载。 Placement 在 workspace eligibility 检查前保留每个已接纳 activation。终止失败的 lease 继续由 placement 持有，在卸载时重试；只有 controller 确认 quiescence 后才移除已成功终止的 lease。失败的 close 不保留已拒绝的缓存 Promise，因此后续 close 可以重试保留的 lease，且不会重新开放 admission。

Review 频道保留携带 payload 的有界视图策略。本地 reviewer turn 结束但没有持久响应时，task/workflow wait 在重新检查 task revision 后报告可处理的错误，worker 结果和 review 状态保持不变。已有持久响应等待 scheduler 同步，不视为失败。这样不会把 reviewer 的传输或模型错误伪造成要求 worker 返工的审阅决定。

## 考虑过的替代方案

**从内存中的最近任务恢复。** 不采用，因为替换后的 delivery 和新 turn 需要持久化的准确 attempt 来源；其他排队任务可能比失败任务更新。

**增加共享 wake 预算。** 不采用，因为更大的 assigned backlog 会再次造成饥饿；各调度阶段需要独立的有界机会。

**不保存创建身份，只重试 review 发布。** 不采用，因为崩溃或 append 失败会留下无法从请求恢复任务身份的空频道。Provider 拥有的确定性身份避免了第二份持久映射，同时保留 proof 检查。

**只返回摘要或复制全部 worker 历史。** 不采用，因为摘要丢失结构化证据，完整对话则增加无关上下文。Task 结果和最近 attempt 已保留所需事实；现有 spill 和明确的 handoff 上限约束其呈现。

**重试所有故障或自动切换模型。** 不采用，因为配置和协议错误需要修正，而模型或 preset 变化可能改变任务能力。请求重试、任务重试和连接恢复仍分别由现有 owner 负责。

## 后果

恢复消息和任务证据属于模型可见的 Session 内容。Prompt、工具和 Loader 测试必须验证实际消息与终态，包括不同续跑 turn，以及接收方 coordinator 的下一次请求。Review 恢复测试覆盖 append 失败后新建 Hub 实例；调度测试保留 pending wake，同时验证空闲 participant 可以接到独立工作。

[任务结果报告](2026-08-28-task-agent-outcome-reporting.zh.md)、[确定性调度器](2026-08-28-deterministic-team-dag-scheduler.zh.md)、[Team Link registry](2026-08-28-team-link-registry.zh.md) 和[准确任务取消](2026-09-06-exact-single-task-cancellation.zh.md)决策继续分别拥有报告、租约、传输身份和停止证据的规则。本决策补充这些机制，不替代它们的授权或生命周期规则。
