# @clocky/clocky-team-human-client

[English](README.md) | 中文

`team-human-client` 拥有持久 principal inbox，不创建 Agent、Activation 或 Session。Hub 从 final 的不可变 human owner 推导 principal，先向 inbox 追加准确的 final 内容，再记录 `principal-inbox` admission 与 channel receipt。Inbox 不可用或写入失败会阻止接纳；重启按同一 Envelope key 重试，不重复投递。System-owned Headless run 保留独立的 `team-run-result` sink。

## 配置与调用

挂载前需要 `teams`、`storageLog` 与 `productPrincipals`。所有限制均须显式提供：`storagePageSize` 限制每次存储读取，`maxPageSize` 限制 API 页，`maxDeliveryBytes` 限制完整序列化投递，`maxPendingOperations` 限制排队操作和 watch，`watchTimeoutMs` 限制长轮询时间，`pollIntervalMs` 控制存储观察间隔。版本为一的 `principal-inbox/` stream 按稳定 principal identity 的 SHA-256 摘要分区，永不保存 credential 或运行时 proof。

Host 提供 `team.inbox.read`、`team.inbox.watch` 与 `team.inbox.acknowledge`；SDK stdio 使用 `team/inbox-read`、`team/inbox-watch` 与 `team/inbox-acknowledge`。TypeScript `Clocky` 和 `HarnessClient` 提供 `inboxRead`、`inboxWatch` 与 `inboxAcknowledge`；Python 使用对应 snake-case 名称。请求不包含 principal 或 participant identity。每一页重新检查已认证 call、唯一 active human owner、该 human 的 `dispatch` grant 与 dispatch policy。

Read/watch 接受可选的 `afterCursor` 和 `limit`。省略 cursor 时从 principal 共享的持久 `displayCursor` 继续；显式 `-1` 从头读取。`nextCursor` 用于继续有界分页，`cursor` 是最后扫描到的存储位置。Display acknowledgement 通过 `throughCursor` 选择真实投递，只能单调推进并在多个设备之间共享，永不写 channel receipt。因此 Team 完成且 Host 重启之后，尚未显示的 final 仍可读取。

存储追加串行执行，同一时刻只打开一个 stream。Team 可见性检查在该队列外运行，避免 Hub final 追加与 inbox 读取相互等待。Disposal 关闭接纳、取消长轮询并等待已接纳存储操作完成。

启动 delivery scan 遇到重复或回退的 Team-list cursor 会以 `TEAM_CURSOR_CONFLICT` 失败，而不会重复扫描同一 Team page。

## Model Experience

### Principal final 投递

#### What the model sees

不增加 prompt 或 tool。现有显式 `team_final` Envelope 提供准确的 human-visible text。

#### Token effect

不增加模型 token。

#### KV Cache effect

不修改模型请求前缀。

## Known Limitations and Deferred Work

- 当前只投递 final Envelope。普通 human message、approval/question continuation、review request 与 lifecycle notice 需要各自的 admission Consumer。
- Inbox 禁用自动 compaction。调用方只能压缩 durable display checkpoint 已覆盖的前缀；默认 unread read 会从保留 suffix 继续，显式 history 或早于保留前缀的 cursor 会明确失败，不推断 display 历史。
- Replay 按固定大小分页、保持有界内存。持久化的 display-cursor checkpoint 让默认 unread read 从已确认的 suffix 继续；显式 history read 仍会扫描保留的 prefix。并发分布式 writer 会收到后端 expected-sequence conflict，必须重试；本 Consumer 只拥有本地队列。
