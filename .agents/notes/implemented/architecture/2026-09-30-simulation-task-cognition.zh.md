# Agent Note: 已记录任务认知与精确尝试启动

Status: implemented

[English](2026-09-30-simulation-task-cognition.md) | 中文

## Problem

已预留的任务 attempt 没有标识所属 decision 或模型输入。复用其他输入、在 Session 持久化前启动，或将提交当作完成，会丢失因果证据，并可能在响应丢失后重复推理。

## Decision

[任务 decision producer](../../../../packages/simulation/simulation-team/src/task-decision.ts) 在打开 decision 前记录精确规范说明、decision 身份、前驱及原因。run 所有的索引标识原 attempt。每个关联保留 writer epoch 与不可变输入回执；另一 decision 要求前驱已接受或取消，且窗口已关闭。原生日志 format 43 拒绝早期格式。

必需输入物化将 task／attempt／来源身份及说明加入既有必读 `simulation/context-view` Session 事件。完整 input 内容计入配置上下文额度，重放检查原生来源及精确文本。不需要新 Session 事件类型或修改循环。

输入分发在保留原生回执前刷新精确 Session 队列。Hub 专用 start 在 task 锁内、policy IO 前后复查 runtime-only 原生输入 proof、规范创建及当前 lease，然后才允许唤醒 actor。模型和工具准入检查当前规范 task lease 及保留说明；推理还要求原生 running-task 观察及精确输入。原 decision 重试保留既有 context 和推理结果。

[分配决定](2026-09-30-simulation-task-assignment.zh.md)保留预留、权限及 controller 退休所有权。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md)仍负责 自动调度。没有记录被完整取代。

## Alternatives considered

**复用未关联的普通 decision。** 它不能确定原任务来源或精确 attempt。

**在 task start 或队列持久化完成前唤醒。** 模型可能在缺少规范 running attempt 或可重建输入时进入 step。

**模型提交时即完成任务。** 提交记录意图；世界效果仍 pending，且可能失败。

## Consequences

一个任务 attempt 可在同一 live epoch 保留多个有序 decision。每个关联固定模型认知或精确确定性策略版本，重放拒绝替换。确定性执行在 actor maintenance 锁内记录已准备 context 与精确已消费输入，刷新 Session 并启动精确 task 后计算纯策略，不创建模型 turn 或请求。任务认知使用既有三个 Simulation 工具，精确重试不会启动额外模型。已应用世界效果仍独立于任务完成。[任务完成决策](2026-09-30-simulation-task-completion.zh.md)负责场景谓词与结果结算；生产自动 executor 仍未完成。

## Verification

真实 JSON／SQLite Loader snapshot 固定已记录任务 context、实际 attempt start、原推理重试及显式应用操作后的库存变化。任务在 controller 退休前保持 running。单元测试拒绝缺失／退休／外部 attempt、来源选择变化、未准备输入、损坏索引及 policy IO 中撤销 start 权限。纯任务 Loader snapshot 验证零推理、已记录输入、实际启动、已应用转移及结果结算。Native 测试拒绝未选择或已变化的认知，并在冷重放后保留选择。该证据不证明自动 executor 或完整进程退出矩阵。
