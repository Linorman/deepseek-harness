# Agent Note: 移除第一方产品集成

Status: implemented

[English](2026-08-27-remove-first-party-integrations.md) | 中文

## 问题

尽管提供方路由与 slot 机制已经支持由部署方选择，插件 harness 仍携带多个第一方产品集成。专用模型适配器、出站搜索提供方、首次使用流程、遥测身份、徽章 skill（技能）、品牌包、产品 subagent transport 和外部 hook bridge，分别向原本可复用的路径加入代码、默认值与产品假设。

## 决策

仓库移除这些专用的第一方集成，同时保留底层扩展点：

- `llm-pi-ai` 是唯一随附的模型适配器，并保留 `deepseek` 提供方 profile。DeepSeek 仍是提供方配置与验证目标，不是产品默认值，也不是独立适配器包。
- base 组合不再包含活跃提供方路由或选定模型。Web、headless、SDK、ACP 和 JSON-RPC 入口要么显式接收提供方／模型选择，要么报告可操作且与提供方无关的配置错误。通用 Models 页面编辑提供方路由，不再显示供应商专属的首次使用面板。
- 提供方无关的 Web 能力、HTTP fetch、Exa 与 Perplexity 集成继续作为可选构件。base 组合不挂载任何出站搜索提供方。
- 官方品牌包、徽章 skill、社区图形和专用首次使用资源均被移除。浏览器与文档中持续存在的图片位置使用共享的机器人回退图形；已删除的内容块与无效操作作为完整单元移除。
- 从 feedback、遥测和提供方请求中移除跨服务匿名身份。OpenTelemetry 仍是可选的部署插件，需要显式端点，且不携带仓库创建的 `user.id`；本地 feedback 仍保持本地。
- SDK server 初始化会校验提供方所有者已经存在于外围 Cordis 组合中。TypeScript 与 Python SDK 调用方显式提供提供方／模型选择，不再获得提供方后备值。
- 移除 Codex 与 Claude Code subagent 提供方和外部 hook bridge 插件。通用 subagent 服务保留进程内、ACP 和 Clocky SDK 提供方；类型化 Cordis 拦截点与共享 hook 协议库仍可供部署方自己的 bridge 实现使用。

面向用户的产品名是 Clocky。本地包名、CLI、环境变量、文件系统、manifest、线路、SDK 和 Python 标识均使用所有者提供的[身份提案](../../proposed/simplification/2026-08-26-generalize-agent-harness.zh.md)中记录的 Clocky 派生名称。最终发布账号和公开仓库 URL 仍是发布阶段的外部输入；这里不添加兼容别名，也不虚构远程所有权。

## 验证

已删除的包不再出现在 workspace 引用、锁文件解析、生成目录、运行时闭包、随附组合行或产品专属 fixture 中。Models、API、SDK、遥测、归属、replay 和 headless 测试覆盖提供方无关行为；通用 subagent 与原生拦截覆盖仍位于各自所属包中。无密钥 snapshot replay 与 JSON-RPC smoke 使用脚本化提供方 fixture；pi-ai 测试保留聚焦的 DeepSeek 提供方覆盖。真实应用内浏览器已检查 Web shell 的机器人标记、文档标题和通用 Models 页面；文档投影与本地机器人资源构建成功。

## 曾考虑的替代方案

**将专用模型适配器作为可选包保留。** 否决，因为通用 pi-ai 路由已经服务保留的提供方 profile，而专用包会继续保留第二套请求实现、默认路径和设置族。

**只做产品名称的文字重塑。** 否决，因为这样会把提供方默认值、出站搜索、首次使用、遥测身份和 SDK 后备行为换一个名称继续绑定到产品。

**同时移除 DeepSeek 提供方支持。** 否决，因为通用提供方路由及其聚焦测试仍然支持 DeepSeek，同时不会让它成为 harness 身份。

**删除品牌图形后留下空位置或纯文本替代。** 否决，因为持续存在的图片位置会变成布局或渲染回归。机器人回退图形负责这些位置，而已退休的功能块直接消失。

**将产品 subagent transport 作为可选 Bundle 保留。** 否决，因为没有随附组合需要原生产品运行时；保留它们会在通用 subagent 服务旁继续维护提供方专属的进程、依赖和工具清单所有权。

**保留第一方外部 hook bridge。** 否决，因为部署方自己的原生插件可以直接订阅类型化拦截点，而保留的协议库不需要随附 bridge 实现。

## 后果

部署失去专用 Files API 生命周期、直连适配器默认值、第一方搜索端点、供应商首次使用便利、匿名关联、随附徽章、原生 Codex／Claude Code subagent transport 和第一方外部 hook 配置，同时获得更小的 base 组合、显式提供方选择、通用设置行为以及单一所有权路径的提供方适配器。既有的专用提供方会话和用户数据不会被自动改写或删除。未来部署仍可通过保留的 slot、seam 与插件提供自己的品牌、可选遥测、bridge 实现或原生产品 transport。
