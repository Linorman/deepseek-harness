# @clocky/clocky-team-artifact-local

[English](README.md) | 中文

`@clocky/clocky-team-artifact-local` 为 Team task output 注册 content-addressed `ctx.teamArtifacts` provider。它把 file、patch、log、screenshot 与 report 作为 private regular file 保存，返回携带 provider name 且经过 hash 校验的 `TeamArtifactReference`，不会把 bytes 嵌入 Team journal 或 channel Envelope。

## 配置

`root` 是以 owner-only 权限创建的绝对目录。`maxBytes` 限制单个对象大小，`maxArtifactsPerAttempt` 限制一个 task attempt 保留的不同 content hash 数量。`providerName` 是 reference 使用的 registry 前缀；所有值在注册前都会校验。可选的 `retention` 段会启用 Team-aware reachability owner，其中 `graceMs`、`maxObjectsPerDrive` 和 `disposalTimeoutMs` 必填，`pulseIntervalMs` 可选并用于 recurring drive。

provider 使用 exclusive creation 写入，只有现有对象 bytes 与请求的 SHA-256 digest 相同时才复用。读取会拒绝 path escape、symlink、缺失对象和 hash mismatch。由于 content-addressed object 可能被多个 Team reference 共享，直接 `delete()` 仍有意是 retention no-op。配置的 retention owner 会分页读取每个未归档 Team，追踪普通与 integration result field 中的 task-attempt artifact reference；新发现的 unreachable object 会等待配置的 grace，之后只有仍不可达的 id 才会进入 provider 的有界 cursor sweep。其内存中的 grace ledger 在重启时采取保守策略：重启后的进程会先再次观察对象，之后才可能删除。重复或回退的 Team-list cursor 会让 retention drive 以 `TEAM_CURSOR_CONFLICT` 失败，而不会重复扫描同一 page。

## 模型体验

### Team artifact reference

#### 模型看到的内容

本包不会注册 prompt section、tool、model input 或 model output。task-report Consumer 会在结构化结果中携带 reference；授权的 UI 与 API Consumer 通过 provider 读取 bytes。

#### Token 影响

直接 token 影响为零；只有 reference 可能进入 model-visible task result。

#### KV Cache 影响

本 provider 不拥有 model-request prefix。

## 已知限制与暂缓事项

- provider 只在单一 host 本地工作，不会在多个 Hub process 间复制对象。
- remote/object-store provider 与跨 host retention 仍是同一 artifact service 上 deployment-specific 的实现。
- 未配置 `retention` 时，本包只挂载 storage；collection 必须由另一个 Team-aware Consumer 驱动。
