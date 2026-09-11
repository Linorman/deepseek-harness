# 33 项 gap 的主责与关闭证据

本表是[总计划](overview.md)的需求分配参考。G01–G33 对应 2026-09-05 审计，编号供开发交接使用，不应进入产品 diagnostics、prompt 或公共 API。每项只有一个主责；协作方不能用自己的局部成功代替主责的端到端验收。

2026-09-06 最新核对时，G01/G02/G03/G07/G26/G27 为 PARTIAL，其余为 OPEN；Direct v4与生产摘要首片已进入主工作区，普通单任务取消也已合入，workflow内取消继续开发，具体已合入、待集成和证据限制见[接手状态](current-state.md)。没有一项仅因计划或分派而被标为 CLOSED。“已有基础”不构成关闭；执行者在交接记录保存提交号、测试命令和产物，将证据链接更新到可复查结果后，才可改成 CLOSED。

| Gap | 需关闭的工作 | 主责 | 必须交付的关闭证据 |
|---|---|---|---|
| G01 | 未释放资源的重启收尾 | [WP01](wp01-lifecycle.md) | 带活跃 epoch/任务/allocation/human action 的故障窗口，terminal 或精确 stall |
| G02 | 摘要 Consumer | [WP03](wp03-summaries.md) | canonical source、summary 持久化、view 重建和重试 |
| G03 | Direct subset/broadcast | [WP02](wp02-channels.md) | v4 多接收者、独立 receipt、final 两方限制 |
| G04 | Invitation/ack | [WP02](wp02-channels.md) | pending 重启、required/optional deadline、关闭与租约释放 |
| G05 | General placement | [WP04](wp04-scheduling.md) | local/SDK/ACP 的约束选择、无候选和重复 activation 防护 |
| G06 | 结果与延迟/成本排名 | [WP04](wp04-scheduling.md) | durable stats、冻结排名版本、重启后同输入同选择 |
| G07 | 单任务完整取消 | [WP04](wp04-scheduling.md) | pending/review/assigned/running、旧 epoch ack、Team cancel 竞态 |
| G08 | 通用模板与 workflow 角色 | [WP04](wp04-scheduling.md) | 单模型成员、不同角色/路由、多个 reviewer、workflow 角色解析 |
| G09 | Child task 模型与入口 | [WP05](wp05-child-teams.md) | execution union、grant/budget/depth 拒绝、tool/API/SDK |
| G10 | Child saga 与结算 | [WP05](wp05-child-teams.md) | 每个跨日志窗口一 child、一 parent result、charge/cancel/archive |
| G11 | Shared workspace observation | [WP06](wp06-workspace-observation.md) | declared/undeclared/external-window、截断、审计重建 |
| G12 | Supervisor seam | [WP07](wp07-remote-supervision.md) | provider 注册/退休、health/fence、generation 拒绝 |
| G13 | Cross-host recovery | [WP07](wp07-remote-supervision.md) | 两主机可执行、旧 epoch 隔离、新 epoch 恢复或 stall |
| G14 | Sandbox loss settlement | [WP07](wp07-remote-supervision.md) | sandbox 消失、产物保留、allocation/attempt retry 或 stall |
| G15 | Durable human inbox | [WP08](wp08-human-delivery.md) | sink flush 先于 receipt、display cursor、重启分页 |
| G16 | 人工请求重启回答 | [WP08](wp08-human-delivery.md) | approval/question/review 重建、撤销权限、重复回答 |
| G17 | UI 成员管理 | [WP10](wp10-ui-members-channels.md) | invite/activate/remove/interrupt 的真实服务场景 |
| G18 | UI 频道管理 | [WP10](wp10-ui-members-channels.md) | audience/post/close/pending/delivery 的真实服务场景 |
| G19 | UI 任务与 DAG | [WP11](wp11-ui-tasks-review.md) | 创建/编辑/依赖/取消/历史/child 导航 |
| G20 | UI 人工 review/action | [WP11](wp11-ui-tasks-review.md) | accept/rework/approval/question 与正确 owner |
| G21 | UI integration | [WP11](wp11-ui-tasks-review.md) | 明确 target/version、policy、proposal/conflict/verification |
| G22 | UI 分页 | [WP09](wp09-ui-state.md) | 各集合 Load more，有限请求，compacted cursor 和取消 |
| G23 | UI 一致性与 mutation 状态 | [WP09](wp09-ui-state.md) | authoritative selection、冲突保留输入、offline/stale/partial |
| G24 | Legacy 产品与发行移除 | [WP12](wp12-legacy-cutover.md) | 源码、组合、catalog、依赖、tarball absence 与 compat smoke |
| G25 | Session 旧属性退出 | [WP12](wp12-legacy-cutover.md) | compat descriptor、旧 header 拒绝、两 SDK fixture |
| G26 | 逐文件覆盖率 | [WP01](wp01-lifecycle.md) | P0 当前提交 100% 证据；后续功能由各包补齐、WP14 聚合 |
| G27 | 生命周期完整故障矩阵 | [WP01](wp01-lifecycle.md) | JSON/SQLite 的真实进程 kill-point 与资源证明 |
| G28 | 统一跨主机故障矩阵 | [WP13](wp13-system-verification.md) | static/dynamic、duplicate/out-of-order、慢消费、revoke/fence |
| G29 | 真实模型完整协作 | [WP13](wp13-system-verification.md) | coordinator/worker/reviewer、rework、fan-out/fan-in、真实文件 |
| G30 | 浏览器与 GIF | [WP13](wp13-system-verification.md) | WP09/10/11 各自 GIF 和完整场景的同提交证据 |
| G31 | 性能预算 | [WP13](wp13-system-verification.md) | reference runner 三次结果、中位数、RSS、队列与 shutdown |
| G32 | 双 SDK、全仓和发行 | [WP14](wp14-release.md) | 同一候选提交的完整 checks、canonical packs、三平台 consumer |
| G33 | 文档与证据收敛 | [WP14](wp14-release.md) | P0/P1/main 逐项映射、双语同步、符合事实的生命周期迁移 |

## 证据状态

PASS 表示指定提交和环境实际运行成功。FAIL 表示实际运行失败。NOT_RUN 表示没有执行。BLOCKED_ENV 表示缺少具名环境、credential 或 runner；记录解锁责任人。SUPERSEDED 只表示证据被后续提交或场景替换，必须链接新证据。

缺功能和缺证据分开登记：例如有 WebSocket restart 测试但未跑两主机，不得写成“没有远程通信”；有 actor proof 实现但 coverage 不达标，不得写成“没有认证”。

## 初次审计的历史证据

2026-09-05 初次审计时，两批聚焦 Vitest 通过 189/189 和 156/156，存在测试重叠。closure-driver 包内 26/26 通过，选定范围覆盖率检查失败；当时主文件分支为 73.70%。assembled channel-view snapshot 1/1 通过。后续开发已有新的通过和覆盖率记录，不能把这些旧数字作为当前缺口。它们是历史工作区快照证据，不是冻结提交上的 P0 或发行放行；当前适用证据以[接手状态](current-state.md)及最终交接为准。
