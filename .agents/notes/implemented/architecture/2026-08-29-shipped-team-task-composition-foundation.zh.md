# Agent Note: Shipped Team task composition foundation

Status: implemented

[English](2026-08-29-shipped-team-task-composition-foundation.md) | 中文

## Problem

本地 Team task protocol、shared workspace provider 和确定性 scheduler 位于 shipped Headless 与 Web 组合之外。后续 task producer 可能因此新增私有 child-Agent 路径，或选择 ambient working directory，而不是经过持久 assignment delivery。

## Decision

`clocky-headless`和 `clocky-web-app`会将 `clocky-team-workspace`、`clocky-team-workspace-shared`、`clocky-team-channel-task-assignment`和 `clocky-team-scheduler-dag`与本地 Team Hub、Link、Agent Client 及 Team-run 行一起挂载。

两个 shared workspace 行都将 `process.cwd()`传给 `shared-local`。provider 通过 `fs.realpath`解析该目录；已分配的 local Agent 若其持久 Session header 记录另一 `cwd`，则不合格，allocation 会拒绝而不改变任一路径。

scheduler 记录一小时 lease、每次 drive 一个 assignment、expiry 和 wake repair、四次 conflict reread、每个 Participant 一个 active attempt、仅 `shared` work 以及五秒 disposal bound。bundle 的 `team-run` 行选择 `workerPreset: minimal` 与 `reviewerPreset: minimal`，随后挂载 `tool-team-task`。Headless 使用 `standard`作为 roster default 挂载 `agent-presets`，随后 profile boot 提供 shipped root；coordinator 不命名 preset，保持 base composition。task tool 只会为准确、live 的默认 coordinator 注册，TeamRun 会为其已接收的 task 激活 worker，带 mutation scope 的 task 通过惰性 reviewer 路由。发生并发 Team cursor advance 时，TeamRun 会对整个 worker/reviewer activation 与 task-create sequence 重试，次数受配置的 receipt retry count 限制。Agent Client 消费选中的 workspace allocation，将其 root 与 pre-disposal settler 保留在由准确 Agent 键控的进程内 registry 中，task report 在 settlement 前发布 provider-owned changed paths/artifacts。base 与 shipped `standard`、`code` 和 `cordis` preset 不包含 direct subagent、legacy script-workflow 或 Ralph 工具；shipped Team workflow-plan tool 仍由 `tool-team-task` 拥有，显式自定义组合可连同其提供方挂载 legacy package。

## Alternatives considered

**只在第一个 model tool 到位时挂载 task feature。** 拒绝，因为默认产品组合必须在 tool 使用前提供持久 assignment path，而只在 tool 中后加挂载会掩盖组合失败。

**使用一个 Agent Session cwd 作为 shared root。** 拒绝，因为 Session header 不是 provider 持有的 execution-root identity。shared provider 必须保留一个 canonical configured root，并拒绝不匹配的 Session。

**为 worker 选择 roster default。** 拒绝，因为即使 coordinator 命名其他 preset，worker 也必须保留不含 delegation 的 composition。`workerPreset`会显式选择 `minimal`。

## Consequences

Headless 与 Web 通过其 bundle manifest 验证相同的 task protocol 行、scheduler configuration、minimal worker/reviewer preset、allocation consumption 和 report-only workspace publish。两者都会禁用 base 的同 Session Goal domain、driver、command 和 tool；Web 只会在 Team coordinator scope 中挂载 `command-team-goal`。既有 shared-workspace provider 测试保持 exact-cwd refusal 和 allocation rejection contract。provider-specific integration、自动或多主机恢复和 hard cancellation 不属于当前本地组合。[compiled Team workflow-plan decision](2026-08-31-compiled-team-workflow-plan-consumer.zh.md)拥有新的声明式 workflow path；[native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍负责剩余的 distributed execution 和 release evidence。

Coordinator 可以通过作用域内的 `team_message` tool 回答 non-final channel turn；该 completed turn 之后，TeamRun 会保持 Team active，等待后续 input 或显式 final Envelope。若 completed turn 没有成功的 Team message，仍按 missing-final lifecycle 处理。
