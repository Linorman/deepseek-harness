# Agent Note: Team Link registry

Status: implemented

[English](2026-08-28-team-link-registry.md) | 中文

## Problem

Team Hub 拥有持久 channel fact，而本地 Agent client 目前直接拥有 event subscription 与 replay。这使本地 Link、远程 Link、已认证 sender 推导、reconnect replay 或 provider lifecycle 没有具名 transport seam。让 client 在每个操作中传入 sender 或 recipient identity 也会绕过定义其权限的 activation binding。

## Decision

`clocky-team-link`定义 `ctx.teamLinks`，即 activation-bound Link provider 的具名 effect-scoped 注册表。connect request 命名一个 provider 和一个准确的持久 activation binding。注册表会验证返回的 Link 重复这两个值，并在拒绝前关闭不匹配的 Link。

Link 公开 notification subscription、已认证 post、delivery claim、receipt acknowledgement 和完全停稳的 close。其不可变 binding 为这些方法推导 sender 与 recipient fact；调用方不提供自由 participant identity。provider 拥有连接、replay、cancellation、notification backpressure 和 notification listener failure 的控制。注册表只拥有 provider selection 与返回 Link identity 校验。

## Alternatives considered

**把 transport 方法放在 Team Hub 上。** 不予采纳，因为 Hub 拥有持久 Team/channel state，而本地与远程连接生命周期会独立演进。

**让 Agent client 用任意 participant id 调用 post、claim 和 acknowledgement。** 不予采纳，因为 client 可以命名不同于其绑定 activation 的身份，并会复制 Link authentication 逻辑。

**为本地和 WebSocket client 创建不同接口。** 不予采纳，因为 replay、claim、receipt 和 binding identity 必须在 transport 分化前拥有一份 Consumer API。

## Consequences

`clocky-team-link-local`是已挂载的本地 provider。它拥有 pending-page replay、可取消的 Team/channel watch、有界 notification handoff 和失败 notification 的 retry，同时把 direct inbox admission 委托给 `clocky-team-agent-client`。`clocky-team-link-websocket`通过相同 Link operation 添加带 framing 的已认证远程连接；[WebSocket Team Link 传输决策](2026-08-29-websocket-team-link-transport.zh.md)拥有其 capability 和 replay 规则。

Team Hub 仍是 journal、WAL、pending delivery、claim 和 receipt 的权威。[本地 Team Link recovery 决策](2026-08-28-cancellable-local-team-link-recovery.zh.md)拥有本地 replay、lifecycle 和已认证 Link operation 行为。[线性化 direct delivery claim 决策](2026-08-28-linearized-direct-delivery-claims.zh.md)仍是本地 inbox admission 的权威。[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)在调度、workspace 与产品阶段完成前仍为 proposed。

## Verification

注册表测试覆盖 provider 注册、重复和无效名称、过期 disposer、缺失 provider、准确 binding 验证、被拒绝 Link 的 close 行为以及受控 cleanup diagnostic。invariant 测试保留 package ownership。生成的子系统参考在 `ctx.teamLinks` 下公开注册表 surface。
