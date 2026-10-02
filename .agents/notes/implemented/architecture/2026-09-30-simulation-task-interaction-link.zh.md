# Agent Note: 原子任务责任与条件履约对账

Status: implemented

[English](2026-09-30-simulation-task-interaction-link.md) | 中文

## Problem

任务创建不含交互身份。从任务文本或完成事实推测关联，可能兑现无关责任。分配后才关联会在响应丢失时丢失选择；只在排队 IO 前检查开放承诺会遗漏取消竞态。

## Decision

`assignTask()` 接受可选的显式交互身份。producer 采集规范 pending task 与交互 revision。Native 在同一条日志追加中预留原 attempt 并关联已接受交互，核对指定 assignee、开放承诺及原创建回执。后续尝试保留同一任务关联；普通任务不能事后增加关联。Native journal format 43 拒绝早期格式。

任务 context 记录交互身份、采集的 revision 及预留记录引用。内容与来源均参与重放校验。分配 proof 在 Hub policy IO 前后复查关联承诺；关闭责任不能发布新的 assignment。

[完成 producer](../../../../packages/simulation/simulation-team/src/task-completion.ts) 先观察精确 Team 结果，再对账较新的交互证据。它等待窗口关闭及必需审核，不更新已取消或已兑现承诺。条件对账在 Native 队列内再次要求开放承诺；竞态拒绝且不写部分业务引用，已结算 task 仍可重试。只有交互不可变的 `task-completed` 策略可从 completed task 证据兑现。转移与债权人确认策略保留各自证据要求。

[任务完成决策](2026-09-30-simulation-task-completion.zh.md) 仍负责结果意图及目标结算。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 仍负责自动选择、生产 executor 及完整故障矩阵。没有记录被完整取代。

## Alternatives considered

**从标题或 actor 身份猜测交互。** 这些值不能标识已接受的业务责任。

**分配后关联。** 崩溃会留下未保留履约选择的已分配 attempt。

**任务完成满足全部履约策略。** 这将执行事实代替各自要求的交付或债权人确认。

## Consequences

普通任务仍独立。关联 task 事实、审核与承诺阶段分别保留。原任务结果重试不重新评估认知或重复世界效果。关联跨中断与取消保留，不复活已关闭承诺。既有行政对账仍可保留关闭任务事实；完成 producer 使用更严格的开放承诺准入。

## Verification

Native JSON／SQLite 测试验证单次追加受理、精确冷重放、跨尝试不可变关联，以及来源／assignee 变化拒绝。实际 Hub 生命周期测试覆盖三种履约规则、分配及排队对账中的取消、并行窗口与配置审核。真实 Loader snapshot 在各策略下记录关联 context、实际输入／启动、已应用库存转移及完成，不进行推理。这些证据不代表自动 executor 或其完整进程退出矩阵已通过。
