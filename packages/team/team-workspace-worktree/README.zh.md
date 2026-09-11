# @clocky/clocky-team-workspace-worktree

[English](README.md) | 中文

`@clocky/clocky-team-workspace-worktree`会在 `ctx.teamWorkspaces` 上注册一个 `worktree`-mode `TeamWorkspaceProvider`。它为一个准确的 current local-Agent task attempt 创建隔离的 detached Git worktree，随后只通过正常 Git removal 释放该 provider 创建的 worktree。

## 必填配置

每个字段都必须显式给出。`repoRoot`和 `allocationParent`必须是绝对且已存在的目录；挂载会用 `fs.realpath`将两者 canonicalize，要求 `repoRoot`等于 Git 报告的 top-level，通过 `ctx.subprocess`解析 `gitExecutable`，并在注册 provider 前将 `baseRef`冻结为一个 commit。`providerName`、`gitExecutable`和 `baseRef`拒绝空值或带首尾空白的值。`processGraceMs`、`commandTimeoutMs`和 `outputMaxBytes`必须是正整数；grace 和 timeout 不能超过 subprocess timer limit。

| 键 | 含义 |
|---|---|
| `providerName` | 此 provider 的 registry identity。 |
| `repoRoot` | main Git worktree 的 canonical root，以及 Git command 的 execution directory。 |
| `allocationParent` | provider-minted detached worktree 的已存在 parent directory。 |
| `baseRef` | 在挂载时解析为 immutable detached base commit 的 revision expression。 |
| `gitExecutable` | 在 subprocess execution world 中解析的 absolute Git executable 或 bare name。 |
| `processGraceMs` | 每个有限 Git command 的 TERM-to-KILL grace。 |
| `commandTimeoutMs` | 一个 Git command 的 wall-time bound；终止后会获得新的 `processGraceMs` drain deadline。 |
| `outputMaxBytes` | 每个 Git command 的 bounded stdout 与 stderr retention。 |
| `artifactProvider` | 可选的 `ctx.teamArtifacts` provider，用于保存有界 file 与 patch bytes；省略时保留 provider-local reference。 |
| `integrationEnabled` | 显式启用该 provider 的 detached merge authority；默认是 `false`。 |
| `integrationAuthorName` / `integrationAuthorEmail` | 仅由显式获准的 integration 创建 commit 时使用的 author identity。 |

Git 会通过带 direct argv 的 `ctx.subprocess`运行，stdin 会被忽略，设置 `GIT_TERMINAL_PROMPT=0`，并移除环境中的 `GIT_DIR`、`GIT_WORK_TREE`和 `GIT_INDEX_FILE`。timeout command 会被终止并由新的 bounded drain signal 观察；无法证明 drain 会明确拒绝。provider 从不直接调用 shell 或 `child_process`。

## 资格、分配与释放

除非 task 在观察到的 revision 上仍是 `worktree` mode、Team 处于 active、candidate Participant 是 active `local-agent`、准确 activation binding 可投递，且其 Session 仍是 live local Agent，否则 `eligible()`返回 `false`。它不会创建目录，也不会读取或改写 Agent Session working directory。

`allocate()`会在 Git mutation 前重新读取 Team projection。它要求 active 且未过期的 assigned 或 running lease 与请求的 Team、task、attempt、assigned revision、Participant、activation 和 Session 匹配，随后把已验证的事实和派生 root 提交给 Team `workspace-allocate` policy hook。policy denial 会在 `git worktree add`运行前以 `TEAM_POLICY_DENIED`拒绝。它会在 Git 创建 worktree 后重复 exact currentness 与 policy check；若第二次检查拒绝，只会移除该刚创建的 clean root。

provider 从完整 attempt 与 binding identity 派生安全、确定的 child directory，拒绝任何已存在路径，而不会声称或删除它，并从挂载时的 base commit 运行 `git worktree add --detach`。重复的 current exact request 会在 release 前返回同一个 immutable allocation。worktree root 永远不会由原始 Team identifier 创建。

成功后的 `release()`是幂等的，并且不带 `--force`地使用 `git worktree remove`。因此 dirty worktree 会保持 allocated，rejected release 可在其内容解决后重试。allocation 与 release 会按 exact attempt 串行化：之后的 allocation 会等待 in-flight removal，只会在 removal 成功且重新验证后重新创建，并传播 removal failure，而不会返回正在被移除的 root。provider 从不递归删除目录。provider unregister 会阻止新的 allocation；已接受的 allocation 会保留之后 release 所需的 subprocess capability。

`integrate({ mode: 'integrate' })` 是独立且默认关闭的 authority。它要求 `workspace-integrate` policy hook，验证 local branch target 与可选的 `expectedTarget` commit，通过隔离 index 创建临时 source commit，在 provider 创建的 detached worktree 中执行 merge，并使用 Git 的 expected-old-value compare-and-set 更新 target ref。`integrateSource()`对已完成 source attempt 的持久 binary patch 使用相同的 target-fence 与 detached-worktree authority，因此不要求 source allocation 继续 live。source patch 包含 tracked change、deletion 和 untracked addition，同时不触碰 source worktree 的 index。成功结果包含最终 `targetVersion`，因此 Team integration task 可以在 durable attempt record 中保留精确的 target fence 与 outcome。冲突会返回 `status: 'conflict'` 与路径且不改变 target；已 checkout 的 target 会被拒绝。该操作绝不会对 task worktree 或用户 main checkout 执行 staging、commit、merge 或 force-push。

## 模型体验

### Detached Team worktree

#### 模型所见

本包不注册 prompt section、tool、model input 或 model output。`team-agent-client` 会把返回的 `TeamWorkspaceAllocation.root`发布到准确 task Agent scope；shell 和 discovery Consumer 会用该 root 执行 process 调用，assignment message 也会携带 root，使模型能从 Session log 重建执行上下文。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

该 provider 不拥有 model request prefix。

## 已知限制与延后工作

- **execution-root consumption 由 binding 感知**——Team Agent Client 会验证并保留准确 attempt 的 allocation，并向 scoped shell/discovery Consumer 暴露它。
- **provider-backed artifact 与显式 integration**——`publish()` 会记录 changed path；有配置 artifact provider 时保存有界 file bytes，并为 tracked change、deletion 和 untracked addition 保存 binary patch。没有 `artifactProvider` 时返回 provider-local file reference。除非 `integrationEnabled` 且 Team policy 允许，否则 integration 仍关闭；proposal mode 始终可用，而显式 authority 只更新未被占用的 target branch。
- **没有 crash recovery catalog**——进程丢失后留下的未跟踪 worktree 会被保留，而不会被新的 provider instance 声称或删除。
