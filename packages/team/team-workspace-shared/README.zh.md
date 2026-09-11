# @clocky/clocky-team-workspace-shared

[English](README.md) | 中文

`@clocky/clocky-team-workspace-shared`会在 `ctx.teamWorkspaces` 上注册本地 shared-root `TeamWorkspaceProvider`。它只为匹配的 local-Agent attempt 分配一个已存在的 checkout root；它既不创建 checkout，也不改变 Agent 的 working directory。

## 根目录配置

`root`为必填项，必须是一个已存在目录的绝对路径。挂载时会通过 `fs.realpath` 解析该路径，并将其 canonical directory 作为 fallback root 保留在 provider 生命周期内。relative、missing 或 non-directory root 会在加载时拒绝。symlink 写法只会以其解析后的 target 被接受，之后的所有比较都使用同一 path identity。启用 `allowTeamWorkspacePath` 后，每个 Team 的 durable `workspacePath` 都可以为该 Team 的 allocation 选择一个 canonical existing root。

shipped Headless 和 Web Team 组合将 `process.cwd()`作为 fallback，并启用 `allowTeamWorkspacePath`，因此在 `team.start` 前选择的文件夹会被 coordinator 和每个 worker 使用。Session header 记录另一 `cwd` 的 worker 保持不合格，`materialize()`会拒绝，而不会改写 header 或改变所选 root。

`artifactProvider` 和 `maxArtifactBytes` 可以选择通过 `ctx.teamArtifacts` 发布有界 file。`integrationRoot` 是一个可选的独立目录，包含 provider-specific target directory；`integrationEnabled` 还会启用 target-directory integration，并要求同时配置 `integrationRoot` 与 `artifactProvider`。`maxIntegrationBytes` 限制 portable change-set 和 decoded file bytes。

## 资格与分配

除非 task 请求 `shared`、其 current owner 是 `local-agent`，并且一个 live local Agent 具有准确绑定的 Session 且其 header `cwd`等于所选的 canonical root，`eligible()`都会返回 `false`。启用 `allowTeamWorkspacePath`时，root 来自 Team 的 durable workspace rule；否则使用配置的 fallback。它绝不会改变 session header、接受 child directory，或把不同写法当作另一个 execution root。

`prepare()`和`materialize()`在返回 root 前会重新读取 Team state。它们要求 current active lease 与请求中的 Team、task、attempt、assigned revision、Participant、activation 和 Session 完全匹配；随后重新检查准确的 live local Agent 与 header。它们将已验证的事实提交给 Team `workspace-allocate` policy hook，因此 denial 会在发布前拒绝。对同一个 current allocation request 的重复调用会在 `release()`前复用其 logical attempt allocation，不会创建额外资源。

返回的 `release()`是 logical 且幂等的。它绝不会移除配置 root、创建 filesystem lock、serialize write，或重写任何 Team record。shared-work write-scope serialization 仍是 scheduler 的 durable advisory rule；unknown filesystem write 仍不在本 provider authority 范围内。

没有 artifact 或 integration 配置时，`publish()` 仍然是 report-only。启用可选 publication 后，它会在 allocation materialize 时 snapshot shared root，返回排序后的 changed path，并可选地持久化有界 file reference。配置 `integrationRoot` 和 artifact provider 后，它还会生成一份带 provenance 的 portable change-set patch；source baseline 会保留在 provider-owned state directory 中，直到 release。`integrateSource()` 是显式且经过 policy authorization 的 target-directory operation，具有 expected content-version fence、staged replacement 和 local-process retry marker。如果在已有 target 移入 provider-owned backup 与安装 staged directory 之间发生 crash，retry 会先恢复该 backup，再重新应用 change set。它绝不会 merge Git ref，也不会写回 shared source root。

## 模型体验

### Shared Team workspace

#### 模型所见

本包不注册 prompt section、tool、model input 或 model output。独立的 Agent preset Consumer 可以使用 `shared` allocation root 来组合 filesystem 与 process authority。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本 provider 不拥有 model request prefix。

## 已知限制与延后工作

- **没有 isolated execution root**——worktree、sandbox 和 remote provider 拥有独立 root 及其 cleanup rule。
- **没有 filesystem enforcement**——本 provider 不锁定 write scope，也不检查 external write。shared-work serialization 仍是 scheduler rule，target integration 是 provider-local operation，不是 distributed lock 或 Git merge authority。
- **Integration 需要显式独立 target root 与 artifact store**——没有 opt-in 配置时，`publish()` 对 integration 仍是 report-only，`integrateSource()`不能应用 source change-set。
- **没有 Agent lifecycle 或 task settlement**——activation placement、delivery-bound attempt start、heartbeat、result reporting 与 review 仍由独立的 Team role 负责。
