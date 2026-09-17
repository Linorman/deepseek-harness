# Clocky 架构

[English](architecture.md) | 中文

改动 `packages/` 下的任何内容之前，请先阅读本文。本文假定你已了解 Cordis；如果尚未了解，请先阅读[入门](cordis-primer.zh.md)或[教程](cordis-tutorial/index.zh.md)。

建议使用 agent（智能体）探索代码库并理解其架构。

## Cordis

[Cordis](cordis-primer.zh.md) 是 clocky 底层的框架：插件向共享上下文贡献服务、类型化事件和可逆的副作用。产品的每一部分都是插件，包括模型适配器、工具注册表、会话日志，以及 agent loop（智能体循环）本身，因此每一部分都可以从配置替换。

不存在需要打补丁的特权内核：扩展 clocky 的方式是把插件挂载到其他插件旁边，而各项注册都是副作用，会在其插件卸载时撤销。

## Profile 与组合包

运行中的 `clocky` 是一棵插件树，由启动时按序叠加的各层组合而成。

**profile** 是存放在 Harness home 中的具名组装。它列出自己叠放的组合包，存放自己安装的树外插件，并保存用户自己的 `cordis.patch.yml`。`web` 和 `headless` 作为模板随发行版交付。

**组合包**是 Cordis 配置项及其挂载代码的分发格式，因此它插入的内容始终可被其上各层 patch。

两者都在各自的 `package.json` 中通过 `clocky` 字段声明自己：`clocky.profile` 列出一个 profile 的组合包，`clocky.bundle` 指向一个组合包的 patch 文件。

[`clocky-base`](../packages/bundle/base/README.zh.md) 是每个 profile 的第一层：模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测。[`clocky-web-app`](../packages/bundle/web-app/README.zh.md) 增加浏览器应用；[`clocky-headless`](../packages/bundle/headless/README.zh.md) 增加一次性运行器，且完全不带服务器。

各层按此顺序应用在空条目列表之上：先按 profile 列出的顺序应用每个组合包，然后是 profile 的 `cordis.patch.yml`，然后是 home 级的那份，最后是任意 `--patch` overlay。一条 patch 按 id 定位某个条目并替换其整个 config，或插入新条目。

要查看你的机器实际启动的配置树：

```sh
clocky --profile web --dump-config
```

它打印出的任何条目，都可以由你自己的 patch 替换。

组装机制见 [app-boot](../packages/boot/app-boot/README.zh.md#profiles)；配置字段见生成的[配置目录](config-catalog.zh.md)。

## 核心包

以下是向 Cordis 树贡献内容的部分核心包。

| 包 | 职责 | `ctx` 键 |
|---|---|---|
| [`core/session`](subsystems/session.zh.md) | 仅追加的 `SessionEvent` 日志和内存存储 | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.zh.md) | 提示词片段与工具 schema 的组装 | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.zh.md) | 作用域化的工具注册表和带把关的执行流水线 | `ctx.tools` |
| [`core/agent`](subsystems/core.zh.md) | `Agent` 接口、活跃 agent 注册表和 `agent/*` 事件 | `ctx.agents` |
| [`core/agent-runtime`](subsystems/agent-runtime.zh.md) | Participant 绑定 Agent 激活 provider 注册表 | `ctx.agentRuntimes` |
| [`core/team-link`](subsystems/team-link.zh.md) | Activation 绑定 Team Link provider 注册表 | `ctx.teamLinks` |
| [`core/team-workspace`](../packages/core/team-workspace/README.zh.md) | Task execution-root provider 注册表 | `ctx.teamWorkspaces` |
| [`core/team-artifact`](../packages/core/team-artifact/README.zh.md) | 与 provider 无关的 Team artifact storage 注册表 | `ctx.teamArtifacts` |
| [`core/agent-loop`](subsystems/core.zh.md) | 实现该接口的默认驱动器 | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.zh.md) | 按 agent 划分作用域的注册原语 | 库，无 ctx 键 |
| [`core/team`](subsystems/team.zh.md) | Team 工作系统 Service Definition、Envelope admission／receipt、适配器注册表和策略 waterfall | `ctx.teams` |
| [`llm/llm`](subsystems/llm-streaming.zh.md) | 消息与流式词汇表，以及适配器 seam | `ctx.llm` |

<a id="events"></a>

## 事件

事件就是扩展点，而选对事件域是大多数改动的第一个决定。

- **会话事件**是追加到日志并通过 `session/event` 广播的持久事实。当某个事实必须在重新加载后仍然存在时，使用它。
- **Agent 事件**（`agent/*`）携带活跃 `Agent`：inbox、步骤、状态、请求、验证、续跑。要观察或拦截进行中的工作时，使用它。
- **能力事件**无需导入循环即可向某个 seam（`fs/*`、`tools/*`、`telemetry/*`）附加策略和适配器。

[事件映射](event-producer-consumer.zh.md)列出每个事件的生产方与消费方。

<a id="turn-flow"></a>

## 轮次流程

一个**步骤**是一次模型请求加上它调用的工具。一个**轮次**包含零个或多个步骤：它在领取首条输入之前打开，并在不再欠下任何工作时关闭。

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`、`step/*`、`user/message`、`assistant/*` 和 `tool/*` 是持久会话事件；其余是分属三个事件域的实时扩展点。`agent/pre-step`、`agent/request`、`llm/stream` 和三个 `tools/*` 事件是 waterfall（瀑布式事件），其监听器必须调用 `next()` 才能委托下去；`agent/turn-stopping` 是 serial 事件，没有 `next()`。

输入通过同一个 inbox 到达驱动器。有些消息会立即唤醒它；注入的上下文会留在 inbox 中，直到另一条消息将其唤醒。

`agent/pre-step` 决定模型看到什么。监听器可以改写已领取的消息，也可以直接拒绝它们；首次领取被拒绝或被改写为空时，仍会关闭一个不含步骤的持久轮次，因此日志会记录这次尝试。每个步骤读取插件注册的提示词片段和工具 schema。

详情见[时序图](agent-lifecycle.zh.md)、[工具流水线](tool-execution-pipeline.zh.md)和[取消与错误恢复](subsystems/core.zh.md#the-agent-handle)。

## 会话日志

会话日志是模型所见上下文的来源。`deriveMessages()` 从中投影出模型历史，原始 `assistant/chunk` 事件则保证回放和 UI 保真。fork、恢复、transcript（文本记录）、遥测和持久化都派生自该事件流。

**模型可见即已记录。** 抵达模型请求的一切都必须能从日志重建，并由一项运行时不变量断言这一点。因此，新增一项模型可见输入就需要新增一个会话事件：扩展 `SessionEventMap` 并从日志渲染。

## 能力 seam

一个 **seam** 是一项可替换能力，包含三种角色：声明接口的 **Service Definition**、实现它的 **Service Provider**，以及使用它的 **Consumer**（通常是面向模型的工具）。一个包可以合并承担多个角色，但单一角色本身不是 seam；添加一项能力意味着把三者一并设计（[能力图](capability-seams.zh.md)）。

seam 正是替换一个提供方就能改变整个产品的原因。文件系统与进程提供方共享同一个执行世界，因此把它们指向远程沙箱，也就把 Bash、PTY 和 LSP 一并搬了过去，无需提供方专用 fork。[subagent 提供方](subsystems/subagent.zh.md)在同一个接口之后同样千差万别，从新建一个子 agent，到把一个轮次委派给另一个产品。

[`core/team`](subsystems/team.zh.md)是 Team Service Definition。[`team/team-hub`](../packages/team/team-hub/README.zh.md)是显式挂载的本地提供方，负责 Team journal、channel WAL、activation 投影、恢复、游标 watch、已认证 Envelope admission、持久 recipient receipt、临时 delivery claim、由 revision/epoch 围栏保护的 task attempt lease，以及精确 target soft interrupt。[`team/team-activation-controller`](../packages/team/team-activation-controller/README.zh.md)会在 `ctx.teamActivations`公开持久 bind-or-dispose ownership 和显式 fenced 冷替换；[`team/team-channel-direct`](../packages/team/team-channel-direct/README.zh.md)提供带独立 recipient receipt 的产品 direct v4 multicast；[`team/team-channel-task-assignment`](../packages/team/team-channel-task-assignment/README.zh.md)提供单 assignee assignment protocol；[`core/team-link`](subsystems/team-link.zh.md)注册 activation-bound transport client 和动态 enrollment issuer；[`team/team-link-local`](../packages/team/team-link-local/README.zh.md)拥有本地 pending-delivery 和 soft-interrupt replay；[`team/team-link-websocket`](../packages/team/team-link-websocket/README.zh.md)提供远程 v4 client provider 与 cooperative endpoint termination，而 [`team/team-link-websocket-hub`](../packages/team/team-link-websocket-hub/README.zh.md)验证 Hub upgrade 并签发 activation-local credential；[`core/team-workspace`](../packages/core/team-workspace/README.zh.md)将 task workspace mode 解析为 execution-root provider；[`team/team-workspace-shared`](../packages/team/team-workspace-shared/README.zh.md)只接受其确切 Session root 已匹配 canonical shared directory 的本地 Agent；[`core/team-artifact`](../packages/core/team-artifact/README.zh.md)解析 provider-owned artifact bytes 与 reference；[`team/team-artifact-local`](../packages/team/team-artifact-local/README.zh.md)保存 content-addressed file、patch、log、screenshot 和 report；[`team/team-agent-client`](../packages/team/team-agent-client/README.zh.md)会为 durable-bound Agent 声明 direct 或 task-assignment Link notification，仅启动 delivery-bound task attempt，消费 provider-owned workspace root，在唤醒模型步骤前 flush source、记录 receipt，在 cancellation 后确认 soft interrupt，并在 terminal Link failure 后重新连接合格 binding；[`team/tool-team`](../packages/team/tool-team/README.zh.md)公开 scope 内的 task report 和显式 final output；[`team/team-scheduler-dag`](../packages/team/team-scheduler-dag/README.zh.md)会使 durable lease 过期、打开持久 task-assignment channel，并确定性地提交其 assignment Envelope，而不直接唤醒 Agent；[`team/team-run`](../packages/team/team-run/README.zh.md)拥有 headless profile 使用的本地默认 Team topology、reviewer routing、workspace outcome publish 和 human final-result receipt。workspace allocation 会消费 provider root，`publish()`会物化有界 artifact，`integrate()`会创建可评审 proposal 或交给 merge authority，ACP/SDK process teardown 使用有界 termination；自动多主机 Hub 恢复仍是 deployment concern。

v4 WebSocket Link 支持 cooperative endpoint termination。显式挂载的 [`team/team-activation-recovery`](../packages/team/team-activation-recovery/README.zh.md)在启动时扫描匹配的未完成或外部已围栏 SDK/ACP epoch，也可配置有界 pulse。它通过本地 fencer 或已配置的远程 supervisor 将 replacement 委托给 controller；本地已结算的 epoch 只重试 wake cleanup。

[`team/team-channel-basic`](../packages/team/team-channel-basic/README.zh.md)和 [`team/team-channel-workflow`](../packages/team/team-channel-workflow/README.zh.md)提供 Team 组合使用的有界 consult、discussion 和声明式 workflow 通道适配器。[`team/team-channel-admission`](../packages/team/team-channel-admission/README.zh.md)等待持久 endpoint consent 并推进 invitation expiry；[`team/team-channel-summary`](../packages/team/team-channel-summary/README.zh.md)从 Hub 授权的 WAL 范围提取有界摘要；[`team/team-delegation`](../packages/team/team-delegation/README.zh.md)通过 Team、channel 与 workspace policy 驱动 parent-owned child-Team saga。

[`core/agent-runtime`](subsystems/agent-runtime.zh.md)为一个 Team 已解析的 Participant activation 解析具名 placement provider 和陈旧 epoch fencer。它不拥有 Team 权限；其进程内 provider 创建本地 fresh/fork/resume activation，SDK provider 则通过 SDK 生命周期／状态协议为活跃的 `remote-agent` Participant 提供 fresh/resume activation placement，在配置同主机 profile 时可先 fence child，再让 activation controller 在新 epoch 下恢复其 Session。activation controller 拥有持久 bind-or-dispose handoff；远程 placement 与远程 Link 投递保持分离。

## 新行为的归属位置

新行为附加到已有文档记录的扩展点。改动循环本身时，本映射随之更新。

| 目标 | 机制 |
|---|---|
| 添加模型提供方 | 在 `ctx.llm` 上注册其适配器 |
| 添加面向模型的能力 | 在 `ctx.tools` 上注册；其 schema 加入提示词组装 |
| 让某个会话拥有不同的能力集合 | 组装一个 agent preset；其中的服务行需要 `isolate` realm |
| 添加 shell 执行 | 注册 `ctx.shell` 后端；本地后端通过 `ctx.subprocess` spawn 进程 |
| 添加持久化终端执行 | 注册 `ctx.terminals` 后端和 `clocky-tool-terminal` |
| 添加用户命令 | 在 `ctx.commands` 上注册；它无需模型轮次即可分派 |
| 添加后台工作 | 在 `ctx.jobs` 上注册；`job_*` 工具负责收集或停止 |
| 添加文件系统访问或策略 | 注册 `ctx.fs` 提供方，或监听 `fs/*` 事件 |
| 限制所启动的进程 | 使用 `ctx.sandbox` 后端；消费方在启动进程前包装 argv |
| 拦截请求、工具或轮次 | 使用相应的 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 会停止轮次 |
| 添加模型可见上下文 | 调用 `agent.inject()`；它会落到下一次获准的请求中 |
| 添加 UI 或编辑器集成 | 驱动 `ctx.agents` 并从 `session/event` 渲染 |
| 添加 Web Client Chat 节点 | 注册 `ConversationNodeDefinition` + keyed renderer |
| 添加持久会话状态 | 扩展 `SessionEventMap`；从日志渲染和回放 |
| 生成会话标题 | 注册唯一的 `ctx.sessionTitle` 提供方 |
| 管理同会话目标 | 使用 `ctx.goals`；通过 `agent/*` 续跑 |
| fork 活跃会话 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 将注册项限定到单个 agent | 使用该 agent 的 `agent.ctx` |

[扩展实操手册](cookbook/extension-cookbook.zh.md)将功能映射到能力，并索引[包](cookbook/adding-a-package.zh.md)、[工具](cookbook/adding-a-tool.zh.md)、[LLM（大语言模型）适配器](cookbook/adding-an-llm-adapter.zh.md)、[Chat 节点](cookbook/adding-a-conversation-node.zh.md)和[设置卡片](cookbook/adding-a-settings-card.zh.md)的分步指南。

## 任务级中断

Task cancellation 由 Team plugin 负责。Agent 原语`cancel(cause, { keepInbox: true, resumePending: true })`保留现有 waking 输入，不会提升 non-waking injected context。Task consumer 使用精确的 Session claim 和对应`turn/end`作为停止证据，不用可能跟随无关排队工作的`whenIdle()`代替。Allocation 释放与 durable task settlement 仍由各自既有 owner 负责。
