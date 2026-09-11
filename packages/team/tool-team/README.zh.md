# @clocky/clocky-tool-team

[English](README.md) | 中文

`@clocky/clocky-tool-team`只会在 Session header 命名有效 Team 和 Participant 的 live Agent scope 中安装 Team 工具。`team_task_report`和`team_task_integrate`消费由 [`@clocky/clocky-team-agent-client`](../team-agent-client/README.zh.md) 准入的持久 task-assignment source。所有工具都使用 activation-bound `TeamLink`，绝不接受模型提供的 Team、Participant、activation、Session、revision、recipient 或 next-phase authority。

## Task reporting

`team_task_report(task_id, attempt_id, outcome, summary?, failure_code?, failure_message?, evidence?, artifacts?, changed_paths?, verification?)`接受 `completed`、`failed` 或 `released`。`completed`必须提供 `summary`，并可以携带 evidence statement、changed path、verification text 和 workspace-owned artifact reference；`failed`必须提供 `failure_code` 和 `failure_message`；`released`不接受 outcome-specific text。该工具要求请求的 task/attempt 恰好有一条已持久化的 `team-task-assignment` `user/message` source，要求 source 匹配调用 Agent 的当前 Team/Participant header 和 active activation binding，并要求 task 保留准确的 running lease。有本地 Team authority 时它打开短生命周期的已配置 Link；远程 child 则借用当前固定 Link。两条路径都由 Link 导出 actor fact，再由 Team provider 应用 owner fence 与 `task-mutate` policy。

Hub 保留 task phase authority。只有 task 的 frozen policy 命名 reviewer 时，completed report 才会进入 `review`；`{ kind: 'none' }` policy 会直接完成 task。failed 和 released report 会在 task 达到 `maxAttempts` 前返回 `pending`，之后进入 `failed`。`team_task_report` 本身不 resolve review、不续约 lease、不标记 Team complete，也不路由后续 assignment。只有 durable attempt history 含有完全相同 outcome 时，重复 report 才会成功；不同的已记录 outcome 或已替换的 lease 会被拒绝。

`team_task_heartbeat(task_id, attempt_id)`使用相同 assignment source 和 activation-bound Link 续约准确的 running lease；它返回新的 expiry，但不会改变 task phase 或 attempt identity。

`team_task_review(task_id, decision, reason)`可供准确的 configured reviewer 使用。当前 review-assignment source 提供 revision fence；工具会向 assignment initiator 发送 response，再通过 activation-bound Link resolve 持久 `completed` 或 `pending` transition，并保留 review reason。

`team_message(channel_id, text, delivery, audience?)`通过调用方当前 activation-bound Link 发送显式 text Envelope。Direct v1/v2/v3 channel 默认发送给 peer。Direct v4 调用默认广播，也接受显式 recipient 子集，并将 text 包装为有序 content payload。远程调用通过绑定 Link 读取当前成员获准访问的准确 channel metadata，使用相同的协议 payload 与默认 audience。其他 adapter 应用其 manifest audience 规则。它的 retry key 从 `team_message` call lineage 派生，并且与 `team_final` retry 保持区分。

## Integration tasks

`team_task_integrate(task_id, attempt_id, verification?)`执行当前 assignment 的 integration task。Hub 会从 frozen task 派生 source task 和 completed attempt、workspace provider、target、expected target revision 以及 proposal／integrate mode；模型只能提供 assignment identity 和可选 verification。Provider 接收 source attempt 的 durable artifact manifest，因此 source allocation 可以在 integration 前释放。Provider 会返回 proposal、integrated target version 或 conflict；结果会在 tool 返回前保留到 integration attempt。

## Final answers

`team_final(channel_id, text)`只接受非空 `text`和 active direct v2/v3 product channel 或恰好包含 coordinator/human 的 v4 channel 的 id。本地调用方验证 Team state；远程调用方借用固定 Link。两种情况下 Team provider 都从已认证 binding 和 channel 原子导出 peer 与当前 cursor。

该工具通过 `postDirectFinal()` 提交带有 `{ text }`和`turn` delivery 的 `final` Envelope。其 key 从模型调用谱系派生，因此丢失响应会重放同一 Envelope，而变参会冲突。它返回已接收的 channel 与 Envelope id。

## Configuration

```yaml
- id: tool-team
  name: '@clocky/clocky-tool-team'
  config:
    linkProvider: local
```

`linkProvider`默认值为 `local`，并且必须命名能够认证调用 Agent 当前 activation binding 的 Link provider。

## Model Experience

### Task attempt report

#### What the model sees

位于 scope 内的 [`team_task_report`](../../../docs/tool-catalog.zh.md#team_task_report) schema，以及包含 task id、revision、phase、attempt outcome 和结果是新结算还是已记录的紧凑结果。Reviewer 还会收到包含 attempt result、initiator 和 review revision 的 Team review-assignment input 与 `team_task_review` schema。assignment 本身仍是由 Agent Client 提供并记录的 input。普通 `tool/call` 和 `tool/result` event 会保留请求 outcome 与返回的 task state；本包不新增单独的 Session event。

#### Token effect

每次 report 增加一个 scoped task-report schema 和一个紧凑结果。Team-bound Session 之外的 Agent 不会获得任何 Team tool。

#### KV Cache effect

当此插件保留在 Agent scope 中时，schema 保持稳定。assignment message 和 report result 是动态后缀条目。

### Task integration

#### What the model sees

scope 内的 [`team_task_integrate`](../../../docs/tool-catalog.zh.md#team_task_integrate) schema 只接受 assignment 中的 task id、attempt id 和可选 verification。紧凑结果保留 task phase、integration status、target、可选 target version、conflict path、artifact，以及结果是新结算还是已记录。source task、source attempt、provider、target fence、mode 和 activation authority 都是 durable 或派生 fact，不是模型可选的 argument。

#### Token effect

每次 integration attempt 增加一个 scoped integration schema 和一个紧凑结果。Team-bound Session 之外的 Agent 不会获得 integration tool。

#### KV Cache effect

当插件保留在 Agent scope 中时，integration schema 保持稳定；assignment、provider result 和 verification 是动态后缀条目。

### Task heartbeat

#### What the model sees

scope 内的 `team_task_heartbeat` schema 以及带有续期 attempt expiry 的紧凑 running-task 结果。assignment source 与 activation identity 仍持久化但不会出现在模型参数中。

#### Token effect

每次 renewal 增加一个 heartbeat schema 和紧凑结果。

#### KV Cache effect

当前 task Agent scope 中 heartbeat schema 保持稳定；每次续期结果都是动态后缀。

### Task review and explicit channel message

#### What the model sees

Reviewer Agent 会收到 `team_task_review` schema 和包含 attempt result 的 Team review-assignment input；任意 Team-bound Agent 可在挂载该工具后使用 `team_message`。两者都只返回紧凑 confirmation，并隐藏派生的 activation identity。

#### Token effect

owner Agent scope 增加一个 review schema 和一个 explicit-message schema。

#### KV Cache effect

两个 schema 在 scope 中保持稳定；decision 与 accepted Envelope 是动态后缀。

### Final answer

#### What the model sees

位于 scope 内的 [`team_final`](../../../docs/tool-catalog.zh.md#clockyclocky-tool-team) schema 只接受 `channel_id`和`text`，并返回紧凑的已接收 channel／Envelope 结果。recipient 与 activation fact 不会进入模型可见 arguments。普通 `tool/call` 和 `tool/result` event 会保留请求与确认；已接收的 final 留在 channel WAL 中，本包不会为其创建 Session event。

#### Token effect

每次 final answer 增加一个 scoped schema 和一个紧凑结果。

#### KV Cache effect

当此插件保留在 Agent scope 中时，final-answer schema 保持稳定。其请求与确认是动态后缀条目。

## Known Limitations and Deferred Work

- **artifact 存储仍由 provider 负责**——report 会保留经过校验的 artifact id 和 provenance metadata，但 bytes 以及 publish/integrate 操作属于选定的 workspace/artifact provider。当前 shipped worktree route 消费一个 provenance-bound Git patch artifact；shared、sandbox 和 E2B directory route 消费一个 provenance-bound portable change-set patch artifact；report-only provider 可以定义其他 artifact interpretation。
- **Requires durable assignment delivery** — 未经准入 `team-task-assignment` source 手动启动的 task 不能使用此模型工具。
- **No local final-answer delivery** — `team_final`会追加 final Envelope，而本地 Agent client 会刻意将 final Envelope 排除在 Agent inbox 之外；TeamRun 或 human delivery Consumer 负责 final receipt。
