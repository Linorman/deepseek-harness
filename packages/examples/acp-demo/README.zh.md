# @clocky/clocky-acp-demo

[English](README.md) | 中文

ACP（Agent Client Protocol）自动化服务器应用：默认 agent（智能体）主干、本地 TeamRun 拓扑、JSONL 协调者转录、Team 日志、语义检查点，以及通过 JSON-RPC stdio bin 暴露的 [`@clocky/clocky-acp`](../../acp/acp/README.zh.md)。每次 ACP `session/new` 为一个 Team 任务返回不透明句柄；协调者 Session 仍是内部转录。

## 组合

| 插件 | 角色 |
|---|---|
| `@clocky/clocky-agent-spine-demo` | 不含提供方且不预创建 Agent 的 Agent 主干。 |
| `@clocky/clocky-session-persistence-jsonl` | 检查点、可观测性和快照回放所使用的持久会话日志。 |
| `@clocky/clocky-session-checkpoint-policy` | 在模型调用和顶层工具 effect 前建立持久性屏障，并为已完成步骤建立检查点。 |
| `@clocky/clocky-session-query-sqlite` | 派生的精确／FTS 会话查询服务；先于 ACP 传输打开，使叶节点消费方在首次模型请求前就绪。 |
| `@clocky/clocky-agent-default-model` | 从此应用的 `provider` 与 `model` 配置选择本地协调者路由。 |
| `@clocky/clocky-storage`、`-json`、`-log`；`@clocky/clocky-team-hub`；`@clocky/clocky-team-channel-direct` | 持久化 Team 日志和 direct v3 人工／协调者通道。 |
| `@clocky/clocky-agent-runtime`、`-in-process`；`@clocky/clocky-team-activation-controller`；`@clocky/clocky-team-link`、`-local`；`@clocky/clocky-team-agent-client` | 激活本地协调者，并把持久通道 Envelope 投递到其 Session。 |
| `@clocky/clocky-tool-team`、`-goal`；`@clocky/clocky-team-run` | 安装作用域内的 `team_final`、`get_goal` 和 `update_goal`，并拥有默认人工／协调者／worker 拓扑。 |
| `@clocky/clocky-acp` | 通过 stdin／stdout 提供、由 TeamRun 支撑的纯自动化 ACP 传输。 |

应用不安装命令、用户交互、会话导航、配置选择器或 stdout logger。其有序 effect 会在 ACP 工作停稳前保留 Team 存储、协调者投递与 JSONL 持久化。叶节点配置负责提供 LLM（大语言模型）、执行器、沙箱、审批、文件系统和面向模型的工具插件。

## 配置

| 键 | 默认值 | 路由目标 |
|---|---|---|
| `provider` | 必填 | 每个 Team 协调者的默认提供方路由。 |
| `model` | 必填 | 每个 Team 协调者的默认模型。 |
| `interruptRetryAttempts` | ACP 默认值（`3`） | 提交协调者软中断时允许重新读取 Team 投影的次数。 |
| `maxParallelToolCalls` | agent loop（智能体循环）默认值 | 正整数工具调用并发上限；`1` 表示串行。 |
| `persona` | 无 | 供 `clocky-system-prompt` 使用的部署 persona 模板。 |
| `toolOrder` | 字典序 | 供 `clocky-system-prompt` 使用的显式面向模型工具顺序。 |
| `tools` | `{ mode: 'native' }` | Native、Code Mode 或组合式模型工具传输。 |
| `clockyHome` | `$CLOCKY_HOME` 或 `~/.clocky` | bash 与本地 skill（技能）发现共享的 harness 主目录。 |
| `sessionTitle` | 主干示例限制 | 持久后备标题限制；标题仍不会进入 ACP wire。 |
| `persistenceRoot` | `./.sessions` | JSONL 后端根目录、派生 `session-query.db` 索引的父目录，以及默认 Team 存储根目录的父目录。 |
| `teamStorageRoot` | `<persistenceRoot>/team-storage` | Team 日志和通道 WAL 的 JSON 存储根目录。 |
| `packChunks` | `true` | 在存储中打包连续的增量分片事件。 |
| `persistenceCompression` | `zstd` | 带校验和的 Zstandard 帧，或原始 `none`。 |
| `workspaceContext` | 必填 | 工作区指令字节预算／配置，或 `false`。 |
| `skills` | 拥有者默认值 | skill 注册表、本地提供方和面向模型的 skill 工具。 |
| `toolBash` | 拥有者默认值 | 面向模型的 bash 工具配置。 |
| `jobs` | `{ maxConcurrentJobsPerOwner: 10 }` | 进程内按 owner 限制活动任务的准入配置。 |
| `toolJobs` | 拥有者默认值 | 通用后台任务控制配置，或 `false`。 |
| `goals` | 已移除 | 加载时拒绝；ACP task 归 Team 所有。 |

已交付的 [`examples/acp-agent/cordis.yml`](../../../examples/acp-agent/cordis.yml) 添加带有明确提供方 profile 的 pi-ai 适配器、沙箱化 bash 与文件系统提供方、一次性审批策略、压缩（compaction）、钩子，以及面向模型的工具。图像 overlay 会显式添加 `@clocky/clocky-attachment-local`；未添加时 ACP 不声明图像输入。应用提供派生会话查询索引，而面向模型的查询消费方仍由叶节点显式选用。direct subagent 与工作流包只属于显式自定义组合。

## Bin

`clocky-acp-demo [--config path-to-cordis.yml]`（短形式 `-c`；默认为 `./cordis.yml`）会加载 gitignore 排除的 `.env`，回放模式除外；`CLOCKY_SNAPSHOT=replay` 选择同级 `cordis.snapshot.yml`；stdin EOF 会在退出前 dispose（资源释放）上下文并刷新会话。Loader 已安装的可选对等依赖（peer dependency）`node-addon-require-builtin` 使纯 Node 下构建后的 bin 可以解析裸插件说明符。诊断使用 stderr，因为 stdout 是 ACP wire。

## 模型体验

模型体验间接来自 `clocky-agent-spine-demo`、`clocky-team-run` 和叶节点的面向模型插件。

#### KV Cache 影响

TeamRun 最终输出指令以及作用域内的 `team_final`、`get_goal` 和 `update_goal` schema 在一次协调者激活期间稳定。人工内容和工具结果仍是动态 Session 后缀。

## 已知限制与暂缓事项

- **协调者 JSONL 持久化固定不变**：使用其他 Session 后端需要另一种组合。
- **同级插件可能破坏 stdout**：应用无法阻止另一个 Cordis 配置项写入非协议字节。
- **只支持新建自动化 Team 任务**：恢复和人工交互属于其他运行入口。
