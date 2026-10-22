# Agent Note: 生产性 Native 治理边界

Status: implemented

[English](2026-10-15-native-governance-boundaries.md) | 中文

## Problem

Native 接受原角色 Decision 时，投票即已不可变，此时 director 确认计划可能尚不存在。若一直等待截止，结果已确定的提案仍可能未结案，而更早的制度生效目标已到期。可信测试直接调用 Native 结案，不能证明已安装的产品 driver 会执行此转换。

## Decision

[World dispatcher](../../../../packages/simulation/simulation-world/src/execution.ts)提供通用、有界的领域边界回调。显式运行中的 driver 在活动决策窗口结算后、下一次 drive 或推进时钟前调用它。每步最多保留一次领域转换。dispatcher 获取原 manifest pin，合并并发边界调用，并持有实现 lease 直到完成。dispose（资源释放）关闭新准入，并等待已准入回调完成。

治理投票 provider 选择满足条件的原提案，包括最后一票已受理、但尚无 director 计划的提案。资格判断与 [Native 结案](../../../../packages/simulation/simulation/src/world-governance.ts)共享同一套冻结 quorum、阈值及剩余票数计算。Native 仍核验实际原票来源，并计算唯一 resolution。director 和产品读取方都不提供票数、结果或替代投票。

严格的 `closeWorldGovernance(proposalId, { boundary: true })` 重载在写队列内重新核验运行 phase、窗口已结算、尚未到原截止时间及提前结案资格。若 pause 先占据该队列位置，调用返回 `undefined`，不追加记录。已保留的 resolution 原样返回。原可信重载保留显式机械结案语义。两者都使用原有的 resolution、提案者 wake 及待处理截止取消原子批次；普通截止结案仍由原调度阶段负责。

暂停读取、恢复和对账均不调用此边界。结案前进程丢失后，显式开始根据同一原票重新判断资格。append 后进程丢失时，已保留的 resolution 阻止再次转换。两种情况的提案结案都不需要推理。已排队公告仍是责任，不证明 Session 已消费。

投票执行使用 `clocky.governance.vote/native/3`、generation `2`，payload parser 仍为 `schema/2`。Native 与执行 provider 使用同一 pin 常量。旧 pin 要求准确原实现，新 artifact 不是兼容别名。现有记录结构与 Native stream 版本保持不变。

## Alternatives considered

**仅在投票确认回调后结案。** 已受理的不可变投票可能尚无任何 director 计划；进程也可能在确认后、结案前丢失。在窗口结算后的边界扫描原领域事实，可以覆盖这两个窗口，而无需伪造另一个计划或回调观察。

**在 Product 计算票数或移动作者的制度生效时间。** 两者都会掩盖缺失的领域转换。资格由 Native 规则负责，原作者时间保持不变。

**在暂停恢复时结案或吞掉 pending 错误。** 读取和恢复不能悄悄推进治理。纯资格检查避免把异常当作轮询协议，无关 append 失败仍会拒绝，并保留原记录。

## Consequences

边界工作消耗原有的有限 driver 步数与 Native 完整记录字节限额，不新增模型调用、外部 provider IO、持久 record kind 或用户权限。提案通过仍不会使其 Norm 生效，独立获准的生效请求仍然必需。

无密钥 Loader fixture（测试前置数据）保留实际已受理投票，在原子结案前后杀死进程，并与真实排队 pause 竞争。独立冷进程核对原票不变、暂停时零模型调用及唯一原 resolution。完整作者工作流断言生产 driver 已结案，不再自行调用结案。完整产品浏览器和真实 provider 验收仍有独立证据要求。

[作用域披露](../architecture/2026-10-13-world-scope-disclosure.zh.md)与 [checkpoint 引用覆盖](../architecture/2026-10-14-world-checkpoint-reference-coverage.zh.md)仍是独立依据；此决策不替代其正文访问或保留来源规则。
