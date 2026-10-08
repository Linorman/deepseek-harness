# Agent Note: 真实 Loader fixture 的所有权

Status: implemented

[English](2026-10-03-real-loader-fixture-ownership.md) | 中文

## Problem

真实 Loader 测试会暴露手动挂载单元 fixture 未覆盖的环境和权限假设。临时工作区位于检出目录下时，项目发现若不在本地停止，就会继承父目录的指令和技能。没有产品 principal 的 Host 事件订阅者无法观察 principal 拥有的 Team 请求。已交付 profile 的解析器也无法导入未声明在依赖闭包中的可选 provider。

## Decision

共享 ACP（Agent Client Protocol）和 Loader-smoke harness 在填充工作区前创建本地 `.git` 项目标记。fixture 自身的指令和技能仍然可见；`TMPDIR` 位于项目内时，不相关的父检出目录内容不会进入模型的持久日志。此标记不会使工作区成为可用的 Git 仓库；测试 Git 行为的场景自行初始化仓库。

Simulation benchmark 的来源清单在读取以 NUL 分隔的名称前，将 Git 查询限定为 packages、vendor、Simulation 场景以及明确拥有的 driver／manifest 路径。清单省略工作树中已删除的 cached 路径，并保留当前未跟踪的源文件。不相关的笔记和临时输出不会耗尽子进程输出缓冲区；未提交的重命名不会让采集器读取已删除的旧路径。

Host 问答、审批、取消和保留 fixture 为整个场景认证稳定的测试 principal，包括事件订阅。human participant 属于该 principal，创建过程通过 `createPrincipalChannelAdmission()` 确认精确的邀请。租约保持有效直到场景结束，先撤销租约，再注销 provider。生产权限检查和事件过滤仍然执行。

以 assistant 文本结束的旧 ACP 回放脚本使用显式配置的测试专用 finalizer，匹配当前 direct-v4 协议。生产完成仍然要求显式 final Envelope。精确 schema、提示词和日志断言保持启用；只有核对声明源和成功运行行为后，才机械迁移已知的文案、包名和 JSON 键顺序变化。

构建 profile 测试要求已退役的 Goal 行不存在。生成的 Remote 冒烟通过普通 Node、真实 HTTP 路由、非法输入拒绝，以及显式和 Agent 作用域调用，覆盖当前 commands namespace。CLI overlay 使用的可选 ACP runtime 和摘要认证 principal provider 声明在 CLI 解析器的 dependencies 中。

生命周期 fixture 保留每次状态转换的公共所有者。Cordis effect disposal 仅移除一次 supervisor 注册，因此退役被替换的 fiber 不会删除其继任者。ACP 取消在返回前等待 coordinator interrupt 请求。浏览器启动诊断保留 stderr 的第一行，支持 LF 和 CRLF 分隔符。Simulation 请求比较仅在 receipt 与领域结果均为终态且不同的时候报告 conflict；accepted receipt 不会同时处于 conflict。

## Alternatives considered

**放宽生产认证，或从任意 assistant 文本推断最终输出。** 这会通过删除需要保护的行为使测试通过。fixture 改为在已有扩展点提供认证和显式完成。

**将临时工作区保留在项目外。** 仓库要求临时输出留在项目内，调用者也可能指定项目内 `TMPDIR`。本地发现标记在两种位置提供相同的指令边界，无需删除 fixture 自身的指令文件。

**失败后刷新全部快照。** 这可能将缺少工具、权限失败或截断日志接受为新基准。任何经过审查的机械基准迁移之前，先修复运行缺陷和不完整 fixture。

## Consequences

测试复现当前产品权限和配置，不再依赖过期默认值。fixture helper 持有真实 principal 租约并确认端点，因此事件可见性和清理成为被测生命周期的一部分。已有的 [ACP 回放决策](2026-06-19-acp-snapshot-tests.zh.md)、[嵌套 Session 回放决策](2026-06-22-subagent-snapshot-replay.zh.md)和[分配元数据决策](2026-08-31-team-snapshot-workspace-metadata.zh.md)保持有效：它们分别拥有独立的回放或分配保证，本文没有替代这些决策。

## Verification

聚焦的 Loader-smoke、ACP-harness、Remote lookup 和 Simulation watch 单元测试通过。真实 Loader 问答和审批场景在 JSON、SQLite 上通过，结果基准无需修改。CLI profile 组合、构建配置转储和构建 commands Remote 冒烟覆盖修复后的入口。ACP 回放保留精确提示词、schema 和持久日志比较。

四个 Simulation benchmark 快照文件的 36 项测试全部通过，覆盖 actor／world、存储和消息工作负载、实时样本及组织恢复，并使用有界的来源清单。

SDK reader fixture 在授权期间通过真实 Cordis disposer 退役 Team 服务，要求等待中的读取拒绝且不启动 Agent。ACP provider fixture 启动真实子进程，同时控制外部 Link claim 和传输结束：所有权、view 或 attempt 不一致时，proxy 日志和 receipt 不发生写入；取消为重试保留已接纳输入；完成后对持久回放去重。header 持久化失败或 enrollment issuer 不可用时，在重试前释放 proxy Session 并证明子进程退出。公共测试还验证 supervisor 替换与 disposal、取消完成、浏览器首行诊断以及上述 receipt 比较关系。
