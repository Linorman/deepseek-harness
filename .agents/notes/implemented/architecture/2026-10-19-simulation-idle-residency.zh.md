# Agent Note: Simulation 闲置驻留选择

Status: implemented

[English](2026-10-19-simulation-idle-residency.md) | 中文

## Problem

固定淘汰名单忽略近期模拟活动，并反复选择仍有已接受责任的角色。真实时间计时器不能证明 writer 已停止或 Session 已持久化。

## Decision

[Team 驻留所有者](../../../../packages/simulation/simulation-team/src/residency.ts) 在已有按需驻留操作中应用可选的[版本化闲置策略](../../../../packages/simulation/simulation-team/src/residency-policy.ts)。它从同一 Native revision 的原决策和已接收消息推导最近活动，排除待处理责任，按闲置时长和身份排序，并限制候选数量。每次异步退休后重新检查资格。规范休眠控制器仍负责关闭准入、刷新 Session 和确认 writer 释放。

部署策略默认禁用。公司和任务场景可在不可变驱动配置中保留显式策略。未知 epoch 优先于普通资格判断，返回 recovery-required，不再次尝试退休。策略选择和恢复均不调用模型。实际 writer 转换仍由已有 Native/Team 日志记录。

## Alternatives considered

**按真实时间淘汰。** 真实经过时间不是模拟闲置时间，也不能安全释放活跃 writer。因此策略使用规范模拟活动。

**新增驻留生命周期。** 第二套取消或释放状态机会重复控制器的持久所有权。选择策略只调用已有休眠路径。

## Consequences

选择会扫描保留的决策、操作和责任，不宣称索引复杂度改善。所有候选均受保护时，容量拒绝符合预期。此功能不降级表示，不改变 cognition、资产、Team 历史容量或 Session 身份。局部结构 mutation 仍独立受限。

[两后端测试](../../../../packages/simulation/simulation-team/tests/residency-policy.spec.ts) 覆盖闲置阈值、待处理 wake、非法策略、原 Session 恢复和未知退休重试。[Loader 场景](../../../../examples/simulation-company/tests/product-driver.snapshot.ts) 在单驻留槽下通过生产驱动验证自动安置。
