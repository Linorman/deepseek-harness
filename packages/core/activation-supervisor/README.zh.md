# @clocky/clocky-activation-supervisor

[English](README.md) | 中文

`ctx.activationSupervisors`解析名称和版本准确匹配的执行 owner。Health 区分`reachable`、`unreachable`、`terminated`和`unknown`；fence 只接受 descriptor 匹配且为`terminated`的结果。Descriptor generation 使用持久 ActivationId。注册退役会阻止后续接纳，已接纳的操作保留其 provider。

`admitOwned()`是 SDK activation 发布前调用的可信执行主机操作。远程 client 无法登记进程所有权。HTTP provider 在暴露 health 或 fence 前持久化登记。Activation controller 通过此 registry 消费监督结果，并为无法确认的执行保留持久 stall。

## Model Experience

### Execution supervision

#### What the model sees

不注册 prompt 或 tool。`Team lifecycle` 诊断描述不可用的执行证据。

#### Token effect

不直接增加模型上下文 token。

#### KV Cache effect

不改变请求前缀。

## Known Limitations and Deferred Work

- **范围** — Registry 只承认选定执行 owner 能建立的证明。
- **延后 ownership** — 它不提供跨主机 placement、凭证、sandbox 恢复或 stalled Team 的自动恢复。
