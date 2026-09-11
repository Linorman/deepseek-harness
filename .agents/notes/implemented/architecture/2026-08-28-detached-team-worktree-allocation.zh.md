# Agent Note: Detached Team worktree allocation

Status: implemented

[English](2026-08-28-detached-team-worktree-allocation.md) | 中文

## 问题

`worktree` task 需要一个绑定到单个 durable attempt 的隔离 checkout，同时不能从不受信任的 Team identifier 派生路径、把 scheduler scope 当作 filesystem lock，或在 cleanup 时危及用户文件。

shared-root provider 有意不创建 checkout。它拒绝为 shared mode 按 attempt 创建 worktree 的结论仍然有效，而 isolated mode 需要自己的 Git lifecycle 与 release rule。

## 决策

`@clocky/clocky-team-workspace-worktree`会在 `ctx.teamWorkspaces` 上注册一个要求具名的 `worktree` provider。挂载要求显式给出 canonical main-repository root、已有 allocation parent、base ref、Git executable、subprocess grace、command timeout、output bound 和 provider name。它通过 `ctx.subprocess`解析 executable，验证配置 repository 是 Git 的 canonical top-level，并在发布前将 base ref 解析一次为 commit。

`eligible()`会检查 current task revision、active Team、active local-agent Participant、可投递的 exact activation binding、live Session-backed Agent 和两个保留目录，但不会分配 root。`prepare()`重新读取 Team，并要求其 active 且未过期的 lease 与每个 attempt、revision、Participant、activation 和 Session 字段匹配。它会在 `workspace-allocate` policy 接受这些事实后返回不含 root 的 provider metadata。Team Agent Client 会先在 Team journal 中 reserve 该 metadata，随后才调用 `materialize()`；后者会在 Git mutation 前再次验证。

provider 从完整 attempt 与 binding identity 派生安全、确定的 child name，拒绝任何已存在路径，并从 frozen commit 用 direct-argv `git worktree add --detach`创建。它会在 Git 创建 worktree 后重复 exact Team／lease／activation／live-Agent／policy validation，并在第二次检查失败时只移除该 clean provider-created root。Git 只会通过 subprocess seam 执行，prompt 被禁用，环境中的 Git redirection variable 被移除；每个 command 都携带 deadline signal，并在终止后获得新的 grace-bounded drain signal。重复准确的 current allocation 会复用同一个 immutable handle。

`release()`不带 force option 地使用普通 `git worktree remove`。Git 拒绝 removal 时 dirty worktree 保持 allocated，并且同一 handle 会在 caller 解决其内容后重试。按 attempt 的 serialization 使之后的 allocation 等待 in-flight release；它只会在 removal 成功后创建 fresh root，并传播 release failure，而不会返回正在被移除的 root。`restore()`只接受 provider mint 的准确 metadata，验证确定性的 canonical worktree 与 base commit，然后重新打开它。`reconcileRelease()`只派生同一 root：缺失 root 被视为已经清理，否则它会执行普通 Git removal，绝不会 materialize 新 root。provider 从不移除任意路径、commit、merge、push 或改变 Team state。已接受的 handle 会捕获 subprocess capability，因此 provider unregister 会阻止新的 allocation，却不会阻止之后的 release。

## 考虑过的替代方案

**在 worktree path 中使用原始 Team id。** 未采纳，因为 Team identifier 在 service boundary 只是非空字符串；hash-derived child name 避免 traversal、Git option 与 path ownership 的歧义。

**用 `--force` 或 recursive filesystem deletion 移除 dirty worktree。** 未采纳，因为两种操作都可能丢弃 task 或用户尚未 integration 的改动。普通 Git removal 会使未解决的 dirtiness 可见且可重试。

**在 release 时创建 branch、commit task output 或 merge。** 延后，因为 allocation 不会建立 integration authority。后续 integration Consumer 拥有 review、merge proposal、conflict resolution、validation 和用户 authority。

## 后果

`worktree` allocation 可以独立于 shared-work write-scope serialization 运行，但仍绑定于[task-attempt 决策](2026-08-28-durable-task-attempt-leases.zh.md)描述的同一 durable lease fence。[shared workspace 决策](2026-08-28-shared-team-workspace-root.zh.md)保持 active，因为它拥有不同的 same-checkout rule；它没有被 supersede。

Team journal 会保留准确的 provider metadata 与 lifecycle state，但绝不保留 filesystem root。Agent Client 只会依靠这些事实恢复 active 或 reserved allocation，并在恢复成功前保持 Agent scope 不可用。只处理 release 的 `team-workspace-recovery` Consumer 会 reconciliation `release-requested` metadata，随后确认 release 或记录 preservation。崩溃后不存在可据以猜测的独立 root catalog。integration、更广泛的 artifact provenance、changed-path audit、sandbox root 与 remote provider 仍是[原生 Team 提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)中的工作。

## 验证

provider test 会通过 `ctx.subprocess`在项目 `.tmp`下创建真实 Git repository。它们验证不含 root 的 preparation、reserve-before-materialize ordering、canonical mount validation、完整 subprocess-output handling、add 前与 add 后的 Team／lease／activation／Session rejection、policy denial、deterministic idempotence、serialized materialize/release ordering、dirty retryable release、live-map 丢失后的准确 restore/reconciliation、base 与 Git registration fence、有界 oversized-artifact fallback、malformed source patch、target-ref compare-and-set race、existing-path preservation、worktree verification cleanup、command timeout，以及 HMR unregistration 后的 release。Client 与 recovery test 覆盖 reservation、activation、terminal release、preservation、restart reconciliation 和有界 pulse shutdown。当前定向 provider suite 达到 statement 95.07%、branch 92.76%、function 93.47% 和 line 96.01% 覆盖；cleanup injection、内部 concurrency window 与不可能的 filesystem path 仍由 repository coverage gate 显式报告。
