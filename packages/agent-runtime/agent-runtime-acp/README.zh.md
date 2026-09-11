# @clocky/clocky-agent-runtime-acp

[English](README.md) | 中文

```yaml
- id: agent-runtime-acp
  name: '@clocky/clocky-agent-runtime-acp'
  config:
    command: clocky-acp-agent
    # Optional: a Team Link enrollment issuer such as the WebSocket Hub.
    # teamLinkEnrollmentProvider: websocket
```

`ctx.agentRuntimes` 的 ACP 子进程 placement 提供方。它在发布 Team activation 前完成 ACP initialize/session 握手；该握手会与 activation cancellation 竞争，取消时会回收尚未发布的 child。它独立保留 Team/Participant/Session 身份与 ACP wire session id，向子会话转发中断，并负责 EOF/终止的有界清理。

提供方不公开本地 `Agent`。它会在 Team 解析出的 `SessionId` 下创建持久 Clocky proxy Session；每个已 claim 的 Envelope 先追加并 flush 到该 Session，再运行 ACP child 的 `session/prompt`。consult、discussion、workflow 和 review claim 使用 Hub 渲染的 `team/channel-view` content，同时用于 proxy event 与 ACP prompt；direct claim 继续使用既有 Envelope source。成功响应会追加 completion fact、flush，然后才写入 Team receipt。resume 时，已经完成的 source Envelope 会直接确认而不会再次 prompt；已接纳但未完成的 prompt 仍可 replay。配置 `teamLinkEnrollmentProvider` 后，它会在 Team binding 提交后申请短期 activation-bound WebSocket enrollment，拥有生成的 Link，并把 claim 的 content 转为 ACP child prompt。v4 Hub `cancel` request 会通过取消 ACP session 进行 cooperative handling，然后 endpoint 才确认；provider 仍通过有界 EOF/termination path 证明 child process 已终止。未配置该选项时，Team channel 投递仍由外部 Consumer 负责。请在 `clocky-agent-runtime`、`clocky-subprocess`、`clocky-session` 和 `clocky-session-persistence` 后挂载（启用 bridge 时还要在 Team Link registry/enrollment provider 后挂载）。

`providerName`、`args`、`env`、`disposeEofGraceMs`、`teamLinkEnrollmentProvider`、`teamLinkProviderPrefix` 和 `teamLinkReconnectDelayMs` 是部署设置。`recoveryProfile`、`recoveryHostId` 和 `recoveryFenceGraceMs` 会显式启用同主机 `acp-local-cold-replace` recovery；可选的 `recoverySupervisor` 要求挂载执行主机的 supervisor owner，由其在 activation 发布前持久接纳准确的 process identity。Owner 缺失或拒绝接纳时会回收尚未发布的 child；清理无法证明终止时报告 `AGENT_RUNTIME_TERMINATION_UNCONFIRMED`，并阻止同一 provider 实例再次激活该 Participant。Provider 会记录准确 process identity 并注册匹配的 fencer；跨主机 ACP recovery 在 supervisor deployment 独立验证前仍不承诺。两个 timer setting 受 Node 最大安全 delay 限制，escalation 后的 termination observation 也会限制在同一上限内。初始化失败或在 initialize/session 握手期间被取消的 child 会在 activation 拒绝前被回收；provider 卸载会关闭后续 admission，而已接受的 handle 会完成其自身生命周期。只有已拥有 child 退出后才发布 `offline`；未确认的终止会保持 `stopping` 并报告 `AGENT_RUNTIME_TERMINATION_UNCONFIRMED`。bridge 会串行化 ACP prompt，通过 activation-bound Link claim 每个 Envelope；activation 仍为 current 时，transport failure 会触发重新 enrollment；prompt 失败时不确认以便 replay，ACP assistant output 绝不会自动广播。

## 模型体验

### ACP Team Link bridge

#### 模型看到的内容

本 provider 不贡献 prompt section 或 tool。远程 child 通过 ACP `session/prompt` 接收 direct content 或 Hub 精确渲染的 `team/channel-view` content；child output 保持私有，除非显式 Team Consumer 发布 report 或 final Envelope。

#### Token 影响

bridge 会加入一个包含已接纳 model content 的串行 prompt；child runtime 报告 Session step 时会记录 provider usage。

#### KV Cache 影响

bridge 不改变 child 的 request prefix 或 cache policy。

## 已知限制与暂缓事项

- bridge 需要挂载 `ctx.teamLinks` enrollment issuer 和 WebSocket Team Link Hub；不接受标准 `session/prompt` 流程的 ACP child 无法通过此 provider 消费 Team Envelope。
- ACP wire session id 不会被当作 Clocky `SessionId` 或 `ActivationId` 使用。Proxy Session 使用 Team 解析出的 `SessionId`，保留 Team/channel/Envelope provenance，并且需要已挂载的 durable Session persistence provider。
