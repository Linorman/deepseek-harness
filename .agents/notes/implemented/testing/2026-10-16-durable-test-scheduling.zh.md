# Agent Note: 限制持久测试并发并观察终态回执

Status: implemented

[English](2026-10-16-durable-test-scheduling.md) | 中文

## Problem

Simulation 测试组合真实 Native、Team 和 Session 日志。按 CPU 数量扩展进程会竞争主机执行资源及持久 IO；回调延迟本身不等于死锁。产品命令还会先返回受理，再异步完成准备。默认1秒轮询错误地把合法准备延迟判作业务失败，fixture 在返回前失败也可能遗失清理责任。

## Decision

普通 [Vitest 配置](../../../../vitest.config.ts)将文件 worker 限制为4个，CI 与 coverage 的显式 worker 预算仍优先。测试内部并发、选定文件、默认5秒测试期限、已有显式期限、重试、断言及覆盖率门槛均不改变。这限制运行器资源需求，不削弱耐久性，也不隐藏慢测试。

World replanning 测试在准确命令的终态持久追加及 store fold 后继续，再断言完成回执。丢失发布测试等待准确的注入发布尝试，之后才关闭并重开 owner。这些 barrier 仍受原测试期限约束；发起成功或别的命令完成都不能满足条件。replanning fixture 在后续初始化前注册幂等清理，使准备失败时也释放 owner。

## Verification

[调查证据](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/timeout-root-cause-proof-20261016.md)区分自然失败、注入延迟和当前验证。终态发布延迟1.2秒时，原 JSON／SQLite 轮询测试失败，基于事件的版本在原测试期限内通过。另一个 fsync 延迟实验诊断串行 IO 累积；拆分的诊断阶段不替代原测试，也不算验收通过。

## Alternatives considered

**提高期限或增加重试。** 拒绝：会隐藏未解释的停顿并改变验收条件。

**跳过 fsync 或把持久 owner 换成内存 fixture。** 拒绝：测试必须保留崩溃耐久性与原身份行为。

**凭重跑判断成功，或把所有慢回调归因于磁盘。** 拒绝：调度停顿也会延迟文件系统回调。保留时间线及失败断言，区分已证明的夹具缺陷与未解决的主机原因。

## Consequences

文件 worker 上限可能延长纯 CPU 测试；具备测量依据的 CI 可以覆盖它。这不是生产吞吐保证，也不声称全部历史超时只有一个原因。[并行门禁调度](../process/2026-07-06-parallel-pre-push-gates.zh.md)仍拥有聚合并发，[分区覆盖率](../process/2026-08-18-in-job-partitioned-coverage.zh.md)仍拥有 coverage 分区；两者均未被取代。整体 MVP 验收还需要当前输入的集成证据。
