# Agent Note：完整 World checkpoint 责任引用

Status: implemented

[English](2026-10-14-world-checkpoint-reference-coverage.md) | 中文

## 问题

完整 World 投影指纹可以绑定尚无逐条 checkpoint 责任引用的数据。缺资料补证轮次、外部裁决及延迟事件责任需要明确引用，才能在不披露私密正文的条件下核对原来源、状态和保留通知。

## 决定

[Checkpoint World 摘要](../../../../packages/simulation/simulation/src/checkpoint.ts)枚举全部原 intent/request/plan/result/mutation/reservation/cancellation、事实/制度版本、治理、外部 registry 和人员记录。补证问题及不可变回答修订有独立 record kind；外部裁决和延迟事件责任也有独立 kind。事件引用使用原裁决 sequence，而内容指纹绑定 scheduled/blocked/consumed 状态、阻塞历史和实际消费；回答引用保留原 input revision 序号。

定义指纹绑定全部原模板和策略；World 投影指纹绑定完整 World 和 bootstrap。Run prefix 指纹和完整原 journal 包含全部初始/生成/代表 Entity profile 与 Persona 数据、资源、承诺、operation、上下文/通知责任及规范清理证据。Materialized Session 引用绑定原已交付上下文和模型/工具历史；未物化 Session 不能替代实际执行历史。摘要暴露身份、版本、sequence 和 hash，不复制私密正文。

发布在封住的 Native cut 上比较完整派生摘要与候选。即使完整投影 hash 未变，缺失或改变逐条记录也拒绝发布；可写回放检查相同关系。Checkpoint manifest 8 和 Native stream 98 拒绝旧格式，不通过当前部署合成缺失引用。Compiler 9 及通用 SQLite/Session 格式不变。

## 考虑过的替代方案

**只使用完整投影 hash。** 它保护完整回放内容，但不能在责任索引中标识每个原补证或延迟责任。

**把全部私密正文复制进 manifest。** 这形成第二个披露面，并重复原保留 journal；引用和内容承诺保留唯一权威正文。

**接受旧 manifest 并在回放时补引用。** 这悄悄改变已接受 checkpoint 合同并掩盖不完整来源。预发布 backend 明确拒绝旧格式。

## 影响

[真实 checkpoint probe](../../../../examples/simulation-company/tests/checkpoint-world-coverage.ts)逐条比较引用与其 Native 拥有表，核验完整定义/投影承诺，并在 live sealed cut 提交缺失/fingerprint/sequence 变体。拒绝保持 revision 和业务状态，正确完整向量可以发布。[补证招聘](../../../../examples/simulation-company/tests/world-evidence.snapshot.ts)、[延迟及阻塞裁决](../../../../examples/simulation-company/tests/world-external-mediated.snapshot.ts)和[三个可移植工作流](../../../../examples/simulation-company/tests/complete-world.snapshot.ts)提供双后端真实 Agent/Session/Channel 历史及冷进程回放。

本文拥有引用完整性合同。[公开失败归因](2026-10-01-simulation-checkpoint-failure-diagnostics.zh.md)与 [checkpoint 限制的 Team 历史压缩](2026-09-01-checkpoint-gated-team-wal-compaction.zh.md)保留独立的错误/隐私及保留合同，均未被替代。跨 owner 原件损坏和故障边界验收仍需自身测试，不能只凭 World hash。
