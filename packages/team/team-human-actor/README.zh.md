# @clocky/clocky-team-human-actor

[English](README.md) | 中文

`@clocky/clocky-team-human-actor` 将一个 `AuthenticatedProductCall` 绑定到准确一个 active human Team participant；该 participant durable 的 `owner` 必须等于已认证 product-principal id。它会在 `ctx.teams` 上注册生成的 runtime-only proof source。

## 语义

`ctx.teamHumanActors.withProof()` 验证 participant immutable operation grant，对完整 JSON-only mutation input 和 Team cursor 或 revision fence 计算 fingerprint，并且只在回调中暴露 proof。Hub 可以在回调期间重复解析该 proof；回调结束后它会被撤销。认证调用被撤销或 binder unload 时，proof 会立即失效。

`channel-invitation-read` proof 使用 `read` fence，只要求当前 human 归属，不要求 mutation grant。它只授权 Hub 邀请查询；显式确认仍要求原有 consent 权限。

## 失败

没有匹配的 active human 时返回 `TEAM_HUMAN_ACTOR_NOT_FOUND`；多个匹配时返回 `TEAM_HUMAN_ACTOR_AMBIGUOUS`；缺少 operation grant 时返回 `TEAM_HUMAN_ACTOR_FORBIDDEN`。伪造、过期、已撤销或 source-unregistered 的 proof 返回 `TEAM_ACTOR_PROOF_INVALID`。

## Model Experience

### 已认证 human proof binding

#### What the model sees

无。`AuthenticatedProductCall`、proof token、fingerprint 和 owner matching 均仅存在于 runtime。

#### Token effect

没有直接 token effect。

#### KV Cache effect

本包不修改 model-request prefix。

## 已知限制与暂缓事项

- **每个 principal 只能有一个 active human**——匹配到多个 active human participant 的调用会以歧义拒绝，不会任选其一。
