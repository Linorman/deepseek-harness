# 部署单 Hub Team Link

[English](deploying-a-team-link-hub.md) | 中文

当远程进程必须将 activation-bound Team Link 连接到一个 authoritative Team Hub 时，请使用本指南。它假定 Hub 进程已经拥有 `ctx.teams`、`ctx.webServer`以及为远程 participant 选定的持久 activation。

## 1. 绑定 Hub endpoint

为 Hub 进程提供 capability 环境变量，然后在 Team Hub 旁挂载 listener。binding 值必须与持久 activation record 完全一致；绝不将 capability value 放入 `cordis.yml`。

```yaml
- id: team-link-websocket-hub
  config:
    path: /team-link
    bindings:
      - capabilityEnv: TEAM_LINK_CAPABILITY
        activationId: activation-example
        teamId: team-example
        participantId: participant-example
        sessionId: session-example
        provider: remote-runtime
```

在 HTTP server 或其 reverse proxy 处终止 TLS。远程 client 使用证书校验的 `wss:` URL；`ws:`只适用于受保护的本地网络。

## 2. 挂载远程 provider

为远程进程提供相同的 capability value，并注册具名 client provider。Link consumer 使用准确的 current activation binding 连接，而不是使用从用户 request 复制的值。

```yaml
- id: team-link-websocket
  config:
    providerName: remote
    endpoint: wss://hub.example.test/team-link
    capabilityEnv: TEAM_LINK_CAPABILITY
```

listener 会从已附接的 binding 推导 sender、recipient、Team、activation 和 Session authority。它会拒绝 stale binding、无关 channel、oversized frame、过多 request 或过满的 outbound queue。

## 3. 安全恢复和取消

Link 发生 terminal failure 后，先 dispose 该 Link；仅在持久 binding 仍为 current 时重新连接。Hub 从 channel WAL 重建 pending delivery；recipient 只会在自己的持久 admission 后记录 receipt。可重试 post 会保留其 idempotency key，并能在 response 丢失后恢复原始 accepted Envelope。

此 transport 仅将 Hub-authored soft interrupt 投递到其精确 activation binding。它不允许 peer 请求 interrupt，也不强制 participant 或 Team cancellation；这些 lifecycle action 仍属于 Team owner。

共享 Link contract 见 [Team Link 参考](../subsystems/team-link.zh.md)，全部 operational limit 见 [Hub package README](../../packages/team/team-link-websocket-hub/README.zh.md)。
