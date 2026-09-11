# `@clocky/clocky-headless`

[English](README.md) | 中文

clocky 一次性任务组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`clocky-base`](../base/README.zh.md) 之上：提供编码 persona 和工具模式、禁用 HMR（热模块替换）及 base 的同 Session Goal 行、将 Code Mode worker、位于 `$CLOCKY_HOME/team-storage.sqlite` 的本地 Team SQLite journal、Hub/activation/Link stack、有界 shared-task foundation 和仅作用于 coordinator 的默认 worker task tool 与声明式 workflow tool 作为核心执行能力挂载，并插入本包的 `headless-runner` 插件（配置为 `{task}`，从注入的 `headlessStartup` 提供方解析）。`team-workspace-shared` row 使用 `process.cwd()`作为 fallback，并接受显式保留的 Team `workspacePath`；`team-run`从 1 个 `minimal` worker 开始，coordinator 可以通过 `team_worker_pool_set` 将 pool 扩到 32 个，因此独立 assignment 会并行执行，超出当前 capacity 的 ready task 会排队且不会让 Team stalled。其 `agent-presets` 行由 profile boot 注入 shipped preset root；`team-run` 为惰性激活的 worker 和 reviewer Participant 选择 `minimal`，coordinator 保持 base composition。带 mutation 的 task report 会通过显式 report-only publish 边界携带 provider-owned changed-path/artifact manifest。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

Loader 结算后，runner 通过 [`ctx.teamRuns`](../../team/team-run/README.zh.md)创建默认 Team，将任务作为一个可信 human text block 追加，等待 coordinator 的显式 `team_final` Envelope，将该 final text 写入 stdout，再经启动器提供的 `ctx.appExit`宿主钩子（[`clocky-cmdline`](../../boot/cmdline/README.zh.md)）请求退出。Team-run failure 会将 message 写入 stderr 并以 1 退出；成功运行时 stderr 保持为空。进程不会打开监听端口。任务文本就是这个应用的命令行：普通 `headless-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`clocky-cmdline`](../../boot/cmdline/README.zh.md)），读取 `clocky --profile headless "task"` 的位置参数、打印应用自己的 `--help`，并提供 `headlessStartup`；runner 注入该服务，再从惰性配置中读取任务。缺失或只有空白的任务会在 runner 激活前被拒绝。

## 模型体验

没有直接影响，因为 runner 只委派给 `ctx.teamRuns`；coordinator prompt 和 tool 属于 Team stack。

#### KV Cache 影响

无；runner 不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- **只提交一个 Team task**：runner 没有用于交互式后续输入的 surface；它会等待默认 coordinator 的显式 final Envelope。
- **仅 coordinator 作用域的 task tool**：`team_task_start`、`team_task_wait`、`team_task_list`、`team_task_watch`、`team_task_cancel`、`team_task_propose_owner`、`team_workflow_start`和`team_workflow_wait`只会为 live 默认 TeamRun coordinator 注册；worker 和普通 Session 都不会获得它们。
- **`ctx.appExit` 由启动器持有**：在 `clocky` 启动器之外启动 headless profile 会在激活时明确报错，直到宿主提供该退出请求。
