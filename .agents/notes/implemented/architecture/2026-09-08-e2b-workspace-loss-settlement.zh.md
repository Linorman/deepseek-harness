# Agent Note: E2B workspace 丢失结算

Status: implemented

[English](2026-09-08-e2b-workspace-loss-settlement.md) | 中文

## Problem

过期的 E2B sandbox 无法凭路径恢复 workspace。Manifest 缺失也阻止安全复用，但不能证明执行世界已经停止。将两者都当作普通保留目录，会使 task outcome、artifact 可达性和执行终止状态含混。

## Decision

Remote allocation metadata 记录准确的 E2B execution-world 身份。Provider 在 restore 和 cleanup 时检查该身份，并有界轮询所拥有的 manifest。只有权威`SandboxNotFoundError`证明 sandbox 过期；world 变化或 manifest 缺失意味着 unavailable，没有终止证明。网络失败仍是可以重试的普通观察失败。

Team journal 将 allocation 记录为`unavailable`，保留准确 world、loss 原因、终止证据和已保存 artifact reference。Source-owned proof 绑定 allocation revision 和完整观察。Hub 拒绝其他 world、丢弃既有 artifact，以及完成已丢失 workspace 的 task。未经确认的 loss 原子地使 Team admission 进入 stalled。Loss record 在 preservation 和 release 后继续保留。

Agent Client 阻止使用不可用 root，并用 task 的准确 Session turn evidence 停止其工作。确认过期后可以释放资源，再记录失败 attempt；现有 attempt limit 选择 retry 或 terminal failure。执行状态未经确认时，资源保持 unavailable，Team 保持 stalled。无法建立准确 stopped-task evidence 时，以特定原因保留 allocation，不会提前结算 attempt。

Provider-backed artifact 每次保存成功后，都将 reference 写入本地、独立版本的 storage-log manifest。因此，部分发布在 sandbox 过期或 provider 重启后仍保留已经提交的 reference。Loss snapshot 参与 artifact 可达性、Host/SDK bytes 读取和 private reference 过滤。仅有远程 URI 不会被保留为可用 bytes。

## Alternatives considered

**在相同路径重建 sandbox。** 拒绝，因为路径既不能建立 execution-world 身份，也不能恢复丢失文件。

**将 manifest 缺失视为执行已终止。** 拒绝，因为 sandbox 内的进程可能仍存活，所有权证据缺失不能授权删除。

**只在发布操作的内存中保留 artifact reference。** 拒绝，因为后面的文件读取可能在先前文件已经保存后失败，导致可用证据丢失引用。

## Consequences

[Sandbox provider 决策](2026-09-03-team-sandbox-workspace-providers.zh.md)继续拥有 allocation 和 integration 语义。本文新增显式 loss settlement，不取代 local sandbox、shared-root 或 worktree 行为。[Supervisor endpoint](2026-09-08-owned-activation-supervisor-endpoints.zh.md)继续拥有远程进程 fencing；workspace 丢失不提供其他 activation 的 fence。

## Verification

Provider 测试覆盖部分发布后过期、provider 重启后的 retained reference、重复 loss 通知、网络不确定性和 world 变化拒绝。真实 Agent/Hub 测试证明 release 前准确 turn settlement、attempt retry、未经确认 loss 的 stall，以及其他 world 观察的拒绝。Artifact transport 测试覆盖 loss reference 读取和 private reference 拒绝。带 key 的 E2B expiry 和多主机部署仍属于独立的发行证据。
