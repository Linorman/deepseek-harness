# @clocky/clocky-acp

[English](README.md) | 中文

通过 JSON-RPC stdio 提供的仅面向自动化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 服务器。ACP 将每个客户端会话投影为一个本地 Team run：它接收 human 文本／图片输入、流式传递已提交的 coordinator 输出、接收显式 Team final 结果、转发一次性权限请求，并请求软中断。仓库中的主要客户端是 [`clocky-subagent-acp`](../../subagent/subagent-acp/README.zh.md)。

此包是传输适配器，而非 UI 集成或能力 seam。它不公开编辑器导航、transcript（文本记录）回放、命令、模式、配置选择器、信息征集、推理（reasoning）、计划、标题或工具展示。交互式渲染与向用户提问属于 Web 宿主和客户端模块。

## 插件

`apply(ctx, config)`在 stdin/stdout 上打开 `AgentSideConnection`，并要求存在 `ctx.teamRuns`、`ctx.teams` 和 `ctx.agentDefaultModel`。stdout 专用于协议帧。TeamRun 通过当前默认模型选择来选择 coordinator 的模型。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `interruptRetryAttempts` | `3` | Team journal cursor 冲突后接收软中断时，有界的重新读取尝试次数，必须为正数。 |

<a id="protocol-contract"></a>

## 协议约定

| 方法 | 行为 |
|---|---|
| `initialize` | 协商受支持的版本。只有当前默认 provider/model 和持久附件存储都明确支持图片时，才公布图片提示词能力；音频与嵌入上下文保持 false。不公布编辑器、终端、文件系统、MCP 或会话管理能力。 |
| `authenticate` | 空操作，因为服务器不公布身份验证方法。 |
| `session/new` | 校验一个绝对 `cwd`，创建默认本地 TeamRun topology，并返回与 Team id 和 coordinator Session id 均不同的随机 ACP id。接受空的 `additionalDirectories` 和 `mcpServers`；非空值会被拒绝。 |
| `session/prompt` | 先接收有序文本和受支持的内联图片块，再追加一个可信 human 的 direct-v3 Envelope。它等待 `team_final`、面向 human 的持久 receipt、coordinator release 和 Team completion。缺少 final 或模型失败时会拒绝。已完成的 ACP session 会拒绝后续提示词。 |
| `session/cancel` | 中止本地内容／final 等待，并请求 TeamRun 签发一条持久 human-to-coordinator soft-interrupt proof。未知或已完成的 id 均为空操作。 |
| `session/update` | 按顺序发出已提交 coordinator 文本／图片块。若 coordinator 尚未发出相同结尾，显式 final 文本会在已有输出之后发出。省略原始增量和非消息事件。 |
| `session/request_permission` | 为携带工具调用 id、由桥接层拥有的批准请求提供一次性允许／拒绝选项。 |

一个连接可以拥有多个 ACP session，每个 session 表示一项 Team task。ACP record 以不透明 wire id 为键，并按确切 coordinator Agent identity 建立反向映射，因此 coordinator Session event 和权限请求不会因匹配的 wire id 而被错误路由。

## 生命周期

客户端断开与 Cordis 释放共用同一个记忆化清理流程。桥接层拒绝新工作、中止未完成的 ACP 等待，然后对每个所属 run 调用 `ctx.teamRuns.cancel()`，并等待有序输出投影。这会先将 active 或 quiescing Team 迁移为 `cancelled`，再释放其 coordinator lease。单个成功提示词则由 TeamRun receipt 其 final Envelope 并完成 Team。

## 模型体验

### 提示词文本与图片

#### 模型看到的内容

coordinator 收到带 Team provenance 的 direct message：先是发送者前缀，再是由 `session/prompt` 接收的有序文本和持久图片引用。resource link 会成为带方括号的文本引用。内联图片 base64、ACP wire id、权限选择和传输元数据不会进入模型请求。TeamRun 的 coordinator prompt 要求其在 direct channel 上调用 `team_final`；assistant message 本身不是 final result。

#### Token 影响

direct-v3 message 和 coordinator system prompt 会进入 coordinator Session history。文本和图片费用取决于数据；final-result tool 与 receipt record 可以从 Team 和 Session log 重建。

#### KV Cache 影响

输入追加在可复用 coordinator prefix 之后。final-output instruction 在该 Team run 内保持稳定。

### 权限决策

#### 模型看到的内容

不会直接看到任何内容。所属工具通过常规工具结果路径记录其允许、拒绝、取消或不可用结果。

#### Token 影响

只有所属工具的结果会贡献 token。

#### KV Cache 影响

仅通过所属工具的结果追加。

## 已知限制与暂缓事项

- **仅新建本地 Team run**：不支持加载、列出、恢复、归档和单 session close。
- **每个 ACP session 只有一项终态 task**：`team_final` 会完成并释放 coordinator；另一项 Team task 需要创建新的 ACP session。
- **仅光栅图片和一个 workspace**：图片提示词要求持久存储以及明确声明支持图片输入的默认 route；只接受 PNG、JPEG、WebP 和 GIF。音频、嵌入资源、非空附加目录和 MCP server 都会被拒绝；resource link 会展平为文本而非获取内容。
- **仅已提交答案**：实时进度、推理、工具活动、计划、标题和用量不会通过协议传输。
