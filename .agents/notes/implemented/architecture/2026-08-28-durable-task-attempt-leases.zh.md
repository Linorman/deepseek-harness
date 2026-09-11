# Agent Note: Durable task attempts and leases

Status: implemented

[English](2026-08-28-durable-task-attempt-leases.md) | 中文

## Problem

task revision 和 dependency graph 无法标识哪个执行实体被允许改变 task。通用的完整 task replacement 会让 stale worker 在另一次 attempt 已启动后改写 phase、retry policy 或 instruction。仅存在于 scheduler process 中的 lease 会在重启后消失，而单独的 attempt log 又会产生半持久化 task/attempt pair 的风险。未来 scheduler 还需要持久 capability eligibility、review decision、有界 retry state，以及最小 result 或 failure record，才能安全地选择或重新分配工作。

## Decision

`TeamTaskSnapshot`仍是单条 `task/changed` Team-journal record 中的完整值。它冻结 ancestry、required capability、priority、scope、workspace mode、budget、封闭 review route、`maxAttempts`和可选的 activation-authorized task-create command。它要么没有 lease，要么有一条 `assigned`／`running` lease，并带有 settled attempt 和 review-decision history。attempt id 和 task-local ordinal 永不重复；`attemptCount`等于 settled history 加上当前 lease。lease 记录 assignment revision、固定 duration、renewal/deadline fact、Participant、可选的已附加 wake channel，以及 agent participant 的准确 `ActivationId`。human 和 service lease 省略 activation field。

Team service 公开受限的 task detail、cancellation、deletion、review、assignment、start、delivery-bound start claim、heartbeat、settlement 和 expiry operation。owner operation 围栏当前 revision、attempt id、Participant 和适用的 activation epoch。assignment 会验证 active membership、冻结的 capability requirement 和可选的 active attached wake channel。`claimTaskAttemptStart()`验证保留的 assignment revision、精确 activation/session binding、attached channel 和一条已接收且指向该 task 的 Envelope；对同一当前 running claim 的重复调用会返回现有 projection，而不会再写入一条 Team-journal record。completion 会记录 summary，并在 no-review route 下直接完成，或为准确 configured reviewer 进入 review，后者的 decision 会保留 reason。failed、released 和 expired attempt 在未达到冻结 attempt limit 时返回 pending，之后失败；cancellation 是终态。Hub 没有 scheduler timer，也没有 owner-selection loop。

Hub 在折叠 journal 和恢复 checkpoint 时，会验证与公开 command 相同的 task-create command、attempt、capability、epoch、deadline、wake-channel reference 和 leased-field continuity rule。它写入 Team journal format 9 和 Team checkpoint format 10。channel WAL format 2 与 channel checkpoint format 5 保持独立。completed attempt 保留 `TaskAttemptResult { summary }`；failed attempt 保留 `TaskAttemptFailure { code, message }`。artifact reference 仍会等到 artifact provider 拥有品牌化 id、provenance、visibility 和 retention 后才出现。workspace allocation snapshot 现在会与 task 分开保留 provider mint 的 metadata 与 lifecycle，而 root 仍是 live provider handle。

## Alternatives considered

**将 attempt 写入单独 journal 或 stream。** 不予采纳，因为 settlement 与 task phase 需要跨 stream 的原子 pair；完整 task snapshot 提供一份可回放的真源。

**保留不受限制的 task replacement operation。** 不予采纳，因为 stale lease holder 可以构造看似有效的 task snapshot，并绕过准确的 attempt fence。

**只用逻辑 Participant 围栏 attempt。** 不予采纳，因为同一 Participant 的先前 local 或 remote activation 可以在更高 epoch 成为 resident 后继续 renew 或 settle。

**在 task contract 中引入 artifact id。** 不予采纳，因为尚不存在能定义其 lifecycle、provenance 或 storage guarantee 的通用 artifact/allocation owner。

## Consequences

[activation-authorized Team task-creation 决策](2026-08-29-activation-authorized-task-creation.zh.md)拥有持久化 creator command 与 retry identity。[确定性 Team DAG 调度器决策](2026-08-28-deterministic-team-dag-scheduler.zh.md)通过这份 contract 提供初始 shared-work selection 和显式 expiry。task-delivery adapter 和 client 会发布 assignment Envelope 并调用 delivery-bound start claim；review/retry/stall policy、quiescence 和 artifact publication 仍是独立工作。client 不能把 task attempt 当作 model turn、Agent handle、workspace allocation 或 transport connection。

`maxTaskAttemptsPerTask`和 `maxTaskLeaseDurationMs`会在 Hub 中限制 task creation 与 assignment。attempt 是 at-least-once execution coordination，而非 exactly-once 模型或工具执行。[本地 Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)仍是 Hub ownership 和 recovery 的权威；[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)在 scheduling、Goal/workflow convergence、workspace、remote Link 和产品阶段完成前仍为 proposed。

## Verification

核心测试覆盖严格 durable parser、chronology、result/failure fact、capability declaration、epoch-fence union、delivery-bound start claim 和每个受限 runtime method。Hub 测试覆盖 JSON 和 SQLite 中 assigned/running/expired/reassigned attempt 的恢复、cap enforcement、capability eligibility、wake-channel validation、stale revision/attempt/Participant/activation/session/channel/Envelope rejection、idempotent claim replay、review/cancel/delete transition、deadline boundary、malformed journal 和 checkpoint rejection，以及 leased task detail 的保留。invariant 测试只接受满足折叠 attempt relationship 的 projection。
