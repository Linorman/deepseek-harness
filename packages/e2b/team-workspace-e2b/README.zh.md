# @clocky/clocky-team-workspace-e2b

[English](README.md) | 中文

`@clocky/clocky-team-workspace-e2b` 会在 `ctx.teamWorkspaces` 上注册 `remote` mode 的 `TeamWorkspaceProvider`。它在 `ctx.e2b` 拥有的 E2B sandbox 内为每个准确的 task attempt 分配一个隔离 directory，并通过同一 Team Agent Client workspace lease 发布有界的 remote file artifact。

## 配置

`workspaceParent` 是 E2B runtime 下可选的 absolute POSIX directory；省略时会从 `ctx.e2b.runtimeRoot` 推导一个 child。provider 会在 containment 检查前规范化两个配置 root，拒绝 NUL byte 和越出 runtime 的 traversal，也拒绝 workspace 与 integration state 重叠。`providerName`、`artifactProvider`、`maxArtifactBytes`、`maxEntriesPerPublish` 和 `maxListDepth` 分别选择 provider identity、可选的 durable bytes 以及有界的 remote publish scan。`integrationRoot` 是同一 E2B runtime 下可选的 remote directory；`integrationEnabled` 用于启用 provider-specific target-directory integration，`maxIntegrationBytes` 限制 portable change-set artifact。挂载不会创建另一个 E2B sandbox；sandbox 的生命周期与释放仍由 E2B owner 负责。

materialize 只有在 Team allocation reservation 之后才会创建 `allocations/<digest>` root 和旁边的 `manifests/<digest>.json` record。restore 与 release 会验证准确的 manifest，因此任意 remote path 都不能成为恢复的 allocation。如果 E2B sandbox 已过期或 remote manifest 缺失，provider 会 fail closed，并将 durable recovery 留给 Team workspace recovery Consumer。

Metadata 和 version-2 manifest 保留准确 E2B world 身份。Sandbox 过期、manifest 缺失和 world 变化产生显式 loss；网络失败不证明终止。Team Agent Client 停止准确 task turn，再释放已确认过期的 allocation 以重试 attempt；无法确认时保留 unavailable allocation 并将 Team 置为 stalled。

`lossPollIntervalMs`默认 5000 ms，`maxLossChecksPerPoll`默认 16。Provider-backed artifact 要求`storageLog`，每次保存的 reference 在继续发布前写入本地独立版本 manifest，`maxRetainedArtifacts`默认限制为 4096。Loss reference 经 provider 重启后仍可参与回收与 Host/SDK 读取。[Loss settlement](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.zh.md)。

## 发布

`publish()` 会按配置的 depth 列出 owned root，超过 `maxEntriesPerPublish` 的结果会被拒绝，并返回稳定的相对 file path。不超过 `maxArtifactBytes` 的 file 会只读取一次；挂载 Team artifact provider 时通过它保存，否则以 live E2B sandbox 中的 remote URI 和 content hash 标识 bytes。启用 integration 后，有界的 remote file 还会编码为一个 provider-bound `patch` artifact；`integrateSource()` 在 policy 授权和 expected content-version 检查通过后，将该 change set 应用到 remote target child。

`integrateSource()` 将 `target` 视为 `integrationRoot` 下的 relative child directory，只创建 provider-owned target path，并在第一次 remote mutation 前在 workspace parent 中保存 `prepared` marker。marker 会记录 target root 是否由 provider 创建，因此即使在创建空 root 后发生 crash，也能从原始的 `missing` target 继续。只有 target 仍匹配 marker 的 expected version 时 retry 才能继续；target 一旦变化仍会保持 conflict。所有有界 write 完成后，marker 才记录 integrated target version。remote file write 由本 provider process 串行；target version 会对有界 file content 做 hash，并为更大的 file 纳入 `modifiedTime`，因此同尺寸的 remote change 也会使 expected-version fence 失效。E2B 不提供 distributed compare-and-set，也无法在 sandbox 自身过期后恢复。

## 模型体验

### Remote Team workspace

#### 模型看到的内容

本包不会注册 prompt section、tool、model input 或 model output。已挂载的 E2B filesystem 与 subprocess composition 会消费 `team-agent-client` 发布的 root；模型只会看到普通 tool result 与显式上报的 artifact reference。

#### Token 影响

直接 token 影响为零；有界的 publication metadata 可以进入 task result。

#### KV Cache 影响

本 provider 不拥有 model-request prefix。

## 已知限制与暂缓事项

- E2B sandbox 是共享的 runtime resource，而不是 durable multi-host workspace store；新的 E2B runtime 无法恢复已经过期的 sandbox。
- integration 仍是 provider-specific 能力：本 provider 只会把自己的 portable file change set 集成到 remote target directory，不会合并 Git ref，也不会恢复已过期的 E2B sandbox。
- keyed E2E 已覆盖 live allocation、publication 和 target-directory integration；keyed remote cancellation/restart evidence 仍需要 `E2B_API_KEY`，且不属于无 key 的 unit coverage。
