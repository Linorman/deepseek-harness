# @clocky/clocky-team-workspace-recovery

[English](README.md) | 中文

`@clocky/clocky-team-workspace-recovery` 是一个显式挂载的 Team Consumer，用于处理 durable 状态仍为 `release-requested` 的 provider-owned allocation。它不会打开或恢复 active workspace。对于每个有界扫描结果，它请求所选 provider 对准确 metadata 执行 reconciliation，随后记录为 `released`；provider 失败则记录带 recovery 原因的 `preserved`。

## 配置

`pageSize` 与 `maxTeamsPerDrive` 都是必填的正整数。`maxPendingTeams` 限制事件队列长度，默认等于 `maxTeamsPerDrive`；队列溢出会请求持久扫描，以 cursor 跨多个有界 drive 推进。`confirmationAttempts` 默认 `3`，`confirmationRetryDelayMs` 默认 `100` 毫秒。Provider 成功释放后，这两个值限制持久确认的重试次数和间隔。耗尽重试后记录带确认失败原因的 preservation；如果 preservation 也无法持久化，恢复会汇总全部失败。`pulseIntervalMs` 可选，用于重复执行有界扫描。 请在 `clocky-team`、`clocky-team-workspace` 以及所有可能参与协调的 provider 之后挂载本 Consumer。

在 Loader 配置中，Consumer 配置项需要声明 `inject: [loader]` 和 `intercept: { loader: { await: true } }`，正式 headless 与 Web profile 均采用此配置。仅依赖 `teamWorkspaces` 只会等待 registry，不会等待 provider 的异步注册。独立 Context 须先 await 每个 provider 的 `ctx.plugin()`，再挂载 recovery。

## 语义

每次 confirmation 或 preservation 都使用短生命周期的 `TeamSystemWorkspaceAllocationProof`。provider 只接收 Team journal 保留的 allocation metadata 与准确 task-attempt identity；filesystem root 和 credential 不会写入 Team journal。无法证明的缺失、dirty 或其他 provider resource 会被 preserved，不会凭猜测重新创建或删除。

即使未配置 pulse，持久的 `release-requested` 事件也会触发合并后的 single-flight drive。每轮遵守已配置的 Team 数量上限，其他分支失败不会跳过已选中的 allocation，所有分支结算后再汇总错误。卸载先停止接纳事件和 timer 工作，等待已接纳的 provider 操作及其持久确认，最后撤销 proof source。
非推进的 Team-list continuation 会让 drive 以 `TEAM_CURSOR_CONFLICT` 失败，而不会重复读取同一 page。

`readAttempts` 默认 `3`，`readRetryDelayMs` 默认 `100` 毫秒。它们独立于 release confirmation 重试暂时失败的 Team 和 Team-page 读取，因此读取失败后无需等待新的 allocation 事件。可识别的持久格式错误、Team 权限错误和文件系统权限错误会立即停止重试；I/O 重试耗尽后会报告全部失败。卸载期间，已接纳的读取重试在撤销 proof 前完成结算。`readRetryDelayMs`、`confirmationRetryDelayMs` 和 `pulseIntervalMs` 不得超过 Node 的 `2147483647` 毫秒 timer 上限。

继续 cleanup 前会记录 provider 确认的 E2B loss。已有持久 release request 且确认终止的 unavailable allocation，在重启后仍可恢复其 release intent 并确认 cleanup。Manifest 缺失或 world 变化若没有终止证明，则保持 unavailable 和 stalled。[Loss settlement](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.zh.md)。

## Model Experience

### Workspace release recovery

#### What the model sees

无。本 Consumer 不会接纳消息，也不会改变 prompt 内容，因此没有 `release-requested` notice 会进入 model request。

#### Token effect

没有直接 token effect。

#### KV Cache effect

本包不会修改 model-request prefix。

## 已知限制与延后工作

- **只处理 release recovery**——本 Consumer 只协调持久的 release 请求。Active/reserved allocation 必须先由 Agent Client 或准确的 closure-owned activation fence 请求释放。
