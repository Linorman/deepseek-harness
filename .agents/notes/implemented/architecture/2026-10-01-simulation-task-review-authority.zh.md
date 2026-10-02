# Agent Note: 原生 Simulation 任务审核权限

Status: implemented

[English](2026-10-01-simulation-task-review-authority.md) | 中文

## Problem

Simulation 任务结果可能在 reviewer 休眠时等待接受或返工。通用 activation 或人工修改权限会允许调用方选择无关 reviewer，或者绕过原生完成结果所有者。已受理审核的响应丢失后，即使后续 attempt 开始，该决定仍必须属于原 attempt。

## Decision

[Simulation 连接](../../../../packages/simulation/simulation-team/src/task-review.ts)从原生预留 attempt 和已应用的创建 receipt 派生 Team、task/create operation、创建者与执行者。reviewer 是 active 原生实体，其 binding 匹配不可变的 Participant review policy。审核要求不可变的原生 completed 结果，但不要求 reviewer 驻留、writer epoch 或模型推理。running 与 paused run 均允许审核；检查点采集、关闭及服务卸载会退役连接权限。调用方可以提供准入 lease 检查，在入口、proof 验证及所有者异步操作等待后运行。

不透明、不可序列化的短期 proof 只能选择 `simulation-task-review`。每次 [Hub](../../../../packages/team/team-hub/src/index.ts) 验证时，resolver 都重新核对原始来源与绑定。`resolveSimulationTaskReview()` 使用 Team 串行器，在普通 task-mutate 策略 IO 前后核对规范创建、结果、配置 reviewer、选定 revision、最新完成 attempt、取消状态及无 lease。scheduler 的 consult-response 恢复保留为独立操作，并拒绝 Simulation scope。

每条已受理审核保留 `TeamTaskReviewDecision.simulationCommand`：run id、运行内 command id、原 task/create operation 和选定 revision。决定的既有字段保留 reviewer、attempt、phase 与 reason。运行内相同身份复用于其他任务或载荷会拒绝。相同命令且权限仍有效时，返回保留历史审核的当前规范任务，不再次运行策略或修改，也绝不审核后续 attempt。Native 仅观察仍属于原 attempt 的返回事实；历史重试跳过后续 attempt 的观察。Team journal 与 checkpoint format 40 拒绝旧格式；Native journal 结构不变。

## Alternatives considered

**激活 reviewer。** 激活为确定性的行政决定增加容量与恢复依赖，且不能证明原生结果所属权。

**复用 scheduler 审核恢复。** 其权限派生自两个持久 consult Envelope 与频道锁；Simulation 的权限来自原生创建、结果及实体绑定。

**仅在内存或产品日志保留审核重试。** 目标受理可能比调用方存活更久，且后续 attempt 可以发生。持久 Team 来源信息在修改所有者处确定原决定。

## Consequences

Participant review policy 与普通任务语义仍是权威。新连接方法是行政能力，不暴露给模型工具或普通人工 Team 修改路线。消费者从保留的审核决定读取重试命令的原结果，不使用任务当前 phase 代替。[完成决策](2026-09-30-simulation-task-completion.zh.md)仍负责结果受理；场景选择与 Web 编排由产品所有。

## Verification

[原生审核测试](../../../../packages/simulation/simulation-team/tests/task-review.spec.ts)覆盖 JSON 与 SQLite、reviewer 已物理停止时的 paused 审核、精确重试、载荷冲突、返工后另一次待审核 attempt、缺失原生结果或来源、reviewer binding 变更、非活动 phase、过期 revision、包括待完成策略 IO 的检查点与关闭准入、所有者读取或策略 IO 期间 reviewer 或调用方 lease 撤回，以及 proof 撤销／不可序列化。序列化 projection 重放保留 command 来源，并拒绝不同创建或未来 revision。Core runtime 与 Hub edge-case 回归保留普通 reviewer 和 scheduler 恢复行为。这些测试证明行政权限及幂等约束；产品组合与浏览器验证由所属工作流负责。
