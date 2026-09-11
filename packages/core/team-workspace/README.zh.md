# @clocky/clocky-team-workspace

[English](README.md) | 中文

`@clocky/clocky-team-workspace`定义了具名 `ctx.teamWorkspaces` 注册表，用于 task execution-root provider。它按 Team task 携带的不可变 `TeamTaskWorkspaceMode` 选择 provider，但不导入 Team Hub implementation、Agent、Session loop、filesystem backend 或 transport。

## 提供方约定

`TeamWorkspaceProvider`以一个非空名称为一个或多个不同 workspace mode 注册。只有一个 live provider 可以拥有一个 mode。若 composition 没有 task 所需 mode 的 provider，`resolve(mode)`会失败；可选的`preflight(mode, { task, participant, route })`在 activation 前拒绝不兼容 route，不进行 allocation，也不修改 Team state；`eligible(mode, { task, binding })`只检查已绑定的 candidate，不会 allocation。`prepare(mode, request)`返回不含 root 的 provider metadata，`materialize()`只会在 Team reservation 之后创建 live root，`restore()`重新打开准确的 durable metadata。`reconcileRelease()`会证明或完成 release-requested cleanup，而不会创建 root。

`encodeTeamWorkspaceChangeSet()` 与 `parseTeamWorkspaceChangeSet()` 定义了非 Git provider 使用的 bounded portable JSON payload；这些 provider 各自拥有 integration target。payload 携带一个 source attempt、互不重复且安全的相对 path、file bytes、symlink target 与 deletion；target authorization、expected-version fence、staging 和 recovery 语义仍由各 provider 负责。

preparation 与 allocation metadata 携带 Team、task、current attempt、assigned revision、Participant、activation 和 Session identity；root 与 credential 仍是 live provider data。注册表会拒绝 provider 或 identity 与请求不符的 metadata 或 materialized result。live allocation 保留幂等的 `release()` operation。`publish(mode, request)`报告 provider-owned change；`integrate(mode, request)`是显式 proposal／merge 操作，权限仍由 provider 与 policy 负责；`integrateSource(provider, request)`将 completed source attempt 的 durable artifact manifest 交给指定 provider，因此 source allocation 可以在 integration 前释放。Provider 绝不自动 merge 或 force-push。注册表只拥有 registration identity；provider 拥有 root allocation、resource cleanup 和 eligibility policy。task-delivery Consumer 拥有准确 Agent-keyed live root 与可选 cleanup settler；activation owner 会在本地 process disposal 前 await 它。

Allocation 可以通过`onLoss()`提供准确的 provider 观察。当前 Agent Client 将 world 与已保存 artifact 记录为`unavailable`，仅停止 task 的准确 turn，并在 attempt settlement 前释放已确认过期的 world。执行状态未经确认时保持 stalled；路径缺失不会变成替代 world。[Loss 所有权](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.zh.md)。

Provider 可以提供默认关闭的 periodic observation pulse。Pulse 通过相同的 Team WAL 和 proof path 为有界的 live allocation 记录 `stage: 'periodic'`；它不代表 filesystem lock，也不识别 writer。

## 模型体验

### Team workspace 注册表

#### 模型所见

`ctx.teamWorkspaces`不注册 prompt section、tool、model input 或 model output。task Agent Consumer 决定 provider-backed allocation 如何改变 execution behavior。`publish()`报告 provider-owned change；`integrate()`处理仍 live 的 owned allocation，`integrateSource()`则从 durable artifact 处理已完成的 source attempt；两者都会显式表达 proposal／merge 决策，权限仍由选定 provider 和 Team policy 负责。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

该注册表不拥有 model request prefix。

## 已知限制与延后工作

- **没有默认 provider**——composition 必须为它调度的每种 task workspace mode 挂载 provider。
- **没有 task mutation 或 artifact storage**——Team provider 仍是 lease 和 task lifecycle 的 authority；workspace 和 artifact provider 拥有各自独立的 resource。
