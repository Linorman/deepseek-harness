# @clocky/clocky-team-workspace-sandbox

[English](README.md) | 中文

`@clocky/clocky-team-workspace-sandbox` 会在 `ctx.teamWorkspaces` 上注册 `sandbox` mode 的 `TeamWorkspaceProvider`。它为每个准确的 task attempt 创建一个确定性的、由 provider 拥有的本地 directory，可选地将配置的 source directory 复制到新 root，并通过已有的 Team Agent Client lease 暴露该 root。

## 配置

`allocationParent` 是拥有 provider-created root 的 absolute existing directory。`sourceRoot` 可选；设置后必须是另一个 canonical directory，且首次 materialize root 时会在不跟随 symlink 的情况下复制其内容。`providerName`、`artifactProvider` 和 `maxArtifactBytes` 分别选择 registry identity、可选的 Team artifact store 以及有界的 file publish 大小。`integrationRoot` 是可选的独立 absolute directory，包含 provider-specific target directory；`integrationEnabled` 用于启用 target-directory integration，`maxIntegrationBytes` 限制 portable change-set artifact 与解码后的 file bytes。

provider 会在每个 root 旁写入 manifest，不会只从 path 推断 ownership，并会在 restore 和 release 时拒绝未知或被篡改的 root。root 会在 Team allocation reservation 之后创建；release 只会移除已验证的 provider-owned root 和 manifest。provider 不声明 filesystem lock。启用 integration 后，配置 artifact store 的 publish 还会生成带 provenance 的 portable patch change set；`integrateSource()` 在 policy 授权和 expected snapshot-version 检查通过后，将它应用到 target child directory，并使用 provider-owned recovery marker。

## 发布

`publish()` 将当前 root 与 manifest 中的初始 file snapshot 比较，并返回排序后的 changed path。大小不超过 `maxArtifactBytes` 的 regular file 在配置 `artifactProvider` 时会成为 provider-backed `TeamArtifactReference`；没有 store 时则保留本地 file URI 与 content hash。配置 `integrationRoot` 后，有界的 file、symlink 与 deletion change 还会编码为一个供 `integrateSource()` 使用的 `patch` artifact；不支持或超限的 change set 仍只作为 report。已删除 path 会保留在 changed-path 列表中，但没有 file artifact。

`integrateSource()` 将 `target` 视为 `integrationRoot` 下的 relative child directory name。provider 会先 stage 一份副本，再次检查基于内容的 target version，只有 expected-version fence 通过后才替换 target directory。位于 integration target 外的 marker 允许在 target 已替换完成后通过 retry 识别该结果；如果在 target 移入 provider-owned backup 与安装 staged directory 之间发生 crash，retry 会先恢复该 backup，再重新应用 change set。provider-specific filesystem replacement 只在本地 process 内串行，不是 distributed lock。

## 模型体验

### 隔离的 Team sandbox

#### 模型看到的内容

本包不会注册 prompt section、tool、model input 或 model output。`team-agent-client` 会在准确的 task Agent scope 上发布 allocation root，已有的 filesystem/process Consumer 会在 task turn 中解析该 root。

#### Token 影响

直接 token 影响为零；只有显式上报的 changed path 和 artifact reference 可以进入 task result。

#### KV Cache 影响

本 provider 不拥有 model-request prefix。

## 已知限制与暂缓事项

- 本地 provider 隔离 filesystem root，但依赖已挂载的 filesystem 与 process Consumer 提供 kernel enforcement。
- integration 仍是 provider-specific 能力：本 provider 只会把自己的 portable change-set artifact 集成到本地 target directory，不会进行 Git branch merge。
- root contents 只存在于单一 host；需要另一种 execution world 时使用 E2B 或其他 remote provider。
