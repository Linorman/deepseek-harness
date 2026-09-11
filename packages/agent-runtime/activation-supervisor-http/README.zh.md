# @clocky/clocky-activation-supervisor-http

[English](README.md) | 中文

在 SDK 执行主机挂载`/endpoint`，在权威 Hub 的 supervisor registry 旁挂载`/client`。两侧使用相同`name`、`version`、`hostId`和`endpointId`；client 从配置解析 URL 和凭证环境变量，不将两者持久化到 Team state。Client 要求 HTTPS，除非`allowInsecureHttp`显式允许隔离的 HTTP 部署。Listener 的 TLS 或反向代理由部署负责。

Endpoint 还要求`storageLog`、`runtimeProvider`、`profile`、`bindHost`、`port`、`credentialEnv`、`fenceGraceMs`、`requestTimeoutMs`、`maxPayloadBytes`和`maxConcurrentOperations`。Client 要求`url`、`credentialEnv`、`timeoutMs`和`maxPayloadBytes`。这些限制约束 payload、接纳、网络等待和进程终止。两侧会在每个请求读取配置的凭证，因此轮换环境变量后无需重建 client 或 listener 即可生效；空值会以 unavailable 方式 fail closed。

SDK runtime 配置`recoverySupervisor: { name, version, endpointId }`、`recoveryProfile`及`recoveryHostId`后，在发布 handle 前通过本地 registry 登记准确的 activation/Team/Participant/Session/process 身份。每次登记占用一个独立版本的`activation-supervisor/<digest>` stream。HTTP 只暴露认证 health 与 fence；登记缺失或进程指纹改变时，在发送信号前拒绝。确认终止后先追加持久记录再返回成功，重放无需推测已消失的 Windows 进程树。

Endpoint 使用现有准确 SDK process inspector 和有界 tree fencer。Linux、macOS 和 Windows 均提供准确的创建身份；缺少此能力的 inspector 会被拒绝。关闭 listener 会等待已接纳操作结算，凭证不会进入 descriptor 或响应诊断。`unreachable`和`unknown`不表示进程已经终止。

## Model Experience

### Remote execution ownership

#### What the model sees

不注册 prompt 或 tool。Activation controller 将不可用的监督证据记录为 `Team stall`。

#### Token effect

不直接增加模型上下文 token。

#### KV Cache effect

不改变请求前缀。

## Known Limitations and Deferred Work

- **范围** — 此 provider 监督已经放置的 SDK 进程；远程 placement 和 replacement 的 Session 可用性仍由选定 AgentRuntime provider 负责。
- **延后部署验收** — E2B loss settlement 需要其自己的 supervisor provider，ownership stream 未挂载自动登记回收 drive，真实进程 HTTP fence 测试要求 Linux，跨主机部署验收需要两台已配置主机。
