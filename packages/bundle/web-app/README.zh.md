# `@clocky/clocky-web-app`

[English](README.md) | 中文

clocky 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`clocky-base`](../base/README.zh.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）、浏览器插件名录与始终挂载的客户端插件重载链（[`clocky-client-hmr`](../../client/hmr/README.zh.md)，在重建 watcher 改写客户端 bundle 之前保持空闲），并挂载本包的 `web-runtime` 粘合插件（配置为 `{openBrowser, printUrl, surfaceContext, trustedHosts}`）。该插件通过 `@clocky/clocky-web-frontend` 的 exports 解析已构建的前端 dist，只采样一次依赖 bind 的 LAN 信任信息并将其作为 `webRuntime` 提供给浏览器信任栅栏和客户端名录，挂载 [`frontend-static`](../../host/frontend-static/README.zh.md) 回退席位所有者，并在 `surfaceContext` 为 true 时注册 Harness 源码与 Web 表层提示词段落，以及 bash 可见的 `CLOCKY_WEB_URL` 运行时变量。自身 Loader 配置树结算后，它在 `printUrl` 为 true 时打印 `clocky web:` URL 行；`openBrowser` 为 true 且继承的 `SSH_CONNECTION` 与 `SSH_TTY` 均为空或不存在时，才会用默认浏览器打开规范宿主机 URL。SSH 启动仍保留 URL 行，但会跳过浏览器交接，因为本地转发地址由 SSH 客户端或编辑器持有。交接前，运行时会打印英文提示 `clocky web: opening the default browser; pass --no-open to disable`。短生命周期 Node helper 使用规范的脱敏子进程环境运行受维护的平台 opener。在 Windows 上，helper 会保持存活，直至短生命周期的 PowerShell launcher 退出，因为 `open` 会在 launcher 把 URL 交给 shell 之前、仅在 spawn 时返回；其他平台则在 opener 接受 spawn 后结束。helper 失败时会向 stderr 写入不含 credential 的诊断，并将 owner-only 临时 handoff document 保留至 TTL，用户可手动打开该 document；不会停止服务器，也不会等待浏览器退出。本组合包还持有应用命令行：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`clocky-cmdline`](../../boot/cmdline/README.zh.md)），解析 `--host`、`--port`、可重复的 `--trusted-host`、`--no-open` 以及应用自己的 `--help`，再提供 `webStartup`；本机启动默认会打开浏览器，`--no-open` 则只对本次调用关闭该行为。它会在发布该服务前拒绝 `--host 0.0.0.0`，因为 CLI 目前有意不支持绑定所有网络接口。由 flag 配置的行会注入该服务，并在惰性配置中直接读取它，因此参数解析完成前不会有任何东西绑定端口，`clocky --profile web --help` 也不会启动服务器。[`clocky-headless`](../headless/README.zh.md) 是同一 base 之上的同级表层，不挂载本组合包。

`productPrincipalProvider` 与 Web connection 行共享。对于 shipped local provider，浏览器交接会在 Harness home 下创建 owner-only 临时 HTML 文件；平台 opener 只接收该文件的 `file:` URL，文件会将 credential 作为正文一次性 POST 到 loopback bootstrap endpoint，再重定向到应用。打印/手动 URL、browser-launch 参数、诊断和浏览器持久化都不携带 credential。文件会在交换成功、到期或 runtime teardown 后删除；`browserHandoffDirectory` 和 `browserHandoffTtlMs` 配置其私有位置与生命周期。配置的 provider 不可用时不会进行浏览器交接。

同一宿主组合还挂载本地 Team 路径：位于 `$CLOCKY_HOME/team-storage.sqlite` 的 SQLite 路由日志、持久 Hub、direct v3 channel、进程内 activation 与本地 Link 投递、作用域化 Team 工具以及 `ctx.teamRuns`。其 JSON domain storage 与 Team journal 保持分离。它还挂载 shared-workspace registry：`process.cwd()`作为 fallback，启用的 durable `workspacePath` 会选择每个 Team 使用的文件夹，另有 task-assignment adapter 和有界 scheduler。provider 会 canonicalize 所选 root，并拒绝 `cwd` 不同的 worker Session；它绝不会改写 Session 或替换另一个目录。`team-run`从 1 个惰性的 `minimal` worker 开始，coordinator 可以通过 `team_worker_pool_set` 将 pool 扩到 32 个；独立 task 会并行分配，超出当前 capacity 的 ready task 会排队且不会让 Team stalled。需要时才准备 reviewer，coordinator 保持 request-selected 或 default preset。带 mutation 的 task report 会通过显式 report-only publish 边界携带 provider-owned changed-path/artifact manifest。浏览器名录挂载 `ui-team`；客户端启动时进入本地 Team 草稿，`team.start` 是用户任务入口。objective、budget 与 phase 保留在 Team detail popover 中，而 `/goal`是 coordinator transcript 中作用域化的 Team command。base 的 same-Session Goal service、automatic driver、command、model tool 和 GoalBar 都不会挂载。默认 coordinator 会获得 `get_goal`、`update_goal`、`team_final`、`team_worker_pool_set`、`team_task_start`、`team_task_wait`、`team_task_list`、`team_task_watch`、`team_task_cancel`、`team_task_propose_owner`、`team_workflow_start` 与 `team_workflow_wait`；shipped Web 组合不包含 direct subagent、legacy workflow-script 或 Ralph tool。部署可在显式自定义组合中挂载 legacy workflow script。

## 模型重试默认值

Web 使用共享的有界 normal 默认值，在首次请求后最多再重试五次符合条件的失败。`test-provider` 与由 settings 新增的 pi-ai 路由在省略 `retryPolicy` 时使用该默认值；显式提供方策略仍然优先。Web 不再增加重试专用的组合覆盖，因此非 Web profile 的省略行为与之相同。

## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（顺序 −98）则向模型说明 GUI：规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`CLOCKY_WEB_URL` 还会连同描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口是启动期事实），因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
- **只观测交接启动**：平台 opener 接受 spawn 后即结束观察，但 Windows 会等待其短生命周期 PowerShell launcher 退出；之后的浏览器退出不会上报，已打印 URL 仍是手动访问的回退路径。
- **SSH 转发持有浏览器 URL**：打印出的规范 URL 指向远端宿主机 loopback 端点；自动交接会被跳过，SSH 客户端或编辑器必须暴露并打开其本地转发地址。
- **浏览器命令覆盖只能来自启动环境**：被发现的 `.env` 不得设置 `BROWSER`；只有继承值可以抵达会读取该变量的 opener 路径，避免 checkout 为自动交接选择可执行文件。
