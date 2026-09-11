# @clocky/clocky-team-channel-summary

[English](README.md) | 中文

`ctx.teamChannelSummaries.summarize()` 从已提交的频道 WAL 范围创建显式、确定性的抽取式摘要。Hub 负责请求者身份、可见性、游标、来源指纹、幂等和持久化。Consumer 注册规范摘要证明源，不调用模型。

## 调用与配置

协调者工具 `team_channel_summarize` 接受频道 id、当前游标、包含两端的来源序号范围和稳定幂等键。经过认证的 Host API `team.channel.summarize` 接受对应的 `ChannelSummarySelectionInput`；人类绑定器检查调用者的活跃成员身份和 `send` 授权。两者返回持久化摘要文本及来源信息。默认 TeamRun 协调者工具可用于其 directed 人类频道，但不会自动缩短该频道的模型历史。

部署必须提供 `allowedPolicies`、`maxSourceEnvelopes`、`maxSourceBytes`、`maxSummaryBytes`、`maxHistorySpan` 和 `disposalTimeoutMs`。组合配置允许 `directed` 与 `summarized-window`，上限分别为 64 个来源 Envelope、65,536 字节来源 JSON、4,096 字节输出、128 个 WAL 序号及 5,000 毫秒释放等待。Hub 的存储分页上限同时生效。来源超限会在生成前拒绝；输出截断在 UTF-8 字节额度内保留完整 Unicode 前缀。

抽取接受纯文本 `payload.text`，或仅含文本块的非空 `payload.content` 数组。它规范化空白并为每条来源标注 WAL 序号。非文本来源会明确失败。来源文本始终是引用数据：抽取器不执行其中的指令，也不推断新事实。

## 权限与持久化

只有当前活跃协调者 activation，或经过认证的活跃人类频道成员，才能请求摘要。新工作还要求 Team 与频道活跃、不存在关闭或取消意图、不可变视图策略获准，并提供精确频道游标。来源范围必须包含对所有不可变频道成员可见的消息；私密收件人子集会在生成所需内容返回前拒绝，诊断不暴露隐藏原文。

Consumer 在生成和提交期间保留选定的 adapter 与 view-policy 实现。临时证明绑定完整输出与来源指纹；Hub 在追加前重读来源并复核请求者。每条持久化记录携带规范化、有序来源 Envelope 的 SHA-256 指纹。WAL/checkpoint 恢复会验证该指纹，压缩不能删除已有摘要的来源范围。

相同幂等键和范围返回原记录，包括重启后或旧游标重试。冲突范围或底层负载会被拒绝。新键需要新游标。`summarized-window` 策略投影最新持久化摘要及其未覆盖的原始尾部；没有摘要时投影原始消息。读取不会生成摘要。

## 模型体验

### 显式协调者摘要

#### 模型看到什么

当前默认协调者收到 `team_channel_summarize` 工具 schema。通用工具卡片显示频道和序号范围；结果包含持久化摘要 id、序号、范围及文本。普通 worker Agent 不获得该工具。经过认证的人类 API 返回相同持久化事实，不发起模型请求。

#### Token 影响

工具 schema 与结果为协调者 Session 增加 token。summarized-window 投递包含持久化摘要和选定原始尾部。抽取本身不消耗模型 token。

#### KV Cache 影响

作用域内的工具 schema 对协调者保持稳定。工具结果与频道视图事件进入动态 Session 后缀，不重写此前请求前缀。

## 已知限制与延后工作

- 摘要对全频道可见，没有按查看者隔离的私密摘要存储。
- 确定性抽取器仅支持文本，不提供模型生成摘要或自动阈值压缩。
- 摘要来源证明会保留原始存储；本包不会用未经验证的摘要替换历史。
