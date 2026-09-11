# Agent Note: 原生 multi-agent 工作系统

Status: proposed

[English](2026-08-27-native-multi-agent-work-system.md) | 中文

## 问题

Clocky 具备 3 项重要的 multi-agent 基础能力：可延续的 [subagent 能力](../../../../docs/subsystems/subagent.zh.md)、脚本驱动的[动态工作流](../../implemented/feature/2026-07-05-dynamic-workflows.zh.md)，以及已归档的[隐式 Lead Agent Teams 实现](../../archived/feature/2026-08-05-agent-teams.md)。该归档实现曾验证持久化扁平成员名册、先入队再投递的同级消息、目标 Session 去重、采用比较并交换的任务 DAG、有界生命周期结算和面向模型的协作工具。与引入新框架相比，这些基础更强。

剩余的产品架构仍在若干面向用户的路径上以单 agent 为主。一个面向用户的运行实例由单个 `Agent` 驱动的 `Session` 表示；直接 subagent 仍是可延续子级；正式 base 组合包仍公开直接 subagent 与 workflow 工具。这些路径不能把人类或远程同级参与者表示为一等 Team Participant，不能支持协议专用会话，也不能协调多个 harness 进程。产品客户端也尚未只把 Team 管理为顶层对象。

直接加入 AgentScope 的历史 `MsgHub` 或 AG2 Classic 的 `GroupChat` 不能补齐这些缺口。它们值得借鉴的部分包括消息共享、动态参与、发言者选择、handoff 和有界会话模式；但其进程内共享会话形式无法满足 Clocky 对持久性、授权、插件、生命周期和回放的要求。两个上游也已经转向更强的网络化设计：AgentScope 2 将活跃消息传输与持久化存储分开；AG2 1.0 则以权威 Hub、持久化 channel WAL、类型化适配器、回执、治理和可替换传输取代经典 GroupChat、swarm 与 nested-chat 编排。

系统需要一条原生 multi-agent 产品主干，而不是一条稳定单 agent 路径外加若干可选协作功能。`Agent` 和 `Session` 继续作为单个模型参与者的执行与 transcript（文本记录）基础，但必须成为 Team 所有的工作系统内部成员，而不能继续充当面向用户的工作单元。

## 提案

### 建议

不要把 AgentScope 或 AG2 加成运行时依赖，也不要移植其 Python 类。应从保留的 Team、subagent 和 Session 基础构建原生 TypeScript/Cordis Team 能力：以 AG2 Network 作为主要结构参考，以 AgentScope 2 的持久化／传输分离作为活跃投递参考。

每项正式产品用户任务都创建或恢复一个 `Team`。Team 是产品级身份、持久化根、授权域、预算所有者和 UI/SDK 对象。每个 LLM（大语言模型）参与者可以拥有一个 `Session`，但 Session 不再是独立产品运行实例。正式默认 Team 模板启动一个 `coordinator` 和一个休眠的 `worker`；对于会产生修改的工作，评审策略会创建或激活 `reviewer`。部署可以配置其他模板，包括为降低成本而使用的单 agent Team，但系统不再保留直接 Session 模式或另一套单 agent 控制路径。

第一版实现采用单个权威 Hub 进程和进程内 agent。设计从一开始就包含 Link 与回执约定；本地约定通过重启与故障注入测试后，再加入 WebSocket 提供方。多 Hub 共识和透明联邦不属于本提案；跨进程 agent 连接到同一个 Hub。

### 上游与当前代码证据

上游审计使用了精确源码版本：AgentScope v1.0.21 的 `b840fa927ad409aeddb9df359631ed586f2ae830`、AgentScope main/2.0.7 的 `9983e76d1ee70052d31c01d224a477c5788cbe33`、AG2 Classic v0.9.10 的 `ac380f5c7962ad875f77c4f8310e3c1167bceeb7`，以及 AG2 main/1.0.2 的 `90f490a1b72b27ab4c219dd3586e94d42383a016`。

| 来源 | 值得采用的机制 | 局限或不采用的默认行为 | Clocky 决策 |
|---|---|---|---|
| [AgentScope MsgHub v1.0.21](https://github.com/agentscope-ai/agentscope/blob/b840fa927ad409aeddb9df359631ed586f2ae830/src/agentscope/pipeline/_msghub.py) | 由上下文管理参与关系、公告、手动广播、自动广播、动态增删成员 | 直接对象订阅；没有持久身份、回执、回放、策略、任务状态或分布式恢复；自动广播会复制上下文并放大 token 用量 | 保留公告、显式广播和动态成员管理的人机工学；拒绝把自动广播作为默认行为 |
| [AgentScope 2 message bus](https://github.com/agentscope-ai/agentscope/blob/9983e76d1ee70052d31c01d224a477c5788cbe33/src/agentscope/app/message_bus/_base.py) 与 [TeamSay](https://github.com/agentscope-ai/agentscope/blob/9983e76d1ee70052d31c01d224a477c5788cbe33/src/agentscope/app/_tool/_team_say.py) | 持久记录与活跃传输分离；排空队列、回放日志、瞬时 publish/subscribe、锁、本地／Redis 提供方、直接或广播寻址 | 读取即确认的队列不能证明模型 inbox 已接收；传输载荷不是业务真源 | 分离权威日志和唤醒传输；按收件人分发持久消息，仅在目标完成持久化后确认 |
| [AG2 Classic GroupChat](https://github.com/ag2ai/ag2/blob/ac380f5c7962ad875f77c4f8310e3c1167bceeb7/autogen/agentchat/groupchat.py) 与 swarm handoff | 轮询／随机／手动／LLM 发言者选择、转移约束、handoff 目标、有界 Round、嵌套模式 | 单一共享会话、以 manager 为中心执行、每轮可能增加一次 LLM 选择、主要依赖进程内可变编排 | 将声明式转移和 handoff 词汇保留为版本化 channel 适配器；LLM manager 只是一项可选策略，绝不充当核心调度器 |
| [AG2 Network](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/website/docs/user-guide/network/overview.mdx)、[Envelope](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/ag2/network/envelope.py) 与 [ChannelAdapter](https://github.com/ag2ai/ag2/blob/90f490a1b72b27ab4c219dd3586e94d42383a016/ag2/network/adapters/base.py) | 权威 Hub、具名注册表、每 channel WAL、受众与因果关系、纯适配器折叠、manifest 版本、回执／游标、视图、治理、本地／WebSocket Link | 可选网络之外仍保留独立 agent，形成第二条产品路径；其 Python 存储和 handler API 不适配 Cordis 或 Session 重建 | 通过原生 Cordis 服务和事件采用其拓扑与可靠性语义；让 Team 成为唯一正式入口 |
| 已归档的 Clocky [Agent Teams](../../archived/feature/2026-08-05-agent-teams.md) | 事件溯源成员名册／任务／消息、精确 Agent 授权、flush 检查点、恢复、任务 CAS/DAG、可延续子级、有界清理 | 隐式 Lead 身份、Lead 日志持久化、扁平本地子级、进程内重试、仅具提示作用的写入范围、没有产品控制平面 | 在稳定 Team 包中保留经过测试的算法，并泛化身份、运行位置、调度与传输 |

### 产品不变量：Team 是顶层单元

产品层级改为 `Team > Participant > Session > Turn > Step`。Team 表示一项目标明确、状态持久的用户任务及其完整协作状态。Participant 表示人类、本地 agent、远程 agent 或系统服务。本地 agent Participant 可以拥有一个持久 Session 和多个活跃 Activation 纪元；远程 Participant 与人类 Participant 不需要本地 Session。

每个 Web、headless、ACP（Agent Client Protocol）、JSON-RPC、TypeScript SDK 和 Python SDK 启动操作都寻址一个 `TeamId`。创建 Team 时，系统记录用户目标、注册人类／系统发起者、应用 Team 模板、创建 coordinator 与 worker 身份、打开用户／coordinator channel，随后才接收首个用户 Envelope。最终答案是一条发给人类参与者的 Team Envelope；完成策略接受该答案且 Team 达到完全停稳后，系统再单独记录 Team 完成转移。

直接调用 `AgentRegistry.create()` 和创建 Session 的能力继续作为提供方、测试和恢复流程所用的可信内部 API。正式客户端不再把它们作为用户可以创建、列出、恢复、取消或归档的单元。只有一个成员的 Team 仍与更大的 Team 使用完全相同的 Hub、journal、策略、channel、调度器和 UI 路径。

### 目标架构

```text
User / Web / ACP / SDK
          |
          v
  TeamRuntime (ctx.teams)  <---- policy waterfalls / observers
    |       |       |
    |       |       +---- Task scheduler + Team budgets
    |       +------------ Channel adapters + view policies
    +-------------------- Team journal + channel WALs
          |                         |
          v                         v
  AgentRuntime registry       Link providers
  local / ACP / SDK           local / WebSocket
          |
          v
  Agent + Session + existing agent-loop
```

Team 层不会成为第二套模型循环。它拥有身份、协作状态、协议接收、分发、调度、策略和恢复。现有 `@clocky/clocky-agent-loop` 继续驱动单个 Agent 的轮次与工具。Team 行为通过 Agent 的公开 inbox 操作和受限 Cordis 上下文进入 Agent；新的 multi-agent 行为不依赖也不导入具体循环实现。

### 身份与生命周期

所有跨包身份均使用相互独立的品牌类型。身份之间的转换必须经过所有者提供的解析器；任何构造函数都不得把 `SessionId` 直接重新标记为 `TeamId`。

| 身份 | 含义 | 生命周期与所有者 |
|---|---|---|
| `TeamId` | 一套面向用户的工作系统与授权域 | 由 TeamRuntime 生成；重启后继续存在，直到归档或删除 |
| `ParticipantId` | 一个逻辑人类、本地 agent、远程 agent 或系统成员 | 由 Hub 生成或接纳；独立于进程与 Session 驻留状态 |
| `SessionId` | 一个本地 Agent 的模型可见事件日志 | 归 Session 所有；对 Participant 可选，绝不充当 Team 身份 |
| `ActivationId` | agent Participant 的一次活跃驻留纪元 | 归选定的 AgentRuntime 提供方所有；冷恢复时改变 |
| `ChannelId` | Team 内一次有界协议会话 | 归 TeamRuntime 以及一个版本化适配器 manifest 所有 |
| `EnvelopeId` | 一项已接收的 channel 事件 | 由 Hub 盖章、全局唯一，并在重试／回放时保持稳定 |
| `TeamTaskId` | Team 工作 DAG 中的一个本地任务单元 | 归 Team 任务存储所有；revision 与 attempt 分开 |
| `TaskAttemptId` | 一次由租约支持的执行尝试 | 调度器分配任务时生成；只会进入一次终态或过期 |

Team 生命周期为 `provisioning -> active -> quiescing -> completed | failed | cancelled`。Participant 成员阶段为 `invited | provisioning | active | left | failed`；活跃 Activation 状态单独表示为 `starting | running | idle | offline | stopping`。Channel 生命周期为 `pending -> active -> closing -> closed | expired | failed`。任务生命周期见后文。持久生命周期转移必须单调，并由回放验证；实时可达性绝不改写持久成员关系。

### 包拓扑与依赖方向

具体拆包遵守仓库的 Service Definition / Service Provider / Consumer 规则。

| 包 | 角色 | 主要约定 |
|---|---|---|
| `packages/core/team`（`@clocky/clocky-team`） | Service Definition | 品牌类型、封闭核心记录、位于 `ctx.teams` 的 `TeamRuntime`、Team/channel 实时事件、适配器与策略注册 |
| `packages/storage/storage-log`（`@clocky/clocky-storage-log`） | 可复用数据形式 | `ctx.storage.log`；按预期序号原子追加、批量追加、范围读取、流枚举、快照检查点和关闭 |
| `packages/storage/storage-json` 与 `storage-sqlite` | Service Providers | 在 KV facet 旁加入 log facet；JSON 用作单 Hub 开发存储，SQLite 是持久化默认实现 |
| `packages/core/agent-runtime`（`@clocky/clocky-agent-runtime`） | Service Definition | Team 已解析 Participant epoch 的具名 activation provider 注册表和不可变 activation 观察 |
| `packages/agent-runtime/agent-runtime-in-process`（`@clocky/clocky-agent-runtime-in-process`） | Service Provider | 带持久 opaque Session provenance、fork 谱系、health、中断和 handle-owned dispose 的进程内 fresh/fork/resume placement |
| `packages/agent-runtime/agent-runtime-sdk`（`@clocky/clocky-agent-runtime-sdk`） | Service Provider | 带准确 lifecycle status protocol 与 child-process ownership 的 SDK remote-agent fresh/resume placement |
| `packages/agent-runtime/agent-runtime-acp` | Service Provider | 提供准确 lifecycle status、有界 process-tree teardown，以及可选 activation-bound Team Link bridge 的 ACP placement |
| `packages/core/team-link`（`@clocky/clocky-team-link`） | Service Definition | 具名 activation-bound Link 注册表；Link 推导 sender/recipient fact、转发 post/claim/acknowledgement 和 delivery-bound task-start operation，并报告 terminal lifecycle |
| `packages/team/team-link-local`（`@clocky/clocky-team-link-local`） | Service Provider | 带有有界 pending-page handoff、可取消 cursor 和失败 notification retry 的本地 activation-bound replay/watch provider |
| `packages/core/team-workspace`（`@clocky/clocky-team-workspace`） | Service Definition | 位于 `ctx.teamWorkspaces` 的按 mode 解析 Team task execution-root provider 注册表 |
| `packages/core/team-artifact`（`@clocky/clocky-team-artifact`） | Service Definition | 位于 `ctx.teamArtifacts` 的 provider-independent content-addressed artifact reference 与 verified-read registry |
| `packages/team/team-workspace-shared` | Service Provider | 用于确切 local-Agent Session cwd 和 current lease identity、并支持 opt-in portable target integration 的 canonical shared-root provider |
| `packages/team/team-workspace-worktree` | Service Provider | 为准确 current local-Agent task attempt 提供显式配置的 detached Git-worktree allocation、有界变更清单，以及可选的 policy/CAS integration authority |
| `packages/team/team-artifact-local` | Service Provider | 在 owner-only root 中保存 file、patch、log、screenshot 与 report bytes |
| `packages/team/team-link-websocket` 与 `team-link-websocket-hub` | Service Providers | 通过相同 Link API 提供已认证远程 framing、receipt/nack 投递、reconnect replay 和动态 activation enrollment |
| `packages/team/team-hub`（`@clocky/clocky-team-hub`） | Service Provider | 本地权威 `ctx.teams`：Team journal、有界 root-or-child 层级、channel WAL、成员／任务／activation 投影、策略派发、恢复、回执、临时 delivery claim、pending page 和游标 watch |
| `packages/team/team-activation-controller` | Consumer／binder | 把已发布的 AgentRuntime handle 绑定到持久 Participant epoch、镜像 health，并拥有 handle release |
| `packages/team/team-agent-client` | Consumer／binder | 在向 durable-bound 本地 Agent 投影 direct 或 task-assignment channel 输入前使用 activation-bound Link claim，只启动 delivery-bound task attempt，在唤醒模型步骤前 flush source、确认持久接收，并重新连接其 current binding |
| `packages/team/team-channel-task-assignment` | 适配器提供方 | 带 task／attempt／revision 及 activation／Session fence 的单 assignee 持久 assignment turn |
| `packages/team/team-channel-basic` 与 `team-channel-workflow` | 适配器提供方 | Consult、discussion 和声明式 workflow 协议及其视图策略 |
| `packages/team/team-scheduler-dag`（`@clocky/clocky-team-scheduler-dag`） | 调度 Consumer | 通过 `ctx.teams` 执行有界、确定性的 shared-work lease assignment、workspace eligibility、task-assignment channel/WAL dispatch recovery 和显式 lease expiry |
| `packages/team/command-team-goal` | 面向用户的 Consumer | 从当前 Team-bound Agent Session 派生的 scope 内 `/goal`状态与 mutation control |
| `packages/team/tool-team` | 面向模型的 Consumer | 通过 binding-derived Link 进行 scope 内 task-attempt outcome reporting；一个工具名只有一个所有者 |
| `packages/client/ui-team` 以及 Host/API/SDK owners | 产品 Consumers | Team 管理、事件投影、图／channel 视图、人类参与和两套 SDK 投影 |

`team-hub`依赖 `clocky-team` 和 `storage-log`，不依赖 `agent-runtime`；其本地持久权威由[本地 Team Hub 决策](../../implemented/architecture/2026-08-27-local-team-hub-durable-authority.zh.md)记录。[AgentRuntime Service Definition 决策](../../implemented/architecture/2026-08-27-agent-runtime-service-definition.zh.md)记录独立的 activation 注册表。适配器与工具依赖 `clocky-team`，绝不依赖 `team-hub`；agent-runtime 提供方依赖 `clocky-agent` 和 Session 能力，绝不依赖 Team 工具。稳定包不依赖已归档的实验包。

### 持久状态与存储

#### 流所有权

每项事实只有一条权威流。

| 流 | 所有内容 | 不所有的内容 |
|---|---|---|
| `team/<TeamId>` journal | Team 生命周期、目标、参与者注册表、规则／预算、任务快照、租约、模板版本 | 模型消息、工具调用或 channel transcript 文本 |
| `channel/<ChannelId>` WAL | Manifest 快照、邀请／确认生命周期、已接收 Envelope、投递回执、适配器转移、关闭原因 | Agent 私有推理、工具或可变运行时引用 |
| `session/<SessionId>` log | 精确的模型可见输入、assistant 输出、工具执行、Agent 轮次／步骤生命周期 | Team 注册表、共享任务真源或投递授权 |
| 审计投影 | 引用权威 id／sequence 的提交后治理与运行记录 | 业务真源；它可以重建，不能修复或否决已经提交的事实 |

`storage-log` 仅在 `expectedSequence` 与持久尾部相符时追加事件批次。JSON 提供方为每条流串行化单个写入方，并拒绝分布式模式。SQLite 提供方使用事务断言尾部并追加完整批次。Hub 在进程内串行化每个 Team 和 Channel；每条命令仍携带预期 revision 或 idempotency key，使重试不会悄然重复变更。

Team 与 channel 格式各自拥有独立的单调版本。预发布 loader 拒绝不支持的版本；实现不会转换旧的 Lead Session Team 事件。切换时重新记录仓库内 fixture 与 snapshot；对于用户所有的预发布数据，系统保持原样，不会猜测并转换到新模型。

#### 运行时验证与投影

核心 Team 事件 envelope、`TeamEnvelope`、manifest、回执、任务、规则和 Link frame 在每个文件、队列、进程与网络边界执行运行时验证。每个 channel 适配器注册自身接受的事件 kind 和 knobs schema。创建 channel 时快照 `(adapterType, adapterVersion, viewPolicyType, viewPolicyVersion)`；恢复时缺少任何必需实现都必须快速失败。

适配器无状态。其 fold 是先前状态与一条 WAL 记录的纯确定函数。TeamRuntime 维护增量内存投影，并定期保存带来源 sequence 的可重建检查点；它不再为每项操作重新折叠完整 Lead Session。恢复流程验证检查点 watermark，回放其后缀；检查点缺失或损坏时退回完整 WAL。

### 通信协议

#### Envelope

所有参与者通信都使用一项由 Hub 盖章的记录。客户端提交的草稿不含 `id`、`sequence`、`senderId` 或 `createdAt`；通过身份验证的 Link 决定发送方。

```text
interface TeamEnvelope {
  readonly id: EnvelopeId
  readonly teamId: TeamId
  readonly channelId: ChannelId
  readonly sequence: number
  readonly senderId: ParticipantId
  readonly audience: readonly ParticipantId[] | null
  readonly kind: string
  readonly payload: JsonObject
  readonly delivery: 'context' | 'turn' | 'steer'
  readonly causationId?: EnvelopeId
  readonly correlationId?: string
  readonly taskId?: TeamTaskId
  readonly traceId?: string
  readonly priority: 'background' | 'normal' | 'urgent'
  readonly createdAt: number
  readonly ttlMs?: number
}
```

`audience: null` 表示 channel 内其他所有可见参与者；列表表示显式子集。发送方保留自身可见性以供回放。`causationId` 把回复或 handoff 关联到触发 Envelope。`correlationId` 汇集一项更高层操作，`taskId` 则把通信绑定到共享工作。`delivery` 表示协议意图，而不是已经发生执行的声明：适配器和 Hub 策略可以拒绝或收窄该意图。

Agent 私有输出不会仅因 Agent 产生了它就自动广播。Agent 通过 Team 工具或适配器自有动作发布报告、handoff、任务结果或显式消息。这样既保留 MsgHub 便捷的显式广播，又不会继承其自动放大上下文的问题。

#### Channel 适配器

Channel manifest 是数据，适配器是代码。Manifest 会快照参与者角色与数量边界、允许的事件 schema、可配置 knobs、默认视图策略、expectation、TTL，以及轮次／任务上限。适配器提供 `validateCreate`、`initialState`、`validateSend`、`fold`、`afterAccept`、`expectedNext`、`deliveryPlan` 和 `projectView`；所有状态方法均为同步纯函数。

首批稳定适配器包括：

- `direct`：2 个或更多参与者，支持显式子集或广播寻址，不自动回复；调用方选择的 `context`／`turn` 意图仍受策略约束；
- `consult`：一次请求、一个 respondent 轮次、一次响应，随后自动关闭；
- `discussion`：多方自由会话或确定性轮询会话，并带硬性轮次上限；
- `workflow`：可 JSON 序列化的 `TransitionGraph`，包含有序 condition 与 target，例如 participant、round-robin、stay、return-to-initiator 和 terminate。

转移 condition 与 target 以版本化名称通过 Cordis effect 注册。图验证拒绝缺失参与者、未知实现、无效默认项、要求有限工作流时不可达的终止路径，以及没有轮次／任务／墙钟时间上限的循环。可选 LLM coordinator 可以发布显式 handoff Envelope；Hub 会记录并验证该决策，而不会执行不可见的发言者选择请求。

#### 接收、投递、确认与恢复

1. 已绑定客户端提交草稿。Hub 从 Link 解析发送方，验证 JSON 与大小限制，检查 Team/channel 成员关系，执行访问与预算策略，并在每 channel 串行器内调用适配器。
2. Hub 为 Envelope 盖章，把它与任何适配器生命周期记录原子追加，推进缓存 fold，并返回持久 id。listener 或分发失败不能回滚 WAL。
3. 适配器的投递计划在提交时把广播展开成各收件人意图。每个收件人的待投递状态由已接收 Envelope 减去持久回执推导；活跃 bus 只是一项唤醒优化。
4. 本地或远程 Link 收到 notify frame。每个客户端在启动模型工作前按 `(channelId, envelopeId)` 去重。`context`、`turn` 和 `steer` 只有通过协议授权后，才由 Agent Client 映射到现有 inbox 操作。
5. 本地 Agent Client 持久化精确 inbox 项或 Session surface event，并等待 `ctx.sessions.flush()`，随后返回 `accepted` 回执。该回执表示目标已持久接收，不表示任务完成或模型执行成功。
6. Hub 追加单调收件人游标／回执。nack 或断线不推进游标；重连会从游标之后重放每条可见且未确认的 Envelope。乱序到达的旧回执不能让游标回退。
7. 回复把触发的 `EnvelopeId` 用作 `causationId`。在重新执行一次重复投递的轮次前，Agent Client 检查同一发送方是否已经为该 causation id 发布结果；如果已经存在，则直接确认，不再调用模型。

系统承诺至少一次通知与幂等的持久接收，不承诺模型执行或外部副作用恰好一次。工具与 workspace 操作必须拥有自己的幂等或比较并交换行为。

读取操作返回 Team 或 channel 游标。`watchTeam(afterCursor)` 与 `watchChannel(afterCursor)` 先比较持久游标；调用方已经落后时立即返回；否则在没有 await 间隙的情况下注册 waiter。面向模型的等待工具始终提供上次 list/read 操作返回的游标，从而消除现有仅观察后续 edge 造成的唤醒丢失。

#### 模型可见上下文

所有 Team 衍生输入都遵守现有「模型可见即必须记录」规则。直接投递会在持久 inbox 项及最终 `user/message` 中保留 `TeamEnvelopeSource { teamId, channelId, envelopeId, senderId, delivery, causationId? }`；Host queue projection 使用保留的 delivery intent 区分 pending steering 与不唤醒的 Team context。计划中的 channel 轮次使用 `team/channel-view` Session surface event，其中包含精确渲染内容、有序来源 Envelope id、适配器／视图版本和触发 id。系统不会在请求时根据隐藏的可变 channel 状态重新构造输入。

视图策略是版本化纯投影，包括仅定向消息、完整 transcript、近期窗口和摘要窗口。摘要本身是一条持久 channel 事件，记录精确覆盖的 sequence 范围和来源；它不能静默替换 WAL 历史。工具 schema 与 Team 指南继续限定在 Agent scope，因此角色或权限变更只影响后续组装，并且可以通过 Participant／Session 绑定和已记录 Team 输入重建。

### Agent 运行位置与执行

现有可延续 subagent manager 已提供有价值的 activation、冷恢复、取消、并发启动、发布和子级优先释放算法。应将这些算法提取到 `ctx.agentRuntimes` 后面，并从提供方约定中删除父子 Team 语义。

`AgentRuntimeProvider` 接收由 Hub 解析后的 Participant 描述、Team 与 Session id、Agent preset、上下文 seed 模式、授权、workspace 分配和取消 signal。只有本地 Agent／Session 或远程 endpoint 完成发布，且 Participant 绑定已持久化后，它才返回 `ActivationHandle`。该句柄暴露 `activationId`、可选的精确本地 `Agent`、结果／健康 promise、消息接收、中断，以及等待完全停稳的 `dispose()`。

Hub 拥有稳定 Participant 身份与成员关系。提供方只拥有一个 Activation 纪元。移除提供方只会阻止新的 Activation，不会撤销已经接收的句柄。不同操作必须隔离取消与可变状态。Session header 记录其 `teamId`、`participantId`、preset 和 workspace 分配；`parentSession` 继续表示 fork seed 血缘，而非授权。所有直接 subagent Consumer 删除后，`origin: 'subagent'` 和委托深度退出产品模型；Team 预算以及任务／channel 血缘负责限制递归与 fan-out。

先落地进程内 fresh/fork 提供方。ACP 与 SDK 提供方适配现有进程外后端。通过 WebSocket Link 注册的远程端是 Participant endpoint，而不是由本地父级创建的子级。嵌套工作会创建通过 `parentTeamId`、`parentTaskId` 和有界 Team 深度策略关联的子 Team；系统不会把 Session 子树重新解释成 Team 层级。

### 共享任务图与调度器

#### 任务生命周期

保留现有完整快照、任务本地 revision、DAG、tombstone 与比较并交换规则。任务记录包含父任务、所需能力、优先级、读／写范围、workspace 模式、预算、评审策略、有界 attempt history、最小 result/failure fact 和一个可选 lease。artifact reference 是持久 task-result fact；workspace 或 artifact provider 负责其 bytes、id、content hash 与 provenance。

no-review task 的任务生命周期为 `pending -> assigned -> running -> completed`，participant-reviewed task 的任务生命周期为 `pending -> assigned -> running -> review -> completed`，并带有终态 `failed | cancelled | deleted`；释放或一次可重试 attempt 过期后，系统在新的 revision 下把已分配／运行中任务恢复为 `pending`。就绪状态继续从依赖和终态阻塞项推导。每次分配创建一个 `TaskAttemptId` 和有界租约。heartbeat 只能续约当前 attempt；陈旧 heartbeat 和终态写入必须因 expected revision／attempt 前提不满足而失败。租约过期后，系统先记录显式 attempt 失败，再执行重试、重新分配或 Team 停滞策略。

在共享 checkout 中，`writeScopes` 成为调度约束，而不是声称存在的文件系统锁。使用共享 workspace 提供方时，调度器不会并发运行写入范围相交的修改任务，除非人类或策略显式覆盖冲突。worktree 或 sandbox 提供方可以并发运行这些任务，因为它们提供相互独立的分配身份。

#### 调度与完全停稳

默认调度器具有确定性。它按优先级／创建顺序选择就绪任务，根据 Hub 授权、声明能力、角色、workspace 访问、可用性和预算过滤 Participant，再按显式分配、能力匹配、当前负载、已观察任务结果和稳定 Participant id 排序。调度器通过任务 CAS 提交分配和租约后，才在任务 channel 上唤醒所有者。coordinator 可以建议所有者或 handoff，但 Hub 会通过同一路径验证。

已发布的 task snapshot 现在会冻结 no-review route 或一个明确 reviewer，并保留 reviewer 的 accepted 或 rework decision 及其 reason。任务完成之后可以要求 reviewer 或 evaluator 任务。worker 发布结构化结果，包含摘要、证据、产物、修改路径和验证；review Consumer 将 participant-reviewed task 路由给符合条件的 reviewer。只有评审通过或配置明确无需评审，任务才进入 `completed`。评审失败会产生显式 revision 与返工依赖，而不是私有会话反馈。

只有同时满足以下条件时，Team 才完全停稳：没有进行中的 Hub 接收或投递，没有正在 `starting`／`running`／`stopping` 的 Activation，没有就绪／已分配／运行中／评审中的任务，没有 channel 等待发言者，也没有待处理的人类问题或批准。存在未完成工作却没有任何可能生产者时，系统写入持久 `stalled` 诊断，而不是完成或无限等待。完成策略随后验证终态任务状态和一条发给人类的最终答案，再提交 `team/completed`。

现有同 Session Goal 改为 Team 目标。Goal 身份、revision、phase、blocker 和预算迁移到 Team journal；`/goal` 及其工具寻址 `TeamId`。目标 Round 驱动器由调度器／完全停稳策略取代：Team 空闲但尚未完成时，它可以唤醒 coordinator，而不会给每个 Participant 添加自动提示词。动态 workflow 脚本改为一种 Consumer，用来创建或修改版本化 Team 任务／转移图；它不再在 Hub 之外启动私有 subagent。

### 治理、资源管理与可观测性

每个 Participant 都有不可变身份描述和可变能力／状态投影。描述包含 kind（`human | local-agent | remote-agent | service`）、显示名、owner、preset、provider／model 提示、声明能力、角色和凭证／认证方案。Hub 从任务推导已观察任务数量、结果、延迟和成本记录；这些记录绝不覆盖声明能力。

TeamRuntime 通过类型化 Cordis waterfall 对 register、invite、activate、channel open、send、dispatch、task mutate／assign、interrupt、workspace allocate 和 Team close 执行授权。策略 listener 通过调用 `next()` 组合；任何拒绝都以结构化原因持久记录。提示词可以解释策略，但绝不提供授权。子 Team 或 Participant 授权必须是创建方 Team 与人类授权的子集。

Team 配置会在创建时解析并快照所有上限，包括 Participant 数量、存活 Activation、任务数、开放 channel、待投递消息、Envelope 字节、委托深度、轮次、模型 token、墙钟时间、成本、重试次数，以及每 Participant inbox／速率上限。Hub 在持久接收前拒绝超限操作；唯一例外是接收后出现的投递压力，此时系统记录显式 backpressure 事件与重试计划。任何插件都不得硬编码随部署变化的限制。

提交后的 `team/*`、`channel/*`、`delivery/*`、`task/*` 和 `activation/*` observer 接收不可变快照，单个 listener 失败会被隔离。Trace 关联 `TeamId`、`ParticipantId`、`ChannelId`、`EnvelopeId`、`TeamTaskId`、`TaskAttemptId`、`SessionId` 以及工具／模型 span。指标覆盖队列深度、回放延迟、活跃 Activation、任务延迟／重试、token／成本预算、停滞 Team、回执延迟、适配器失败和 workspace 冲突。

取消 Team 时，系统同步关闭接收，持久化取消意图，取消 Activation，排空已接收的消息／任务操作，关闭 channel，释放 workspace 分配，并等待完全停稳。即使某个分支失败，清理也会继续；所有自有资源结算后才报告聚合错误。HMR（热模块替换）先注销提供方并阻止新操作，同时保留已接收句柄／适配器，直到其自有工作进入定义明确的终态。

### Workspace 与产物协调

`core/team-workspace`将不可变 task workspace mode 解析为 provider，而不改变 Team task state。`core/team-artifact`将 provider-independent artifact reference 解析为 bytes provider。`team-workspace-shared` provider 会 canonicalize 一个配置的 existing root，只接受 durable Session header 已经等于该 root 的 active local Agent，在 logical allocation 前重新读取 current lease 与 activation，并且绝不声称 filesystem lock；其可选 artifact/integration 配置会将 portable change-set 发布到独立的 target directory。`team-workspace-worktree` provider 会验证显式 Git root 和 base commit，随后只在重新验证准确 current local-Agent lease 和 policy decision 后创建 hash-derived detached checkout，并可通过 `ctx.teamArtifacts` 持久化有界 file 与 patch bytes。scheduler 会在为 shared-work candidate 排名之前使用 provider eligibility，且绝不分配 root。

新增 sandbox／remote provider 和 task-Agent allocation consumption，把精确 filesystem 与 process authority 返回给 Agent preset，记录 changed path／artifact，并且只在 integration 或 cancellation 结算后释放 resource。Worktree provider 已提供显式的本地 integration authority；sandbox／remote integration 仍由各 provider 自行负责。

共享提供方保留当前同 checkout 行为，但将其局限变成可执行规则：声明的修改范围相交时串行运行，文件系统陈旧版本检查继续生效，Bash／generator 产生的未知写入显示为审计警告，而不是虚假的锁保证。配置独立 integration root 与 artifact provider 后，它还会发布 portable change set，并且只会在 policy 与 expected content-version fence 下将其应用到 provider-owned target directory。Worktree provider 只会在已解析 base commit 创建 detached checkout，且绝不强制移除 dirty work。其可选 integration authority 会创建隔离 source commit，执行可检测冲突的 detached merge，并用 compare-and-set 更新未被占用的 target ref；绝不 force-push、静默提交用户改动或无 Team policy merge。Sandbox 和 remote provider 保留各自的 integration authority。

产物通过持久 id 与来源引用，不直接嵌入消息。任务结果可以发布 patch、文件、日志、截图或报告；Hub 记录所有者、内容 hash、来源 attempt 和可见性。Channel 视图携带摘要和引用，避免把大型工具输出广播到每个模型上下文。

### 产品 API、SDK 与 UI

Host 暴露面向 Team 的 Remote：`team.create/get/list/cancel/archive`、`team.member.list/invite/remove/interrupt`、`team.channel.open/post/read/close/watch`、`team.task.create/get/list/update/watch` 和 `team.audit.read`。方法使用品牌 id、游标分页、AbortSignal、结构化错误和无损 JSON。与 agent 绑定的方法解析已认证 Participant，而不接受调用方提供的 sender id。

TypeScript 与 Python SDK 投影 Team、Participant、Channel、Envelope、Task、回执、Activation 和预算事件。prompt／run 调用返回 Team 完成状态与最终人类可见输出，同时继续提供事件流。Session API 保留用于 transcript 检查和内部诊断，不再用于创建顶层运行实例。

Web 侧边栏列出 Team。Team 页面展示目标／预算状态、成员名册与可达性、任务 DAG、开放 channel、待处理人类操作、产物和审计时间线。选择 Participant 会打开其 Session transcript；选择 Channel 会打开其 WAL 衍生视图。人类输入以一等 Participant 身份发布 Envelope。批准与 `ask_user_question` 请求保留来源 Participant／Session／task id，并路由给获授权的人类，不会因为 teammate 身份就隐式获得 UI 权限。

会影响产品可见 GUI 的改动必须加入真实服务器浏览器测试和要求的录制 GIF。无密钥 snapshot 覆盖组装后的 Team transcript 与持久流；UI 投影绝不通过抓取多个 Session transcript 推导 Team 真源。

### 缺口收敛实现规范

现有稳定包继续作为基础。收敛工作只在当前行为无法满足验收标准时修改其约定；不会新增第二个 Team 提供方、另一个模型循环，也不会为预发布持久格式增加兼容路径。

#### 生命周期、完成与取消授权

`TeamRuntime`新增由提供方拥有的 `completeTeam()`、`failTeam()`和`cancelTeam()`命令。产品 Host 与 SDK API 删除通用 `team.phase`变更；`transitionTeamPhase()`只保留为可信提供方／测试原语。每条关闭命令都携带已认证行为者、预期 Team 游标、幂等键和结构化原因；完成命令还必须指定最终 channel 与 Envelope。

`completeTeam()`会锁住 Team 与最终 channel，验证 Envelope 是由已配置 coordinator 发给已授权人类的`final`，并要求已存在人类回执。active goal 会在记录完成意图的同一条 Team journal 命令中转为`complete`；paused 或 blocked goal 拒绝完成。命令先把 Team 转为`quiescing`，随后由可在重启后恢复的关闭驱动器确认不存在非终态 task、可投递 Activation、协议预期发言者、待投递消息、待处理人类操作、存活 workspace allocation 或提供方已接收操作，才提交`completed`。

`cancelTeam()`会在释放资源前关闭新接收，并记录一条持久取消意图。pending 与 review task 转为`cancelled`；assigned 或 running attempt 保留取消请求，直到 owner 报告取消、其自有提供方终止，或 fencer 证明该 epoch 已 offline。activation controller 在关闭 channel 前释放 attempt 与 workspace。即使某个清理分支失败，其他分支仍继续；只有所有已接收分支结算后才报告聚合错误。提供方无法证明终止的远程 endpoint 会让 Team 以`REMOTE_CANCELLATION_UNCONFIRMED`持久停滞，绝不会被报告为已取消。

coordinator 轮次结束但没有已接收 final 时，以`FINAL_ANSWER_MISSING`记录 stalled；基础设施或模型失败则携带精确终态错误记录`failed`。只有显式 resume 可以让 stalled Team 返回`active`。墙钟时间或预算过期使用同一持久 stall 路径，而不是等待另一条任意变更触发检查。

#### 治理与预算执行

`clocky-team`定义封闭的`TeamAuthorityGrant`，覆盖允许的操作、Participant 与 child-Team 委托、workspace mode 与 scope、provider/model route 以及类型化资源上限。Team 模板会快照 root human/system grant；每个 Participant 与 child Team 存储其不可变子集。Hub 在可扩展策略 waterfall 之前执行身份、active membership、grant subset、task ownership 与 workspace scope 的结构检查。可选策略 listener 可以收窄授权，但不能恢复被 Hub 拒绝的操作。

每条产品或协议变更都携带`TeamActorProof`，该证明只能由 Host 已认证人类、activation-bound Link 或可信 system provider 派生。API 绝不把调用方提供的 sender、reviewer 或 interrupt authority 当成已验证标识符。正式组合缺少 root grant 或必需策略提供方时会在加载时失败。sender、audience、task、interrupt、phase、workspace、integration 和 artifact-read 测试同时覆盖结构拒绝与策略拒绝。

Team 与 task budget 使用类型化 token、turn、墙钟时间、成本、重试、并发和 artifact-byte 字段，并保留命名空间扩展对象。task budget 必须是 Team 剩余额度的子集。`TeamUsageSample`增加可选 task 与 attempt provenance，使接收方在下一模型步骤前为准确 ledger 预留并计费。child usage 先提交 child journal，再提交幂等 parent charge；待处理 parent charge 会阻止更多 child work，恢复过程必须在重新接收前修复。存在成本上限时，未知价格绝不能按零成本计算：route 必须提供冻结费率，否则模型请求被拒绝。

#### 评审与面向模型的任务编排

评审投递记录`TeamReviewAssignmentSource`，其中包含 task、已完成 attempt、精确 review revision、结果证据、产物、reviewer、channel 和触发 Envelope。`team_task_review`删除由模型提供的 revision 参数，只能从唯一一条 current source 派生 fence。该工具发布携带`accepted`或`rework`及原因的 consult response；适配器在接收该 response 的同一批次关闭 consult channel。

scheduler 把 response Envelope 当成 review outbox。它在 channel 提交后幂等应用 task transition，并在下一次 drive 修复“response 已提交、task 尚未更新”的崩溃窗口。接受会完成 task。返工会记录被评审 attempt 与原因、推进 revision、把 task 返回`pending`并要求新的 attempt；之前的结果保持不可变。

正式 coordinator 除 start 与 wait 外，还获得 task list、有界 progress watch、cancel 和可选 owner proposal 操作。owner proposal 可以命名 Participant，但不会授予权限；scheduler 仍验证 grant、capability、load、workspace eligibility 与 budget。多个合格 worker 通过普通 DAG dependency 实现 fan-out 与 fan-in。单 worker 模板继续作为默认 cardinality，而不是另一种 task protocol。

#### Workspace 与产物执行授权

每个 attempt 记录`TeamWorkspaceAllocationSnapshot`，包含 provider、allocation id、mode、base version、lifecycle 与 integration status。provider filesystem root 和 process credential 仍是 live handle data，而不是持久授权。allocation binding 是由 task、attempt、activation、Session 与 provider 围栏保护的 Team mutation；恢复会重新打开或显式保留 provider-owned allocation，而不会根据目录名猜测。

`resolveAgentWorkspaceRoot()`成为 shell、filesystem、search、instruction、file-reference、skill、sandbox-policy 和 subprocess consumer 唯一的 workspace-root resolver。sandbox confinement 会优先使用 allocation root，再回退到 Session cwd。静态门禁拒绝已登记 workspace-sensitive consumer 直接读取`session.header.cwd`；组装测试证明 Bash、read/write/edit、search、instruction 与 subprocess 观察同一 worktree 或 remote root。

shared provider 会记录 baseline 与 final version、串行化声明 write scope 相交的任务，并为未知外部修改发出持久 audit warning，而不声称存在锁。其 opt-in artifact path 会保留有界 source baseline，并且只会在 policy 与 expected content-version fence 下将 provenance-checked portable change set 应用到独立 target directory。已交付的 shared 与 worktree provider 会 mint 不含 root 的 metadata、在 materialization 前 reserve、恢复准确的 active allocation，并在没有持久 root catalog 的前提下 reconciliation `release-requested` cleanup。Sandbox 与 remote provider 通过同一 registry 返回准确 filesystem 与 process authority。Integration 是显式 human- 或 policy-authorized Team task；其 expected target version、proposal、conflict result、verification 和最终 artifact manifest 都是持久事实。

模型 task report 只能引用已经为 current Team／attempt mint 的 artifact id。Hub 记录 reference 前，`ctx.teamArtifacts`会验证 ownership、content hash、source attempt 与 visibility；provider publication 提供 changed path 与 artifact id。本地 retention 会从未过期 Team 追踪 reference，并在配置的 grace 之后删除不可达对象。Remote／object-store provider 与跨主机 replication 继续作为同一 Service Definition 的可替换实现。

#### Channel 视图、协议生命周期与 workflow 汇合

被 claim 的非 direct delivery 返回精确渲染的`TeamChannelViewSource`：adapter 与 view-policy version、触发 Envelope、有序 source Envelope id 和 rendered content。Agent Client 追加`team/channel-view` Session surface event，并在 acknowledgement 前 flush。Direct unicast 可以保留现有 identified `user/message` source，因为该记录已经包含精确渲染内容和单一 Envelope provenance。

Summarization 是显式 channel command，会追加持久 summary record，其中包含 covered sequence range、source Envelope id、精确文本、policy version 与幂等键。runtime-only `TeamSystemChannelSummaryProof`会绑定完整 payload；由于尚无 summary consumer 拥有 canonical source，shipped composition 会 fail closed。Hub 会在 channel load 前、channel serializer 内以及读取 source range 后、append 前重新解析该 proof。View policy 可以选择结果 record，但绝不能在读取时合成替代历史。Channel read、Team／member／task list 和 audit read 都接受`limit`并返回`nextCursor`；任何产品调用都不得实体化无界 WAL。TTL expiry 由显式 scheduler／Hub drive 处理，并在移除 pending work 前追加 delivery expiry 或 terminal channel record。

切换后的 direct protocol 接受至少 2 个 Participant、显式非空 audience subset 或`null` broadcast，并且没有自动 reply。`final`只允许出现在准确的 two-party product channel 中，绝不 broadcast。Text／image payload 与显式 delivery intent 继续作为 versioned adapter data；旧预发布 direct version 不会被静默扩宽。

适配器与 workflow-extension 注册会返回 lease。注销会阻止新的 channel 或 graph，但 active channel 在关闭前继续保留精确实现；重启时引用版本不可用则快速失败。Workflow condition 与 target extension 提供版本化 validation 和纯 evaluation／resolution，graph 存储其精确 ref 与 JSON config，而不是只支持封闭 built-in union。

现有 script／value isolation 继续属于显式 custom composition 中的`clocky-workflow`。正式 Team workflow 改为接收 JSON-serializable `TeamWorkflowPlan`：task template、有序 fan-out／fan-in dependency、versioned condition 与 target、bound 和 result projection。Compiler Consumer 会在创建持久 Team task 与 workflow-channel record 前验证完整 plan；重启直接从这些 record 派生剩余工作，而不会重新运行模型编写的代码。旧的无 journal JavaScript workflow execution 只保留给使用不同 tool name 的显式 custom composition，并且不能变更正式 Team authority。

#### 远程接收与终止

动态 WebSocket enrollment 只会在 provider-owned storage-log stream 中持久化 credential digest、generation、binding 和 revocation state。Hub 重启会加载 current generation；rotation 会追加 replacement 并关闭旧 socket。Link frame versioning 增加 cancellation request／result 与 pagination field，同时保留 binding-derived identity、有界 queue、nack retry 和至少一次 notification。

ACP placement 会为其声明的`SessionId`实体化一个 proxy Clocky Session。调用`session/prompt`前，provider 追加并 flush 精确 Team-derived input；收到非 cancelled response 后，追加 completion fact、flush，然后确认 Envelope。恢复会直接确认已完成 source 而不再次 prompt，并重放已接收但未完成的 prompt。ACP output 继续保持 private，除非显式 Team operation 发布它。

每个 AgentRuntime provider 声明`cooperative`或`owned-process` termination。owned-process provider 必须在 activation 变为 offline 前证明有界 process-tree exit；cooperative endpoint 需要 external fencer，否则 cancellation 保持 stalled。静态与动态 credential 通过同一套 forced-disconnect、full-Hub-restart、duplicate／out-of-order、slow-consumer 与 cancellation 测试。

#### 产品、UI、存储默认值与兼容性

Headless 与 Web 默认选择 SQLite 存储 Team journal；JSON 仅保留为显式 single-Hub development／test backend。Team task tool 和每条 Host／SDK operation 使用同一组 authenticated command 与 cursor page。Web Team page 提供 Participant transcript selection、channel view、DAG／task detail 与 cancellation、review decision、受 visibility 限制的 artifact read、human-action routing 和真实 audit timeline。Summary card 绝不通过抓取 Session transcript 推导 Team state。

Session create／fork 产品 route 与正式 legacy orchestration tool 继续保持缺席。Compatibility package 只能由显式 custom composition 加载，并且不能与正式工具共用 tool name。提案移入`implemented/`前，源码、generated catalog、snapshot、packed artifact 和两套 SDK expected output 会一并扫描。

#### 持久与协议版本

Closure、grant、typed budget、review source、allocation state、summary 与 parent charge 会提升 Team journal／checkpoint 和 channel WAL／checkpoint version。按 source 分离的 durable audit projection 使用独立 format version，并且仍可从这些业务 stream 重建。Link cancellation 与 enrollment recovery 会提升 frame version。Host 与两套 SDK schema 原子更新。新 Session surface event 遵循现有`SESSION_FORMAT_VERSION = 0`预发布策略；除非其完整模型可见含义可以安全忽略，否则读取时必须识别。旧预发布 stream 会快速失败；不提供 converter 或 compatibility reader。

#### 可观察性、保留与性能

Team metrics 增加 pending delivery／admission gauge、active Activation／workspace count、replay lag、task／receipt latency、retry／nack total、budget use、stalled Team、adapter failure、compaction／checkpoint failure 与 workspace conflict。当前 local implementation 已通过现有 metrics route 暴露 active-admission、compaction、checkpoint-failure 以及 audit projection repair/failure counter。Team telemetry Consumer 会用 Team、Participant、Channel、Envelope、task、attempt、Session 及 model／tool span 关联每条 record，再把导出委托给 deployment provider。Metric 是 operational projection，绝不是业务授权。

Hub 会在业务提交后写入独立、可分页的`audit/<TeamId>` projection。Entry 会引用 authoritative stream 与 cursor，并覆盖 policy decision、delivery retry／backpressure、Link lifecycle、external workspace change、integration、retention 和 cleanup failure。Audit append failure 可观察、可重试，但不能回滚、修复或否决其引用的业务事实。恢复会在推进 audit cursor 前重建缺失且可重建的 entry；Host 与 SDK audit read 绝不把原始 Team 或 channel record 重新解释成 audit model。

Retention 只有在 adapter、receipt、audit 与 replay watermark 证明被移除 prefix 不再需要时才压缩 stream。Active channel 保留每条未确认或 causation-reachable Envelope；terminal Team 与 channel 保留经过验证的 checkpoint、适用时的持久 summary 和配置的 audit tail。可选的 scheduler retention drive 会提供有界的 terminal-stream tail，并调用由 Hub Team-journal／channel-WAL watermark gate 保护的 compaction command；省略 retention field 时仍只有显式 compaction 会发生。Artifact collection 遵循上文 reachability／grace 规则。部署指南定义 queue pressure、replay lag、receipt latency、stalled Team、重复 retry、checkpoint failure 和 cleanup failure 的告警阈值。

### 迁移与交付计划

剩余工作通过一个官方 stack 落地。每个 stack 项都能构建，拥有自己的新 Agent Note 或更新既有决策 owner，并携带其约定要求的最小测试。后续项绝不能削弱前序项已经建立的持久或安全保证。

剩余 stack 由两份可执行 specification 管理：[P0 安全闭环](2026-09-04-native-multi-agent-p0-safety-closure.zh.md)拥有 authenticated human authority、restart-safe lifecycle settlement、retained protocol implementation 与 durable channel view；[P1 产品收敛](2026-09-04-native-multi-agent-p1-product-convergence.zh.md)依赖 P0，并拥有 child Team、channel 与 scheduler expansion、remote supervision、complete UI、legacy cutover、performance budget 与 final promotion evidence。

[开发交接计划](../../../plans/2026-09-05-native-multi-agent/overview.md)将剩余工作分配为可独立审查的程序员工作包，并明确共享接口主责、集成依赖和 33 项验收映射。它以 2026-09-05 的工作区审计作为规划基线；其中的任务说明和历史测试结果不能证明 P0 已完成或版本已可发布。

| Stack 项 | 依赖 | 交付内容 | 退出门禁 |
|---|---|---|---|
| S0 — 锁定约定 | 当前稳定 Team 包 | 为 closure、review、grant、budget、workspace root、channel view、remote restart 和 pagination 新增初始失败的 contract／property fixture；记录每条 current public bypass | 后续每项行为都有失败的替代测试，source／artifact entry inventory 保持 current |
| S1 — Closure 与 cancellation authority | S0 | 新增 typed completion／failure／cancellation command、closure intent 与 quiescence projection、完整 task cancellation、failure／stall settlement，并移除产品`team.phase` | 没有 final receipt 与完全停稳时，任何路径都不能提交`completed`；cancellation 会结算或 stall 每条 owned branch |
| S2 — Grant 与 budget ledger | S1 | 新增 actor proof、immutable grant、parent-subset validation、typed Team／task budget、task usage provenance、parent charging 与正式 mandatory policy composition | root 与 child Team 中未授权或超预算操作会在持久接收或下一模型步骤前失败 |
| S3 — Review 与 task orchestration | S1, S2 | 新增 review-assignment source、response-driven review repair、模型 task list／watch／cancel／owner proposal、multiple-worker DAG scenario 与 cancellation race | 组装后的 accept 与 rework run 会关闭 channel、保留 reason，并到达确定性 task outcome |
| S4 — Workspace 与 artifact authority | S2, S3 | 扩展已交付的 durable allocation binding 与 release recovery，新增 common root resolution、sandbox／remote provider、external-write audit、verified artifact、integration task 与 retention | 每个 workspace-sensitive tool 使用同一 provider root；conflict、dirty tree、restart、cancellation 与 artifact visibility 均有证明 |
| S5 — Channel 与 workflow completion | S2, S3 | 新增 logged channel view、adapter／extension lease、versioned extension execution 与 Team workflow compilation／replay；local control-plane cursor pagination、durable TTL delivery expiry 与 durable channel summary 已实现并单独验证 | conditional handoff 与 workflow restart 可以回放，且不存在 private child ownership 或 unlogged model input |
| S6 — Remote reliability | S1, S2, S5 | 新增 durable dynamic enrollment、ACP proxy Session admission、termination mode、Link cancellation frame 与 full-restart recovery | local、SDK、ACP 与 WebSocket delivery 共享 receipt semantics；remote cancellation 会终止或持久 stall |
| S7 — Product 与 UI convergence | S3–S6 | 把正式 Team log 切换为 SQLite、公开完整 authenticated paged control plane、实现 Team detail interaction，并清理陈旧文档声明 | Web、Headless、ACP、JSON-RPC、TypeScript SDK 与 Python SDK 公开同一 Team product model，并可检查 descendant Session |
| S8 — Observability 与 retention | S4–S7 | 新增 Team telemetry、完整 gauge／counter／latency、WAL 与 artifact retention、operational alert 和 large-state benchmark；本地 content-addressed artifact reachability／grace collection、按 source 分离的 durable audit projection，以及由 checkpoint 保护的 terminal-channel／audit prefix compaction 已实现并单独验证 | 在受支持范围内，JSON 与 SQLite 的 bounded-memory、queue-pressure、checkpoint、compaction 与 shutdown threshold 通过 |
| S9 — Final evidence 与 promotion | S0–S8 | 运行 keyless assembled snapshot、keyed multi-agent e2e、distributed fault test、real-browser／GIF acceptance、full repository gate、packed probe 与 documentation reconciliation | 每条验收标准都有具名证据；本 Note 可以改写为当前现实并移入`implemented/` |

### 测试策略

| 范围 | 必需证据 |
|---|---|
| 持久存储 | 共享 JSON／SQLite 约定、差分回放、断裂写入／重启测试、属性生成事件流、expected-sequence 竞态 |
| Team／channel／task 状态机 | 纯 fold 测试、invariant companion、基于模型的转移测试、无效持久／协议载荷拒绝 |
| 生命周期与并发 | 使用 fake clock 的确定性测试，覆盖接收截止、重复启动、取消、租约过期、HMR、listener 失败、完全停稳式释放和聚合清理 |
| 投递 | 在 append／notify／inbox-flush／receipt 边界执行故障注入；覆盖重复、缺失、陈旧和乱序 frame；覆盖重连与 causation 去重 |
| 产品组合 | 通过真实组合包运行无密钥 headless／ACP snapshot；使用真实密钥执行任务拆分、工具调用、同级报告、评审和最终汇总的 multi-agent e2e |
| SDK／API／UI | TypeScript 与 Python 预期输出、Remote schema 测试、回放／导航测试，以及 GUI 改动所需真实浏览器截图和 GIF |
| 安全与策略 | 发送方伪造、未授权 audience／task／interrupt、父级授权升权、畸形／超大载荷、速率／inbox 上限、远程认证失败 |
| 性能 | Hub 内存上限、增量 fold 与检查点 benchmark、WAL 分页、高水位 backpressure、大型 Team 关闭 |

每个 PR 按仓库 pre-push policy 运行覆盖其出站 diff 的最小检查。最终切换执行不可再拆分的全仓 build、typecheck、hygiene、coverage、snapshot、SDK 投影、`doc-sync`、website build 和打包产物探针；完整平台矩阵仍由 CI 负责。

### 既有决策影响与取代审计

当前 implemented 记录继续充当已发布行为的权威说明。历史记录只有在其理由已有稳定 owner 或只保留历史价值时才会进入归档。

| 既有决策 | 全部实现后的分类 | 处理方式 |
|---|---|---|
| [持久 Agent Teams](../../archived/feature/2026-08-05-agent-teams.md) | 在源代码中已取代 | 归档记录保留原始理由；稳定 Team 决策负责持久投递、任务、activation 和产品 topology |
| [实验性 Team 包](../../archived/architecture/2026-08-18-experimental-agent-teams-packages.md) | 完全取代 | 稳定包取代私有包对后已归档 |
| [Subagent 能力](../../implemented/feature/2026-06-21-subagent-capability-seam.zh.md)与可延续生命周期记录 | 部分取代 | 在 AgentRuntime 下保留提供方并发、冷恢复、发布、取消和完全停稳理由；退役直接父级 Team 授权与模型工具 |
| [动态 workflow](../../implemented/feature/2026-07-05-dynamic-workflows.zh.md) | 部分取代 | 保留隔离脚本／值边界理由；让编排通过持久 Team 图执行，并删除私有直接子级所有权 |
| [持久同 Session Goal](../../implemented/feature/2026-07-19-persisted-same-session-goal-domain.zh.md)及 Round 驱动器 | 在正式产品中完全取代 | 把目标／CAS／blocker／预算理由整合进 Team Goal，所有客户端迁移后删除同 Session 调度 |
| [并行 subagent 委托](../../implemented/feature/2026-08-09-parallel-subagent-delegations.zh.md) | 工具删除时完全取代 | 在调度器／提供方约定中保留并发独立工作和如实描述 workspace 冲突的必要性 |
| [事件溯源 Session](../../implemented/architecture/2026-06-11-event-sourced-sessions.zh.md)、[微内核事件](../../implemented/architecture/2026-06-11-microkernel-event-taxonomy.zh.md)与能力 seam | 不取代 | 继续作为基础；Team 新增更高层事件溯源能力，并继续使用 Agent／Session／loop 扩展点 |

## 考虑过的替代方案

**把 AgentScope 或 AG2 作为 multi-agent 运行时依赖引入。** 不予采用：生产系统使用 TypeScript/Cordis，已经拥有更强的 Session／subagent 生命周期机制；引入第二套框架后，仍需为持久化、工具、权限、UI、SDK、取消和 HMR 编写适配层。本提案采用其公开语义并在本项目中原生实现，不复制任何上游源码。

**先移植 AgentScope MsgHub，之后再加持久化。** 不予采用：自动对象订阅没有稳定收件人身份、接收回执、策略检查点、重启游标或协议生命周期。补齐这些能力后，MsgHub 实际上会变成 Hub／channel 设计，却仍保留不安全的自动广播默认值。

**只给当前实验 TeamService 增加更多方法。** 不予采用：其 Team 身份、事务所有者、恢复、授权和成员关系全部依赖一个存活 Lead Session 与直接子级血缘。Channel、人类、远程 agent、独立 Team 生命周期和跨进程投递要求新的持久化与身份根，不能靠增加 façade 方法解决。

**保留独立 Session 模式，并让 Team 继续可选。** 不予采用：每个产品、SDK、UI、策略、snapshot 与工具都会保留两条生命周期和持久性不同的编排主干。单成员 Team 已能提供低成本场景，无需第二种模式。

**把经典 GroupChatManager 作为核心调度器。** 不予采用：额外的 LLM 发言者选择调用具有不确定性，成本更高，也难以重建为授权事实。LLM handoff 保持为确定性 Hub 策略的显式持久输入；部署可以注册 LLM 调度策略，但不能让它成为基础机制。

**继续让模型编写的 JavaScript 充当正式 Team workflow authority。** 不予采用：任意 control flow、clock／randomness access 和 Node escape 无法被验证为确定性持久 graph。正式 workflow 使用`TeamWorkflowPlan`数据；现有 script engine 只作为显式 custom-composition 能力保留。

**采用没有权威 Hub 的纯点对点 actor mesh。** 不予采用：成员关系、顺序、任务 CAS、回执、预算、审计和恢复将需要分布式共识或相互冲突的副本。单 Hub 首先提供清晰的一致性域；Link 提供方仍可分布 Agent 执行。

**仅通过把协作消息复制到每个 Participant Session 来保存协作。** 不予采用：没有任何 Session 可以权威回答 channel 顺序、成员关系、可见性、任务状态，或每个预期收件人是否已持久接收消息。Channel WAL 是 outbox 和协议真源；Session 只记录实际收到的精确模型输入。

**强制每个 Participant 使用 worktree。** 不予采用：只读调研、远程 sandbox 和刻意共享的任务需要不同执行环境，而 worktree 创建／merge 也存在仓库专用失败模式。workspace 提供方显式表达隔离；共享模式会串行化声明冲突写入，也绝不假装存在锁。

## 当前实现基线

正式 Headless 与 Web 组合包使用稳定的本地 Team spine；ACP、JSON-RPC、TypeScript SDK 与 Python SDK 产品 run 会创建由 Team 拥有的 coordinator Session。JSON 与 SQLite log、Team／channel／task／activation projection、typed closure 与 cancellation、immutable grant 与 typed budget、child-to-parent usage charge、review source、direct／consult／discussion／workflow adapter、本地与 WebSocket Link、本地 receipt-backed delivery、确定性 task assignment、Team Goal state、shared／worktree provider、artifact storage、control-plane Remote、SDK projection 和 Team detail UI 已有聚焦实现证据。Legacy subagent、workflow 与 same-Session Goal 包只保留给显式 custom 或 internal composition，并且不存在于正式 Team preset。

普通 Envelope admission 使用 runtime-only actor proof，而不是 caller-selected sender 字段：Link 派生 activation sender，TeamRun 派生其准确 human input，scheduler 只派生 current assignment/review Envelope 或一条经过验证的 closed review-response recovery。该基线已经满足 typed lifecycle authority、review revision/source delivery、participant/task grant 与 budget enforcement、common workspace-root consumption、versioned workflow extension、ACP proxy-Session admission、child usage propagation、Team detail read、有界 Team/member/task/channel page read、durable TTL delivery expiry、durable channel summary、coordinator task list/watch/cancel/owner-proposal control、可配置本地 worker-pool fan-out、正式 `TeamWorkflowPlan` Consumer、本地 content-addressed artifact reachability／grace collection、按 source 分离的 durable audit projection、Team metrics route 中的 audit repair/failure counter、由 checkpoint 保护的 terminal-channel／audit prefix compaction、terminal Team-journal compaction、可选的有界 scheduler terminal Team／channel retention drive、typed live `TeamTelemetryCoordinator`、带可配置 threshold alert 的显式 OTLP Team telemetry provider、完整的 Team operational gauge 与累计 task/receipt latency histogram、coordinator Session 的 Team-aware model-directory read/select、v4 cooperative WebSocket endpoint termination、dynamic WebSocket enrollment Hub restart、纯 channel replay/watermark property coverage、generated Task lifecycle fold property coverage、通过 local 和 WebSocket Link 的 artifact-sourced integration-task execution、local shared、sandbox 与 E2B remote workspace provider 的 bounded portable change-set integration、默认的 bounded 4,096-record SQLite WAL page/restart load coverage，以及 opt-in 的 16,384-record SQLite load benchmark 等本地实现切片。该 page contract 为 scheduler/recovery 保留 provider-owned full read，同时为产品 transport 使用 exclusive cursor 与 bounded look-ahead；Host、TypeScript SDK、Python SDK 和 Web refresh 都会保留 continuation cursor。TTL expiry 是显式 Hub drive，会为每个 recipient 追加可 replay 的 expiry record，并且不会推进 receipt high-water。Channel summary admission 会在追加由 policy 选择的 durable summary 前校验 bounded WAL range 与精确 source Envelope provenance；summarized view 不再在 read 时合成 history。Plan compiler 会在 durable task/channel work 前校验完整 JSON graph，从 Team journal 恢复 task/template/channel binding，并将 legacy JavaScript workflow execution 保留在显式 custom composition 中。Local artifact owner 会分页读取未归档 Team 的 task result，采用重启保守的 grace ledger，并通过 bounded object cursor 驱动 provider collection。Hub 会在 `readAudit()` 返回前修复独立的 Team 与 channel audit stream；business commit 仍是 authority，audit append failure 不会回滚它。Terminal stream retention 要求 current checkpoint、已授权 maintenance actor 与配置的 audit tail；channel retention 额外要求没有 pending delivery；压缩后的 channel snapshot 与 audit page 会公开 first retained cursor；storage layer 保留原始 cursor，并明确报告 compacted old cursor。[compiled Team workflow-plan decision](../../implemented/architecture/2026-08-31-compiled-team-workflow-plan-consumer.zh.md)记录了该边界。本地 keyed Team real-model e2e 现在覆盖 coordinator-to-worker assignment、worker evidence 与 final output；剩余实现与 evidence gap 是 multi-host/distributed restart、real-browser/GIF、超出 opt-in benchmark 的 load performance budget、已完成 activation-recovery suite 之外的 provider per-file coverage，以及完整 release evidence。

本地 OpenAI 兼容 route 现在也驱动已有的 headless real-model file-edit、bash、todo、Code Mode、compaction 和 resume 套件：本地 Qwen 运行通过 13/13 测试。默认的有界 SQLite Team load path 已通过 opt-in 的 16,384-record replay／restart 运行，耗时约 136 秒并使用 32-record page；生产性能 budget 仍属于 deployment evidence，而不是绑定本机速度的 timing assertion。

同一个本地 route 现在也驱动 text ACP 的 real prompt 与 sandbox approval／rejection 套件，6/6 测试通过。本地 profile 会将 canonical `high` reasoning 映射为测试 Qwen endpoint 接受的 `xhigh` 拼写；图像专用与提供方专用的 ACP overlay 继续保留各自的 model contract。

TypeScript SDK 现在有成组的 contract coverage，覆盖每个低层 Team request wrapper，以及每个 `HarnessTeam` inspection、channel、task、member、lifecycle 和 archive forwarder。该套件在面向 wire 的层验证畸形 result rejection，在高层验证稳定的 Team/cursor identity forwarding；已认证的通用 Team write 仍按照 actor-proof proposal 有意保持 fail-closed。Python SDK 现在也为 notification subscription closure 提供相同的有界 teardown 行为：丢弃排队 notification，并用 typed transport-closed failure 唤醒每个阻塞的 `next()`。

Bundled Python runtime carrier 现在在 inert `test-provider` 之外也包含显式的本地 `local-vllm` route。Python SDK caller 可以使用相同的本地环境变量选择 Qwen-compatible route，其中 canonical `high` reasoning 会映射为测试 endpoint 的 `xhigh` 拼写，无需提供自定义 Cordis 文件。

受控 SDK remote 路径现在把明确的远端 `offline` 响应或已确认的子进程退出视为终止证明。取消中两者都不可得时，activation 会保持 `stopping`，controller 会将 `REMOTE_CANCELLATION_UNCONFIRMED`记录为持久 Team stall。WebSocket v4 现在会在关闭 attached socket 前传递有界的 cooperative endpoint-termination request；真实 child-process transport 与远程 `task-integrate` dispatch test 已覆盖这些路径。ACP provider 现在会让 initialize/session startup 与 activation cancellation 竞争，在 child quiescence 前等待 in-flight enrollment cleanup，去重已完成的 Envelope delivery，并通过真实本地 process 证明 EOF 与 trapped-SIGTERM child termination。外部 cooperative endpoint 的 hard termination 与分布式重启证据仍是未完成工作。

Provider-backed artifact reference 会保留其命名的 provider；`team.artifact.read` 现在通过 Host、client runtime 与 Team detail UI 传递准确的非 private reference，提供有界 base64、provider 校验、inline text preview、download、cancellation，以及没有 provider 时仅保留 metadata 的 fallback。

SDK server 现在也通过 `team/artifact-read` 暴露相同的 visibility-checked read；TypeScript 与 Python Team handle 会返回准确的 provider-backed reference、byte count 和 canonical base64 data，并将 private、ambiguous、缺失、没有 provider 及超限 artifact 映射为 typed error。

Task／channel property suite 现在会一起生成 retry、heartbeat、assignment／report Envelope、receipt interleaving 与 checkpoint round trip，并检查 task-attempt provenance 和 channel pending／replay watermark 在两个 fold owner 之间保持一致。

现有 artifact／pricing、worktree integration、shared target-directory integration 与 SQLite handoff 机制继续作为有效基础，分别由[artifact 与 pricing 决策](../../implemented/architecture/2026-08-31-team-artifact-storage-and-pricing.zh.md)、[worktree integration 决策](../../implemented/architecture/2026-08-31-team-worktree-integration-authority.zh.md)和[projection reconciliation 决策](../../implemented/architecture/2026-08-31-multi-hub-projection-reconciliation.zh.md)所有。其当前 package-local guarantee 仍不能替代完整 Team-journal watermark policy 或上述 release-tier evidence。

本地 `sandbox` workspace provider 现在拥有隔离 root、可选 source seeding、外部 allocation manifest、有界 changed-file publication、fail-closed release/recovery，以及带 expected-version fence 与 retry marker 的 opt-in portable change-set integration target。opt-in E2B `remote` provider 在已挂载的 E2B execution world 内拥有隔离 root 与 manifest，会先规范化并约束 remote root，发布有界 remote file，并可在 sandbox 存活时将自己的 portable change set 应用到显式 remote target，执行 expected-version fence。两个 provider 都不会推断 Git integration authority 或 distributed lock；target-directory replacement 仍是 provider-specific 能力。

官方本地 release path 现在已经证明 `build:clocky`、完整的 Clocky/vendor pack、native Landlock entry pack，以及一个能够启动 `@clocky/clocky` 并报告打包版本的隔离 consumer install。`release.yml` 也定义了基于这些 canonical tarball 的 Linux/macOS/Windows packed-consumer matrix。独立的 Landlock workflow 已经在匹配的 runner 上构建并测试每个受支持的 Linux architecture，组装完整 native package family，并验证 packed install；Clocky composite release 消费 entry tarball，并按宿主验证 consumer degradation 或 native resolution。Leader election、自动 multi-Hub failover 与 federation 继续不属于本提案。本地 keyed real-model Team e2e 现在覆盖 coordinator-to-worker assignment、worker evidence 与 final output；hard remote cancellation、multi-host-capable transport test、browser／GIF acceptance 和完整 release-run evidence 仍是本提案的必需验证，不能由 deployment-owned evidence 替代。

Closure authority 现在遵循同一边界：只含 JSON 的 complete/fail/cancel input 携带不透明 runtime proof；Hub 会在其 serializer 内将 active activation proof 解析为 participant，或将 `team-run` proof 解析为一条封闭的 completion、cancellation 或 creation-failure scope。持久 closure 与 cancellation record 只保留得到的 participant 或 `team-run` system attribution，绝不保留 proof 或 caller-supplied raw actor。Goal update 与 phase-transition input 同样使用 activation proof；TeamRun 只会为其准确 coordinator 与可信 human-turn capability 签发它。Scheduler 的 maintenance compaction 与 phase recovery 仍是独立的 authority 工作。

root Team creation 同样是 proof-only：在任何 Team identity 存在前，TeamRun 会把一条完整 root payload 绑定到 `TeamSystemRootCreationProof`，Hub 会在 register policy 和 stream opening 后、首条 record append 前重新验证它。首条 record 只保留派生的 `createdBy` system provenance，并折叠到 Team snapshot 与 checkpoint。嵌套 Team creation 现在需要独立的 `TeamSystemChildCreationProof`，其中包含完整 child payload 和一条 observed parent cursor。Hub 只接收 canonical `team-child-delegation` source，并会在 parent repair 前、parent serializer 内、register policy 后和 child-stream opening 后重新验证它。在 parent-task delegation consumer 拥有该 source 前，shipped product 不会挂载它，因此原有 raw child path 会 fail closed，而不会把 parent Team 或 task 视为 authority。

terminal archive 现在同样是 proof-only：TeamRun 自己完成或取消 Team 后，会保留一条 in-memory owner，并为准确的 Team/cursor archive call 签发一条 `TeamSystemArchiveProof`。Hub 会在加载前、在 Team serializer 内（即使是 idempotent archive read）以及 close policy 后、追加既有 `team/archived` marker 前验证 canonical `team-run` scope。Host 只委托给这条 local owner；SDK server 只会保留自己的 terminal run record，直到完成 archive。TeamRun disposal 时 owner 和 proof 都会消失，任何 Team id、snapshot、provenance、roster、detached product client 或 restart 都无法重建它们。

通用 lifecycle command 也已变为 proof-only：`team-scheduler-dag`只能以准确 reason 证明 active-to-stalled transition，`team-run`可以证明 stalled-to-active resume，或为已接纳 final 建立 active-to-quiescing admission fence。该 fence 会在阻止新的 channel work 前绑定 final channel、Envelope、默认 topology 和 Team cursor。Scheduler maintenance compaction 仍是独立的 authority gap。

Scheduler terminal retention 现在会将每段破坏性的 Team-journal 或 channel-WAL prefix 绑定到一次性 maintenance proof，其中包含准确 cursor 和 `throughSequence`。Hub 会在 policy、audit、checkpoint 或 storage compaction 前重新校验该 proof，因此 durable system attribution 不能被复用为 compaction authority。

Soft interrupt authority 同样是 proof-only：ACP 会把一条 current-run human-to-coordinator request 委托给 TeamRun，而 target Link 使用自己的 activation proof 完成 discovery 和 acknowledgement。任何 requester、target、activation、Session 或 provider identity 都不会从调用方跨越 interrupt command boundary。

Usage recording 也是 proof-only：`team-agent-client`会为每条准确 current binding 保留 activation-proof lease，并且只将 JSON provider/model fact 传给 Hub。Hub 会在 parent-charge repair、重复 replay、policy 或 append 前重新验证 binding，并派生 Team、Participant、Session 与 timestamp；parent-charge propagation 保持为带有该 durable provenance 的内部 settlement。

activation lifecycle authority 也是 proof-only：controller 会为其拥有的 epoch 保留一条准确 bind/status/fence/quiesce proof，startup recovery 只保留一条本地 quiesce wake-cleanup retry。Hub 会在选择 Team 前和在 serializer 内再次解析每条 proof，因此从旧 binding 复制的 identity 无法到达 policy、lease cleanup 或 journal append。

Host approval/question action 也是 proof-only：API proxy 只会在 durable admission 成功后保留每条 verified pending action，并为每次 retry 签发新的 cursor-bound resolution proof。Hub 会从该 scope 派生 durable action 与 policy fact；Host restart 后缺少 verified entry 会记录诊断并 fail closed，而不会重建 raw authority。

scheduler task assignment 与 lease expiry 也是 proof-only：`team-scheduler-dag`会为每次 Hub call 保留一条准确 assignment 或 elapsed-attempt proof。Hub 会在 parent-charge repair 前及其 Team/wake-channel serializer 内验证该 proof；assignment failure 会关闭新打开的 wake channel，而不会留下 orphan。

scheduler review consult 与 wake channel lifecycle 也是 proof-only：`TeamSystemSchedulerChannelProof`会为一条准确 review attempt/reviewer binding、pending task/assignee activation 或 failed-assignment wake channel 固定 scope。Hub 会派生固定 channel manifest，在 repair 前后和 policy 后重新验证它，并且绝不会关闭被当前 lease 引用的 wake channel。

scheduler TTL delivery expiry 使用同一 proof family：一条 scope 选择 active Team、attached channel、observed cursor、clock observation 与有界 batch。Hub 保留 policy-free expiry drive，在 WAL append 前立即重新验证，并允许 terminal attached channel 清空 pending delivery。

coordinator task creation 与 workflow-plan admission 也是 proof-only：TeamRun 会为每次 retry 签发新的 current-coordinator activation proof，Hub 会在 repair、policy、replay 或 append 前派生 durable creator 或 plan-actor attribution。每个新写入的 Task snapshot 都会保留派生出的 creator command，journal 或 checkpoint parser 会拒绝缺失 provenance。剩余的 workflow compiler channel/binding/phase operation 仍在这个较窄 admission boundary 之外。

workflow compiler channel open、plan binding 与 phase 也是 proof-only：TeamRun 会为一次 compiler mutation 保留准确 `TeamSystemWorkflowProof`，Hub 会在其 Team/channel serializer 内验证 plan revision 与 payload。attached workflow channel 只能在 compiling plan bind 前通过 scoped orphan cleanup 关闭。

current-coordinator 的 default-worker owner proposal 与 cancellation 均要求 `TeamSystemTaskControlProof`。TeamRun 固定 durable creator、task revision 与 selected payload；Hub 验证该 creator，并在 policy 后、append 前再次验证 proof。Owner proposal 要求 pending nonworkflow task。[单任务取消决策](../../implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md)拥有取消接纳和精确工作结算规则。Post-release cleanup 保留独立 authority lifetime；`cancelTask()`没有 actor-free path。

Participant topology 也是 proof-only：`TeamSystemTopologyProof`只覆盖 Run 发布前 TeamRun bootstrap participant/phase/direct-channel mutation，以及已保留 Run 的 declared-worker activation 与 reviewer provisioning mutation。Hub 会在 participant policy 前解析每条准确 scope，并在 Team serializer 内、持久 mutation 前再次解析；raw participant ingress 会 fail closed，而 scheduler structural channel open 仍由独立 owner 管理。

release 后的 cleanup 按 lifecycle evidence 分开：`TeamSystemCancellationCleanupProof`绑定一条 durable cancellation identity 及其准确 pending task 或 active channel，而 `TeamSystemFinalizationCleanupProof`绑定一条已由 human receipt 的 final、默认 topology 和准确 active channel。Hub 会在 parent-charge repair 前拒绝 stale cancellation scope，并在 policy 或 durable cleanup 前重新验证两类 proof；它们都不能授权通用 channel closure。

## 验收标准

- 每项正式产品用户任务都按 `TeamId` 创建、列出、恢复、取消、完成和归档；任何 Web、CLI、ACP、JSON-RPC 或 SDK 路径都不把独立 Session 创建暴露为产品操作。
- 默认正式 Team 模板包含 coordinator 与 worker 身份；单成员配置使用同一运行时；策略可以创建 reviewer，而无需切换产品模式。
- `TeamId`、`ParticipantId`、`SessionId`、`ActivationId`、`ChannelId`、`EnvelopeId`、`TeamTaskId` 和 `TaskAttemptId` 保持独立品牌类型；跨包转换必须经过所有者查询。
- Team journal、channel WAL、Session log 和审计投影遵守上文所有权划分；Team 真源不依赖存活 Lead 或复制的 Session transcript。
- JSON 与 SQLite log 提供方通过同一套一致性测试；不支持的格式／适配器／视图版本快速失败；Hub 重启能重建等价 Team／channel／task 投影。
- Direct、consult、discussion 和 workflow 适配器强制执行 manifest 版本、参与者角色、轮次／终止规则、投递计划和纯回放；图扩展通过 Cordis effect 注册并释放。
- 本地与 WebSocket Link 暴露相同客户端约定。已接收 Envelope 在 Hub 重启后继续存在；未确认投递在重连后重放；旧回执不能让游标回退；重复 causation 不会重复模型轮次。
- 每条 Team 衍生模型输入都能通过 Session log 重建，并带有 Team／channel／Envelope 来源与精确渲染内容；不存在自动输出广播。
- 任务变更使用 revision 与 attempt CAS；依赖保持无环；租约显式过期；重试／评审／停滞转移持久化；Team 完成要求完全停稳及一条发给人类的最终答案。
- Hub 策略独立于提示词遵从性执行身份、成员关系、访问、授权、预算、速率／inbox 上限、中断、任务分配和 workspace 分配。
- 并发修改任务要么获得隔离 workspace 分配，要么按冲突声明范围串行；集成与产物来源持久化，用户改动得到保留。
- Team 取消与插件／进程清理会关闭接收、结算已接收工作、在需要时按子级优先释放 Activation／Link／workspace、隔离 listener 失败，并只在完全停稳后报告聚合清理失败。
- Web UI、Host Remote、TypeScript SDK 和 Python SDK 暴露 Team／Participant／Channel／Task 模型，并同步更新预期输出；Participant Session transcript 继续作为后代可检查。
- 切换后，实验 Team 包、旧 Team Session 事件、模型可见的直接 subagent／fork 控制和 workflow 自有私有子级启动从 shipped 源码／catalog 区域、默认组合包、snapshot 与打包产物中消失；兼容包只能保留给显式 custom/internal composition。
- 单元、约定、属性、竞态／故障、无密钥 snapshot、真实模型 e2e、分布式 Link、浏览器／GIF、两套 SDK、build、typecheck、coverage、hygiene、文档和包 Consumer 证据在各自阶段及最终切换时通过。

## 风险

- **如果顺序含糊，3 条持久流可能产生分歧。** Channel WAL 先于投递提交，目标 Session 在回执前 flush，回执在目标持久化后提交。恢复始终根据这些有序事实推导待处理工作；系统不声称跨存储原子性。
- **Hub 起初是单点故障和吞吐上限。** 持久重启、增量投影、检查点、有界队列与 SQLite 可降低影响。单 Hub 语义和指标稳定后，多 Hub 共识／联邦需要单独提案。
- **至少一次投递可能重复模型或工具副作用。** Envelope／causation 去重防止已知重复轮次；外部工具仍需幂等／CAS。文档与 API 绝不能声称恰好一次。
- **Multi-agent 上下文增长可能快于有效工作。** 显式发送／报告、受众过滤、有界 channel、视图策略、带来源摘要、任务产物和禁止自动广播共同控制 token 成本。
- **更多 agent 会增加成本、延迟和失败概率。** Team 预算、休眠的预创建 worker、并发上限、确定性调度、任务租约和可观察成本使权衡可配置；默认模板必须与单成员 Team 对照 benchmark。
- **共享文件系统工作仍可能与未声明或外部写入冲突。** 调度器串行化与 worktree 提供方可以降低风险，但无法推断所有 Bash／generator 效果。集成边界仍是最终 diff／产物评审与测试。
- **重构跨越持久化、Agent 生命周期、工具、goal、workflow、API、SDK 与 UI。** 按依赖排序的 stack 保证每个分支都可构建，先迁移替代证据再删除，只在最终切换时使用预发布无兼容层策略。
- **版本化适配器／插件移除可能让活跃 channel 无法继续。** 已接收 channel 在关闭前保留其适配器 lease；重启时缺少精确版本就快速失败。保留与部署检查必须阻止移除仍被活跃持久 channel 引用的版本。
- **远程 Link 扩大安全边界。** Hub 盖章发送方身份、验证每个 frame／payload、执行认证／访问／大小／速率限制，并绝不接受客户端提供的授权。TLS、凭证轮换和部署隔离仍由运营方负责。
- **LLM coordinator 可能创建低质量任务图或 handoff。** Hub 验证图结构、预算、能力、策略和生命周期；确定性 fallback／stall 行为阻止无效模型决策演变成无界执行。任务语义质量仍需评审或 evaluator 策略。
