# @clocky/clocky-team-scheduler-dag

[English](README.md) | 中文

`@clocky/clocky-team-scheduler-dag`是本地 Team 消费方：它通过 `ctx.teams` 确定性地提出带 lease 的 task assignment、写入其持久 task-assignment notification、使逾期的 task attempt 失效，并可运行显式配置的 terminal-stream retention drive。它会在选择 owner 前查询 `ctx.teamWorkspaces`，但绝不分配 execution root。它会注册 source-scoped ordinary-post proof；Hub 只会在 leased task 或 review scope 仍为 current 时接收 task-assignment 与 review-request Envelope。它独立的 task-review proof 会在 retention 丢弃 response 前修复 closed consult response，即使 reviewer activation 已 offline；channel change 会请求该 Team 的 drive。独立的一次性 phase proof 只能以 scheduler 准确的 budget 或 unassignable-work reason 将当前 active Team 标记为 stalled。它只会在分配准确 selected task 或使准确 elapsed attempt 失效期间保留 `TeamSystemTaskLeaseProof`，并且只会在打开一条选定 review/wake channel、关闭一条未被 lease 引用的 failed-assignment wake channel，或以 drive 的 clock observation 使一条有界 channel batch 失效期间保留 `TeamSystemSchedulerChannelProof`；Hub 会在 durable acceptance 前重新验证两者。它不拥有通用 Team authority 或 Agent execution，也不导入任何 Hub implementation、Agent、Session 或 workspace provider implementation。

Team 的 stall 判断会等待仍可推进的 assigned/running task attempt，或 active reviewer 的 idle/running activation。这些 drive 重置 unassignable-work 计数，pending 后继任务依赖这些工作时也一样。没有这类进行中工作后，缺少可用 reviewer 属于 owner eligibility 失败；无法完成的依赖仍按 dependency deadlock 诊断。

Ready pending work 也会等待满足 Participant capability、load 上限、允许的 workspace mode 及当前 provider eligibility 的 running activation。该 owner 结束当前 turn 后可以变为 idle；无关的忙碌 Participant 或不可用 workspace 不会阻止 stalled diagnosis。Workspace check 期间开始 disposal 时，不再提交之后的 phase 或 assignment command。

Wake-channel 创建与恢复，以及 consult review 发送，都会通过 `teamChannelAdmission.waitUntilActive()` 等待，再进行 assignment 或 Envelope dispatch。等待不持有 Hub 锁，并随 scheduler disposal 停止。缺少 endpoint consent 时由 admission Consumer 的持久 deadline 处理；scheduler 不会把插件注册当作 acknowledgement。

Wake 恢复、review 派发与新任务分配分别受每轮额度约束。`maxReviewDispatchesPerDrive` 默认 `8`，限制 review 请求或恢复的响应数。耗尽 `maxWakeDispatchesPerDrive` 只结束 wake 扫描，合格的新任务和 review 仍可推进。Review 频道按准确的 Team、task、attempt 和 reviewer 幂等创建，包括已 attached 但尚无 request Envelope 的频道。

任务在频道发布期间推进时，scheduler 签发的 proof 可能失效。Scheduler 在 `maxConflictsPerDrive` 限制内重读状态并签发新 proof；持续的 proof 失败仍被抛出，未完成 assignment 的 wake 频道逐个关闭。明确的策略拒绝不会触发此重试。

每次 discovery drive 消费一个配置大小的 Team page，为下一 pulse 保留 opaque cursor，空页也推进。每次 Team drive 完成一个有界轮次；期间合并的变更安排到后续事件循环。Disposal 取消这些延后轮次，并在已接纳工作结算前保留 proof source。

## 调度与失效

每次 drive 检查冻结的消费与时间上限后，会使已到期的 assigned 或 running lease 失效，再按 priority 降序和 task 的 durable creation order 选择 ready 的 `pending` task。它只考虑 active 的 `local-agent` 和 `remote-agent` participant：它们必须声明全部 required capability、拥有准确的 `idle` activation，且 active attempt 数少于 `maxActiveAttemptsPerParticipant`。在对这些 candidate 排名之前，它会调用 `ctx.teamWorkspaces.eligible(task.workspaceMode, { task, binding })`，并跳过返回 `false` 的结果；provider 不可用会使 drive 拒绝。scheduler 绝不调用 `allocate()`。它使用 task revision 与已配置的 `leaseDurationMs` 调用 `assignTask()`；Team provider 仍是 membership、capability、activation identity、task phase、revision 和 lease validity 的最终 authority。Discovery 使用配置的 `teamPageSize`调用有界 `listTeamsPage()`，一个 pulse 不会请求完整 Team collection。

排名要求 provider 冻结 `rules.taskRanking` policy。合格候选依次比较 proposal、capability surplus、load、同能力集合 attempt 结果净值、延迟中位数桶、有成本约束时已验证的费率桶，最后为 Participant id。无历史为中性；未知成本排后，不能绕过预算准入。

对于每个选中的 Agent lease，scheduler 会通过一次性 scheduler-channel proof 打开恰好一个仅含 assignee 自身的 `task-assignment` channel，并冻结不可变的 `{ taskId, activationId, sessionId }` limits。它将所得 channel id 提供给 `assignTask()`，使 Team provider 将其附加到新 lease，随后追加该 channel 唯一自寻址的 `assignment` Envelope，其中带有已生成的 attempt 和 assigned revision。proof 或 assignment 被拒绝时，只有 Hub 验证没有当前 lease 引用这条准确 active wake channel 后，它才能关闭该 channel；close failure 会与 assignment failure 一起报告。participant review 使用同一 proof family，但只会为所选 completed attempt 与 idle reviewer activation 打开准确 consult channel。后续 drive 会从已附加的 channel 和 lease 恢复中断的 assignment sequence，只追加缺失的 Envelope，绝不会为该 lease 创建另一个 channel 或 Envelope。

对于 `shared` work，如果任一 assigned 或 running 的 shared task 保留了重叠的已声明 `writeScopes` prefix，scheduler 会跳过该 task；workspace 根 scope `.` 与任一路径重叠。每次成功 assignment 和每次 compare-and-set conflict 后，scheduler 都会重新读取 Team projection 后再选择，因此会根据 durable state 重新计算 load 和 shared-scope conflict。即使 listener 识别出某个 task revision 是 scheduler 自己提交的 mutation，该 revision 也会请求下一次 coalesced drive；这样 `maxAssignmentsPerDrive` 仍是每次 drive 的 bound，同时不会遗留后续 ready task。当并发 channel-maintenance CAS 耗尽一轮 drive 的 conflict budget 时，coalesced drive 会用 fresh projection 重试完整扫描，再暴露 race，确保 queued work 仍可被调度。`maxAssignmentsPerDrive`、`maxExpirationsPerDrive`、`maxWakeDispatchesPerDrive` 和 `maxConflictsPerDrive`限制这类工作。Lease expiry 使用记录的 attempt fence 调用 `expireTaskAttempt()`；TTL-bound channel delivery 会在 task selection 前为每条 attached channel 使用一条准确 scheduler-channel proof，其中携带该 drive 的 `scanNow`、两条 cursor 与剩余 bound。两条路径都不会伪造 owner outcome。

由 `TeamWorkflowPlan` 编译出的 task 在 plan 处于 `compiling` 时保持 dormant；进入 `ready` 后，scheduler 会将其中 assigned/running lease 限制在 plan 的 `maxParallelism`，并由 Team provider 强制 `maxTotalAttempts`。没有当前 `ready` projection 的 plan task 不会被当作不可分配工作。

可选的 `pulseIntervalMs` 会安装有界的 recurring discovery pulse，用于发现 lease expiry 与 retention；省略它则由 Team event 或外部显式 drive 触发。Retention 是 opt-in：同时配置 `terminalChannelRetentionTail` 与 `maxCompactionsPerDrive` 后，每次 drive 会检查 terminal Team 与 channel，并调用 Hub 提供的、受 checkpoint、audit 和 pending-delivery gate 保护的 compaction command，保留配置数量的 source tail。pending delivery 或 policy denial 会让 channel 留到后续 drive。其已接收的 `assignment` Envelope 是持久 owner notification，而非直接 Agent wake：scheduler 不会写入 Agent inbox、启动 attempt、对 lease heartbeat 或结算 task work。独立的 task Agent Consumer 会在启动受 owner fence 保护的 attempt 并唤醒 Agent 前，声明准确的 delivery。

每项终态 Team-journal 或 channel-WAL compaction 都包在一次性 scheduler maintenance proof 内，并绑定准确 cursor 和 `throughSequence`。Hub call 结束后 proof 即被撤销，因此 scheduler 拥有的合格 prefix 不会被扩大或重放为通用 maintenance capability。

每次 retention drive 先遍历终态 channel，并根据其 `firstCursor` 跳过已移除的前缀。Compaction 预算仍有余额时，再压缩 completed、failed 或 cancelled Team 的 journal。这样每轮只允许一个 command 时，也能依次推进各 channel，再处理 journal。Team 仍为 active、stalled 或 quiescing 时，已关闭的 channel 仍可回收；这些 Team journal 不属于终态 retention 候选。

查找 review channel 时，除了 task 和参与者，还匹配专用 review request 的 completed attempt id。返工任务的下一次 completed attempt 因此会收到新的 consult request，旧 request、response 和 decision 仍保留在历史中。

达到冻结的 input/output/total token、turn、cost 或 wall-time 额度后，scheduler 会停止新调度。Typed count 与 time ceiling 允许零，typed cost ceiling 允许非负小数；对应的正整数部署限额仍然生效，两者取较小的有效值。

Concurrency 是 assignment capacity：检查前仍会处理 expiry、wake repair 与 review。正 `maxConcurrency` 已满时，已接纳工作继续保持 active，并重置此前 unassignable-work 的观察计数。零 capacity 会对 ready pending work 给出明确 stall，而空 Team 仍为 active。Hub 也会在接纳每个新 lease 前独立检查 capacity。

Task 的首次 attempt 不消耗 retry 额度。Typed `maxRetries` 与冻结的 `maxRetriesPerTeam` 只限制后续 attempt，按所有保留 task 的 `sum(max(0, attemptCount - 1))` 计数。选择时跳过无额度的 retry，并继续尝试后面的首次 attempt。最后一次已接纳的 retry 仍可完成；只有 leased/review work 已不存在、且剩余 scheduler-ready task 全是无额度的 retry 时，才记录 `TEAM_RETRIES_BUDGET_EXCEEDED`。其他未成功选出 assignment 的路径继续使用既有 stalled diagnosis。

## 配置

`channelPageSize`限制 scheduler 在 review 或 task-assignment channel recovery 中每次读取的 page 大小，默认为 `128`。

除 opt-in flag 外，configuration field 都是必填项。`leaseDurationMs`是每次 assignment 请求的 duration，且必须被已挂载的 Team provider 接受。`maxAssignmentsPerDrive`、`maxExpirationsPerDrive`、`maxWakeDispatchesPerDrive` 和 `maxConflictsPerDrive`限制一次 drive 中的 assignment、task/channel expiry record、assignment-channel validation 或 publication，以及 compare-and-set conflict retry。`maxActiveAttemptsPerParticipant`限制此 scheduler 为一个 participant 选择的 lease 数量。`permittedWorkspaceModes`列出该 Consumer 可以选择的 task execution mode；始终必须包含 `shared`，而 `worktree`、`sandbox` 和 `remote` 还需要 `allowNonSharedWorkspaceModes: true`。`teamPageSize`限制每个 source page 的 Team discovery work。`stallAfterUnassignableDrives`控制没有 eligible owner 时在多少次 drive 后将 Team 置为 stalled。`terminalChannelRetentionTail`与`maxCompactionsPerDrive`必须成对配置：前者设置每个 terminal Team 或 channel 保留的 record 数量，后者限制每次 drive 的 compaction attempt 数量。`disposalTimeoutMs`限制 plugin unload 前已经接收的 drive 的结算时间。

## 模型体验

### Team DAG 调度

#### 模型所见

本包不注册 prompt section、tool、model input 或 model output。只有独立的 Agent delivery Consumer 将其已声明的持久 `task-assignment` Envelope 准入为已记录的 turn 时，它才会到达模型。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有 model request prefix。

## 已知限制与延后工作

- **provider-owned allocation**——显式启用后可以选择 worktree、sandbox 和 remote mode，但 allocation、artifact provenance 与 integration 仍由 workspace provider 负责。
- **没有直接 Agent wake 或 execution**——独立的 Agent Consumer 会声明持久 assignment channel，然后启动准确的 owner-fenced attempt 并将内容纳入 Agent inbox。
- **coordinator 拥有的 task 准入**——Headless 和 Web 会将此 Consumer 与静态 shared-root provider 及默认 TeamRun coordinator 的 task tool 一起挂载；worker 和普通 Session 都不能启动或等待默认 worker task。
- **没有 final-answer completion policy**——该 Consumer 提出有界的 assignment、review dispatch、lease-expiry 和 stalled command；Hub 负责 usage accounting；TeamRun 或其他产品 policy 负责最终 human-addressed completion。
