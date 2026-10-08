# Agent Note: 共享 provider 操作与本地文件系统所有权

Status: implemented

[English](2026-10-03-shared-provider-operations.md) | 中文

## Problem

本地与远程 workspace provider 复制了分配身份、预留、来源策略准入及恢复标记来源规则。Sandbox 与共享目录 provider 还重复实现了本地文件发布及安全的可移植变更操作。Host 与 SDK transport 独立构造相同的人类凭证并遍历 Session 祖先，使等价消费者的授权规则可能产生偏差。

## Decision

Core Team 拥有不可变 activation binding 比较、完整的零值 metrics 构造，以及解析后 channel/task 人类凭证构造器。凭证保留完整、精确且不含 actor 的 payload，以及原来的 cursor 或 revision fence。各 transport 继续解析自身输入、解析服务器所有的 Team 身份，并验证当前 principal。

Core Session 根据调用方提供的内存与持久化 header 读取器遍历最近所有者。持久化清单按需最多读取一次；缺失或成环的祖先返回不可用。Host 内容读取保留拒绝行为，SDK 列表保留排除行为。Core header 校验还拥有对废弃 product metadata 的拒绝；JSONL backend 保留额外的废弃 policy 字段拒绝。

Core Workspace 拥有不依赖 provider 的精确分配键、基本 metadata 比较、活动本地 Participant 资格、独立预留注册表、单次物理创建、按目标串行的集成队列、来源集成策略事实、可移植 artifact 解码及公共恢复标记来源。执行世界比较仍由拥有该世界的消费者负责。Worktree provider 保留已有的 Promise 分配所有权及操作队列。

`team-workspace-local-files` 实现库为 sandbox 与共享目录消费者提供公共本地文件发布、目录祖先检查、可移植变更及本地恢复标记 IO。它接收已解析的 artifact 上限与 provider 诊断标签，不导入任何 provider 实现。该库还拥有本地目录集成的暂存、内容版本复查、备份恢复，以及 committed/prepared 标记收敛。Provider 保留根目录选择、版本扫描、目录断言、确定性磁盘命名及分配授权。远程 E2B adapter 保留自身 transport 与执行世界丢失处理。

Host 变更准入、actor 凭证调用、投影及错误映射采用一份本地实现。Channel 路由保留 channel 到 Team 的查找及协议校验。Principal inbox 操作共享当前授权调用准入，不改变哪些失败携带 Team 身份。HTTP supervisor 客户端及端点共享标识同一部署的校验字段，各自保留 transport 专属资源上限。

OTel Session provider 提供独立的 `./pipeline` SDK 支撑 subpath，供 Session 与 Team backend 共用。它不导入 Session 服务或 capture policy，也不挂载插件。各 backend 保留隐私、severity 映射、scope 命名、alert、flush 及有界 shutdown。ACP 与 SDK 启动共用 timeout 库的取消竞争操作；各 provider 仍拥有停止并等待收敛的责任及自身取消诊断。

Simulation 所有者共用 prepared context 超限发布、空 effect continuation 确认、checkpoint 所有者移动分类及独立的 run 本地 provision 队列。Scenario driver 共用 activation seed/model 选择，同时保留各自 eviction policy；task executor 共用 resident drive 停止处理。Product command 保留不同的 terminal/admission 失败语义，只共享后台工作保留。Task definition 消费者从 Core 校验器显式选择支持字段，使不安全的 priority 与 attempt count 在 decision acceptance 前拒绝；Simulation specification 仍拒绝调用方指定 actor、execution、placement 及 workflow 字段。

## Alternatives considered

**通过 Core 重新导出 provider 实现。** 这使复制的所有权留在错误层级，并使 Service Definition 依赖平台行为。公共协议规则归 Core，本地文件系统代码拥有单独实现所有者。

**在 provider 之间共用可变分配控制器。** Provider 生命周期、物理根目录及恢复必须独立。各 provider 拥有独立注册表和队列，只复用操作规则。

**共用一个通用 transport 变更 schema。** Host 与 SDK wire schema 的输入归一化与服务器所有身份不同。它们保留解析，只在解析后共享凭证构造。

## Consequences

公共规则都有当前消费者及唯一实现。Provider 与 transport 授权仍然显式，包括精确 attempt/activation 身份及当前 principal 生命周期。现有错误信息、标记格式、确定性路径、模型输入及已发布协议字段保持稳定。本地实现库给两个本地 provider 各增加一个静态依赖，并新增一个 Host 编译项目。

## Testing

协议整理后，五个 workspace 所有者测试通过：14 个文件、117 项测试。本地文件逻辑提取后，sandbox 与共享目录测试通过：五个文件、33 项测试，覆盖发布、恢复、可移植变更及错误路径。Host Team 与人类交互测试通过：两个文件、94 项测试。SDK 通知祖先、Core 人类凭证及相邻所有者检查也通过。覆盖 workspace、OTel、timeout 及 AgentRuntime 所有者的组合 source 测试通过：25 个文件、263 项测试；这些所有者的 typed lint 通过。Simulation Local/Team 测试通过 54 个文件、1,159 项测试；Product 测试通过 41 个文件、347 项测试。Core AgentRuntime 发布测试通过五个文件、73 项测试；ACP/Agent Client review fence 测试通过八个文件、252 项测试。Task schema 与拒绝测试通过 40 项测试，本地文件符号链接保护通过两项测试。本任务 scope 的所有 Client、Host、workspace、AgentRuntime、OTel 及 Simulation 重复均已移除。全仓重复代码及 build 验证仍由任务整体门禁负责。
