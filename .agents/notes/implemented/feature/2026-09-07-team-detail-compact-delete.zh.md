# Agent Note: 紧凑 Team 任务详情与认证删除

Status: implemented

[English](2026-09-07-team-detail-compact-delete.md) | 中文

## Problem

Team 详情面板在信息有用之前就展示了标识符、空区块、重复状态文字和原始记录。它也没有删除无 lease 任务的浏览器操作；此外，Web 启动时 API gateway 可能早于 authenticated Team actor provider 对外提供服务。

## Decision

详情面板只保留目标、生命周期、参与者、活动任务和需要人工处理的内容。隐藏空区块与重复标识符，限制任务描述行数，并把预算、通道记录、审计事实和已完成任务的证据放进原生折叠控件。无 lease 任务显示图标删除操作；用户确认后，Host 返回已删除 tombstone，再从可见列表移除该任务。

Web API gateway 在注册 Team control methods 前等待 `teamHumanActors`。这样浏览器删除任务时一定已经具备 authenticated actor proof；未认证请求仍使用既有拒绝路径。shipped shared-workspace provider 可以解析 durable Team workspace path，因此 worker Session 的 `cwd` 和 scheduler eligibility 使用用户选择的文件夹，而不是 Web 进程目录。shipped profile 从 1 个 worker 开始；coordinator 可通过 `team_worker_pool_set` 将 durable pool 调整到 32 个，多个 ready task 会分发给不同的存活 Session，超出的工作排队且不会让 Team stalled。TeamRun 只串行化 pool topology 与 task admission，并在任务压力下降后回收空闲多余 worker。shipped profile 提高了 Team token budget，本地模型 patch 将单次请求默认上限设为 32,768。所选详情改为紧凑的右上角浮层，带有隐藏触发器、受视口限制的拖拽／键盘调整大小和重置操作。

面向 model 的 Team task tool 现在会根据 coordinator Agent 当前 workspace 解析 scope。workspace 内的绝对路径会转换为严格的 Team wire 形式，workspace 根本身转换为 `.`；越出该根的路径会以可操作的边界错误拒绝。minimal preset 保持双 tool surface，同时挂载受 sandbox 约束的 filesystem 和 runtime permission context，因此 coordinator 与 worker model 在行动前可以看到当前 mode、workspace 和 approval 事实。

coordinator contract 将包含多个可并行 workstream 的任意 non-trivial objective 视为需要指挥的计划，适用于 research、analysis、writing、planning、data、operations、coding、testing 及其组合。它要求在等待前至少启动两个 worker task；有依赖时使用声明式 workflow，非 filesystem 工作保持空 scope，shared workspace writer 使用窄且互不重叠的 file scope。如果只能由一个 worker 写入共享 artifact，则为其他 worker 安排只读 research／analysis／review task，避免宽泛目标被静默压成一个 all-purpose worker。

scheduler 在 channel maintenance 遇到暂态 stale cursor 时，也会在既有 conflict bound 内用 fresh projection 重试完整 Team scan，避免 queued task 因并发 receipt 或 worker-pool 更新而悬置。

lease 释放后，任务详情会回退到最近一次已结算 attempt 的 participant 作为 owner；review 状态会关联到配置的 reviewer participant。这样已完成工作仍保留 worker 归属，活动分配继续以当前 lease 为准。

Team-owned coordinator 和 worker Agent 现在会在 provider 返回 `max-tokens` turn 后，在同一个 Session 上执行有界 continuation。Continuation 会在唤醒 worker 前重新检查 live task lease 与 activation，并要求 coordinator 或 worker 完成尚未结束的 Team tool operation；worker 达到上限后将仍在运行的 attempt 结算为有界 failure，coordinator 达到上限后记录现有的 missing-final stall，不会留下隐藏的无限等待。

Host 的 model-catalog read path 现在允许 live Team worker Session 读取只读 metadata，但 prompt 和 model mutation 仍由 coordinator 拥有。因此打开 worker transcript 不会再显示虚假的 coordinator 缺失错误。

Team human-question authorization 现在把提问 participant 视为 source identity：worker 或 coordinator 提问时，由 authenticated Team human owner 回答；human-originated action 仍要求准确的 human participant。Worker question 不会再在答案到达等待中的 Agent 前以 `not-pending` 失败。

## Alternatives considered

保留固定的 4 个 worker roster、只依赖 coordinator prompt。这样小任务会浪费 activation，而且 scheduler 仍没有明确的 saturation result。只保留 coordinator 的内存计数也会在 restart 后消失。当前设计从较小 pool 开始，将每个邀请的 worker 写入 Team journal，用 `maxWorkerCount` 限制增长，并通过 coordinator tool 暴露 queue pressure。

## Consequences

任务删除和任务停止仍由 Host 按 revision 管理。mutation 失败或 revision 过期时，对应确认框保留并展示错误；切换 Team 会中止进行中的读取或 mutation。已删除 tombstone 继续持久化，但不会出现在活动任务列表中。Team 级 cancel 会先 fence 掉上一个 Host 留下的仍在运行的 coordinator activation，再重新接管 product-owned run 并发出正常 TeamRun cleanup，因此 Host 重启不会把有效的停止操作变成 actor 缺失或 activation 仍在运行错误。Stop admission 后 client 会轮询，直到无 lease 的 terminal projection 持久化，因此短暂的 `stopping` 或 stale `running` row 不会继续隐藏 delete action。

## Testing

客户端 UI 和 runtime 测试覆盖紧凑渲染、已结算 attempt 的 owner 归属、reviewer 状态、折叠内容、任务停止／删除确认、abort 处理、选中状态同步，以及 body-level confirmation dialog 不会卸载 floating surface。workspace provider 和 TeamRun 测试覆盖所选 root、coordinator 驱动的 worker pool 扩缩容、多个 worker 将 assignment 分发到不同 Session 的流程，以及 output truncation 后的 automatic coordinator continuation。Team Agent Client 测试覆盖只有 exact running lease 仍有效时才执行的 automatic worker continuation。Host API 测试覆盖 worker Session 的只读 model metadata、worker-originated human-question resolution，以及 coordinator-only mutation fence。tool 测试覆盖 coordinator-only pool resize 和 saturation result、workspace 内绝对 task/workflow scope 的转换、root scope 以及 workspace 外路径拒绝。无 key 的 assembled Headless snapshot 固定 coordinator 至少启动两个 task 的 delegation contract。minimal preset snapshot 验证 sandbox backend 与 runtime permission context 已启用。随附 Web composition 测试在真实 actor provider 与 API gateway 完成启动后，通过 authenticated RPC 删除无 lease 任务。构建后的 Web 启动快照和客户端包构建也通过。
