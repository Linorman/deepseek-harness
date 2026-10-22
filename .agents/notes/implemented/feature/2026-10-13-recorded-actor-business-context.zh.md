# Agent Note: 已记录的 actor 业务责任

Status: implemented

[English](2026-10-13-recorded-actor-business-context.md) | 中文

## Problem

actor 不能仅凭传输消息安全地接受、取消、确认或交接义务。模型需要原 interaction/commitment 的身份、revision 与双方，同时不能获得其他 actor 的私有业务或 task/provider 正文。

## Decision

Native 为 decision 的实际 actor 派生一个完整 required commitments 块，包含本人的活动 interaction/commitment。终态记录只从本人实际 claimed wake 与原 typed 业务关联进入。canonical 消息可关联其收到 post 所属同一 accepted Native decision 中已应用的 interaction 效果；任意消息文字不能选择历史或授予权限。覆盖明确为 active/current-wake，不是全部历史。空范围不添加块或 routes。

严格 schema 只暴露安全业务状态、fulfillment policy、evidence operation IDs 及原 Native 已确认的 actor-member Channel routes。route 确认不保证 Hub 当前可用性。没有 task 正文、provider 配置或第二个 viewer 参数。既有 Native decision/context 与 Session context-view 事件保留所有模型可见输入，不引入新 Session 事件类型。

材料引用原 decision snapshot。同一 prefix 的 window fold 或唯一后续 decision/opened 记录有已知不变的业务投影。其他插入的 Native 记录缺少可重建的逐对象历史版本，因此拒绝准备，而不把新状态冒充旧 claim。原 applied operation/deadline 游标也拒绝后来事实。义务随后结算时，已准备的历史视图保持冻结；回放在原 context 记录重新计算材料。完整 UTF-8 块，包括 routes 与来源，计入 required section 预算；overflow 不丢弃已选义务。

Native journal format91 拒绝早期 stream。compiler9 与公开 SDK text-block/context envelope 结构保持原样。

## Alternatives considered

**让模型猜测业务身份或读取另一个角色的账本。** 文字与角色名不能证明 party membership 或原 revision；Native 从 actor 派生范围以保留原所有权。

**导入全部历史或截断单个责任。** 不相关旧正文泄漏范围，部分清单还可能隐藏人事变更前必须处理的工作。完整 active/current-wake 范围使用明确 required-budget 拒绝。

**把当前可变状态当成旧 snapshot。** interaction 没有完整逐 revision 历史投影。prefix 证据缺失必须拒绝，不能编造历史事实。

## Consequences

actor 只能根据原已记录责任状态提出操作。Native 独立验证与执行每个业务变更，传输确认不等于业务接受。窄测试覆盖双后端、真实 canonical 消息及成员 routes、非 party/task 正文隐私、精确 UTF-8 预算、历史视图保留和变化 prefix 拒绝。完整非空交接及冷恢复由独立 Loader 流程验证，owner 单测不替代此证据。
