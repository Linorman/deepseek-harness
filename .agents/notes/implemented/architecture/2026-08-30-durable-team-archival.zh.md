# Agent Note：持久化 Team 归档

Status: implemented

[English](2026-08-30-durable-team-archival.md) | 中文

## 问题

Team 的创建和终态结算已经持久化，但没有一种 Team 自有的方式可以在不删除 journal 的情况下，将已结束 Team 从普通产品列表中隐藏。

## 决策

Team Hub 只为 `completed`、`failed` 或 `cancelled` Team 追加带版本的 `team/archived` journal 记录。`TeamSnapshot.archivedAt` 保存该标记，`getTeam()` 保留完整状态，`listTeams()` 排除已归档 Team。重复归档是幂等的并返回已有状态；过期或 active Team 的归档请求会在追加前失败。新增记录会同步提升 Team 和 checkpoint 格式版本。

## 考虑过的替代方案

**把归档保留在 Host 或浏览器 registry 中。** 否决，因为进程重启后 Team 会再次出现，不同客户端也可能对可见性产生分歧。

**删除 Team journal。** 否决，因为归档必须保留 replay、task、channel 和 transcript 引用。

## 影响

产品客户端可以通过 `TeamId` 归档终态 Team，同时恢复和直接读取仍然无损。Scheduler 与默认列表会自然跳过已归档 Team；journal 和 channel WAL 仍可供检查。
