# Agent Note: 不可变的 Team 任务创建时间

Status: implemented

[English](2026-09-29-team-task-creation-time.md) | 中文

## 问题

Team task snapshot 保留 revision 和创建命令身份，但没有首次接纳时间。产品查询无法从这些 snapshot 按创建时间排序离页任务；当前 Team 游标或后续修改时间也不能保留其创建来源。

## 决策

Hub 使用首条 `task/changed` record 的同一个单调真实时间戳写入必填的 `TeamTaskSnapshot.createdAt`。命令调用方不能提供该字段。编辑、分配、attempt、review、取消和删除均保留原值；幂等创建重试返回既有任务。

Journal 回放要求该值与首条 record 相等，并拒绝后续 revision 改写。检查点重建要求任务创建时间位于所属 Team 的创建／更新时间区间内。Team journal 和 checkpoint format 均为 40；预发布 backend 拒绝旧格式，不为既有任务虚构时间戳。

## 考虑过的替代方案

**只排序浏览器已加载页。** 离页任务仍不可用，翻页会改变集合呈现顺序。

**使用最新 Team 游标或任务修改时间。** 无关 Team 命令或后续任务编辑会改变旧任务排序，且不能证明创建时间。

**恢复时为缺失时间补默认值。** 保留前缀压缩后无法重建该值；任意默认值会为旧任务虚构创建来源。

## 影响

完整任务读取记录增加一个数字字段，仍受既有完整结果字节额度限制。该时间戳使用真实时间，不定义 Simulation tick，也不改变 Session format。[本地 Hub 权威决策](2026-08-27-local-team-hub-durable-authority.zh.md) 继续负责 journal、checkpoint 和串行队列的所有权。Team 待处理事项产品查询仍是独立的实施步骤。

## 验证

Fold 测试覆盖编辑、删除和检查点回放后保留创建时间，并拒绝缺失、伪造首条记录时间、修改 revision 时间及超出生命周期的检查点值。JSON／SQLite 回放 fixture 保留有效时间戳，同时继续覆盖原有损坏案例。消费者测试覆盖 Team、SDK、工作区和 GUI 记录解析。真实 Host 的 keyless 集合场景检查接纳时间、创建重试及任务编辑后时间不变。
