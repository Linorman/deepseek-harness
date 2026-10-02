# @clocky/clocky-team-human-actor

[English](README.md) | 中文

`withReader()` 为目录消费者保留不可变的主体、issuer、subject 和凭据代际事实。它不要求已有 Team 成员资格，本身不授予 Team 访问；provider 检查每个返回对象。回调完成、调用撤销或 source unload 都会退役该不透明 reader。Reader 不能作为成员或修改 proof 使用。

`openReader()` 为流消费者返回该 reader、退役信号与幂等的 `close()`。消费者负责清理；认证撤销或 source unload 会中止 lease，即使没有新帧到达。`session-content-read` 只使用成员读取权限，并绑定完整 Team／成员／Session 元组；Hub 独立检查其持久绑定。

身份、就绪度、Session、频道列表和频道内容检查，可将 proof 锚定到规范 reservation 祖先 Team 中最近的 active 人工成员。回调接收该成员所属 Team，完整目标 payload 仍计入 fingerprint。其他操作仍解析目标 Team 内的成员资格。缺失／私有 Team 检查使用 `TEAM_HUMAN_ACTOR_FORBIDDEN`；祖先关系不提供修改或同意授权。

`@clocky/clocky-team-human-actor` 将一个 `AuthenticatedProductCall` 绑定到准确一个 active human Team participant；该 participant durable 的 `owner` 必须等于已认证 product-principal id。它会在 `ctx.teams` 上注册生成的 runtime-only proof source。

`resolveHumanActor()` 提供有界身份和操作名称；proof 签发不复制完整 Team 快照。仅检查成员资格的 `task-capabilities-read` scope 将准确的输入路径绑定到 read fence，不允许变更，并由 Hub 重新检查。

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
