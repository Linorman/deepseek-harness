# Agent Note: 无记忆外部表示切换

Status: implemented

[English](2026-10-19-memoryless-representation-switch.md) | 中文

## Problem

更换外部模拟实现必须保留原业务身份与事实。不能仅通过修改提示词或丢弃 Session 就把 actor 替换为规则。

## Decision

[表示 domain](../../../../packages/simulation/simulation-local/src/world-representation-domain.ts) 只支持没有 actor 代表历史的规则和 director 裁决主体。它记录连续 generation、原身份 sequence、来源 revision、模拟时间，并明确记录没有表示所有的记忆及待处理 IO。已有资源、合同、事实和身份记录仍属于原主体。不支持 actor 到规则的降级；[闲置驻留](2026-10-19-simulation-idle-residency.zh.md) 改为保留规范 Session。

接受切换会关闭该身份的新交互准入。未完成 case 和已调度或阻塞的外部事件阻止接受；最终 Native 队列重新检查这些责任及主体 revision。精确注册的处理器提交一次 mutation。普通实体创建和 profile 替换不能注入或清除历史。回调失败保留原 Native 请求及未知执行观察，再次执行前先对账。精确 mutation 重试返回原结果。

## Alternatives considered

**替换原身份。** 重新分配身份会割断已有事实和资源所有权与来源的联系。因此转换仅改变独立 generation 记录。

**把 actor 摘要为规则。** 尚无已实现的记忆等价证明支持此降级。操作拒绝所有 actor 代表历史，包括已退休代表。

## Consequences

支持的转换范围有限，不创建 Person、Session、资产或模型调用。它不证明任意 actor 升级或跨 owner 热变更。历史结果仍由原操作版本解释，当前准入则独立读取保留的 generation。

[两后端测试](../../../../packages/simulation/simulation-local/tests/world-representation.spec.ts) 覆盖实际规范决策、执行注册表、来源保留、中断回调对账、精确重试、禁止覆盖及重开重放。[可运行快照](../../../../examples/simulation-company/tests/world-representation.snapshot.ts) 固定真实 Loader 流程的可观察结果。
