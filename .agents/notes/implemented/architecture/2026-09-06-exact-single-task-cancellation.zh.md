# Agent Note：精确的单任务取消

Status: implemented

[English](2026-09-06-exact-single-task-cancellation.md) | 中文

## 问题

任务取消会与分配、审阅、lease 到期、重连及 Team 关闭并发。owner 尚未停止时就把任务改为 cancelled，可能在工作仍使用执行范围时释放它。取消整个 Team 也会停止无关工作。

## 决策

Hub 在 Task snapshot 中保留一份 cancellation，包括请求者 Participant、原始 revision、可选原因、时间戳，以及精确的 pending、review attempt 或 activation-bound attempt 目标。重复请求保留最先接纳的 intent 和不可变 attempt 历史。存在该 intent 后，新工作和审阅决定均被拒绝。

Pending 工作要等保留的 allocation 释放后才能结束。Review 取消只关闭选定 completed attempt 对应的 consult，然后结束任务，不编造审阅决定。Scheduler 根据同一份 durable intent 恢复中断的 lease-free 清理。

Assigned 和 running task 保留 phase、lease 和资源，直到选定 owner 确认工作已停止，或对应 activation 已有真实 quiescence 事实。Lease 到期只记录期限已经过去，终止仍未确认，不会重新开放任务。Local 和 WebSocket Link 为精确 activation 重投保留的 intent。Agent client 从 Session log 重建精确 task claim。它独立丢弃已证明尚未执行的排队输入；running 工作等待自己的 `turn/end`、释放 allocation，再通过 binding 确认。`resumePending`保留现有 waking 输入，不会把 injected context 变成新 turn。迟到通知不能停止后续工作。

TeamRun 和模型工具提供有界取消进度；Host 与两种 SDK 保留相同 Task 事实。Team 继续处理其他任务。Workflow task 的取消校验其已保留的 plan/template binding，并复用准确工作停止机制。Hub 只会取消同一 plan 中尚未执行、且终态前置任务已无法满足依赖的后继，并在 `blockedByOutcome` 保留前置任务的 id、revision 和 phase。可重试失败仍保持 pending。独立节点继续执行；全部绑定任务结算后，Hub 在同一 journal batch 中记录 plan 汇总结果与配置选定的结果投影。有 failed task 时 plan 为 failed，否则存在 cancelled task 时为 cancelled。Plan 完成不能替代 owner 终止或 allocation release。任务终态本身不能证明 live owner 已终止。

Task 终态提交在同一 journal batch 中取消仍 pending 且绑定该 task 的 human action，使用明确的`task-cancelled`业务 outcome。已经结算的 Host 决定与 Session `approval/decided`事件保持不变。

## 考虑过的替代方案

**立即进入终态。** 不采用，因为 owner 仍在执行时，task 状态可能已经声称资源释放。

**软 Participant interruption。** 不采用，因为它没有 task-attempt fence，也不证明停止已经完成。

**独立取消 registry。** 不采用，因为它会复制 durable Task authority。

## 影响

Lease 期限经过或 allocation 清理失败后，取消可能仍未进入终态。调用方观察保留的 intent 和 task phase，不能将请求接纳当作终止成功。精确回放要求 Link version 5 及对应的 Task journal、checkpoint 格式。

## 验证

Keyless example 使用真实文件操作 approval 等待和真实 Participant 审阅，通过模型工具取消，并在同一 Team 中完成后续工作。Owning tests 覆盖保留的期限事实、activation fence、持久回放、旧 attempt acknowledgement，以及 Local/WebSocket 重连。

两种 SDK 的 owning snapshot 还保留真实 child 被取消的 tool turn，以及保留的 waking 输入触发的后续 turn，协调者仍返回显式 Team final。TypeScript 验证源码与构建运行时；Python advanced 场景验证构建后的工作区运行时，single-executable 验证仍归发行检查。
