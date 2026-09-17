# @clocky/clocky-sdk-client

[English](README.md) | 中文

以子进程方式驱动 Clocky 运行时、走 stdio JSON-RPC 的 TypeScript 客户端 SDK——[Python SDK](../../../python/README.zh.md)（`clocky`）的设计孪生，共享同一个运行时对端、协议与分层：`Clocky` 是高层自有运行 API，`HarnessClient` 是低层协议客户端。包（package）根枚举消费方接口：两层客户端、面向调用方的类型和 `JsonRpcResponseError`；源模块、规范化辅助函数与订阅投递机制不供消费方导入。纯库：不在任何 Cordis 上下文注册；它所 spawn 的运行时进程是一个完整 harness，其组成由自己的 `cordis.yml` 决定。

与 Python SDK 不同，启动规格完全显式（`command`/`args`）：本包面向仓库近旁的 TypeScript 消费方，包括 [`clocky-subagent-clocky-sdk`](../../compat/subagent-clocky-sdk/README.zh.md) 后端和自动化；它们知道自己要启动哪个运行时。捆绑运行时解析（寻找打包可执行文件）仍归 Python 发行版负责。


`Clocky` 与 `HarnessClient` 提供 `inboxRead({ afterCursor?, limit? })`、`inboxWatch(...)` 和 `inboxAcknowledge({ throughCursor })`。这些方法选择初始化时已认证 principal 的持久 final inbox，不接受 caller identity。读取省略 cursor 时从共享 display position 继续；display acknowledgement 永不创建 channel receipt。[Inbox Consumer](../../team/team-human-client/README.zh.md) 拥有持久化、权限、限制与当前缺口。

Team-list continuation 是 opaque string，`-1` 表示新扫描。`scanned` 表示 discovery 工作量；即使 `items` 为空，也应根据 `nextCursor` 继续。遇到 `TEAM_DISCOVERY_CURSOR_EXPIRED` 时开启新扫描。Member、task 和 channel cursor 仍为数值。

## Clocky

```ts
import { Clocky } from '@clocky/clocky-sdk-client'

await using harness = new Clocky({
  launch: { command: 'node', args: ['lib/bin.js', 'cordis.yml'] },
  credential: 'product-credential',
  provider: 'test-provider',
  model: 'test-model',
  maxTokens: 49_152,
})
const result = await harness.run('say hi')
console.log(result.finalResponse)
```

子进程在首次使用时惰性启动，并在多次 `run()` 之间持续归实例所有；必须 `close()`（或 `await using`），子进程才总能被回收。`credential` 是只在 `initialize` 期间发送的不透明产品凭据；客户端会从子进程环境移除它，拒绝它出现在启动 command/arguments 中，并在客户端错误中脱敏。`start()` 记忆化 `initialize` 握手（工作区 cwd——在通过协议传输之前解析为绝对路径——加 provider/model 路由和可选的正整数 `maxTokens` 输出上限）；握手失败会回收运行时并换入全新客户端，后续调用用新子进程重试（直到终结性的 `close()`）。该上限作用于每个 Team coordinator 请求；压缩（compaction）插件单独持有摘要上限。`createTeam(input, { objective? })`返回带 Hub 铸造的 `id`、coordinator transcript id、`waitForFinal()` 与 `cancel()` 的 `HarnessTeam`。这些方法只在 spawn 的 runtime 仍持有该 TeamRun 时可用。任一终态操作结算后，`HarnessTeam.archive()`会将观察到的 cursor 绑定到 authenticated human 的`close`authority；同一 authenticated owner 可通过`HarnessClient.archiveTeam()`归档 terminal、detached 或 restarted Team。`HarnessTeam.resume()`以及通用 member/channel/goal/task mutation helper 都使用连接的 authenticated human proof，wire 上不携带 actor 或 proof。

`run(input, { objective?, onNotification? })`创建一个 Team、接纳初始 human Envelope，并等待其显式 final result。它返回 `RunResult { teamId, finalResponse, final, events, notifications }`；`final`包含 final channel 与 Envelope id，`finalResponse`就是该面向 human 的 final text。`events`与`notifications`都只包含 coordinator Session，且按协议传输顺序排列。提示词文本默认作为 objective；无文本 content 必须提供 `objective`。`resumeTeam(teamId)`会先读取新鲜 Team cursor，再提交经认证且不含 actor 的 resume request；持久 Team id 不是认证。传输丢失、超时、过期 fence 与协议违例也会导致 Promise 被拒绝。

`inspectTeamTask({ teamId, taskId, section: "record" })`读取当前字段及历史计数。选择`"attempts"`或`"reviews"`，传入`afterCursor`、`limit`，并将返回的版本用作`expectedRevision`，即可读取有界历史窗口。响应必须匹配所请求的 Team、任务、分区、版本及窗口；任务变化后需要刷新当前记录。此读取省略私有产物引用，不激活 Agent。

## HarnessClient

`listTeams()`、`listTeamMembers()`、`listTeamTasks()`和 `HarnessTeam.channel()`暴露有界 page field `afterCursor` 与 `limit`；每个 result 都可以带 `nextCursor`。High-level call 会保留 page boundary，因此 caller 可以在不要求 subprocess 返回无界 response 的情况下继续读取大型 Team 或 channel。

可用的 Team inspection 操作包括 list/get、member/channel/task read/watch、quiescence、audit，以及通过 `teamMetrics()` 与 `HarnessTeam.metrics()` 获得的进程内 metrics。只要挂载的 Team provider 支持这些可选 record，Team state read 还会包含持久 pending／settled human action 以及 provider 报告的 token／turn／cost usage。

`HarnessClient.readTeamArtifact()` 和 `HarnessTeam.readArtifact()` 按 durable id 读取一个可见的 provider-backed artifact，并返回准确的 reference、byte count 和 base64 data。Private、ambiguous、没有 provider、缺失和超限 artifact 在该 SDK surface 上仍不可用。

自有运行 API 之下的协议客户端：显式 `start()`/`initialize()`/`createTeam()`/`resumeTeam()`/`waitForTeamFinal()`/`cancelTeam()`/`archiveTeam()`/`request()`/`close()`，外加通知订阅。`createTeam()`在持久 Team 和首个 Envelope 接纳后返回；`waitForTeamFinal()` 与 `cancelTeam()`只作用于当前本地 Team。初始化后，如果运行时组合了`teamHumanActors`，member mutation、channel open/post/close、goal update/transition、task create/update/cancel/delete/review、terminal archive 与 resume 都会使用连接的 authenticated human proof；每个 proof 绑定完整 payload 与观察到的 cursor 或 revision，archive 与 resume 会直接到达 Hub，用于 detached 或 restarted Team。缺少 binder 时以`SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE`拒绝。Team id、cursor、revision 与 participant id 都不能证明 authority。`subscribe(filter?)` 返回 `NotificationSubscription`（可等待的 `next()`、非阻塞 `tryNext()`、异步迭代）。本包导出有明确类型的错误：`JsonRpcResponseError`（协议错误响应，保留 code/data）、`RequestTimeoutError`（配置的时限已到）、`SdkProtocolError`（响应超出文档化协议）、`TransportClosedError`（运行时已消失——消息携带退出码与有界 stderr 尾部）。

`HarnessClient.openActivation({ target, seed })`、`enrollActivationLink({ target, binding, enrollment })`、`getActivationStatus({ target })`、`interruptActivation({ target, cause })` 和 `disposeActivation({ target })` 是底层 remote placement lifecycle。每个 `target` 都携带 `activationId`、`teamId`、`participantId` 与 `sessionId`；每个返回 state 会重复这些 provenance、加入驻留状态和 `statusSequence`。`enrollActivationLink()` 供受信任 placement owner 在持久 binding 提交后使用：它把匹配的带 provider binding 与短期不透明 credential 下发给 child，以启动固定 delivery，不是产品 Team API。在 open 前订阅，把 `activation.status` 通知交给 `parseActivationStatusNotification()`，再按同一 target 和 sequence 用查询校准。helpers 会验证出站帧和每个具名响应；畸形帧以 `SdkProtocolError` 拒绝。`disposeActivation()` 只释放该 remote Agent，运行时进程仍可承载另一 activation 或 Team。

`close()` 先请求协议 `shutdown`（受 `shutdownTimeoutMs` 约束，默认 1000 毫秒），然后走 stdin-EOF → SIGTERM → SIGKILL 阶梯（`disposeEofGraceMs` 默认 6000，`disposeGraceMs` 默认 3000）直到进程真正退出。该阶梯为本客户端私有：它运行在任何 harness 上下文之外，无法搭乘 [`clocky-subprocess`](../../subprocess/README.zh.md) 服务——即该 seam 所记录的 SDK 托管传输例外。`detached` 是陈旧进程 fencer 的 opt-in hosting 控制；普通调用方不设置它，启用它的客户端会回收整个隔离 POSIX 进程组。该操作幂等，已关闭的客户端拒绝复用。

`HarnessClientOptions.env` 给定时整体替换子进程环境（`undefined` 原样继承父进程环境）；凭据策略归调用方——`clocky-subprocess` 的 `scrubbedParentEnv` 是面向隔离启动的共享擦除基底。

## 模型体验

无，因为这是一个客户端进程库；模型运行在 spawn 出的运行时中，其体验由该运行时的 `cordis.yml` 所组合的插件决定。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **无捆绑运行时解析**——调用方显式指定运行时可执行文件；打包可执行文件的发现留在 Python 侧，直到出现 TypeScript 发行版消费方。
- **没有 detached current-run control**——`waitForTeamFinal()`与`cancelTeam()`仍要求 SDK server 保留 TeamRun。resume 与 terminal archive 通过 authenticated human proof 到达 Hub；连接绑定记录在[authenticated product-principal Team control note](../../../.agents/notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)中。
- **没有自动 integration**——workspace provider 拥有显式 publish/integrate authority，绝不会自动 merge 用户更改。
- **没有 AgentRuntime provider 或 Team binding**——这些 helpers 只暴露 lifecycle wire。placement provider 负责进程丢失、status-sequence 校准和持久 Team bind-or-dispose handoff。
- **没有 fork activation seed**——remote activation 接受 fresh 或持久 resume，不传输 Session event history。
- **客户端→服务端通知与服务端→客户端请求**在协议两端都未实现；传输层为未来审批流保留了承载能力。

### 单任务取消

`cancelTeamTask()`和`HarnessTeam.cancelTask()`接收可选原因，返回 durable cancellation 进度。Assigned 或 running 结果仍保留 live work；应观察任务状态直到 cancelled。该操作让 Team 继续处理其他任务。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md).
