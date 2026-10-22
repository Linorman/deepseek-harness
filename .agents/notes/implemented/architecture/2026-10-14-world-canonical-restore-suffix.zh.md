# Agent Note：World 恢复校验规范 owner 后缀

Status: implemented

[English](2026-10-14-world-canonical-restore-suffix.md) | 中文

## 问题

Initial checkpoint 早于后续招聘和代表创建。后来 Team/Channel 投影可以与自身日志一致，却不符合 Native 原 participant descriptor 或 Session endpoint。只重验旧 checkpoint prefix 无法识别此类不一致。已提交招聘也需要和已提交代表相同的原 Persona 合同。

## 决定

[共享 owner-reference 检查](../../../../packages/simulation/simulation-team/src/owner-references.ts)把每个已预留 participant 的不可变 kind、姓名、role、capabilities 及 runtime hints 与 Native 原 reservation 比较。每个已确认 Native Channel 的实际 manifest 和 endpoint consent 都须符合原 participant、role、limit、adapter、Session binding、required flag 及 manifest fingerprint。Collection 和 restoration 使用相同检查，覆盖所选 checkpoint 之后新增的 owner。退休成员和关闭 Channel 保留合法 phase，不以必须 active 替代身份核验。

所选 manifest 保留的 Session binding 在遍历后来 Channel 前检查。既有 protected-prefix、consumption、activation、cleanup 和 accepted Envelope 检查仍拥有各自来源合同。全部校验早于 phase 改变、attachment 或 writer recovery；独占 Native open 不会在这些检查通过前暴露可写恢复连接。

已提交生成/代表 Persona profile 保持原 accepted profile。通用 profile mutation 在 append 前拒绝替换，generated-hire projection 在 replay 重验原 plan/profile。Native stream 94 拒绝旧解释；checkpoint manifest 4 和 compiler 9 不变。World 初始化不是缺资料补证 transition：只有已有 evidence state 之间的变更使用 evidence submission allowance，完整实际 evidence batch 仍受额度约束。

## 考虑过的替代方案

**信任当前 owner 自身 fingerprint。** 它证明内部一致，不证明符合原 Native 分配。

**要求所有历史 owner active。** 这会拒绝合法离职和已确认 Channel 关闭，而不是核验保留身份。

**重生成缺失 Persona 或规范身份。** 这替换已接受来源、改变模型历史并可能重复责任。缺失来源拒绝可写恢复。

## 影响

[持久故障场景](../../../../examples/simulation-company/tests/world-restore-contract.snapshot.ts)复制实际已完成公司/实验室世界，并从 initial checkpoint 恢复。它破坏后来真实 Session 文件、participant WAL 快照、Channel invitation、保留 Envelope 或追加 Native profile record，仅移除可重建的 projection cache。正确 baseline 恢复为 paused；损坏来源拒绝恢复，没有 model、activation、publication、attachment 或 Native journal 改变。故障介质使用独立写入时复制，只读 baseline 可共享字节。Python mutator 仅用于测试，允许通过 `PYTHON` 指定解释器。

[Checkpoint 引用覆盖](2026-10-14-world-checkpoint-reference-coverage.zh.md)拥有完整性/内容承诺；[公开失败引用](2026-10-01-simulation-checkpoint-failure-diagnostics.zh.md)拥有安全披露的诊断。两者保留独立合同，均未被替代。这些 owner 检查本身不证明更广的 SIGKILL 矩阵或真实模型质量。
