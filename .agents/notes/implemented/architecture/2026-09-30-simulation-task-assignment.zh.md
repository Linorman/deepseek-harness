# Agent Note: 持久 Simulation 任务分配

Status: implemented

[English](2026-09-30-simulation-task-assignment.md) | 中文

## Problem

任务分配可能在调用者收到响应前提交。缺少来源预留时，重试或恢复可能创建另一 attempt、丢失 writer 身份，或发布遗漏该责任的检查点。逻辑 offline 状态本身不能证明物理终止。

## Decision

显式[连接分配](../../../../packages/simulation/simulation-team/src/task-assignment.ts) 在 Hub IO 前，将创建操作、规范任务 revision、所选 entity／participant／Session、writer epoch／activation／reservation、attempt ordinal 和 lease 时长预留到 Run 日志。重试保留该选择，按精确目标 attempt 对账。不隐式交付任务输入或推理。

Hub 专用方法只接受 Simulation owner 的 runtime-only proof。在 task 锁内、policy 等待前后复查规范创建、当前 activation 及精确请求。原能力、工作区、预算、review 与重试约束仍由 Team 所有。proof 不授予频道权限，并在对应操作后撤销。

[Controller 清理](../../../../packages/simulation/simulation-team/src/task-retirement.ts) 在实际 quiescence 后保留精确任务事实或原 epoch 的退休。Hub 将受影响尝试的退休 metadata 与 activation quiescence 原子配对。重放、检查点及完整前缀读取拒绝未配对或不匹配的证据。未完成即中断的 Simulation lease 以 `SIM_WRITER_RETIRED` 失败；退休不能声明 completed。原生清理写入在关闭准入后仍可完成，安全淘汰排除未完成任务的 owner，完整采集排空分配并校验保留的跨 owner 引用。Native journal format 为 45；Team journal 与 Team checkpoint format 为 40。

[来源证据决定](2026-09-30-simulation-task-source-evidence.zh.md)保留独立交互与履约规则。[认知决策](2026-09-30-simulation-task-cognition.zh.md)负责已记录输入和 scoped 启动，[完成决策](2026-09-30-simulation-task-completion.zh.md)负责证据结算和有界自动批次。[协调提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)及[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md)保留产品调度、自动 attempt 恢复及完整故障矩阵要求。没有记录被完整取代。

## Alternatives considered

**先分配，再推断来源身份。** 响应丢失后没有可对账的稳定责任。

**向 actor 提供通用 scheduler 或 channel proof。** 它授予当前预留 attempt 之外的操作，且遗漏原生 writer 撤销。

**用 offline 状态或调用者布尔值证明退休。** 二者都不能证明 controller quiescence，也不能阻止迟到完成。

## Consequences

分配须显式调用，要求 actor 已驻留，不启动模型。旧 epoch 丧失权限；新尝试使用另一身份及 Team 剩余尝试预算。未知分配结果保留原预留。已完成目标事实在清理期间保持不变。完成 owner 选择效果证据；产品自动模式启用仍是独立工作。

## Verification

JSON／SQLite 真实 Loader snapshot 在来源预留、Hub 分配、原生观察后中断。恢复先退休同一旧责任，再显式替换，保持一个任务、遵守实际尝试次数且零推理。原生及连接单元测试覆盖选择变更、policy IO 中撤权、响应丢失、不可变事实、清理重试及检查点引用。该示例使用生产分配和 controller 退休，不通过 helper 构造成功执行。

[proof 来源回归](../../../../packages/simulation/simulation-team/tests/task-authority.spec.ts)验证来源／attempt／输入／结果缺失、writer 已释放、启动 proof 不可序列化、Hub 调用完成后撤销，以及采集时替换创建回执。任务 authority 与采集目标引用两个模块在所属原生及 executor 测试下，语句、分支、函数与行均达到完整覆盖率。
