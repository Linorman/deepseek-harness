# Agent Note: Simulation 控制轮询

Status: implemented

[English](2026-10-15-simulation-control-polling.md) | 中文

## 问题

World 页头独立于领域正文轮询控制提示。冷读取重放的保留历史可能超过轮询间隔；每次 tick 都取消同一已选读取，会让控制观察一直无法完成，恢复操作也不可用。

## 决策

`SimulationRuntime.control()` 仅在运行、凭据 generation 及活动控制请求相同时共享在途 promise。结算后的调用读取新状态。其他运行或已退休请求开始新观察；既有 read owner 继续取消旧 IO 并拒绝过期发布。共享 promise 在发布 loading 前安装，防止同步监听者创建第二个轮询。完成时只释放自身槽位。

## 考虑过的替代方案

增加轮询间隔会让正确性依赖重放速度及部署历史。共享无关读取会改变独立选择和显式刷新契约；仅由控制 owner 合并其重复观察。

## 后果

本变更只影响读取调度，不增加管理命令、writable owner、Native 事件或模型调用。测试在重复轮询期间持有原响应，随后验证结算、新运行、凭据替换及迟到拒绝响应。真实浏览器验收使用保留的较长历史与显式暂停恢复。
