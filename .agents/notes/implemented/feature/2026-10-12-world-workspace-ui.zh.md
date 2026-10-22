# Agent Note: 先于 Host 领域读取交付世界工作区 UI

Status: implemented

[English](2026-10-12-world-workspace-ui.md) | 中文

## Problem

[世界 UI 设计](../../../plans/2026-10-11-world-simulation-completion/ui-design.md)规定了作者台、组织／制度／外部世界模块、四轨事项和统一管理流。Host 与 Client runtime 目前只发布世界创建、预检、导出和招聘案件。等待全部领域读取会让工作区缺少结构；而把占位内容当数据渲染，又违背“界面只显示 Host 事实”的规则。

## Decision

`@clocky/clocky-client-ui-simulation` 基于 `src/client/world-domain.ts` 中预留的类型化领域接口交付完整世界 UI。`WorldDomainState` 为每个拟议投影（模板、概览、组织、人物、制度、提案、制度版本、外部世界、身份、事项扩展、操作字段、操作预览）保留一个 `WorldWindow<T>`，`WorldDomainReads` 命名对应的有界读取。在 Client runtime 投影这些读取之前，`apply` 注入 `createUnpublishedWorldDomain()`，其领域窗口保持 `unpublished`；模块将其显示为明确的不可用状态，计数保持 `FactValue` 不可用而不是 0，管理提交保持禁用。

作者台消费可选目录 `worldTemplates`，其中只包含明确公开的 `world.authoringTemplates`。Host 验证完整 v1 定义，将其计入已安装模板额度，且不会从私有 run 导出推导公开模板。它编辑一个规范 JSON 模型，用 Host 自身的仅语法解码器（`decodeScenarioInput`，现由 `@clocky/clocky-simulation-scenario` 导出）解析源码，在本地运行共享编译器发现结构错误，只把解析成功的定义发往现有预检。创建复用保留的 `world-create` 原命令。空白定义使用 `clocky.world/v1`，全部支持的分节均可编辑。复合 JSON 单元格及可为空的区间结束值保留完整编写模型。未完成的本地文本在切换视图时保留；取消重新生成或拒绝有界变更会恢复父草稿。旧 `clocky.world/v0` 编译器不接受的分节仍以只读“已预留”状态显示。未知的源码专有字段保持可见，不会丢失。

所有 World 预检响应均要求 `scope.source: simulated-only`，包括旧版招聘预览。未知或缺少来源标记会在 Host/TypeScript/Python 边界拒绝，不补造仅模拟保证。预览和保留的 World 运行页面使用同一不可关闭的模拟说明，置于折叠详情之外，在引擎导航及页面重开后持续可见；说明外部行为不使用真实网络、付款或邮件，未发布的领域数据仍保持未发布。

世界运行由保留的场景模板（`clocky.world/v0/*` 或 `clocky.world/v1/*`）识别，从不依据名称。其主导航行放置五个世界模块，引擎模块收进一个“引擎”菜单；其他运行保持原有模块行。

世界文件平铺在 `src/client/`（`World*.tsx`、`world-*.ts`），因为客户端领域图门禁禁止 `Workspace.tsx` 等顶层文件导入子领域目录。

客户端插件 bundle 通过依赖包对象形式的 `browser` 字段解析被内联的依赖（`packages/client/tsdown.client.ts` 中的 `browserFieldTarget`）。`yaml` 的 Node 构建导入 `process`，浏览器模块表无法提供；其声明的浏览器构建不需要。

## Alternatives considered

**等待 runtime 投影。** 会把导航、布局、可访问性和动效评审推迟到 Host 工作完成之后，并让 UI 评审依赖后端排期。

**在发布插件中使用 fixture 演示数据。** 会把虚构的组织或投票事实当作观测结果展示，违反事实优先规则；fixture 只保留在测试和本地评审 gallery 中。

**在客户端复制校验规则。** 会与 Host 漂移；共享编译器包已能在浏览器中运行。

**只在打包器中为 `yaml` 设别名。** 通用的 `browser` 字段映射能解决这一类仅支持 Node 的构建，而不必点名单个包。

## Consequences

runtime 实现 `WorldDomainSource` 并在 `apply` 中注入即可替换预留数据源，无需修改 UI。在此之前，生产环境中除作者台、事项与导出之外的世界模块显示不可用状态。`world-domain.ts` 中拟议的 DTO 形状须与最终 Host DTO 保持一致，或一起有意修订。Simulation bundle 现在包含 YAML 解析器。此前内联了仅 Node 依赖构建的 bundle 改用其声明的浏览器构建。

## Verification

`pnpm exec vitest run packages/client/ui-simulation` 覆盖草稿模型往返、组件状态矩阵、作者台检查／定位／锁定流程、模块观察规则、管理流以及组装工作区中的世界导航。`scripts/client-bundle-purity.spec.ts` 固定 `browser` 字段映射。
