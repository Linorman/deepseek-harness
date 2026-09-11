# P0-04：保存基线、集成现有补丁与阶段放行

主责：集成人。归属：[WP00](wp00-integration.md)，协调 WP01/WP13。与 P0-01/02/03 同时开展；负责共享文件和依赖队列，不包办各自实现。先读[接手状态](current-state.md)与[共享接口](contracts.md)。

## 可复现基线

当前主工作区和三个独立 worktree 都包含未提交代码。先保存每条线的实际文件、相对其轮前基线的 diff 和 hash，保留 staged/unstaged/untracked 区别；与相关 owner 确认进入开发基线的内容。未经核对不执行整树 add/commit、reset/clean 或覆盖复制。

最初 baseline-manifest 只能解释启动时输入，后续轮次有独立基线，不能一律用最初 baseline 算增量。把本机 .tmp 中已确认的测试日志和 patch 转成其他程序员可取得的提交及 artifact；给出安装/构建入口、当前失败和运行环境。临时目录本身不是长期交付。

## 集成顺序

1. 以当前状态和精确 manifest 核对已合入切片，避免重复套用旧 Agent Client、生命周期、Hub 或 Loader 增量。
2. 审查新一轮 P0-01 两包增量，保留主工作区已验证的 Hub/TeamRun/Core；必要共享类型先登记并与消费者同时集成。
3. 审查 P0-02 后续 invariant 与职责组修复；保留已有效的 phase-cursor 错误分类与 final admission 语义。
4. 集成 P0-03 真实 Loader 场景，补足官方 source/artifact 构建输入，重新 replay；环境问题与产品失败分别记录。
5. 每次合并只重跑因该变更失效的聚焦证据；最后以同一共同版本做 P0 整体核验。

功能作者提交新增依赖的 manifest 输入，集成人统一安装更新 lockfile；不复制某个 worktree 的整个 lockfile。Team journal/checkpoint、channel、SDK、SQLite 格式分别登记实际值；不能因分支冲突复用具有不同含义的版本号。

Config catalog 与 Hub fixture 类型问题已修复。后续源码行号、配置或公开类型改变时，仍按 owning generator 重生成并同步双语。最新 unit/build、doc-sync、hygiene 与局部回放结果统一见[接手状态](current-state.md)，每份证据都绑定实际源码与日志；后续增量必须注明它是否仍适用。历史 HMR 时序失败及尚未确定的原因继续保留，后续未复现不等于根因已解决。

## P0 放行表

| Requirement | 最小必须证据 | 交付者 |
|---|---|---|
| AUTH | 当前 principal/proof 来源、Host/SDK 实际写入拒绝、跨 Team/撤销/等待后重校验 | P0-01/02 与已有认证 owner |
| LIFE | completion/failure/cancel 重启、精确资源证明、sink/receipt、missing-final/预算恢复与 no-pulse 推进 | P0-01/02/03 |
| LEASE | 当前实现租约退休、HMR、投递与关闭中保留、释放一次、重启缺版本拒绝 | 对应 runtime/consumer owner；P0-03 组合 |
| VIEW | consult/discussion/workflow/review 的真实 Session 输入重建、flush-before-receipt、两 SDK owner | P0-03 与原 view owner |
| GATE | 适用文件逐文件 100%、snapshot、build/typecheck/lint、文档与 P0 所需 packed consumer | 各作者提供局部证据，集成人聚合 |

每行记录共同版本、命令、环境、执行/跳过数量和可访问 artifact。未执行、失败、环境缺失分别记录，不把通过的单包 coverage 代替整行。P0 不要求提前完成 P1 supervisor，但未知终止状态必须正确 stall。

## 检查与交接

本轮用户要求所有测试临时文件、目录与中间产物都放在项目内。新场景与日志已使用项目 `.tmp`；运行旧套件前还必须检查其共享 helper 和子进程路径。不能仅以 runner 的日志目录在项目内就视为满足要求。调整临时根时保留 Git/AGENTS 隔离与 socket 长度语义，不盲目改全局 TMPDIR。

按[pre-push 工作流](../../skills/dsh-pre-push-checks/SKILL.md)选择精确 diff 对应测试和检查。生成类型/API/config/event 目录时修改 owner 后统一重生成，同步双语对侧；执行 doc-sync 与必要构建。公共 Session/协议变化同步两 SDK 和 runnable examples。

P0 全部通过后给出具名放行记录与下游可 checkout 版本，再按[分派入口](start-here.md)启动 P1 生产开发。提前允许接口讨论、场景设计和环境准备，不允许以占位插件伪装 P1 已集成。

最终交付是共同基线、已集成补丁清单、C0/C5 实际 API/版本、五项证据和仍属于 P1 的缺口。P0 完成只关闭其自身阶段，不等于整个 native multi-agent 提案完成；33 项最终签收仍由 WP14 负责。
