# Agent Note: 经认证的产品主体 Team 控制

Status: implemented

[English](2026-09-04-authenticated-product-principal-team-control.md) | 中文

## 问题

Loopback 可达性、Team id、participant id 或 Session header 都不能证明哪个产品用户请求了 Team mutation。持久化的人类 owner 也必须能在重启后保留，同时不能保存 credential 或可重放 proof。

## 决策

`ctx.productPrincipals`拥有可撤销的认证调用。Web composition 使用会轮换的本地 provider，并通过仅 owner 可读的 handoff document 交换 credential；bundled Python runtime 则将 handshake credential 与配置的 SHA-256 digest 比较。credential、digest、cookie 和 proof 都只存在于 runtime。Transport teardown 会先关闭 bootstrap admission，再撤销保留的 lease；浏览器 handoff 在 disposal 后即使处于进行中也不能发布新 artifact。Current-run start 的 retry identity 包含非 secret human owner，因此同一 key 不能重放另一 principal 的结果。

human Participant 保留封闭 owner：`{ kind: 'product-principal', principalId }`或`{ kind: 'system' }`。interactive TeamRun creation 从认证调用派生前者；unattended run 保留后者。当前 journal 和 checkpoint reader 会拒绝缺失、格式错误、被重新赋值或重复的 active product-principal owner。

`team-human-actor`选择一个 active 且归属于 product principal 的 human，并为已解析的 operation、payload 与 cursor 或 revision 签发一次性 proof。Host 和 SDK wire contract 保持 actor-free。它们的 Team mutation 在 Hub 重验该 proof，覆盖 topology、channel、task、goal、detached archive 与 resume。current-run input、final wait、cancellation、coordinator prompt 与 SDK run record 还要求 caller 拥有该 run 的 durable human。Team-bound approval 和 question response 也会在结算 pending action 前执行同一 owner 检查。

resume 通过 TeamRun、resume phase proof 与 activation-controller binding 持有 Hub 签发的 runtime authorization。每次 durable phase 或 activation bind 都会重验 authorization；被撤销的 authorization 会释放尚未发布的 raw handle，而不会发布新的 coordinator。Host response route 在异步读取 Team 后还会重新检查 pending action 的准确 participant、product principal、active phase 和不可变的 `human-action` grant。

本记录是更广泛的[Team actor proof control plane](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.zh.md)的产品认证 human consumer。多领域的[P0 safety proposal](../../proposed/architecture/2026-09-04-native-multi-agent-p0-safety-closure.zh.md)仍为 proposed，因为其中 lifecycle、lease 和 view 的决策有独立范围。

## 考虑过的替代方案

**把 loopback 或`trustedHosts`当作 human identity。** 拒绝，因为可达性不能证明持有 product principal。

**在 mutation wire payload 中接受 principal id、participant id 或 proof。** 拒绝，因为可序列化 authority 可被重放，也可能进入 durable 或 model-visible data。

**把明文 SDK credential 传入 child environment。** 拒绝，因为 client 会主动从 child launch state 清除它。runtime 只接收非敏感 digest 配置。

## 后果

旧 Team journal/checkpoint format 会被拒绝而不转换 owner。使用 bundled SDK runtime 的 deployment 向 client 提供显式 credential，并通过`CLOCKY_PRODUCT_CREDENTIAL_SHA256`提供其 SHA-256 digest；缺失或不匹配的 digest 会在 load 或 initialization 时失败。Headless Team 保持 system-owned，不能使用通用 human control route。

## 验证

聚焦的 Core/Team、Host/Web、SDK、client-runtime 与 Python SDK suite 覆盖 credential rotation/redaction、owner/replay validation、proof fence/revocation、resume kill point、response-action ownership、严格 actor-free schema 与认证 mutation route。
