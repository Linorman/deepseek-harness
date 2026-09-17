# @clocky/clocky-team-human-client

[English](README.md) | 中文

`team-human-client` 拥有持久 principal inbox，不创建 Agent、Activation 或 Session。Hub 从 final 的不可变 human owner 推导 principal，先向 inbox 追加准确的 final 内容，再记录 `principal-inbox` admission 与 channel receipt。Inbox 不可用或写入失败会阻止接纳；重启按同一 Envelope key 重试，不重复投递。System-owned Headless run 保留独立的 `team-run-result` sink。

## 配置与调用

挂载前需要 `teams`、`storageLog` 与 `productPrincipals`。基础限制均须显式提供：`storagePageSize` 限制每次存储读取，`maxPageSize` 限制 API 页，`maxDeliveryBytes` 限制完整序列化投递，`maxPendingOperations` 限制排队操作和 watch，`watchTimeoutMs` 限制长轮询时间，`pollIntervalMs` 控制存储观察间隔。版本为一的 `principal-inbox/` stream 按稳定 principal identity 的 SHA-256 摘要分区，永不保存 credential 或运行时 proof。

可选`retention`开启已读历史的自动迁移，必须提供`tailRecords`、`maxStreamsPerDrive`、`maxRecordsPerDrive`和`maxBytesPerDrive`（每条选定记录的序列化 source/anchor 字节数取较大者）；省略时关闭。单条记录超过配置字节预算会报告 backpressure；只因本批剩余额度不足而未推进的 stream 会在下一轮继续。未读记录和 source 中仍待答复的 action 会保留前缀。每条迁移的投递先索引到不可变的`principal-inbox-admission/<principal digest>/<admission digest>` stream。Index format 2 保存 final 元数据及 JSON 编码正文的 SHA-256；Hub 授权的重试提供正文，摘要匹配后才返回原序号。Message 和 action 保留完整 payload，普通 receipt 恢复仍读取原 rendered view。Version-one anchor 明确拒绝，不迁移。随后再由 checkpoint 记录`indexedThroughCursor`，最后压缩。后续已读确认保留该水位。Final/message receipt 和 action revision 去重先解析这些 anchor，再扫描保留 suffix。

Host 提供 `team.inbox.read`、`team.inbox.watch` 与 `team.inbox.acknowledge`；SDK stdio 使用 `team/inbox-read`、`team/inbox-watch` 与 `team/inbox-acknowledge`。TypeScript `Clocky` 和 `HarnessClient` 提供 `inboxRead`、`inboxWatch` 与 `inboxAcknowledge`；Python 使用对应 snake-case 名称。请求不包含 principal 或 participant identity。每一页重新检查已认证 call、唯一 active human owner、该 human 的 `dispatch` grant 与 dispatch policy。

Read/watch 接受可选的 `afterCursor` 和 `limit`。省略 cursor 时从 principal 共享的持久 `displayCursor` 继续；显式 `-1` 从头读取。`nextCursor` 用于继续有界分页，`cursor` 是最后扫描到的存储位置。Display acknowledgement 通过 `throughCursor` 选择真实投递，只能单调推进并在多个设备之间共享，永不写 channel receipt。因此 Team 完成且 Host 重启之后，尚未显示的 final 仍可读取。读取与确认会重放 checkpoint 后的 display 记录并修复 checkpoint，同时保留 admission-index 水位；已提交确认不会因 append 响应丢失或 checkpoint 写入失败而回退。

Inbox 操作串行执行；保留流程在 inbox stream 之外至多打开一个 admission anchor。Team 可见性检查在该队列外运行，避免 Hub final 追加与 inbox 读取或显示确认相互等待。显示确认在提交前重新核对选定记录，并保留并发推进的较新显示位置。Disposal 关闭接纳、取消长轮询并等待已接纳存储操作完成。

启动 delivery scan 遇到重复或回退的 Team-list cursor 会以 `TEAM_CURSOR_CONFLICT` 失败，而不会重复扫描同一 Team page。

人工操作响应在每个异步 responder（包括 unavailable fallback）返回后重新验证当前 principal；撤权后不再返回操作数据，但不会撤销已提交的回答。

## Model Experience

### Principal final 投递

#### What the model sees

不增加 prompt 或 tool。现有显式 `team_final` Envelope 提供准确的 human-visible text。

#### Token effect

不增加模型 token。

#### KV Cache effect

不修改模型请求前缀。

## Known Limitations and Deferred Work

- 显示保留流程回收 final 正文，但 message/action anchor 仍保留 payload。元数据仍随 admission 数量增长；回收其他 payload 需要 source-owned 引用释放。
- Display checkpoint 本身不释放 replay 或幂等引用。读取早于保留前缀的位置返回`TEAM_INBOX_COMPACTED`与`details.firstCursor`。Host client 收到`team-inbox-compacted`；SDK read/watch 错误通过 JSON-RPC 的`data.code`与`data.firstCursor`返回。显式从`firstCursor - 1`之后读取可查看保留历史。浏览器保留当前页面，直到“查看保留的历史”成功。
- Replay 按固定大小分页、保持有界内存。持久化的 display-cursor checkpoint 让默认 unread read 从已确认的 suffix 继续；显式 history read 仍会扫描保留的 prefix。并发分布式 writer 会收到后端 expected-sequence conflict，必须重试；本 Consumer 只拥有本地队列。
