# @clocky/clocky-team-agent-client

[English](README.md) | 中文

`@clocky/clocky-team-agent-client`导出 `FixedBindingTeamAgentLinkDelivery`，这是一个为准确 `{ agent, binding }` 配对投递已接收 direct、basic-channel、workflow 和 task-assignment channel Envelope 的消费方。它使用 Team Link、Agent、Session 和 channel protocol；可选的本地 workspace consumption 还会使用 Team 与 workspace registry。`TeamAgentClient`是本地包装层：它将 live Agent 的 Session-header `teamId` 与 `participantId`解析为持久 activation state，然后为该 binding 拥有一个固定投递消费方。该包依赖 `clocky-team`、`clocky-team-link`、channel protocol、Agent、Session 和 LLM 合约，绝不依赖 `team-hub`、AgentLoop 内部实现或 AgentRuntime provider。

每个固定 delivery Consumer 会在普通 delivery 前接收 `onInvitation()`。它检查当前 Agent/binding、准确的 manifest fingerprint、role 和支持的 adapter version，再调用 `acknowledgeChannelInvitation()`。Task-assignment invitation 还须匹配冻结的 activation 和 Session。确认不会创建模型输入或 Envelope receipt。普通 delivery 仍先 claim 已接纳的 intent，并在 receipt 前 flush Session。

## 本地投递

`TeamAgentClient`会先订阅，再扫描已处于 live 状态的 Agent。它会针对每个 Session-header pair 与 `TeamStateSnapshot.activations`同步，只接受该 Session 准确的 `running` 或 `idle` epoch。`starting`、`stopping` 或 `offline` epoch 不会接收 channel 输入。每个已接纳 binding 都会启动 `FixedBindingTeamAgentLinkDelivery`；调用方拥有 binding discovery，而固定消费方拥有 Link connection、notification handling、claim、inbox admission、flush、receipt、soft interrupt、reconnect 和 close。启用 `consumeWorkspace` 后，固定消费方会读取持久 allocation metadata，并观察其准确 binding 的 allocation change。已配置的 Link 拥有 pending-page replay 和 cursor watch。对于 direct v1/v2/v3 单接收者或 v4 子集/广播 `message` Envelope notification，Link 的 `claim()`是最终等待的准入检查，它携带准确的 Team、participant、activation、Session、channel 和 Envelope 身份。`undefined`不会影响本地 inbox。返回的 claim 必须仍与本地 binding、active direct channel、Envelope 和 delivery intent 匹配，client 才会派生确定性的 `team-envelope:<EnvelopeId>` message，并在其上记录 `TeamEnvelopeSource`；source 会保留已接收的 delivery intent，使 Host queue projection 能区分 pending steering 与不唤醒的 Team context。direct v3/v4 会解析有序的 text 与 image-reference block，并在不改变顺序的前提下将它们置于持久 sender prefix 之后。direct v2/v3/v4 的 `final` Envelope 绝不会进入本地 Agent inbox，也不会创建本地 receipt。

对于 consult、discussion、workflow 或 review notification，claim 必须携带由 Hub 渲染的 `team/channel-view`。client 会追加该 required Session event，将稳定派生的 user message 放入受 pre-step persistence barrier 保护的 inbox，并在允许 model step 或确认 Envelope 前完成 flush；它不会重新渲染实时 channel、adapter 或 view policy。缺失或不匹配的 view 会被拒绝。重复 claim 必须匹配已保存的字段值和有序 content；JSON 对象键的顺序不会改变 view。对于 `task-assignment` v1 notification，client 会解析不可变 manifest 和精确的一次 turn Envelope，将 task、assignee、activation 和 Session 与本地 binding 核对，然后通过 Link 调用 `claimTaskAttemptStart()`。Link 会导出调用方 identity，Hub 会在重放 start claim 后返回相同的 running task。只有返回的 task 带有 assigned lease、wake channel 和 started timestamp 时，才会作为确定性的 `team-task-assignment:<EnvelopeId>` message 连同 `TeamTaskAssignmentSource` 进入目标 inbox；task channel 始终使用 `followup`。

该 client 将 `context` 映射到不唤醒的 `inject`、将 `turn` 映射到 `followup`、将 `steer` 映射到 `steer`。direct 和 task source 会安装 Envelope 专用的 `agent/pre-step` barrier，直到 `ctx.sessions.flush()`持久化目标 Session；失败的 flush 会让 receipt 保持 pending。non-direct channel view 的派生 inbox message 使用相同的 persistence barrier。Replay 会复用已保存的 view；若其 claimed input 已进入持久 model step，就不会再次入队；fork seed 不算新 Agent 已消费该输入。成功投递会使用 claim 的 channel cursor 调用 Link 的 `acknowledge()`。task-start 成功后若 Session 或 receipt 失败，仍可重放：持久 pending Envelope 会在被接纳或确认前重试其幂等 start claim。配置启用时，client 会在 start claim 后消费准确 task workspace allocation，将其 root 保留在 Agent-keyed live lease 中，并在 task terminal settlement 后释放。

任务 turn 以 `max-tokens` 结束时，client 最多按 `maxTaskOutputContinuations` 接续同一 running attempt。续跑消息保留 `team-task-assignment` 来源和按 turn 派生的确定性消息 ID。Session inbox 记录用于累计 attempt 预算，delivery 重载后仍有效；重复 turn 通知不额外消耗次数。输入经 pre-step 屏障 flush 后模型才可消费。正常结束但未 report 时，最多提醒 `maxTaskReportReminders` 次，之后以 `TEAM_TASK_REPORT_MISSING` 失败；零表示关闭未报告恢复。模型请求重试耗尽后，以原始 code 和 message 结算仍在运行的准确 attempt。已取消、过期、结算或替换的 attempt 不会被重新唤醒。

对于精确 binding-targeted soft interrupt，client 调用 `Agent.cancel({ kind: 'user' }, { keepInbox: true })`，随后调用 Link 的 `acknowledgeInterrupt()`，而不等待 turn completion。该 interrupt 不会加入 inbox source 或 model-visible input；确认失败会保持 pending，等待 Link replay。

匹配的 durable binding 或 Agent 进入 live 状态时，client 会在接纳 Link notification 前完成连接。可恢复的 connection 或 Link `done` 故障只会在准确 binding 仍为 current 时，于 `reconnectDelayMs` 后重连。Provider 标记为 `retryable: false` 的 `TeamLinkConnectionError` 会暂停重连，直到 provider 重新注册或绑定新的 activation。重放或重复的 Link notification 只有在 Envelope 到达持久 `user/message`、仍存在于 live inbox，或已完成 flush 且正在等待 receipt 时才将其视为已接纳；在 `user/message`前被拒绝的 claimed message 会在 retry 时重新接纳。已 flush 的 source 会 flush 并确认，而不会再次写入 inbox。对于每条准确 current binding，client 会私有保留 activation-proof lease，并且只将 provider 报告的最终 `assistant/message.usage` fact 转发给 `ctx.teams.recordUsage()`；Hub 会重新验证该 binding，并在 budget policy 或持久 accounting 前派生 Team/Participant/Session/timestamp。binding release 或 client close 时会撤销该 lease；Hub 会替换 chunk/final 重复项并执行冻结的 Team budget。未绑定、stopping、offline 或已离开的目标、broadcast、多接收者 draft、unsupported channel protocol 以及没有本地 Agent 的 Link 均不属于这条本地路径。

当远程 WebSocket Hub 发送 cooperative termination request 时，固定 delivery 会调用可选的 `onTerminate` callback；没有自定义 callback 时，它会对准确的 Agent 执行 `keepInbox: true` 的 cancellation 并等待 `whenIdle()`。Hub 主动 retirement 后该 connection 不会安排 reconnect；拥有该 activation 的 AgentRuntime provider 仍负责 dispose Agent/process 并证明 offline termination。

新 assignment 携带最近已结算 attempt 的结果及对应审阅决定，使接手 worker 无需继承另一 worker 的对话即可获取已有证据。`maxTaskHandoffBytes` 限制这段 UTF-8 交接内容（包含明确截断提示），默认 `16384`，最小 `128`。`maxTaskReportReminders` 默认为 `1`。原任务说明及当前 assignment 来源独立于这段有界交接内容。

## 配置

`consumeWorkspace` 默认为 `false`；本地 binding 需要消费持久 task allocation 时启用。Allocation mutation 需要 Team runtime 与 workspace registry。`workspaceMutationMaxAttempts` 默认为 `3`，必须是正安全整数。预留、激活、release intent、preservation 与 release confirmation 只对 `TEAM_CURSOR_CONFLICT` 重试；每次从同一个新 snapshot 读取 Team cursor 与当前 allocation revision，再签发新的精确 proof。预留仍使用已接纳的 task revision 与 attempt。Provider release 和 reconciliation 位于这些重试循环之外；live owner 会保留物理释放成功的事实，直到持久结算，因此后续 confirmation retry 不会再次释放 root。Confirmation 若被 `TeamError` 拒绝，会保持 pending，等待 owner 显式重试，不会触发 provider reconciliation。

`linkProvider`选择 Team Link provider，默认值为 `local`。`reconnectDelayMs`默认为 `100`，限制 current binding 在 Link failure 后 reconnect 前的延迟。`maxTaskOutputContinuations`默认为 `3`，限制 provider 输出达到上限后的自动 task wake。`disposalTimeoutMs`限制此插件 unload 前已接收的本地投递与 Link closure 的结算时间；默认值为 `5000`。unload 会先关闭新的 delivery admission、取消 pending reconnect、停止每个 Link subscription、拒绝 pending pre-step barrier，并保留已由接收投递追加的任何 inbox message。Link 退休后被拒绝的 claim 会保留待重放的 Envelope，不会使 disposal 失败；仍有效的 Link 会继续抛出 claim 错误。Disposal failure 或 timeout 表示关闭尚未完成。只要已接纳工作或 mapped allocation 尚未结算，已关闭的 delivery 就会保留 workspace proof source、Agent lease、unavailable marker，以及拒绝执行的 pre-step listener。Activation-disposal owner 可通过 Core workspace settler 重试；成功释放或明确 preservation，且已接纳工作排空后，这些资源才会一次性撤销。原 close promise 仍保留失败结果。Setup 在关闭后才返回时，会 abandon 尚未预留的 preparation，或结算已预留／materialized allocation，不会发布新的 Agent root。恢复出的 allocation 若无法完成 activation 或 root publication，会先记录持久 release intent 再释放；物理 cleanup 失败时记录 preservation。参见[恢复与结算决策](../../../.agents/notes/implemented/bug-fix/2026-09-05-agent-client-recovery-settlement.zh.md)。

Allocation 可以通过`onLoss()`提供准确的 provider 观察。当前 Agent Client 将 world 与已保存 artifact 记录为`unavailable`，仅停止 task 的准确 turn，并在 attempt settlement 前释放已确认过期的 world。执行状态未经确认时保持 stalled；路径缺失不会变成替代 world。[Loss 所有权](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.zh.md)。

## 模型体验

### Direct 和 task-assignment Envelope 投递

#### 模型可见内容

目标 Agent 收到一条形式为 `Direct message from <ParticipantId>:\n<text>` 的 direct v1/v2 message。direct v3/v4 message 以 text block `Direct message from <ParticipantId>:\n` 开始，随后是其准确且有序的 text 与 durable image-reference block。non-direct 投递会收到由 Hub 渲染的 `team/channel-view` content，其中包含 Team/channel/Envelope provenance 与可能的 review fence。task message 的形式为 `Team task assignment: <subject>\n\n<description>\n\nTask: <TeamTaskId>\nAttempt: <TaskAttemptId>`。Agent Client 会在确认 source Envelope 前 flush 每个模型可见输入，因此 Session history 能重建准确输入。

#### Token 影响

一次 direct 投递会把 sender prefix 与 text 或有序 text/image content 添加到目标 Agent 的下一段 context、turn 或 step。一次 task assignment 会把 subject、description、task id 和 attempt id 添加到目标 Agent 的下一个 turn。

#### KV Cache 影响

该 message 是动态输入，不会修改 Agent 的静态 prompt prefix。

## 已知限制与延期工作

- 该 Consumer 处理投递给本地 Agent 的 direct v1/v2/v3/v4、由 Hub 渲染的 consult/discussion/workflow/review view 和 task-assignment v1；direct v2/v3/v4 `final`需要 TeamRun 或 human delivery Consumer。它不拥有 Team admission、Link authentication、channel adapter、Agent placement 或 pending-page replay。
- 只有其 binding 具有确切本地 Agent 时，远程 Link 才能通知此 Consumer。远程 endpoint、远程 direct delivery 和其他 channel view 需要独立 Consumer。

### 单任务取消

单任务取消只丢弃匹配的排队 assignment 输入。Client 从 Session log 重建 task claim，等待选定 turn 结束、释放其 allocation，再通过 Link 确认。已证明尚未执行的排队输入可独立结束，不依赖其他 running 工作。迟到通知不能中断后续任务。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
