# clocky-team-workspace-local-files

[English](README.md) | 中文

本地 sandbox 与共享目录 Team workspace provider 共用的文件系统实现。它发布变更的普通文件，将已验证的可移植变更应用到私有暂存目录，检查普通目录祖先，并通过精确恢复标记执行暂存目录集成。Provider 配置、分配授权、版本扫描、确定性磁盘命名及目标选择仍归消费者 provider 所有。

## Contract

文件发布遵守 provider 的单文件字节上限及 artifact store 路由。没有 artifact store 时，文件获得 provider 所有的本地 URI 引用与 SHA-256 哈希。已删除、非普通文件及超限路径不产生文件 artifact。

可移植变更不能删除或替换目录、穿过符号链接写入，或逃逸目标根目录。父目录创建拒绝已有符号链接及非目录祖先。prepared 恢复标记采用独占创建；只有通过校验后，integrated 标记才替换 prepared 记录。辅助函数显式接收 provider 的诊断标签，保留各 provider 的错误契约。目录集成暂存私有副本，在提交前复查目标版本，并根据 prepared/integrated 标记恢复或清理确定性备份。

## Verification

Sandbox 与共享目录 provider 测试通过现有分配、发布、集成、恢复及错误路径验证这些辅助函数。该包不拥有独立运行时事件流。

## Model Experience

### 本地 workspace 文件操作

#### What the model sees

该库不注册 prompt section、工具或模型输入。`materializeArtifacts()` 将文件引用返回消费者 provider，由 provider 拥有 artifact 发布及精确任务尝试来源。

#### Token effect

零直接 token 影响。消费者 provider 拥有 artifact 与 change-set 上限。

#### KV Cache effect

无影响；该库不创建模型请求前缀。

## Known Limitations and Deferred Work

- 这些文件系统原语不获取跨进程分配锁。Provider 拥有集成串行化、目录版本复查、精确分配来源与生命周期收敛。该库不实现远程文件系统或 Git worktree 操作。
