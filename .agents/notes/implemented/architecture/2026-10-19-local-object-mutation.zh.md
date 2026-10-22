# Agent Note: 局部对象名称变更

Status: implemented

[English](2026-10-19-local-object-mutation.md) | 中文

## Problem

全运行维护会为仅修改对象名称而中断无关角色。没有完整范围证明就绕过屏障，会让旧模型上下文跨越变更边界。

## Decision

版本化操作 `organization/rename-object/1` 只改变普通非认知对象的名称。目标必须活跃、没有 Participant、Session 或 writer，元数据仅含 name 和可选 description。重试保留原目标 revision、严格请求与已接受计划；描述和身份不变。可移植 v1 compiler 接受非认知 `object` 实体，不改变既有实体投影。

Native 在唯一提交队列内计算写入范围，并重验原计划读取与权限。私有 Native mutation 记录保留目标/revision、空 writer epoch，以及关联关系、资源、通道与权限关系，并在重放时独立重算校验。Native stream 100 拒绝此前格式；公开业务结果不泄漏这些私有引用。精确授权关系是读取依赖，不是写入。目标存在其他关系、资源所有权/控制权或通道成员关系时，需要全运行维护。局部路径没有跨 owner IO，因此只需要一个 Native 准入点，不另造第二套锁协议。提交落盘期间，该队列之外的无关模型执行可以继续。

只有准备完成的 World context 属于这一精确不可变 provider，并带有不相交读取集合时，开放或已提交的 decision 才允许局部执行。此 provider 的规划上下文只暴露原请求和目标名称。无实时读取的已保留请求回执保持不可变。未知领域上下文、缺失读取或范围重叠回退原 canonical 静默收集路径；不支持局部能力的 provider 也如此。回退原因保存在维护 owner 和原子结果中。仅同一计划的 quiescent 维护允许此变更；取消不丢弃已接受维护责任。

Checkpoint cut 按既有[维护控制 cut 规则](2026-10-14-world-maintenance-control-cut.zh.md)继续优先于局部提交。Native 在追加前重验权限与目标 revision。原子变更沿用现有日志与结果身份，精确重试不重复效果。进程崩溃后不能仅因名称变更完成而释放继承的 writer 责任。人员、认知、表示、全局制度、任意 profile 与跨 owner 资源变更均不属于此局部能力。

## Alternatives considered

提高全局变更额度不能证明读取依赖。将所有领域的读取集合视为完整，会信任从未声明该保证的能力。既有全运行路径继续作为保守回退。

## Consequences

[B3c 证据](../../../plans/2026-10-16-world-post-mvp/evidence/b3c/) 包含两后端 canonical 请求/计划/窗口、取消与回退、过期及撤权来源、checkpoint 排他、追加前后 SIGKILL 和真实 Loader 快照。固定对照使用同一个改名请求与已接受计划，对照 provider 适配器不提供局部能力检查。原限额、身份和历史保持完整。这证明独立名称修改的优化，不证明并发录用、任意领域安全或多 owner 锁支持。
