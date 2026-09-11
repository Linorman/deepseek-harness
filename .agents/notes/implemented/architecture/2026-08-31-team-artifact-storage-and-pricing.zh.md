# Agent Note：Team artifact storage 与 provider pricing

Status: implemented

[English](2026-08-31-team-artifact-storage-and-pricing.md) | 中文

## 问题

Team task result 可以命名类似文件的 artifact，但没有 provider-independent service 拥有 bytes 或校验 reference。Usage aggregate 只有在 adapter 提供 cost 时才保留，因此 token count 存在而 cost 缺失的 provider 无法使用统一、可审计的 pricing table。

## 决策

`@clocky/clocky-team-artifact` 定义 effect-scoped 的 `ctx.teamArtifacts` provider registry。provider 保存有界 bytes，返回 content-addressed `TeamArtifactReference`，并在读取时校验 hash。`team-artifact-local` 在 owner-only root 下为 file、patch、log、screenshot 和 report reference 保存 regular file。配置 provider 后，worktree `publish()` 会保存有界 changed file 和 tracked binary patch；未配置时明确保留 provider-local reference。Content-addressed deletion 在 reachability owner 出现前是 retention no-op。

Provider-backed reference 会携带读取所用的命名 provider。Host 的 `team.artifact.read` operation 会从持久 Team result 中选择准确的 reference，拒绝 private 或有歧义的 id，要求该 provider 已挂载，执行固定的 response bytes 上限，并以 base64 返回经过校验的 bytes；没有 provider provenance 的 reference 仍只能作为 metadata。

SDK server 以 `team/artifact-read` 暴露同一个只读 operation，TypeScript 与 Python client 会让 Team id、artifact id、visibility、provider、byte bound 和 base64 response 与 Host path 保持一致。SDK error 会区分隐藏或缺失 artifact 与不可用 provider，且不会接纳 caller 提供的 URI。

Team-aware local retention owner 会在应用重启保守的 grace ledger 前，追踪 completed attempt 可达的所有 artifact slot，包括普通 result artifact、integration proposal artifact 和 integration final artifact。`TeamUsageSample` 记录 provider/model provenance。`team-hub` 在 Team creation 时把 `usageRates` 快照到 Team rules；sample 没有显式 `costUnits` 时，按 `provider/model`、provider、`*` 的顺序解析 pricing。显式 provider cost 始终优先，replacement 仍保持幂等 turn/step 记账。

Workspace provider 暴露可选的 `integrate()` 操作。worktree provider 支持可评审 proposal，并对 merge mode fail-closed；没有独立 integration authority 和 `workspace-integrate` policy decision 时绝不 commit、merge 或 push。

## 替代方案（Alternatives considered）

- 继续把 artifact URI 当作未经校验的 string。拒绝，因为 task result 可能指向已删除、可变或跨 Team 的 path，UI 无法证明 provenance。
- 把 bytes 放进 Team journal。拒绝，因为大输出会放大 WAL 与 channel payload，且 retention、deduplication 和 authorization 会与 Team state 纠缠。
- 只信任 provider 报告的 cost。拒绝，因为只报告 token bucket、没有 billing metadata 的 adapter 会让 deployment budget 被静默低估。
- 让 worktree provider 在 `publish()` 中直接 merge main checkout。拒绝，因为 publication 是 observation boundary；merge authority 必须保护用户 dirty work，并显式完成 conflict/review 检查。

## 后果

Task result 可以携带持久 file 与 patch reference，而不会把 bytes 复制进 model context；local provider 可替换为 remote/object store 而不改变 Team schema。要持久化 bytes，deployment 必须挂载 artifact provider；没有 provider 的 composition 只保留 provider-local reference，不能把它当作 durable read capability。Pricing 在每个 Team 内确定，但 operator 必须配置 route rate；未知 route 的 sample 会保留 token count，cost 为零，直到显式 cost 或匹配 rate 到达。

worktree provider 可以生成 proposal，但仍不负责 repository merge、branch publication、conflict resolution 或跨 host retention；这些操作仍需显式 integration 与 deployment authority。

## 验证

- `pnpm exec vitest run packages/core/team-artifact/tests packages/team/team-artifact-local/tests packages/team/team-workspace-worktree/tests packages/team/team-hub/tests/team-hub.spec.ts` 通过。
- Local retention test 会保留嵌套的 integration proposal 与 final artifact reference，不会把它们误判为 unreachable。
- 重新生成后 `pnpm run verify-config-catalog`、`pnpm run verify-cordis-config`、`pnpm run verify-package-invariants`、`pnpm run verify-package-readme-model-experience`、`pnpm run verify-doc-refs` 和 `pnpm run verify-md-wrap` 通过。
- `pnpm exec tsc -b tsconfig.host.json --pretty false` 与变更源码的 `oxlint` 通过。
- Host API test 覆盖 visible read、private／missing reference、provider 不可用和 cancellation；runtime 与 Team detail test 覆盖 provider-backed read、有界 preview、download、stale response 抑制和 unmount cancellation。
