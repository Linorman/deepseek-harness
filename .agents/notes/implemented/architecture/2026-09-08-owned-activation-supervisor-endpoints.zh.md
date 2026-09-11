# Agent Note: 有所有权证明的 activation supervisor endpoint

Status: implemented

[English](2026-09-08-owned-activation-supervisor-endpoints.md) | 中文

## Problem

Hub 无法从传输断开证明执行已经停止，经过认证的远程调用方也不能任意选择要杀死的进程 id。现有 SDK process fencer 能在本机提供准确的进程树证据，但恢复操作需要具有明确版本的远程 owner 和持久登记，才能通过网络使用这些证据。

## Decision

[Supervisor registry](../../../../packages/core/activation-supervisor/README.zh.md)按准确名称/版本解析实现，并验证每次返回的完整 activation-generation descriptor。Health 有四种结果，只有`terminated`能作为 fence 结果。Provider 退役阻止新操作，已接纳操作保留其实现。

[HTTP endpoint](../../../../packages/agent-runtime/activation-supervisor-http/README.zh.md)只登记可信本地 SDK provider 在 activation 发布前产生的进程身份。持久 stream 记录 Team、Participant、Session、runtime provider、进程创建身份和 supervisor generation。HTTP 只暴露 health 和 fence，凭证无法登记另一个进程。Endpoint 在调用现有 SDK process-tree fencer 前，比较请求与持久 owner record。确认终止后先持久化再返回响应，使重启后的 fence 重试可重复。

Activation controller 的监督解析不依赖具体传输。版本缺失、endpoint 不可达及执行状态未知会产生准确当前 epoch 的 Team stall，不会将 activation 标记 offline。Cold replacement caller 的 `AbortSignal` 会传入 supervisor-backed fence，因此取消可以停止进行中的远程 fence request；caller cancellation 会直接传播，不会记录 fence-failure stall。Recovery 通过有界分页发现 Team，并接受显式配置的 supervisor host。SDK provider 仍负责进程 placement 和 replacement 所需的 Session 可用性。

## Alternatives considered

**将断连视为终止。** 拒绝，因为远程工具可能在 Link 关闭后继续改变外部状态。

**接受任何认证进程 descriptor。** 拒绝，因为凭证证明的是请求部署，而不是任意进程的所有权。只有本地 runtime 登记能建立该关系。

**重启后选择更新的 supervisor 版本。** 拒绝，因为进程身份和 fencing 语义是具有版本的执行合同。

## Consequences

远程监督不增加 model loop 或 prompt。仍要求准确的进程创建身份，macOS 保留 fail-closed 限制。[SDK placement 决策](2026-08-28-sdk-remote-agent-runtime-placement.zh.md)继续拥有 fresh/resume 与本地进程所有权语义；本文拥有其远程监督扩展。两份记录均未被完全取代。[Native Team 提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)继续拥有跨主机 placement、E2B loss 及完整分布式验收要求。

## Verification

针对性测试覆盖 fence 接纳期间退役、generation 不匹配、unknown/unreachable、持久 owner 重启、凭证拒绝、进程身份替换、版本选择、不调用本地 fencer 的远程恢复，以及无效 recovery-stall authority。仅 Linux 运行的 HTTP process 测试启动并终止真实 detached child，再在 endpoint 重启后重放终止结果；当前 macOS 主机跳过此项。跨主机部署和 E2B loss 验收未由这些本地测试证明。
