# Agent Note: Native 守恒资源预留账本

Status: implemented

[English](2026-10-13-native-resource-reservation-ledger.md) | 中文

## 问题

即时转移无法保护承诺给后续执行的资金。仅核对余额、不扣除其他预留会允许超额承诺；一次性 grant 也可能授权两项并发义务。墙钟推理或任务 lease 不实现模拟预留到期。取消和到期必须释放预留，不能撤销已经提交的支付。

## 决策

Native 拥有必需的资源预留表及严格的[资源操作](../../../../packages/simulation/simulation/src/business.ts)：reserve 固定精确交易/read-set、真实 actor、一次性 grant 和有限模拟期限；commit/cancel 选择原 hold/revision。[唯一账本 owner](../../../../packages/simulation/simulation-local/src/resource-ledger.ts)对即时及预留转移执行相同的权限、单位和守恒核验。可用量为实际余额减去所有 active 借方预留。live hold 使用的 grant 不能授权另一预留或即时交易；撤销原 grant 会阻止提交，释放也不让它恢复。

完整历史采用显式冻结的 `maxResourceReservationHistory` 上限。终态条目保留，不返还历史额度。相同 ID/正文/actor 复用原 hold，变更输入拒绝。普通支付只能使用未预留资金。提交在原子更新余额、消耗 grant 和记录结算前，重验原账户 revision、控制权、grant 与期限。现有 interaction owner 也能使用守恒交易证据。

[有原来源的 scheduler 事件](../../../../packages/simulation/simulation-local/src/resource-reservation.ts)保留真实 applied reserve 操作及精确 time/phase。消费在一项 Native 事实中使本地 hold 到期并释放可用资金。`time == expiresAt` 时，即使之后的 deadline phase 尚未消费，提交也拒绝。active 到期事件不能被管理取消；显式 commit/cancel 在同批次只取消已结算 hold 的期限。paused 墙钟前进不会推进模拟到期。Native stream83 拒绝旧格式及缺失必需 state/spec 字段。

这扩展了[持久模拟提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)的资源所有权部分；该提案更广及未完成的领域仍保持 active。没有 active implemented note 拥有这一精确账本/到期决策，也没有笔记被替代或归档。

## 考虑过的替代方案

**只核对原余额。** 多个计划可承诺同一可用资金，无关即时转移也能旁路预留所有权。

**删除取消或到期条目。** 新 ID 重新取得历史额度，原请求失去持久身份。

**采用墙钟 timer 到期。** paused 与回放在相同模拟轨迹下产生不同经济结果。

**保留余额预留但允许复用 grant。** 只要剩余余额充足，同一一次性权限仍可授权多项义务。

## 影响

资源输入 schema 位于无 operation/scheduler 依赖的 leaf，避免 import cycle。即时转移保留原权限和守恒算术，只有真实借方预留量不可使用。无关账户 revision 让原 hold 变为 stale，不静默替换交易。同一 actor 必须显式取消，或保留责任直到原到期。

[一次性录用 feature](../feature/2026-10-13-one-time-hiring-resource-reservations.zh.md)通过严格 World 来源及结算共享该台账。普通资源工具不能结算这些 hold；身份准备 IO 未知时，资金/grant 锁保留至业务 owner 确认清理。两 owner 都不推进 quiescent 维护时钟，也不把 planning 操作冒充 applied 转账。

## 验证

[Owner 测试](../../../../packages/simulation/simulation-local/tests/resource-reservation.spec.ts)覆盖新 ID 超额预留、grant 锁定/撤销、actor/正文变更、单位、等时刻到期、终态历史、stale reads、伪造期限及拒绝时余额不变。[真实 Loader 场景](../../../../examples/simulation-company/tests/resource-reservations.snapshot.ts)经 canonical Agent/Session observe-stage-submit 验证模拟到期、守恒支付/取消及两个后端的新进程 paused 恢复。[Native 测试](../../../../packages/simulation/simulation-local/tests/run.spec.ts)仍明确拒绝旧 stream。原 grant、interaction、scheduler 和 task evidence 回归保护既有业务约束。
