# @clocky/clocky-team-artifact

[English](README.md) | 中文

`@clocky/clocky-team-artifact` 定义与 provider 无关的 `ctx.teamArtifacts` registry。Team Hub 只记录不可变 artifact reference 与 task provenance；挂载的 provider 负责 file、patch、log、screenshot 和 report 的 bytes 保存与读取校验。

provider 通过 effect-scoped `registerProvider()` 注册。Consumer 为 `save()`、`read()` 以及可选的 retention `delete()` 或有界 `collect()` 显式选择 provider。可读取的 reference 可以携带命名的 provider；没有 provider 的 reference 对无法安全推导路由的 consumer 仍只能作为 metadata。reference 不是授权凭证；调用方必须在读取 bytes 前执行 Team visibility 与 policy 校验。collection 同时接收当前可达 reference 与已经通过 grace policy 的 provider-owned id，因此 content-addressed provider 不会把对单个对象的直接 delete 误当成垃圾回收。

## 模型体验

### Artifact storage

#### 模型看到的内容

本包不会注册 prompt section、tool、model input 或 model output。task 与 workspace Consumer 决定哪些 reference 会进入 model-visible result。

#### Token 影响

直接 token 影响为零。

#### KV Cache 影响

本 service 不拥有 model-request prefix。

## 已知限制与暂缓事项

- service 没有默认 provider；每个 composition 都必须挂载 storage implementation。
- retention policy 仍由 Team Consumer 负责；provider 只有在能够安全执行时才实现有界、provider-owned collection。
- replication 与 remote/object-store collection 仍属于 deployment-specific 行为。
