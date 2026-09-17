# @clocky/clocky-team-closure-driver

[English](README.md) | 中文

`@clocky/clocky-team-closure-driver`是有界、可重启的 Consumer：它发现具有持久 closure 或 cancellation 工作的非终态 Team，并为每个 Team 串行执行一次由 Core proof 绑定的恢复 pass。它不拥有 Team mutation policy，也不选择 final result。

## 配置

`backend`指定配对的 Hub bridge；`maxTeamsPerDrive`、`pageSize`、`disposalTimeoutMs`和`observerRetryAttempts`是正数部署选择。`pulseIntervalMs`可选，在启动后重复有界 discovery。必须在本 Consumer 之前挂载`/registry` service entry与`/hub` bridge；`inject`会强制该屏障，缺失或 retired backend 会以`TEAM_CLOSURE_DRIVE_BACKEND_UNAVAILABLE`失败。 重复或回退的 Team-list continuation 会让 discovery pass 以 `TEAM_CURSOR_CONFLICT` 失败，而不会保留同一 cursor 再次扫描。

## Backend 协议

`TeamClosureDriveBackend.drive()`会收到 detached Team state、已合并的 trigger、abort signal 和 Core 的`TeamSystemClosureDriverProof`。Driver 会从已经持久化的 completion、failure 或 cancellation fact，或 owner 提交的 current turn／budget observation 派生准确 scope 并注册到`ctx.teams`；Hub bridge 将其转交给`continueTeamClosure()`，后者会在 serializer 中重新验证 intent 和 resource fence。Pending receipt 的 completion intent 会保持在 quiescing，直到 final human receipt 持久化。dispose 时，已接纳 pass 的 proof 会一直有效到该 pass 结算。

并发的 `start()` 调用会等待同一次初始恢复扫描。Driver 在入队前复制 turn 和 budget observation，合并重复项，并在报告 pass 失败前结算所有排队的 observation。Dispose 会拒绝尚未进入 backend pass 的 observer，关闭新接纳入口，让 proof 保留到已接纳的 backend 工作结算，并在 cleanup 失败时仍移除公开的 driver。

Hub bridge 依赖 activation controller。对已经接纳的 closure 或 cancellation intent，它先通过 `teamActivations.recoverClosure()`委派一次精确 epoch 的资源恢复。若该动作推进了 Team cursor，本次 pass 结束，让下一次 drive 获取新 proof；否则 Hub 使用原 cursor 继续生命周期结算。Team event 会继续驱动已接纳的 TeamRun completion，无需等待轮询 pulse。当前 turn／budget observation 直接进入 Hub，在 intent 存在之前不能授权资源恢复。

Budget scan 与 Hub 重新校验采用同一个更紧的 typed／deployment 上限及原因。达到上限即将 Team 置为 stalled；typed token／turn／cost 零上限与小数 cost unit 保持 schema 定义的含义。Deployment 计数及 cost 上限仍必须为正整数。Retry 计数及已占用的 concurrency slot 不会把已经接纳的 attempt 变为全 Team budget stall。

## Model Experience

### Closure recovery

#### What the model sees

无；`TeamClosureDriver` 不会接纳消息，也不会改变 prompt content。

#### Token effect

零直接 token effect。

#### KV Cache effect

本包不会修改 model-request prefix。

## 已知限制与延后工作

- **需要 Hub bridge**——driver 故意没有 fallback closure command；配对的`/hub` entry 是已挂载 Team provider scoped recovery API 的正式 bridge。
