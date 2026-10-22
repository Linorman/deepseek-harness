# Agent Note：新控制意图使维护 cut 失效

Status: implemented

[English](2026-10-14-world-maintenance-control-cut.md) | 中文

## 问题

结构维护在 Native 队列外退休 writer 并收集规范 Team/Session 证据，但封闭 Native cut 仍会在这些读取期间拒绝新 pause/cancel。产品取消可能已持久化，而 Native 没有取消记录，自动继续便看到未变化的控制历史。

## 决策

Native 在 cut draining 或 sealed 时，通过内部 control 队列模式仅准入 pause 和案件取消。生产写入及 running 准入仍关闭。控制提交改变持久 revision；旧 cut 保留原 reference，不能发布变化后的 prefix。Native pause 也能与 in-progress checkpoint 共存，新 running 请求仍拒绝。Native stream 94 拒绝之前的 fold 解释。

规范读取将 `SimulationRevisionConflictError` 分类为来源移动。维护只拥有原 `maxAttempts` 额度，每轮收集一个新 candidate。Team/Session 移动可重试；Native 移动仅在持久 management 或 cancellation 历史变化时重试。缺失证据、无关 Native 移动及次数耗尽仍失败并保留原维护。每个失败 candidate 在新 cut 收集前释放屏障。

[已认证场景](../../../../examples/simulation-company/tests/world-maintenance-intent.snapshot.ts)持有真实退休 IO、sealed cut 下的 Team persistence-reference 响应或最后自动 `setPhase` 调用，使用实际生成招聘、mediated 代表准备、调岗和离职。新控制必须在释放 IO 前进入 Native；无新意图时 adapter 继续，有新意图时保持暂停。冷恢复及同命令重试保留结果。

## 考虑过的替代方案

**等 IO 结束才记录控制。** 新受理用户意图可能被自动继续覆盖。

**为控制释放生产屏障。** 会放进无关业务写入并削弱 checkpoint 发布。

**在旧 cut 内外都重试。** 会乘增冻结额度，并重复读取永久失效的 Native reference。

## 后果

原 adapter revision CAS 仍保护最后 resume 窗口。Driver 也在等待 resident IO 和提名后、分配窗口前重读 phase，后继合法 pause 返回 paused，而不是成为准入故障；无关 provider IO 错误仍传播。本决策修复外部收集 IO 期间的准入，不替换 CAS。没有新增 DTO、Session event、兼容层或模型生成。产品公开 checkpoint 的 management 串行化与 Native pause 准入分属不同约束；结构维护探针不宣称所有公开 checkpoint API 调用均可立即中断。
