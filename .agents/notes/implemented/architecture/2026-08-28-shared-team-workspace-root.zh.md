# Agent Note: Shared Team workspace root allocation

Status: implemented

[English](2026-08-28-shared-team-workspace-root.md) | 中文

## 问题

已分配的 shared-work task 需要一个与本地 Agent Session 一致的具体 execution root，而不能依赖环境 process directory、child directory 或 checkout 的另一种写法。

scheduler 声明的 write scope 会约束 task selection，但不是 filesystem lock，因此 provider 不得把 advisory scheduling fact 表示为独占 filesystem ownership。

## 决策

`@clocky/clocky-team-workspace-shared`在 `ctx.teamWorkspaces` 上注册名为 `shared-local` 的 `shared`-mode provider。其必填 `root`配置是一个 absolute existing directory，在挂载时通过 `fs.realpath`解析；canonical result 在该 provider 生命周期内保持固定。

除非 current active Team projection 保留 candidate task revision 且其为 `shared` mode、其 Participant 是 active `local-agent`、其 exact current activation 可用，并且 live local Agent 的 Session header `cwd`字符串等于配置的 canonical root，否则 `eligible()`返回 false。它既不 canonicalize 也不 rewrite header、不接受 child directory，也不替换为另一个 root。

`prepare()`会重新读取 Team projection，并要求 active unexpired assigned 或 running lease 的 attempt、assignment revision、Participant、activation 和 Session 与请求匹配。它会重新检查 active local Participant、available activation、live Agent 和准确的 header `cwd`，随后调用 Team `workspace-allocate` policy hook。policy denial 仍会产生 `TEAM_POLICY_DENIED`错误。它返回不含 root 的确定性 metadata；Agent Client 会先提交 Team reservation，之后 `materialize()`才返回一个 logical root。`restore()`与 `reconcileRelease()`只接受该准确 metadata。

allocation 独立于 artifact/integration 配置保留有界、不可变的 baseline sidecar。发布与释放会追加 `workspace/observed` 事实，包含完整/部分内容版本、实际扫描窗口和范围分类，不推断写入者。allocation 投影仅保留最新观察，历史通过既有 journal/audit 分页读取。释放删除逻辑条目和 sidecar，保留用户根目录；观察失败不阻止其他资源收尾。

Task report 按实际 Agent 对象和精确 task/attempt/allocation revision 解析 effect-owned publisher。AgentClient 验证已 claim 的 Session turn、running lease、binding 与 root，等待 provider 发布后才结算任务。释放与 disposal 等待该发布完成，包括取消情况。Keyless FS/Shell Loader 与 queued-B 隔离场景验证这些真实路径。

首次挂载会以 owner-only 目录创建外部`observationStateRoot`。Provider 检查每级祖先并拒绝用户控制的 symlink；受保护 filesystem root 之下、root 所有的顶层别名可以解析到规范系统目录。新的 Harness home 因此无需预先创建状态目录，也不会通过仓库控制的重定向写入观察数据。

## 考虑过的替代方案

**Canonicalize 或接受每一种 Session `cwd`写法。** 未采纳，因为 shared allocation 必须证明预配置 execution root 与 Agent durable Session header 是同一 directory identity；静默适配 header 会掩盖放错位置的 Agent。

**根据 `writeScopes`声称 filesystem lock。** 未采纳，因为 scheduler 声明的 scope 只是 selection constraint，无法覆盖 shell command、generator 或其他 external writer。lock claim 会夸大 provider 的 authority。

**为每个 shared allocation 创建 worktree。** 未采纳，因为 isolated checkout creation、base revision、cleanup、integration 和 user dirty-tree handling 属于独立的[detached worktree allocation 决策](2026-08-28-detached-team-worktree-allocation.zh.md)，而非 shared-root provider 的行为。

## 后果

[确定性 Team DAG scheduler 决策](2026-08-28-deterministic-team-dag-scheduler.zh.md)继续 serialize 重叠的 declared shared write scope，而本 provider 只会在 owner validation 后提供具体 root。[持久 Team task attempt lease 决策](2026-08-28-durable-task-attempt-leases.zh.md)仍是 task/lease identity 与 lifecycle 的 authority。

本 provider 不提供 worktree、sandbox 或 remote root，也不拥有 Agent lifecycle。Agent Client 拥有 root exposure 与 fail-closed recovery；provider 返回有界观察路径、可选产物及 `accepted: false`。integration 仍是显式的 provider/policy 操作。

## 验证

provider test 覆盖 root validation 与 canonicalization、exact 和 stale eligibility、每一项 lease/Participant/activation/Session rejection、policy denial、logical idempotence、release 和 deleted-root handling。一个真实 JSON-backed Team Hub 加 live Agent Session 的 composition 验证了 current-lease allocation 与 HMR unregistration，而不会删除 shared root。
