# team/ — 持久 Team 工作系统家族

[English](README.md) | 中文

本家族包含本地 Team 工作系统提供方。Service Definition 仍位于 [`core/team`](../core/team/README.zh.md)，因此提供方可以拥有持久 Team 状态，而不会把 Team 变成 Agent、Session 或实验性 Lead 身份。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`team-hub/`](team-hub/README.zh.md) | 本地权威 Team journal 与 channel WAL 提供方 | `ctx.teams` |
| [`team-workspace-shared/`](team-workspace-shared/README.zh.md) | 带 opt-in portable integration 的本地 canonical shared-root provider | `ctx.teamWorkspaces` provider `shared-local` |
| [`team-workspace-worktree/`](team-workspace-worktree/README.zh.md) | 本地 detached Git-worktree workspace provider | 由配置选择的 `ctx.teamWorkspaces` provider |
| [`team-workspace-sandbox/`](team-workspace-sandbox/README.zh.md) | 本地隔离 sandbox-root workspace provider | `ctx.teamWorkspaces` provider `sandbox-local` |
| [`team-workspace-recovery/`](team-workspace-recovery/README.zh.md) | 有界的 release-requested workspace recovery Consumer | — |
| [`team-artifact-local/`](team-artifact-local/README.zh.md) | 本地 content-addressed Team artifact provider | `ctx.teamArtifacts` provider `local` |
| [`team-link-local/`](team-link-local/README.zh.md) | 带 pending-delivery replay 的本地 activation-bound Link provider | `ctx.teamLinks` provider `local` |
| [`team-link-websocket/`](team-link-websocket/README.zh.md) | 远程 WebSocket activation-bound Link provider | 配置的 `ctx.teamLinks` provider |
| [`team-link-websocket-hub/`](team-link-websocket-hub/README.zh.md) | 已认证 Team Hub WebSocket upgrade endpoint | — |
| [`team-activation-controller/`](team-activation-controller/README.zh.md) | 本地 AgentRuntime-to-durable-activation service | `ctx.teamActivations` |
| [`team-activation-recovery/`](team-activation-recovery/README.zh.md) | 显式同主机 SDK 启动恢复 Consumer | — |
| [`team-channel-admission/`](team-channel-admission/README.zh.md) | 持久邀请 deadline recovery 与 dispatch admission 等待 | `ctx.teamChannelAdmission` |
| [`team-channel-direct/`](team-channel-direct/README.zh.md) | 无状态 direct v1/v2/v3/v4 channel-adapter provider | adapter registry |
| [`team-channel-summary/`](team-channel-summary/README.zh.md) | 显式有界抽取式频道摘要 Consumer | 协调者工具 / 经过认证的 Host API |
| [`team-channel-basic/`](team-channel-basic/README.zh.md) | Consult 与有界 discussion channel-adapter provider | adapter registry |
| [`team-channel-task-assignment/`](team-channel-task-assignment/README.zh.md) | 持久单 assignee task-assignment v1 adapter provider | adapter registry |
| [`team-channel-workflow/`](team-channel-workflow/README.zh.md) | 版本化声明式 workflow channel-adapter provider | adapter registry |
| [`team-delegation/`](team-delegation/README.zh.md) | 有界 shared-workspace child-Team delegation Consumer | `ctx.teams`、`ctx.teamRuns`、`ctx.teamWorkspaces` |
| [`command-team-goal/`](command-team-goal/README.zh.md) | scope 内面向用户的持久 Team-goal 命令 | — |
| [`tool-team/`](tool-team/README.zh.md) | scope 内的 task-attempt report 与显式 final-output tool | — |
| [`tool-team-goal/`](tool-team-goal/README.zh.md) | scope 内的持久 Team-objective read 与 edit tool | — |
| [`tool-team-task/`](tool-team-task/README.zh.md) | scope 内的 coordinator worker pool resize、默认 worker task 与 workflow tool | — |
| [`team-agent-client/`](team-agent-client/README.zh.md) | 本地 direct/task-assignment Envelope-to-Agent-inbox Consumer | — |
| [`team-scheduler-dag/`](team-scheduler-dag/README.zh.md) | 确定性 lease、task-assignment dispatch 与 expiry Consumer | — |
| [`team-run/`](team-run/README.zh.md) | 本地默认 Team topology 与显式 human-result owner | `ctx.teamRuns` |
| [`team-telemetry-otel/`](team-telemetry-otel/README.zh.md) | 显式 OTLP Team telemetry provider 与可配置 threshold alert | `ctx.teamTelemetry` |

`team-workspace-sandbox`会为准确的 attempt 创建 provider-owned 本地 root，可选地从配置的 source directory 初始化，在 recovery 与 release 期间验证外部 allocation manifest，并发布有界 changed-file artifact。显式配置 integration 后，它还会在 expected-version fence 下将 portable change set 应用到本地 target directory。E2B `team-workspace-e2b` 使用一个显式挂载的 E2B execution world，分配隔离的 remote root、发布有界 remote file artifact，并可将自己的 portable change set 应用到存活的显式 remote target；它仍是 opt-in POC，其 sandbox state 不作为跨 process durable store。

`team-hub`与 [`clocky-team`](../core/team/README.zh.md)、[`clocky-storage-log`](../storage/storage-log/README.zh.md)以及选定的日志后端显式挂载，并在同一 journal 中持久化 Team-wide human-action record 与 provider usage aggregate。`team-artifact-local`与 [`clocky-team-artifact`](../core/team-artifact/README.zh.md)挂载，在 owner-only root 下保存经过 hash 校验的 file、patch、log、screenshot 和 report bytes；Team journal 只保留 reference 与 provenance。`team-workspace-shared`与 [`clocky-team-workspace`](../core/team-workspace/README.zh.md)、`clocky-team`和 `clocky-agent`挂载；它只会为准确的 current local-Agent lease 和 Session header 返回 canonical root，并且其可选 artifact/integration 配置会将 portable change-set 发布到独立的 provider-owned target directory。`team-workspace-worktree`会加入 subprocess capability，并且只有在 current lease、local-Agent 和 policy validation 之后才创建 detached Git worktree；其显式 command deadline 与新的 bounded drain 会保护每个 Git lifecycle，已接受的 allocation 保留可重试的 normal Git removal。`team-link-local`与 [`clocky-team-link`](../core/team-link/README.zh.md)和 `clocky-team`挂载，然后通过可取消的本地 watch、有界 handoff、retry 和 binding-derived attempt settlement 重放 pending recipient Envelope。`team-link-websocket`注册远程 provider，而 `team-link-websocket-hub`会根据配置的持久 binding 验证远程 upgrade。`team-activation-controller`会在 `ctx.teamActivations`公开其 bind-or-dispose owner；`team-activation-recovery`是一个单独挂载的同主机启动扫描，它会将选中的 SDK epoch 重新委托给该 owner。`team-channel-direct`、`team-channel-basic`、`team-channel-task-assignment`和`team-channel-workflow`在 Team provider 之后注册；`command-team-goal`会将 `/goal`限定在 Team-bound Agent 中，并从 Session header 派生 actor；`tool-team`会在 Team-bound Agent scope 中注册 task report 和显式 final output；`tool-team-goal`只会为准确的 current TeamRun coordinator 读取并以 activation fence 编辑持久 objective；`tool-team-task`只会为该 coordinator 注册默认 worker task start 与 wait；`team-agent-client`只为匹配的 durable-bound live Agent Session 连接所选 Link，随后拥有 direct/task-assignment inbox admission、delivery-bound task start、usage forwarding 和合格 Link 的 reconnect；`team-scheduler-dag`消费 Team state 以使 lease 过期、附接 task-assignment channel 并提交唯一 assignment Envelope，而不唤醒 Agent；`team-run`拥有本地默认 human/coordinator/worker topology 和 human final-result receipt。`clocky-headless`和 `clocky-web-app`会将本地 Hub 路径与 shared workspace registry、其 `process.cwd()` root provider、task-assignment adapter、有界 scheduler，以及在 `team-run`之后的 `tool-team-goal`和`tool-team-task`一起挂载；Web 还会挂载 `command-team-goal`并禁用 same-Session Goal stack。provider 会 canonicalize 该 root，使 `cwd` 不匹配的 Session 保持不合格，并拒绝 allocation 而不是改写任一路径。其 Team-run 行会为惰性激活的 worker 选择不含 delegation 的 `minimal` preset；Headless 通过 profile 注入的 shipped preset root 解析它，Web 通过已挂载 roster 解析它。scope 内 model tool 只会为准确、live 的 coordinator 注册。

可选的 `team-telemetry-otel` provider 会将 `clocky-team` 的 `TeamTelemetryCoordinator` 与 OpenTelemetry SDK 的 OTLP/HTTP logs pipeline 组合起来。它不在默认产品 bundle 中：deployment 选择 `FULL`、配置 endpoint，并可以配置 rolling alert rule，其 threshold crossing 会变成 `ops` record。Exporter failure 与 alert policy 永远不会成为 Team journal authority。

Team 类型和提供方操作定义于 [docs/subsystems/team.md](../../docs/subsystems/team.zh.md)。[本地 Team Hub 决策](../../.agents/notes/implemented/architecture/2026-08-27-local-team-hub-durable-authority.zh.md)记录所有权和恢复规则。
