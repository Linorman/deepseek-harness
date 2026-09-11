# @clocky/clocky-team-channel-admission

[English](README.md) | 中文

`@clocky/clocky-team-channel-admission` 提供 `ctx.teamChannelAdmission`。它在启动后发现持久 channel invitation，通过 source-owned Hub proof 让未确认 endpoint 到期，并让 dispatch Consumer 等待实际的 channel activation。它不会替 Agent 确认，也不会把已安装的 adapter 当作 endpoint consent。

## Admission 与恢复

Hub 将每个 channel 打开为 `pending`，并为每名 manifest 成员冻结一条 invitation。Invitation 保留 role、channel-manifest visibility、required/optional 选择、deadline、endpoint expectation、revision 与 manifest fingerprint。每个 required endpoint 都必须持久确认，Hub 才追加 `active`。Optional endpoint 到期不会缩减不可变 manifest。

`waitUntilActive({ channelId, signal })` 观察当前 channel cursor，只返回 active snapshot。Terminal admission 或取消会拒绝等待。TeamRun creation/workflow compilation 与 scheduler wake/review dispatch 都会在发送协议工作前使用它。Service 等待时不持有 Hub 锁，disposal 会中止其等待。重复或回退的 channel watch cursor 会让 wait 以 `TEAM_CHANNEL_CURSOR_CONFLICT` 失败，而不会重复尝试同一 continuation。

Recovery 扫描有界 Team page 和按 FIFO 排列的 channel identity。`scanIntervalMs` 默认为 `100`，`teamPageSize` 为 `64`，`maxChannelsPerPass` 为 `128`。每次 pass 将 `Date.now()` 保留在准确的 source-owned expiry proof 中。`runOnce()` 可显式执行 recovery pass，并加入已运行的 pass。Hub 拥有默认 `30000` 的 `channelInvitationTimeoutMs`，在创建时冻结 deadline。重启会保留这些 deadline 与 acknowledgement。

缺少 required endpoint 时 channel 到期，原因为 `TEAM_CHANNEL_REQUIRED_INVITATION_EXPIRED`。Optional expiry 只有在保留的 adapter 显式允许移除该成员时才能继续，否则 channel 以 `TEAM_CHANNEL_OPTIONAL_REMOVAL_UNSUPPORTED` 进入 failed。Direct v4 在至少保留两名 invitation 成员时允许移除。关闭会先停止 admission，再结束 pending invitation 并写 terminal record。

## Endpoint Consumer

Agent Client 通过 local 或 WebSocket v6 Link 接收准确 invitation，验证当前 binding 与支持的 manifest，再通过 Link 的私有 activation proof 确认。Invitation acknowledgement 不创建模型输入或 Envelope receipt。消息投递仍由既有 claim、Session flush 与 receipt operation 拥有。

`/principal` 导出的 `createPrincipalChannelAdmission(ctx, call)` 为 TeamRun creation 提供仅限运行时的 Host/SDK 能力。它接受受支持的 direct-v3 human/coordinator manifest 和 directed-v1 policy，并使用当前 authenticated principal，将完整 acknowledgement payload 绑定到 human proof。Call 取消会撤销该 proof。TeamRun 检查回调确实持久化了 consent；失败会进入普通 creation cleanup。System-owned human 则由实际 TeamRun result Consumer 独立确认。

`resolvePrincipalChannelText` 保留 consult 发起请求显式提供的 `taskId`；response 继承已保留 request 的 task，并拒绝冲突的路由。带 key 的重试省略 task 时从已保留的 request 恢复，修改 task 则由 Hub 判定幂等冲突。

## 模型体验

### Channel invitation admission

#### 模型所见

没有 invitation prompt 或合成 message。协议消息只有在 `channel activation` 和普通持久投递之后才进入模型。

#### Token 影响

Invitation confirmation 不消耗 model token。

#### KV Cache 影响

Admission 不改变 request prefix。

## 已知限制与延后工作

- **Placement 独立负责**——该 Consumer 不创建缺失的 Agent residency；不可用的 required endpoint 会到达其持久 deadline。
- **产品协议显式选择**——默认 TeamRun 与其 principal endpoint Consumer 使用 direct v3。Generic Host/SDK invitation operation，以及默认 direct-v4/远程 text-tool 切换，仍属于独立的 Consumer 接入工作。
- **Human display 位于下游**——endpoint consent 证明协议 admission 受支持，不表示浏览器 display acknowledgement 或持久 human final inbox receipt。
