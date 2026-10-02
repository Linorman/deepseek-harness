# Agent Note：按主体授权的 SDK Team 读取

Status: implemented

[English](2026-09-28-sdk-principal-team-readers.md) | 中文

## 问题

已认证 SDK 连接标识主体，但不授予所有持久 Team 的访问。原始目录暴露 grant 和存储位置；选中 Team 正文、频道等待与产物 provider 可能在成员资格撤销后完成。

## 决策

SDK Team 目录使用 Hub 主体 reader、安全产品摘要与加密续页。`team/list` 不含物理扫描计数、grant 和 goal budget 正文。TypeScript 与 Python 接收相同响应；续页过期要求明确读取首页。

选中 Team 的管理读取在 provider IO 期间保留准确的 active-human read proof。Binder 选择直接成员或规范父团队权限；Hub 在操作前后检查空的有限身份集合，包括失败操作。Selection 响应携带由此得到的成员或父团队只读状态。不授予修改、同意或执行权限。缺失／私有 Team 返回相同 SDK 拒绝。

原始频道读取和等待私下解析已挂载所有者，再使用其 Team 权限。Watch 合并调用取消与凭据退役。产物字节使用相同检查，保留 provider 校验与字节限制。任务历史、工作区丢失结果与工作流结果在核心 selection 模块共用 Host 的纯私有产物投影。

## 考虑的替代方案

**只认证一次连接并暴露所有 Team。** 持有传输凭据不提供持久成员关系。

**过滤目录条目但保留 provider 游标。** 存储位置和隐藏 Team 身份仍可观察。

**维护两份产物删节实现。** 结果类型演进时，Host 与 SDK 可能披露不同的私有引用。

## 影响

读取可能加载 Team journal；响应额度不承诺性能。[SDK 通知决策](2026-09-29-sdk-principal-notification-ownership.zh.md) 负责管理流、精确远程 activation 通知权限和凭据退役。[Session 产品 reader 决策](2026-09-28-team-session-product-readers.zh.md) 负责 Web 路径。

## 验证

真实 Hub 测试覆盖按主体过滤目录、直接 selection、跨主体正文拒绝，以及权限撤销后扣留成功／失败结果。SDK 转发、媒体、client／schema 与 Python 回归覆盖协议变化。真实 JSON-RPC Team-final keyless 场景读取安全目录和授权 selection，不新增模型请求。
