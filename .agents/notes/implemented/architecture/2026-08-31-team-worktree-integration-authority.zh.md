# Agent Note: Team worktree integration authority

状态：已实现

[English](2026-08-31-team-worktree-integration-authority.md) | 中文

## 问题

Detached Team worktree provider 可以报告 changed path 并生成可审阅 patch，但没有已配置的 authority 能安全地将已接受的变更集应用到 target branch。若把 `publish()` 当作隐式 merge，就可能破坏用户的 dirty worktree、与并发 branch 更新竞态，并混淆 policy approval 与 observation。

## 决策

`team-workspace-worktree` 暴露显式的 `integrationEnabled` 配置和 commit author identity。`integrate({ mode: 'integrate' })` 首先执行 `workspace-integrate` policy waterfall，解析 local branch target，并可检查调用方提供的 `expectedTarget` commit。它通过隔离的 `GIT_INDEX_FILE` 创建临时 source commit，从 target commit 创建 provider-owned detached integration worktree，执行 no-ff merge，再用 Git 的 expected-old-value compare-and-set 更新 `refs/heads/<target>`。

只有在 target ref 更新成功后，操作才返回 `status: 'integrated'`，并将最终 target commit 作为 `targetVersion` 返回。Merge conflict 会在中止临时 merge 后返回 `status: 'conflict'`、`accepted: false` 和未合并路径。任何 worktree 已 checkout 的 target branch 都会被拒绝，因为更新它会使用户 checkout 变旧。临时 index、source commit 和 integration worktree 都通过 provider 的 bounded subprocess 及 aggregate-cleanup 规则清理。Integration 操作绝不会 stage 或 commit task allocation，也不会改写用户 main checkout。

Proposal 与 conflict result 不会携带 `targetVersion`；只有 `integrated` 才证明 target ref 已推进到新的 revision。

Team task contract 会保留一条显式 integration task，记录已完成的 source attempt、provider、target、expected target revision 以及 proposal 或 merge mode。Hub 会在 task creation 时校验 source 与 target fence，并在 task settlement 时校验 provider result。`executeTeamIntegrationTask()`获取 completed source 的 artifact manifest，调用指定 workspace provider，并通过当前 activation-owned task lease settlement result。`team_task_integrate` tool 以及 local/WebSocket Link operation 只暴露 task/attempt fence 和可选 verification；source、provider、target 与 mode 都是 durable task fact。Worktree provider 通过 `integrateSource()`接收 source patch，因此 integration 不要求 source allocation 继续 live；patch 以 allocation base 为比较基准，包含已提交 change、deletion 和 untracked addition，同时不对 source index 执行 staging。

Host RPC 与 TypeScript SDK 的 task-create payload 会保留相同的 integration specification，fixture 也会在 carrier 中保留它。这些 product write 在 authenticated Team actor 可用前仍会 fail closed；共享 wire contract 不会静默丢弃已授权的 integration request。

`integrationEnabled` 默认是 `false`；未启用时仍可使用 proposal mode。Provider 从不 push、force-update ref 或改写 Team task state。调用方仍决定何时清理 source allocation 并在 integration 后释放它。

## 备选方案

**直接在 task worktree 中 merge。** 不采用，因为这会改写 task-owned checkout，使 release cleanup 依赖 merge 状态，并混淆 source execution 与 integration authority。

**直接把 patch 应用到用户 main checkout。** 不采用，因为 checkout 可能含有无关 dirty work，也没有持久 target revision fence。

**不带 expected old commit 更新 target branch。** 不采用，因为并发 writer 可能被静默覆盖。即使调用方省略 `expectedTarget`，Git 的 expected-old-value ref update 仍是最终 compare-and-set 边界。

**在 task worktree 中使用临时 index。** 不采用，因为 source Agent 的 index 是 provider-owned state，必须保持不变；隔离 index 可以在不 stage live allocation 的情况下捕获 tracked 和 untracked change。

## 影响

部署可以选择一条具体且可审计的 integration 路径，同时保留安全的 report-only 默认行为。Branch race 与 merge conflict 会成为显式结果，target 变更在 ref 边界原子完成。Integration 会使用配置的 author identity 创建 commit，因此需要 policy decision，并需要为生成的 history 保留运维策略。Remote push、人类评审 UI 和跨主机 authority 协调仍由调用方负责。

## 验证

- Worktree provider 测试覆盖 detached integration 成功、target-version provenance、expected-target mismatch、同文件 merge conflict、policy-disabled integration、dirty source 保留、source/target checkout 安全性，以及包含 tracked、deleted 和 untracked path 的 artifact-sourced integration。
- Team Hub 测试覆盖 durable integration-task source/result fence、mismatched result rejection 和 JSON restart reconstruction。
- Workspace executor 与 tool composition 测试覆盖 provider delegation、幂等 settlement、本地 task assignment 和面向模型的 integration result。
- WebSocket Hub 测试通过 proof-derived workspace authority 和 durable settlement 覆盖真实远程 `task-start` 与 `task-integrate` dispatch。
- `pnpm exec vitest run packages/team/team-workspace-worktree/tests/provider.spec.ts` 通过。
- Hub、schema 与 worktree integration focused test、host typecheck 以及完整 Vitest suite 均通过。
