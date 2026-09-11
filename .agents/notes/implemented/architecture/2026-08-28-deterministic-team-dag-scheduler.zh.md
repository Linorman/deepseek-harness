# Agent Note: Deterministic Team DAG scheduler

Status: implemented

[English](2026-08-28-deterministic-team-dag-scheduler.md) | 中文

## Problem

持久 task attempt 使 assignment 安全，但不会选择 owner、使被遗忘的 lease 过期，或阻止两个 ready shared-work task 声明相交的 write scope。让模型、Agent client 或 process-local timer 选择这些操作，会绕过 Team provider 的 compare-and-set 和 policy authority，也无法在重启后保持一致恢复。

## Decision

显式挂载的 placement Consumer 会在任务分配前准备具有明确执行路由的 active participant。Task placement 限制持久化保存；Hub 在分配 attempt 时重新检查身份、角色、runtime provider 与 Activation 的实际 model/preset 选择。成员描述提示不能替代 Activation 保留的实际选择。Activation controller 负责并发启动去重；请求任务消失时，placement owner 释放已发布且没有其他任务需要的执行实例。

`clocky-team-scheduler-dag`是 `ctx.teams`的一个具体 Consumer，而不是新的通用 scheduler registry。它读取持久 Team projection，调用 `openChannel()`、`assignTask()`、`postChannelEnvelope()`和 `expireTaskAttempt()`，并使用 task-assignment adapter 的纯 parser。它不导入 Hub implementation、Agent、Session、Link 或 Agent inbox 代码。每个公开 mutation 仍是 Team provider 的 compare-and-set operation。

一次 drive 检查冻结的消费与时间上限后，使到期 lease 失效，再按 priority 降序和首条 durable task-record 顺序选择 ready task。初始 eligibility set 包含 active local 或 remote agent，它们有一条准确 idle activation、具备全部 required capability、拥有可用 load，且没有相交的 shared-work write scope。排名使用 Team 冻结的 `outcome-latency` v1 policy：proposal、capability surplus、load、同一 required-capability set 的完成次数减负向次数、延迟中位数桶、有成本约束时已验证的冻结费率桶，最后为 Participant id。无历史为中性；未知成本排在已知费率后。只有 binding 的 recovery model route 能证明费率选择，可变 hint 不能。Hub 根据真实 settled attempt 增量折叠固定长度直方图，并用保留的历史（包括 deleted task tombstone）校验 checkpoint。没有 attempt 的依赖取消不计失败。scheduler 会在每次已接收 mutation 或可恢复 CAS race 后重新读取持久 Team state。Hub policy 和 validation 保持最终 authority。

对于每个被选中的 activation，scheduler 会打开一个 active `task-assignment` v1 channel，它有唯一 `assignee` 和不可变的 task／activation／Session limit，随后将该 channel 作为 `wakeChannelId` 分配 lease。lease 公开 attempt id 和 assigned revision 后，它会追加唯一的自寻址 assignment Envelope。之后的有界 drive 会通过配置的 `readChannelPage()` continuation 轮转读取每个 assigned wake channel，接收其唯一的 parser-validated Envelope，或在 crash 使 channel 为空时追加它。Review request/response repair 也使用同一 page source。它绝不调用 Agent、Link 或 inbox method。

所有 limit 都是经过验证的 configuration：lease duration、assignment/expiry/wake-dispatch/conflict cap、channel recovery page size、per-Participant load、permitted workspace mode 和 disposal bound。Shared work 始终启用；其他 workspace mode 需要显式开启，并由 provider 接受所选 task 和 activation。Startup 和已提交 Team change 会请求 drive。部署可以配置 `pulseIntervalMs`，或自行提供用于 expiry 与 retention 的 recurring drive。WAL 提交后的 `team-scheduler/assigned` observation 是 advisory 且会被包含；restart recovery 扫描持久 assigned task 和 channel WAL，而不依赖该 event。

Task attempt 仍为 assigned/running，或 participant-review task 的 active reviewer 有 idle/running activation 时，Team 仍有可以推进的工作。这些工作可能解除后续依赖，因此 scheduler 在其结算前重置 unassignable-drive 计数。没有进行中的工作后，缺少 reviewer 报 owner eligibility 失败；pending task 的依赖无法完成时才报 dependency deadlock。已持久化 consult request 后 reviewer 变忙，不会使该 review 变为 deadlock。

终态 retention 使用 channel 返回的 `firstCursor` 跳过已移除的前缀。符合条件的 channel 先使用 drive 预算，再处理终态 Team journal，使预算为一时重复 journal maintenance 也不会阻止 channel 推进。Active、stalled 和 quiescing Team journal 不属于 compaction 候选，其终态 channel 仍可回收。每个被选前缀仍须通过 provider 的 cursor、checkpoint、causation 与 pending-delivery 检查。

Review request 属于一次 completed task attempt。Channel lookup 根据专用 review payload 匹配该 attempt id，旧 rework decision 的 channel 不会被当作后续审阅。Worker 仍在结束 report turn 时，rework 可以先进入 pending；具备能力且 workspace eligible 的 running owner 属于暂时不可用。之后的 idle status 因此可以直接触发 assignment，无需人工 resume Team。Await workspace query 后，scheduler 会先检查 disposal 再决定是否提交新 mutation。

冻结的 token、turn、cost 与 wall-time ceiling 取有效 typed 值和部署值中的较小者。Typed count 与 time 允许零，typed cost 允许非负小数；达到额度后停止新调度。Hub 的 wall-time admission 使用相同的 exclusive deadline：相等时即拒绝工作，包括创建时的零时间额度。

Concurrency 与 retry 管理 assignment admission。正 Team concurrency 已满时，已接纳工作继续保持 active，并重置此前 unassignable-drive 的观察计数；零 concurrency 对 ready pending work 给出明确 stall。Scheduler 在 expiry、wake repair 与 review handling 后检查 capacity，Hub 在提交 lease 前再次检查。

Team retry usage 为各 task 首次 attempt 之后的 attempt 数之和。Typed quota 与冻结 legacy quota 都只限制已有 attempt 的候选任务。选择时跳过无额度的 retry，继续尝试首次 attempt；已接纳 lease 和当前 review 完成后，才诊断 retry 额度耗尽。没有其他 budget-admissible ready task 时，scheduler 为 blocked ready retry 记录 `TEAM_RETRIES_BUDGET_EXCEEDED`。这样 quota enforcement 位于新 attempt admission，其他路径仍保留既有 owner/dependency 诊断。

## Alternatives considered

**在第二个实现出现前创建通用 scheduler service。** 不予采纳，因为第一个 scheduler 只有一项具体 policy，且尚无外部 Consumer 需要可替换 registry。

**assignment 后直接唤醒 Agent。** 不予采纳，因为进程内 inbox call 无法恢复 process crash 前已提交的 assignment。scheduler 写入持久 channel Envelope；Link 和 Agent Client 拥有 delivery 与 model input。

**用隐式 interval 使 lease 过期。** 不予采纳，因为部署时机属于显式 pulse；隐藏 timer 会使 reload 复杂化，且无法跨 process restart 存活。

**把 `team-scheduler/assigned`当作 task outbox。** 不予采纳，因为它是可能丢失或重复的提交后 observation。task-assignment channel WAL 持久且可 replay。

## Consequences

Scheduler 拥有确定性的 lease selection、显式 expiry、review dispatch/response repair 和有界 stalled diagnosis。Agent/Link Consumer 拥有执行，workspace provider 拥有 artifact publication，生命周期 owner 证明 quiescence 与 Team completion。Scheduler 只使用 Team Service Definition，并由 provider 重新验证其操作范围 authority。

[持久 task attempt 与 lease 决策](2026-08-28-durable-task-attempt-leases.zh.md)仍拥有 task state、lease fencing 和 replay validation。[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)在 review/retry/stall policy、workspace allocation、remote Link、Goal/workflow convergence 和产品入口完成前仍为 proposed。

## Verification

真实 Hub review 组合会在 rework 后完成第二次 attempt，获得独立 consult request，并在保留两次 decision 的同时接受第二次 attempt。Busy-owner 用例等待合格 worker 变为 idle，保留 capability/workspace 拒绝，并验证 workspace eligibility 等待期间 disposal 不会再发起 mutation。可运行 review-projection 场景另行验证实际 worker 的最后一轮模型响应与 rework 重叠的窗口。

真实 Hub retention 测试验证 active work 可以获分配且不请求 Team-journal compaction，并以实际 Envelope、recipient receipt 和 closure 创建两个 direct channel。连续两个单-command drive 必须推进两个 WAL 的保留前缀，再一次 drive 必须跳过二者。另一项 Consumer 测试验证相同预算下先处理 channel，再处理终态 Team journal。

真实 Hub 组合测试在后继任务等待时保留 running prerequisite 和已交付 review request，并验证 reviewer 进入 running 不会使 Team stalled。独立用例保留缺少 reviewer 的 owner failure 和 failed prerequisite 的 dependency deadlock。这些场景使用实际 task assignment、settlement、activation status 和 scheduler 自有 proof。

另一项真实 Hub 测试先累计 unassignable drive，再启动并结算独立 task。剩余的无 owner 工作必须重新等待配置要求的完整 drive 次数才进入 stalled，证明工作推进会清空此前计数。

[Review terminal restart 示例](../../../../examples/headless-agent/tests/review-terminal-restart.snapshot.ts) 让真实 worker report 经过 participant review、consult delivery 和 running reviewer，再触发 failure 或 cancellation。JSON 和 SQLite 场景在 terminal intent 持久化后终止 Host，再启动另一个 Loader。恢复保留 completed attempt 和 consult 历史，只取消 review task 一次，并因无法确认终止的准确旧 activation epoch 而 stalled。源代码和构建产物运行同样的四个场景。

Scheduler 测试覆盖 priority 和 creation ordering、capability specificity、load cap、idle activation selection、shared-scope conflict、expiry-before-assignment、CAS reread、policy-denial stop、startup scan、drive coalescing、channel/Envelope parser rejection、有界 wake recovery rotation 与 page continuation、advisory listener containment、无 private timer 和有界 disposal。真实 JSON-backed Hub composition 证明初始 assignment dispatch 和 crash-window Envelope repair 不会产生重复 WAL entry。这些路径改变后仍需重新验证完整 scheduler coverage。

Budget-boundary 的 JSON 与 SQLite 测试挂载真实 Hub 和 scheduler proof source，覆盖零 consumption/time、fractional cost 未达与达到上限、有效 typed/legacy 最小值、正 concurrency 的等待与释放、空 Team 和 pending work 的零 capacity、零 retry 下的首次 attempt、最后一次已接纳 retry、blocked retry 后面的 fresh task，以及最终 retry stall。直接 Hub caller 也保留首次 attempt 的豁免，并拒绝已耗尽的 typed 或 legacy retry quota。Capacity-wait 回归保留此前 unassignable 观察计数的重置。

Hub 时钟测试使用 `vi.spyOn(Date, 'now')`，不修改系统时间。正 wall-time cap 在 deadline 前接纳工作，在相等或更晚的 assignment 时拒绝，包括更早的 legacy deadline。零 wall time 会拒绝公开 task creation，Team journal cursor 不变，也不创建 task 或 channel。

[Review-projection 示例](../../../../examples/headless-agent/tests/review-projection.snapshot.ts) 还为一个 rework 场景冻结 `maxRetriesPerTeam: 1`。真实 coordinator、worker 和 reviewer Session 完成第二次 attempt、接受对应 review 并交付 final result，Team 始终保留这一准确 retry ceiling。
