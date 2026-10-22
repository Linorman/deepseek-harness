# Agent Note: 限制原 World 接受 append 的完整字节数

Status: implemented

[English](2026-10-13-world-acceptance-envelope-budget.md) | 中文

## 问题

World 请求或计划可能满足内层业务记录的字节额度，但完整接受 append 已超额。run/revision 包装、展开操作及因果 scheduler 记录同样是保留输出。仅检查部分展开内容会留下绕过声明字节上限的路径。

## 决定

[Native commit owner](../../../../packages/simulation/simulation-local/src/run.ts)在全部招聘资金 scheduler 记录追加后、发布前，计量最终 `JSON.stringify(batch)` 的 UTF-8 字节数。每个本次新接受的展开 `world/request` 使用冻结 `maxBytesPerRequest`，`world/resolve` 使用 `maxBytesPerPlan`。实际批次包含 run/revision 包装、串行决策完成、展开操作 intent，以及实际存在的排队、期限、定时或场景记录。超额接受抛出 `SIM_WORLD_LIMIT/bytes`，不追加该批次的任何部分。

窗口决策的 finished/submitted 记录属于独立 append；该规则仅计量实际接受 append。已经接受的精确重试不新增 append，也不重复计字节。Native stream 85 拒绝旧 stream；compiler 8、严格 payload parser 与 SDK schema 保持不变。

窗口 proposal 可能已具有成功的 Session stage/submit 证据和持久 inference 完成时间，随后才在最终 Native 接受时因字节超额被拒绝。`commitWindow()` 将受支持的 World 拒绝连同原 submission hash 保存为 `worldSubmissionBlock`，取消该 slot 但保留其 submission；全部 slot 终态时，在同一拒绝 append 中关闭窗口。此前已接受的 slot 仍保持提交。driver 报告 `stalled`/`world-byte-limit`；checkpoint 校验关联真实成功的 Session stage/submit 与 Native 拒绝，不伪造工具失败结果。

投影验证继续检查内层业务记录。历史回放不重构或重新计量原完整接受批次。该额度是原 append 的准入检查，不是新的批次大小回放不变量。

## 考虑过的替代方案

**分别检查生成的业务记录。** 每条记录都可能合规，但总和加包装仍超过原额度。

**在共同 commit 前检查展开。** 末尾资金 scheduler 记录仍可能扩展批次；持久 append owner 才持有完整输出。

**合并所有窗口准备 append。** 独立 finished/submitted 记录不属于接受 append。合并会定义另一种额度，并虚构存储从未接收的批次。

## 影响

同一 payload 可能需要更大的显式字节额度，因为持久包装和派生效果也参与计量。被拒绝的接受批次不贡献任何已接受效果；后续持久拒绝记录取消的 slot 与停止。此前已接受的窗口 slot 不回滚。[Native 测试](../../../../packages/simulation/simulation-local/tests/world-acceptance-budget.spec.ts)覆盖请求/计划精确 UTF-8 边界、窗口准入、展开计数、append 拒绝及原件重试。[真实 Loader 测试](../../../../examples/simulation-company/tests/world-acceptance-bytes.snapshot.ts)测量实际 append，接受精确上限并拒绝小一字节，覆盖双后端和 source/lib，每案两次冷恢复。记录矩阵还在不提高预算的情况下保留外部预留/提交字节故障边界；40案、120进程保存原 journal 和 Session 证据。这不代表完整 World 或真实 provider 验收完成。
