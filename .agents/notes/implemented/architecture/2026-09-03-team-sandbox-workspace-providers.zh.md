# Agent Note：隔离的 Team sandbox workspace provider

Status: implemented

[English](2026-09-03-team-sandbox-workspace-providers.md) | 中文

## 问题

Team workspace vocabulary 已经允许 `sandbox` 和 `remote` task mode，但只有 shared-root 与 detached-worktree provider 能 materialize execution root。因此 scheduler 可能选择一个 task Agent 无法消费的 mode，而 workflow compilation 也没有按 mode 检查 provider。

## 决策

`@clocky/clocky-team-workspace-sandbox` 注册本地 `sandbox` provider。它只有在 Team allocation reservation 之后才会在显式配置的 allocation parent 下创建确定性 root，可选地从 canonical source directory 初始化；它在 model-facing root 外保存 manifest，在 restore 与 release 时验证该 manifest，并返回排序后的 changed file 以及有界的可选 artifact。显式配置 integration target root 与 artifact provider 后，它还会生成和消费带 provenance 的 portable patch change set，并使用 expected content-version fence 与 provider-owned recovery marker；如果 process 在已有 target 移入 provider-owned backup 后停止，retry 会先恢复 backup，再重新应用 change set。provider 拥有 root cleanup，但不声明 distributed filesystem lock 或 Git integration authority。

`@clocky/clocky-team-workspace-e2b` 基于 `ctx.e2b` 拥有的 E2B execution world 注册 opt-in `remote` provider。它会在 containment 检查前规范化配置的 POSIX root，拒绝 NUL byte、越出 E2B runtime 的 traversal 以及 workspace 与 integration state 重叠；然后在 reservation 之后创建隔离的 remote allocation 与 manifest path，在 restore 或 release 前验证准确 metadata，并在可用时通过配置的 Team artifact provider 发布有界 remote file。显式启用后，它会在 expected content-version 检查通过后将自己的 portable patch change set 应用到 E2B target directory，对有界 target file 做 hash，并为更大的 target file 纳入 `modifiedTime`，在 remote mutation 前写入 `prepared` marker 并记录 target root 是否由 provider 创建，且只在所有 write 完成后记录 integrated target version；只有未变化且仍匹配 prepared expected version 的 target（包括 provider 创建但尚为空的原始 missing root）才允许 retry，其他变化都会保持 conflict。E2B sandbox 仍是 runtime resource；新的 E2B process 无法恢复已经过期的 sandbox。

Team Agent Client 已经会在准确的 activation-owned Agent workspace lease 上发布每个 provider root。TeamRun workflow compilation 现在只有在显式挂载对应 provider 时才接受非 shared workspace mode；shared plan 保留现有本地 test 与 product composition 行为。source integration 仍是显式 provider-specific 能力，不会从 sandbox root 推断。

`@clocky/clocky-team-workspace-shared` 现在也支持相同的 portable source-integration boundary，但必须显式 opt-in。它会为 live shared allocation snapshot 有界 source baseline，通过配置的 artifact provider 发布 file 与 patch reference，并且只有在 policy authorization、expected content-version fence、staged replacement 与 retry marker 通过后，才将 patch 应用到独立 target directory；target 被移除后的 retry 会先恢复 provider-owned backup，再重新应用 patch。它绝不会加锁或改写 shared source checkout。

三个 provider 都会将同一个 preparation 的并发 materialize call 合并为一个 allocation handle，因此 asynchronous allocation race 不会为同一个 task attempt 发布多个 provider-owned resource。

Shared release 只有在 sidecar cleanup 成功后才会删除 provider-owned baseline；cleanup error 会保留 allocation 与 recovery evidence，供后续 retry 使用。

带 key 的 E2B workflow 现在会用真实 remote allocation、bounded publication 和 provider-owned target-directory integration 走通一遍。带 key 的 remote cancellation 以及 sandbox 过期后的 restart evidence 仍是外部后续工作。

准确 E2B world loss、task settlement 和已保存的部分 artifact 由[workspace loss 决策](2026-09-08-e2b-workspace-loss-settlement.zh.md)拥有。

## 考虑过的替代方案

**把 `sandbox` 当作另一个 shared root。** 未采纳，因为 sandbox task 需要由 provider 拥有的 root，其 cleanup 与 visibility 不依赖调用方的 Session cwd。

**把任意 path 当作恢复后的 remote allocation。** 未采纳，因为 remote path 是 execution-world resource；provider manifest 必须在 restart 或 release 触碰它之前证明准确的 allocation identity。

**为每种 workspace provider 加入通用 target mutation algorithm。** 未采纳，因为非 Git sandbox 与 remote target 没有共同的 physical replacement 或 distributed compare-and-set 语义。共享的 portable change-set encoding 消除了 artifact shape 重复，但每个 provider 仍拥有自己的 target authority 与 failure boundary。

## 后果

本地 sandbox task 可以消费隔离 root 并发布有界 file evidence，而不影响主 checkout。显式配置的本地 target directory 可以在 policy 与 expected-version fence 通过后接收该 provider 的 portable change set；该 operation 只在一个 provider process 内串行，不声明 distributed lock 或 Git branch merge。Shared-root task 也可以使用相同的 artifact-sourced target-directory boundary，而不改写 source checkout，同时保留 shared provider 的 no-lock 语义。E2B task 可以消费独立 remote root，同时复用已挂载的 E2B process 与 filesystem adapter；只要 sandbox 仍存活，也可以将有界 portable file 应用到显式 remote target。没有 provider 的非 shared workflow plan 会在持久 workflow task/channel 创建前失败；带 key 的 remote cancellation 与 sandbox 过期后的 restart 仍是明确的后续工作。

## 验证

- portable change-set test 覆盖 canonical round trip，以及 unsafe path、duplicate path、invalid provenance 和 oversized file byte rejection。
- local sandbox provider test 覆盖 source seeding、准确 metadata restore、changed-file publication、provider-backed 与 provider-local artifact、包含 symlink change 和 no-change report 的 patch publication、existing-root reuse、reconciliation、large-file bound、target-directory integration、expected-version conflict、prepared-marker backup recovery、retry recovery、policy/stale/tampered-root rejection、release、invalid configuration 以及 root-overlap configuration failure。
- E2B provider test 使用 fake remote filesystem 覆盖 normalized-root containment 与 overlap rejection、invalid configuration、allocation、有界 publication、provider-local fallback artifact、patch publication、target-directory integration（包括同尺寸 large-file change 导致的 expected-version conflict）、首次 write 中断后的 prepared-marker retry recognition、concurrent materialization、重复 abandonment、provider-owned reconciliation、restore、release、sandbox unavailable failure、disabled integration、policy denial、malformed source patch、unsafe target、non-directory/symlink/non-file target entry、tampered manifest 与 forged allocation。
- shared provider test 覆盖 opt-in baseline 与 patch publication、report-only fallback artifact 与 non-file entry、ownership fencing、prepared-marker backup recovery、proposal/integration policy、独立 target-directory application、expected-version conflict、retry recognition、restart baseline restore，以及 configuration overlap 或 missing-dependency rejection；同一 suite 也继续覆盖默认 report-only behavior。
- shared、sandbox 与 E2B provider test 都断言 concurrent materialization 返回同一个准确的 allocation handle。
- shared provider test 断言 baseline-sidecar cleanup 失败不会丢弃 recovery state，后续 release retry 可以成功。
- TeamRun test 覆盖只有在挂载 `sandbox` provider 时才编译 `sandbox` workflow task；现有 shared workflow compile test 仍通过。
- 带 key 的 E2B workflow 会用真实 sandbox 执行 allocation、bounded publication 和 target-directory integration；无 key 的 provider suite 仍负责确定性的 failure-path coverage。
