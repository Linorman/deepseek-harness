# 世界调控者 MVP 实施证据

源码基线为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。以下为当前工作区未提交实现的证据，不以基线 SHA 冒充实现提交。范围与验收状态由 [checklist](checklist.md) 和 [开发计划](development-plan.md) 负责。保持 checklist 的原条目、内容和粒度，仅在完整满足原条目后修改勾选状态；本文中的局部证据不等于原验收项完成。

## W0-a：显式 readiness 与执行准入

已实现：创建命令严格要求 ready/preparing；preparing 仅在暂停、无窗口/在途决策且无未停止 writer 时结算为 ready 或不可逆 abandoned。认知实体完成 ready 需要规范 binding。Native writer、决策、调度、任务执行及 Team 直接激活入口执行准入。公司产品先准备身份与通道再标记 ready。恢复保留退休能力。两后端使用 journal stream 47，通用 SQLite 表结构及 Session format 不变。

未实现：持久 world maintenance owner、world/request 与 world/resolve、director 消费证据、入职和取消线性化、专用 coldReplace 故障测试、W1–W6。可信管理创建仍允许显式 ready，用于已有低层 bootstrap；模型操作不包含管理创建。

所有命令在项目根目录执行，环境变量 `TMPDIR="$PWD/.local/world-director-mvp/tmp"` 将系统临时文件保留在项目内；测试自有数据保存在 `.tmp/`，构建使用项目内的 `lib/`、`dist/` 等既有目录。

## 已通过的命令

```sh
pnpm exec vitest run packages/simulation/simulation-product/tests/company-task-policies.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-local/tests/scheduler.spec.ts packages/simulation/simulation-local/tests/dispatch.spec.ts --maxWorkers=2
```

5 files、45 tests 通过；JSON/SQLite，真实 Native owner，外部模型使用脚本提供方。日志：[readiness-core.log](../../../.local/world-director-mvp/readiness-core.log)。

```sh
pnpm exec vitest run packages/simulation/simulation-team/tests/participants.spec.ts
```

30 tests 通过，包含两后端 direct controller 与 checkpoint 恢复后 preparing 拒绝。日志：[readiness-team.log](../../../.local/world-director-mvp/readiness-team.log)。

```sh
CLOCKY_SNAPSHOT=refresh CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/product-administration.snapshot.ts --update
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/product-administration.snapshot.ts examples/simulation-company/tests/procurement.snapshot.ts -t 'crash=ready|happy crash=undefined' --maxWorkers=1
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/procurement.snapshot.ts -t "'happy' crash=undefined" --maxWorkers=1
```

真实 Loader/产品创建 17 tests 通过；新增 ready 边界使用 SIGKILL 中断并恢复。新增两份快照随后 replay 2 tests 通过；第一条 replay filter 未匹配采购名中的引号，因此采购另用最后一条命令验证，JSON/SQLite 两项均通过。无真实 API 调用。日志：[创建](../../../.local/world-director-mvp/readiness-snapshot.log)、[ready replay](../../../.local/world-director-mvp/readiness-snapshot-replay-focused.log)、[采购](../../../.local/world-director-mvp/readiness-procurement.log)。

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/loader.spec.ts --maxWorkers=1 --update
pnpm exec tsc -b tsconfig.host.json
pnpm run build
pnpm run doc-sync
```

Loader 4 tests 通过，更新两处包含 readiness 的实体投影快照；Host 编译通过；完整构建通过；doc-sync 为 29 passed、0 failed。日志：[Loader](../../../.local/world-director-mvp/readiness-loader.log)、[TypeScript](../../../.local/world-director-mvp/readiness-tsc-final.log)、[build](../../../.local/world-director-mvp/readiness-build.log)、[doc-sync](../../../.local/world-director-mvp/readiness-doc-sync.log)。最终 schema 去重后的构建及产物验证见末节。

```sh
pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation/src/entity.ts packages/simulation/simulation/src/entity-types.ts packages/simulation/simulation-local/src packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-team/src/index.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-product/src/company-preparation.ts examples/simulation-company/tests/product-administration-scenario.ts examples/simulation-company/tests/product-administration.snapshot.ts
```

修改代码 lint 通过。日志：[readiness-lint-final.log](../../../.local/world-director-mvp/readiness-lint-final.log)。

## 回归中的修复及待完成检查

首次 focused tests 发现实体精确投影需增加 readiness，已修正。曾将通用 entity-active 判断同时要求 ready，导致公司 bootstrap 初始化资源失败；已移除该不合适的限制，资源准备继续独立于执行准入，隔离 company-task-policies 与相关 gate 测试通过。

扩大回归命令：

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests packages/simulation/simulation-team/tests packages/simulation/simulation-product/tests --maxWorkers=2
```

完整运行结果为 98 files passed、7 failed；1,634 tests passed、15 failed。失败包含两项 Loader 预期投影变更（已按上方命令修复）、12 项产品测试的 5 秒超时及一项 restore-bound 的 30 秒超时。失败全部在下方隔离重跑或修复后重跑中通过；保留原始失败日志，不将这次完整运行改写为全绿。日志：[readiness-regression-bounded.log](../../../.local/world-director-mvp/readiness-regression-bounded.log)。

超时隔离命令：

```sh
pnpm exec vitest run packages/simulation/simulation-product/tests/task-executor.spec.ts packages/simulation/simulation-product/tests/company-driver.spec.ts packages/simulation/simulation-product/tests/company-tasks.spec.ts packages/simulation/simulation-product/tests/maintenance.spec.ts packages/simulation/simulation-product/tests/topology.spec.ts --maxWorkers=1 -t 'automatically assigns|retries the original identities after|resumes an exact task window|handles current inputs and equal-time|executes a real company task and applied inventory|collects a complete original checkpoint|retains one attributed input|retains a third reviewer'
```

5 files、18 tests passed（122 skipped），覆盖完整回归中的全部产品超时失败，保持原始测试 timeout。日志：[readiness-timeouts-isolated.log](../../../.local/world-director-mvp/readiness-timeouts-isolated.log)。


```sh
pnpm exec vitest run packages/simulation/simulation-team/tests/recovery.spec.ts --maxWorkers=1 -t 'restore-bound'
pnpm exec vitest run packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-product/tests/company-preparation.spec.ts packages/simulation/simulation-local/tests/loader.spec.ts --maxWorkers=1
```

restore-bound 在 JSON/SQLite 上两项通过（102 skipped），保持原 30 秒 timeout；最终 focused 4 files、34 tests 通过，包含修复后的 Loader 投影以及 schema 去重后的 readiness。扩大回归超时后产生的一份跨用例迟到输出快照已删除，没有替换既有恢复快照。日志：[restore-bound](../../../.local/world-director-mvp/readiness-restore-bound.log)、[最终 focused](../../../.local/world-director-mvp/readiness-final-focused.log)。


## 最终构建与产物验证

```sh
pnpm run build
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run packages/simulation/simulation-local/tests/loader.spec.ts --maxWorkers=1
pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation/src/entity.ts packages/simulation/simulation-local/src/writers.ts packages/simulation/simulation-local/tests/loader.spec.ts
```

最终完整构建通过；分发产物 Loader 4 tests passed，覆盖两后端新进程重建与独占 owner；最后修改文件 lint 通过。日志：[最终 build](../../../.local/world-director-mvp/readiness-build-final.log)、[built Loader](../../../.local/world-director-mvp/readiness-built-loader.log)、[最终 lint](../../../.local/world-director-mvp/readiness-lint-last.log)。`git diff --check` 与计划目录 Markdown 本地链接、尾随空白、文件结尾检查通过。W0-a 验证收口，W0 总体验收仍未完成。

## 持久维护准入与 Team 停稳（W0 局部实现，不改变原验收项）

工作区新增 Native `beginMaintenance` / `quiesceMaintenance` / `finishMaintenance` 与 Team `quiesceForMaintenance`。原 owner、draining/quiescent/completed、转换顺序保存在同一 Native journal；当前 stream version 为 48。新 writer/窗口/决策/调度/任务/发布准入被关闭；已有决策可提交，在途发布仍能保存回复。只有暂停、无窗口/决策、writer 全部释放且无在途发布时才能确认停稳。Team 方法复用 checkpoint collector 的真实排空、退休和引用验证，不发布新 checkpoint，也不自动恢复调度。关闭会等待已接受的退休，未确认停止继续保留责任与容量。

尚未接入 world/request、world/resolve、HireIntent、产品 case owner 或入职；上述接口不能当成完整 W0 或 W3 验收。checklist 原条目内容、数量和粒度保持不变；没有将这里的局部实现新增为 checklist 项目。

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-local/tests/management.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/windows.spec.ts packages/simulation/simulation-local/tests/decision-replay.spec.ts packages/simulation/simulation-local/tests/dispatch.spec.ts packages/simulation/simulation-local/tests/scheduler.spec.ts packages/simulation/simulation-local/tests/task-execution.spec.ts packages/simulation/simulation-local/tests/outbox.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-product/tests/company-preparation.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-local/tests/maintenance.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-team/tests/participants.spec.ts --maxWorkers=1
```

相关回归 13 files / 204 tests passed；随后加入的旧窗口结算、新窗口拒绝测试包含在最终 Native 13 tests passed 中，关闭等待真实退休的补充测试包含在最终 Team 36 tests passed 中。日志：[相关回归](../../../.local/world-director-mvp/maintenance-regression.log)、[Native](../../../.local/world-director-mvp/maintenance-native-final.log)、[Team](../../../.local/world-director-mvp/maintenance-team-final.log)。

```sh
CLOCKY_SNAPSHOT=refresh CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/maintenance.snapshot.ts --update
pnpm run build
CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/maintenance.snapshot.ts
```

源码与分发产物各 8 snapshot tests passed，JSON/SQLite 都覆盖正常完成及 draining/quiescent/completed 三边界 SIGKILL。真实 Loader、Native、Team、controller、Session 存储参与，模型调用为零；原 owner、identity、停稳与完成重试保持。完整构建通过。日志：[源码快照](../../../.local/world-director-mvp/maintenance-snapshot.log)、[构建](../../../.local/world-director-mvp/maintenance-build.log)、[分发产物](../../../.local/world-director-mvp/maintenance-built-snapshot.log)。

```sh
pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'publication|proof|outbox|transport' --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'exact current accepted intent|publishes through direct v4|publishes a dependent intent' --maxWorkers=1
```

通信证明回归分别 46 与 3 tests passed，覆盖正文、目标、fingerprint、原 identity、proof 生命周期、到期与依赖的已有校验。日志：[proof](../../../.local/world-director-mvp/maintenance-communication-proof.log)、[精确 intent](../../../.local/world-director-mvp/maintenance-communication-exact.log)。

Host `tsc -b tsconfig.host.json`、修改代码的 `scripts/run-oxlint.ts` 与 `git diff --check` 通过；日志：[TypeScript](../../../.local/world-director-mvp/maintenance-owner-tsc.log)、[lint](../../../.local/world-director-mvp/maintenance-lint-last.log)、[补充测试 lint](../../../.local/world-director-mvp/maintenance-test-lint.log)。首次 doc-sync 发现派生的图、Cordis API 和 Config 目录过期，分别运行 `gen-doc-graphs`、`gen-cordis-catalog`、`gen-config-catalog`，同步中文来源行号及 pairing 后重验。最终 `pnpm run doc-sync` 为 29 passed / 0 failed，见[门禁日志](../../../.local/world-director-mvp/maintenance-doc-sync-verified.log)。

## W0 请求协议、结果/取消与冷替换收口（2026-10-09）

本节覆盖当前未提交工作区，提交基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。Native 负责请求展开、原私有通知、精确持久消费授权、完整计划、显式 read-set、结构化结果与原取消命令；Team/Session 保持各自所有权。当前 journal stream 为 50，JSON/SQLite 明确拒绝 47、48、49 等旧格式，SQLite 表结构与 Session format 不变。

`cancelWorldCase()` 是可信 Native 管理入口，不暴露给模型工具。当前实现只处理尚未进行外部人员准备的案件：取消与计划结算在同一 run 队列排序，取消未 accepted 的规划和过期通知 wake，保存唯一业务结果；已经拒绝的案件返回 `already-resolved` 并保留原原因。拒绝/取消结果与仅含结果索引的请求者 wake 在同一 append 保存。accepted 计划及私有 rationale 保留，后续结算不覆盖取消结果。岗位预留、入职提交、外部准备结果未知时的 cancel-requested/责任清点尚未接入；W0 首项的完整协议验收以及业务入职去重项保持未勾选，W3/W4/W5/W6 不据此宣称完成。

冷替换专项发现并修复真实缺陷：没有 persisted recovery plan 的本地 epoch 必须在 `lifecycle.recover/revoke` 前拒绝，否则错误路径留下 unresolved owner，阻断合法 resume。准备中人物在冷恢复后仍由 Native/Team readiness gate 拒绝 fresh/resume；无历史 activation 的 coldReplace 由 `TEAM_ACTIVATION_NOT_FOUND` 提前拒绝。后者属于不存在历史的前置拒绝，不冒充 coldReplace 内部 readiness 检查。真实 ready 本地 epoch 的冷替换 unsupported 拒绝后没有新 owner/writer，普通 persisted resume 仍成功。

全部命令在项目内执行，`TMPDIR="$PWD/.local/world-director-mvp/tmp"`；日志、临时后端和编译产物留在项目内。没有发布、提交或使用真实付费模型。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-scenario/tests --maxWorkers=1` | 初始现有协议/编译器 4 files、104 tests passed | [world-baseline.log](../../../.local/world-director-mvp/world-baseline.log) |
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-local/tests/scheduler.spec.ts packages/simulation/simulation-local/tests/dispatch.spec.ts packages/simulation/simulation-local/tests/task-execution.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-scenario/tests --maxWorkers=1` | 最终 11 files、215 tests passed；两后端严格 parser、展开计额、伪造权限/未消费/旧 epoch 拒绝、窗口取消、结果/wake 原子性、append 失败、checkpoint 恢复、旧格式拒绝及场景编译 | [world-results-regression-final.log](../../../.local/world-director-mvp/world-results-regression-final.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/participants.spec.ts packages/team/team-activation-controller/tests/recovery-admission.spec.ts packages/team/team-activation-controller/tests/edges.spec.ts packages/team/team-activation-controller/tests/closure-recovery.spec.ts` | 4 files、162 tests passed；修复不支持冷替换路径的生命周期泄漏，并验证既有 recovery/fence 流程 | [cold-replace.log](../../../.local/world-director-mvp/cold-replace.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/participants.spec.ts` | 最后 matcher 调整后 38 tests passed；preparing 的真实直接启动/恢复拒绝及 ready 后 resume 正例 | [cold-replace-participants.log](../../../.local/world-director-mvp/cold-replace-participants.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'publication\|proof\|outbox\|transport\|exact current accepted intent\|publishes through direct v4\|publishes a dependent intent' --maxWorkers=1` | 49 passed、340 skipped；普通通信精确 proof、到期和依赖检查保持 | [world-results-proof.log](../../../.local/world-director-mvp/world-results-proof.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-protocol.snapshot.ts --maxWorkers=1` | 源码 14 tests passed；真实 Loader/Agent/三工具/私有 Channel；apply/reject accepted 后及取消/拒绝结果保存后 SIGKILL，再新进程恢复，原计划/结果/命令不变、模型调用零、保持暂停 | [world-results-snapshot.log](../../../.local/world-director-mvp/world-results-snapshot.log) |
| `pnpm run build`；`CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-protocol.snapshot.ts --maxWorkers=1` | 完整构建通过；相同 Loader 世界协议的分发产物 14 tests passed | [build](../../../.local/world-director-mvp/world-results-build.log)、[built snapshot](../../../.local/world-director-mvp/world-results-built-snapshot.log) |

首次结果回归为 211 passed、2 failed；失败是取消已结算原通知 wake 后，测试仍预期进入上下文检查。调整测试在不复用已取消 wake 的新决策中验证闭案拒绝，同时显式断言旧 wake 已取消，最终 215 tests 全部通过。初次 lint 发现行长、生产非空断言及测试 void shorthand，均已修复；保留 [初次回归](../../../.local/world-director-mvp/world-results-regression.log) 和 [初次 lint](../../../.local/world-director-mvp/world-results-lint.log)，不把首次运行改写为通过。

本轮勾选原 W0 第 3–8 项：展开、权限、preparing 准入、通信证明、提交不等待维护及格式落点；原 W1 第 1、2、8 项：双场景纯预检、严格输入拒绝、可移植定义往返。75 个验收项的正文、顺序和粒度完全保持；其余项等待完整实现。纯编译器能在浏览器中打包求值且无 Node/Host 服务依赖，JSON/SQLite 创建与产品 RPC 接入仍待实施，不能将纯编译成功视作 W1 总体验收。


## W1 通用暂停 bootstrap 与实际 Team 限额（2026-10-09）

当前工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。`prepareSimulationWorld()` 从事先接受并持久保留的 `ResolvedWorldScenario` 准备组织、岗位与全部初始人物，复用真实 Native/Team reservation，先完成全部 binding/私有 Channel 再标记 ready；只保存初始事项/wake 和完整 checkpoint，不激活、不推理、不启动调度。完整解析结果及 checkpoint 指纹进入 Native root owner 身份，异 payload 或已推进历史拒绝。原采购准备函数保持独立。

TeamRootCreateInput 增加可选的严格完整 `limits`，与纯场景包复用同一 browser-safe parser。TeamHub 逐字段拒绝高于 Host 上限的值，实际冻结接受值；原 Simulation genesis 重试比较原限额，不依当前 Host 默认值重新生成。Native root reservation 对此新输入使用 stream 51，拒绝 stream 50 及更早格式；Team journal 的 limits 仍在既有 rules 中，SQLite 表结构及 Session format 不变。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation-product/tests/world-preparation.spec.ts` | 194 tests passed；双场景/两后端，41 个持久准备边界前后共 164 例，readiness/checkpoint 边界，原身份/定义、真实历史推进拒绝，reopen/restore，全程暂停且 Session 未物化 | [world-preparation-tests.log](../../../.local/world-director-mvp/world-preparation-tests.log) |
| `pnpm exec vitest run packages/team/team-hub/tests/root-creation-authority.spec.ts packages/simulation/simulation-scenario/tests --maxWorkers=1` | 3 files、63 tests passed；严格限额、Host ceiling、原 genesis/重启，以及纯编译器和完整 browser bundle 运行 | [world-team-limits-focused.log](../../../.local/world-director-mvp/world-team-limits-focused.log) |
| `pnpm exec vitest run packages/team/team-hub/tests/root-creation-authority.spec.ts packages/core/team/tests/schema.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-team/tests/bootstrap.spec.ts --maxWorkers=1` | 实际命中 3 files、39 tests passed；最后一个 filter 对应文件不存在，不能作为额外 bootstrap 测试证据；真实限额拒绝发生在 policy/append 前，限额减少真实约束成员创建，Host 上限变化不覆盖原 root，Native 拒绝旧版本 | [world-team-limits-owner.log](../../../.local/world-director-mvp/world-team-limits-owner.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-preparation.snapshot.ts --maxWorkers=1` | 16 tests passed；真实 Loader 两场景/两后端暂停准备；Participant reservation/创建、Channel reservation/创建、ready 和完整 checkpoint 后 SIGKILL，并由新进程复用原身份继续；模型调用与 Session 物化均为零 | [world-preparation-snapshot-final.log](../../../.local/world-director-mvp/world-preparation-snapshot-final.log) |
| `pnpm exec tsc -b tsconfig.host.json` | 当前 Host 编译通过；含新 helper、场景/Team parser 及真实进程 fixture | [world-preparation-tsc-final.log](../../../.local/world-director-mvp/world-preparation-tsc-final.log) |

首次 Loader 16 例因 examples 未声明其新增 `zod` 依赖而失败，见 [world-preparation-snapshot.log](../../../.local/world-director-mvp/world-preparation-snapshot.log)。已在 resolver manifest 明确声明、安装现有版本，并重跑全文件通过。首次 Host 编译发现测试 `publish(manifest)` 的泛型 predicate 被推断为零参数；改为精确匹配原 manifest identity，未用 any/cast 隐藏错误。该发布前后专项 4 tests passed，见 [world-preparation-tsc.log](../../../.local/world-director-mvp/world-preparation-tsc.log)。所有临时后端、日志、fixture 输入和编译产物仍在项目目录内；安装不新增工具或远程模型。

本轮只新增勾选原 W1 第 5 项，全部初始角色的 trusted bootstrap/canonical binding/readiness 有完整证据。W1 的产品 original command、真实创建 RPC、preview 世代重验和命令恢复尚未接入，相关条目保持未勾选；此底层 helper 与测试内原请求文件不能冒充产品命令日志。当前 75 项正文、顺序和粒度保持不变，共 10 项已勾选。W0/W1 总体验收与 W2–W6 仍未完成。


## W1 原产品命令、严格预检/创建和已认证 fetch（2026-10-09）

当前工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。行政日志升级为 3，明确拒绝旧版本；同一 command store/fold 保存 company 与 World 原创建索引，Native 继续唯一拥有世界事实。World 原命令在身份 IO 前保存完整严格解析结果、预览 hash/世代、实际 provider/spec、原 owner/checkpoint 与认证 principal。原命令重复调用及 HTTP/进程响应丢失保持同一分配，异 payload/异 principal 拒绝；移除当前 catalog 后仍可读取并返回原终态。

`getCreationLimits()` 无 IO/分配地返回实际 Host Team 上限。World 预检在静态引用检查后仅查询已选 model/preset/runtime metadata，冻结有效限额，撤销及不可用不冒充 ready。严格公开 DTO 显示初始角色/模型/岗位占用/授权/配额及不含薪酬、委员会审批的范围；私有完整 resolved 不经 fetch 返回。公开导出包含选定 runId 与原可移植 definition，客户端核对选择归属。`simulation.world.preflight/create/prepare/export` 使用真实认证和已有 fetch carrier。创建返回原 receipt，后台只准备暂停世界，不激活或推理；当前未开放 World productive start/driver/case 执行。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation-product/tests/world-preflight.spec.ts packages/core/team/tests/runtime.spec.ts --maxWorkers=1` | 55 tests passed；真实 metadata/Host limits，零存储写入/原命令/新增身份/Session/model permits，坏字段/引用及 unavailable/撤销；Core runtime 更新后回归 | [world-preflight-tests-final.log](../../../.local/world-director-mvp/world-preflight-tests-final.log) |
| `pnpm exec vitest run packages/simulation/simulation-product/tests/world-schema.spec.ts` | 88 tests passed；两场景完整 strict 私有创建、重新封 hash 的语义篡改、所有对象 unknown/missing fields，以及公开摘要/export parser 与隐私投影 | [world-preview-tests.log](../../../.local/world-director-mvp/world-preview-tests.log) |
| `pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/administration.spec.ts packages/simulation/simulation-product/tests/creation-book.spec.ts packages/simulation/simulation-product/tests/creation-store.spec.ts --maxWorkers=1` | 4 files、52 tests passed；两后端/双场景实际 product 原创建，重复/异 payload/跨 principal/旧预览拒绝，失败后原分配准备，catalog 移除后原件读取，原 company 与 journal 回归 | [world-creation-tests-final.log](../../../.local/world-director-mvp/world-creation-tests-final.log) |
| `pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/world-preflight.spec.ts scripts/client-bundle-purity.spec.ts --maxWorkers=1` | 公共摘要/export wrapper 后 3 files、36 tests passed；准入、无副作用及 exact pure-entry 边界 | [world-fetch-source-tests.log](../../../.local/world-director-mvp/world-fetch-source-tests.log) |
| `pnpm exec vitest run packages/host/apiproxy/tests/world-creation.spec.ts packages/host/apiproxy/tests/simulation-preflight.spec.ts packages/host/apiproxy/tests/fetch-carrier.spec.ts --maxWorkers=1` | 3 files、68 tests passed；认证/撤权、实际 fetch 原命令和暂停 Native/Team 准备、关联 export 与查询，模型调用零 | [world-fetch-tests-final.log](../../../.local/world-director-mvp/world-fetch-tests-final.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-product.snapshot.ts --maxWorkers=1` | 源码 60 tests passed；真实 Loader、local principal lease、product 原日志/fetch、两场景/两后端；三个初始人物的 reservation/创建/readiness、两个私有 Channel 的 reservation/创建均在前后 SIGKILL，另 accepted/terminal 中断；新进程复用原 commandId、定义和已分配全部身份，保持暂停/零模型/零 Session 物化 | [world-product-snapshot-final.log](../../../.local/world-director-mvp/world-product-snapshot-final.log) |
| `pnpm run build`；`CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-product.snapshot.ts --maxWorkers=1` | 完整构建通过；同一真实 original-product 路径分发产物 60 tests passed | [world-creation-build-final.log](../../../.local/world-director-mvp/world-creation-build-final.log)、[world-product-built-snapshot.log](../../../.local/world-director-mvp/world-product-built-snapshot.log) |
| `pnpm exec vitest run packages/client/ui-simulation/tests/persistent-requests.client.spec.tsx packages/client/ui-simulation/tests/command-record-edges.client.spec.tsx --maxWorkers=1` | 19 tests passed；现有原命令阅读组件保持行为，新 command family 中英 labels 同步；没有新增创作页面/业务动作 | [world-command-label-tests.log](../../../.local/world-director-mvp/world-command-label-tests.log) |

首次部署预检发现 Cordis traced proxy 不能用对象引用相等判断 owner 变化，改为核对实际不可变 limits 值；最终 55 项通过。首次 Host 回归两项旧测试携带非法/缺失 expectedModel，分别从 preflight draft 移除、给 create 补完整确认 route，未放宽 parser。首次完整 build 发现新 kind 缺翻译及两个 fake Client API 漏新方法，按当前 locale/契约补齐，后续完整 build 通过。保留 [首次 Host](../../../.local/world-director-mvp/world-fetch-tests.log)、[首次 build](../../../.local/world-director-mvp/world-creation-build.log)，不把首轮改写为通过。

公开 World schema 真实 browser ESM bundle 的 99 个输入无 Node/private creation/preparation/preflight/directory 模块和 external imports，并在只提供标准 Web API 的 VM 中运行 result/export parser通过，见 [browser log](../../../.local/world-director-mvp/world-preview-browser.log)、[runtime](../../../.local/world-director-mvp/world-preview-browser-runtime.log)、[metafile](../../../.local/world-director-mvp/world-preview-browser-meta.json)。项目现有 DESIGN/UX contract 已读取并保持原视觉系统；只扩展既有原命令 label，premium static audit 为 errors/warnings/violations 全零，见 [audit](../../../.local/world-director-mvp/world-label-premium-audit.json)。这不代表 W5 新创作/案件页面或完整 UI 验收通过。

本轮按完整证据勾选原 W1 第 3、4、6、7 项；W1 共 8 项已勾选，总计原 75 项中 14 项勾选，所有正文/顺序/粒度不变。文档/catalog 门禁的新增源链接与派生物仍在收口，工作包状态保持进行中；没有宣布 MVP 完成，也没有以暂停创建代替 W2–W6。


## W1 门禁收口

`pnpm run doc-sync` 最终为 29 passed、0 failed、0 skipped，见 [world-creation-doc-sync-final.log](../../../.local/world-director-mvp/world-creation-doc-sync-final.log)。首次运行发现 5 个新增 service signature 类型缺文档归属，以及图、Config/Cordis catalog 和对应 source/link inventory 过期；已添加真实 subsystem owner，运行 `gen-config-catalog`、`gen-doc-graphs`、`gen-cordis-catalog` 更新派生物，核对中文 technical graph/table/link 对侧并重新记录 pairing。未改 archived notes，也未绕过门禁。初次结果保留 [world-creation-doc-sync.log](../../../.local/world-director-mvp/world-creation-doc-sync.log)。

最终源码/Host/fetch 修改 lint 通过，见 [world-fetch-lint-final.log](../../../.local/world-director-mvp/world-fetch-lint-final.log)；产品进程 fixture lint 通过，见 [world-product-lint-verified.log](../../../.local/world-director-mvp/world-product-lint-verified.log)；新增中英 command labels、fake API 契约及 catalog owner map lint 通过，见 [world-command-contract-lint.log](../../../.local/world-director-mvp/world-command-contract-lint.log)。`git diff --check` 与 75 个 original checklist item 的正文/顺序比较通过；当前已勾选 14 项，W1 8 项全部有证据，包状态为待验收。源码与分发原产品 SIGKILL 矩阵均为 60 tests passed；所有新增输入、临时后端、日志、浏览器 bundle 和编译产物都保存在项目内。

实现仍为当前工作区未提交内容，不能用基线 SHA 冒充实现提交；统一提交和最终 MVP 验收尚未进行。接下来继续 W2 的完整案件编排和 W3 的入职预留/提交/结果未知取消，W4–W6 仍保持完整原范围，不能把本轮暂停创建当作最终成果。


## W3 Native 入职预留、原子提交与执行失效（2026-10-09，验证中）

当前实现仍为工作区未提交内容，基线 SHA 不代表本节实现提交。Native journal stream 52 在同一日志追加严格 hire reservation/preparing/committed 与 world/plan-stale 记录，拒绝 stream 51 及更早记录；SQLite 表结构和 Session format 不变。预留只接受最新 accepted apply 计划，保存完整原 member route/维护身份以及全部 Entity/Participant/Session/Relation/两个私有 Channel 身份，在 IO 前占用岗位。准备要求原 quiescent owner，先持久 preparing Entity、participantReservation 和 channelReservations；Team active membership 不能替代 readiness。任职、ready、业务结果、新人首次 wake、请求者安全 wake 及预留结算在一次 append 中提交。

准备前取消保留 abandoned 原身份并释放岗位，不创建人物；通用管理创建、Channel key 与 assignment ID 都不得复用这些历史身份。准备中取消保存 cancel-requested，不生成终态结果、不释放岗位、不完成维护；已提交的入职收到取消返回 already-committed。未知外部准备 IO 的精确清理尚未实现，不能把保留责任描述为取消已完成。关键执行 read-set 变化追加 stale 阶段/原因/序号，保留原 proposal/hash/reads；准备后失效仍保留全部责任。有界后继计划显式 supersedes 原件，第 4 次在原 3 次限额下于模型调用前拒绝；已预留事项的后继计划执行与外部对账仍待编排。

| 实际命令 | 已观测结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts --maxWorkers=1` | 首轮 Native hire 整文件 42 tests passed；真实三工具、两后端身份准备/入职、取消、append 故障和响应丢失恢复 | [world-hire-team-final.log](../../../.local/world-director-mvp/world-hire-team-final.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'execution-stale\|preparing responsibility\|invalidation append\|unrelated later wake\|explicit read sets' --maxWorkers=1` | 8 passed、40 skipped；执行关键读项变化、原失效原因、失败 append、reopen 和无关 revision 正例 | [world-hire-stale-tests.log](../../../.local/world-director-mvp/world-hire-stale-tests.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'explicit model replanning' --maxWorkers=1` | 2 passed、48 skipped；两后端真实 Agent 后继计划、原 case/Persona/前驱链与模型前的预算拒绝 | [world-hire-replan-tests.log](../../../.local/world-director-mvp/world-hire-replan-tests.log) |
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts --maxWorkers=1` | 最后 strict parser 与真实 Team 两文件 101 tests passed；包含取消后的 Entity/Channel/Relation 原身份复用拒绝 | [world-hire-inputs-final.log](../../../.local/world-director-mvp/world-hire-inputs-final.log) |
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-local/tests/scheduler.spec.ts --maxWorkers=1` | 当时 7 files、152 tests passed；shared lifecycle/旧格式/调度回归。随后新增 strict parser 和后继计划测试分别由上方最终 101 项覆盖 | [world-hire-regression-current.log](../../../.local/world-director-mvp/world-hire-regression-current.log) |
| `pnpm exec tsc -b tsconfig.host.json`；changed-source `run-oxlint.ts` | 当前源码与测试类型/lint 通过；包括新增 strict parser、Native folds、产品未启动历史校验 | [tsc](../../../.local/world-director-mvp/world-hire-tsc-verified.log)、[lint](../../../.local/world-director-mvp/world-hire-lint-final.log) |

初次更宽回归为 95 passed、2 failed，两项原 apply/reject 测试超过原 5 秒时限；未增加 timeout，整文件单 worker 复跑 42 项通过。初次故障测试另有三项 SQLite disk IO setup 失败，磁盘剩余容量充足，原命令复跑 11 项全部通过；这些首次失败日志保留为 [world-hire-regression.log](../../../.local/world-director-mvp/world-hire-regression.log)、[world-hire-fault-tests.log](../../../.local/world-director-mvp/world-hire-fault-tests.log)，后者复跑见 [world-hire-fault-tests-final.log](../../../.local/world-director-mvp/world-hire-fault-tests-final.log)。初次类型/lint 的可空 channelReservations、行长与缩进问题已修复，未放宽 parser 或门禁。

真实 Loader 入职 SIGKILL 矩阵、完整分发构建和文档门禁正在收口，其证据尚不记作通过；W3/W2 尚未完整验收，原 checklist 保持 14/75 勾选，未新增或改写验收项。全部日志、临时后端、编译产物和 fixture 输入保存在本项目中，没有发布、提交或真实付费模型调用。


Native 类型边界收口：首次完整 build 在 Client 编译失败，新 `world-types` 的 schema inference 导入了 Host Session 声明，造成 `sessions` 与 Client 服务声明冲突。现将 canonical binding、maintenance identity 与 hire records 放入纯类型叶文件，schema 用 `satisfies z.ZodType` 验证形状，channel retry ID 由既有纯 identities owner 定义。现有公共导出保持同一类型归属，不引入格式兼容分支；Host/Client `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json` 最终通过，见 [world-hire-types-boundary-final.log](../../../.local/world-director-mvp/world-hire-types-boundary-final.log)，相应 lint 通过见 [world-hire-types-lint.log](../../../.local/world-director-mvp/world-hire-types-lint.log)。保留 [首次完整 build](../../../.local/world-director-mvp/world-hire-build.log) 和 [首轮边界编译](../../../.local/world-director-mvp/world-hire-client-boundary.log)；首轮边界编译的三个旧 import 未使用错误也已修复，不把它改写成通过。

本次 `doc-sync` 已通过 29 passed、0 failed、0 skipped，见 [world-hire-doc-sync.log](../../../.local/world-director-mvp/world-hire-doc-sync.log)。英文 generator 输出和中文源引用/表格已核对更新并记录 pairing；后续新增真实进程 fixture 和纯类型叶文件的最终门禁仍待统一验证。


纯类型拆分后完整 `pnpm run build` 已通过，见 [world-hire-build-final.log](../../../.local/world-director-mvp/world-hire-build-final.log)。对应 strict parser/maintenance/writers/原 World bootstrap 回归 4 files、271 tests passed，见 [world-hire-types-regression.log](../../../.local/world-director-mvp/world-hire-types-regression.log)。新增两后端岗位已满、Entity、历史 Participant、Channel 限额拒绝 8 passed、50 skipped，见 [world-hire-capacity-tests.log](../../../.local/world-director-mvp/world-hire-capacity-tests.log)；原 accepted 计划不被容量拒绝改写，未保留身份分配或执行准备。

进一步堵住未知准备结果的提前释放：未结算 reservation 下，通用 `entity/readiness` 不得 abandoned，通用 phase/profile 不得终止或改写 preparing 人物；Native 投影验证其 active/preparing 与原 Persona。准备中取消、真实准备提交、append 故障和全部容量用例共 16 passed、42 skipped，见 [world-hire-cleanup-gate-tests.log](../../../.local/world-director-mvp/world-hire-cleanup-gate-tests.log)。最后 Host 类型/lint 通过，见 [world-hire-gate-tsc.log](../../../.local/world-director-mvp/world-hire-gate-tsc.log)、[world-hire-gate-lint.log](../../../.local/world-director-mvp/world-hire-gate-lint.log)。这仍不等同于外部清理已完成；该项保持未勾选。最后这处 Native fold 变化的分发 bundle 需刷新后再做 lib probe。


真实 Loader 的 `world-hire.snapshot.ts` 最小闭环已在源码和分发产物各通过 2 tests（JSON/SQLite），见 [world-hire-happy.log](../../../.local/world-director-mvp/world-hire-happy.log)、[world-hire-happy-built.log](../../../.local/world-director-mvp/world-hire-happy-built.log)。流程复用真实成员/director 三工具及私有 Channel，共 6 次脚本模型调用；后续 reserve/quiesce/prepare/真实 Participant 与两条 Channel/commit/finish 不调用生成模型。新人的 Session 尚未物化，全部原 Persona/UUID、单份任职/结果/两个 wake 和精确重试有断言；最后保持暂停。当前尚未执行新增 SIGKILL 恢复矩阵，不能以 happy path 代替 F3–F5 故障验收。

最终 generic cleanup gate 修改后，`pnpm exec tsdown --filter @clocky/clocky-simulation-local --env.CLOCKY_BUILD_FACE host` 刷新实际 Native 分发 bundle 通过，见 [world-hire-native-build.log](../../../.local/world-director-mvp/world-hire-native-build.log)。新增失效原因测试 4 passed、56 skipped，覆盖 read-set-changed 与 authority-unavailable 的两后端持久恢复，见 [world-hire-stale-reasons-tests.log](../../../.local/world-director-mvp/world-hire-stale-reasons-tests.log)。第二轮文档门禁因 `tool-cordis` 派生 API catalog 落后于纯类型声明位置而为 28 passed、1 failed，见 [world-hire-doc-sync-verified.log](../../../.local/world-director-mvp/world-hire-doc-sync-verified.log)；已从实际源码重跑 generator 更新唯一过期 artifact，最终门禁待检查，不隐去失败。


Native 部分最终 `pnpm run doc-sync` 为 29 passed、0 failed、0 skipped，见 [world-hire-doc-sync-final.log](../../../.local/world-director-mvp/world-hire-doc-sync-final.log)。纯类型声明后的 Cordis 派生 artifact 已从源码更新，没有降低任何门禁。新增真实 Loader fixture 的源码/分发 happy path 均已通过；强制退出扩展仍在单个既有 subagent 内进行，验收 checklist 保持 75 个原条目及 14 个已勾选状态。


## W3-a 全身份与原子提交的真实进程验收

`CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-hire.snapshot.ts --maxWorkers=1` 源码 12 tests passed，见 [world-hire-recovery.log](../../../.local/world-director-mvp/world-hire-recovery.log)；相同命令增加 `CLOCKY_EXAMPLE_MODE=lib` 的分发产物 12 tests passed，见 [world-hire-recovery-built.log](../../../.local/world-director-mvp/world-hire-recovery-built.log)。矩阵覆盖 JSON/SQLite 的正常闭环及 accepted-before-reserve、reserve-before-prep、实际 Participant invite IO 后/Native binding 前、commit-before、commit-after 五个 SIGKILL 边界。每例完成后额外再开新进程核对原 Persona、plan/hash/reads、全部已分配 UUID、结果及完成 revision 不变。恢复保持暂停，模型调用为零；首进程只有真实请求者/director 各三工具共 6 calls，新人 Session 未物化。

Native methods 没有 mock；Participant 边界仅在真实 `inviteParticipant()` IO 返回后用 IPC 停住进程再 SIGKILL。测试从真实初始 checkpoint 及 Native/Team/Session 日志恢复，不手造 accepted 计划、不重新 bootstrap、不删除未知责任。首次退出早于身份分配的情形由后续第三进程验证新分配只出现一份。分发最终报告的 entities/actors/reservations/assignments/results 均由实际 state 派生，原 Persona、binding、唯一 relation/result、ready、两个 wake 与重试都有事实关系断言。fixture 最后 Host 类型/lint 通过，见 [world-hire-loader-tsc-final.log](../../../.local/world-director-mvp/world-hire-loader-tsc-final.log)、[world-hire-loader-lint-verified.log](../../../.local/world-director-mvp/world-hire-loader-lint-verified.log)。

本轮及时勾选原 W3 第 3、5 项：全身份在 IO 前持久保存且重试复用；任职/ready/结果/首次 wake/预留结算的原子性。原 checklist 75 项正文、顺序、粒度保持不变，现 16 项勾选。其他 W3 项及 F1–F8 综合验收仍等待完整覆盖；这五个强杀边界不能冒充全部故障矩阵、精确取消清理或通用世界 driver 已完成。当前源码仍未提交，基线 SHA 不冒充实现提交。所有现场和产物在本项目目录中，无发布或真实付费模型调用。


最后状态派生报告的源码矩阵复跑也为 12 tests passed，见 [world-hire-recovery-source-final.log](../../../.local/world-director-mvp/world-hire-recovery-source-final.log)；分发矩阵为同一最终报告代码的 12 tests passed。新增 example README 中英说明、paired metadata 与完整文档最终门禁通过 29 passed、0 failed、0 skipped，见 [world-hire-example-pairing.log](../../../.local/world-director-mvp/world-hire-example-pairing.log)、[world-hire-doc-sync-complete.log](../../../.local/world-director-mvp/world-hire-doc-sync-complete.log)。最终 `git diff --check` 和全部 75 个原验收项正文/顺序比较通过，勾选数为 16；没有把未完成的取消清理、世界 driver、新人模型行动或产品/SDK闭环标记完成。

## W0 技术/业务去重验收与 W3 准备权限撤销（2026-10-09）

工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。本轮只使用一个 subagent 完成独立去重测试，主 agent 核对代码和原始结果后及时勾选 W0 第 2 原项。两后端真实 Agent/三工具/私有 Channel 证明：原 decision 的请求与计划精确重试不增加 revision，异 payload 拒绝；相同 HireIntent 换 decision ID 在开放案件中不创建第二请求，实际入职后仍只有原 Entity、预留、任职、结果、首次 wake、结果 wake 与私有通知。入职后新 director decision 不能再次规划；关闭重开后重复提交仍返回原结果。既有 reservation 异 member 拒绝与 append 故障/回执丢失也在完整回归中通过。

取消准备前已关闭新人执行，但 Participant、Channel 和独立端点同意的 preparation proof 未检查案件取消。现在共享 `assertSimulationWorldPreparationAdmission()` 根据原 reservation/request/最新 accepted plan 检查全部相关人物；Team 在排队执行、每次 proof 解析及 IO 之后复核，Native 拒绝撤权新人的新通道预留。独立 consent 检查整个预留通道，现有 requester/director 的 ready 状态不能授权已取消新人。取消或持久计划失效撤销新 IO；已写入的 Participant/Channel、未确认 binding/consent、原身份与容量责任继续保留，不把撤权当成外部清理完成。新 helper 不改变持久结构，journal stream 仍为 52。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts --maxWorkers=1` | 去重新增/扩展后完整 65 tests passed；两后端、真实请求/计划/入职与 reopening | [dedup-world-suite.log](../../../.local/world-director-mvp/dedup-world-suite.log)；[focused 6 项](../../../.local/world-director-mvp/dedup-focused.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-team/tests/channels.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts --maxWorkers=1` | 6 files、200 tests passed；取消先赢、排队/迟到 invitation、已写 Participant/Channel、跨端点 consent 撤销、未知责任保留及既有身份/readiness/维护回归 | [preparation-admission-regression.log](../../../.local/world-director-mvp/preparation-admission-regression.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'preparing responsibility\|already-issued endpoint' --maxWorkers=1` | 最后补验 4 passed、69 skipped；两后端 accepted-plan invalidation 和已签发 consent proof 在 Hub IO 前撤销 | [preparation-admission-stale-consent.log](../../../.local/world-director-mvp/preparation-admission-stale-consent.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-hire.snapshot.ts examples/simulation-company/tests/world-hire-cancellation.snapshot.ts --maxWorkers=1` | 源码 2 files、18 tests passed；原 12 项真实 SIGKILL/恢复矩阵及新增邀请前/真实邀请后/真实 Channel 后取消的 6 项 Loader 探针 | [preparation-admission-source-matrix.log](../../../.local/world-director-mvp/preparation-admission-source-matrix.log) |
| 上述命令增加 `CLOCKY_EXAMPLE_MODE=lib`，先完成 `pnpm run build` | 分发 2 files、18 tests passed；相同后端和真实 Loader/Agent/Team/Native 断言 | [preparation-admission-built-matrix.log](../../../.local/world-director-mvp/preparation-admission-built-matrix.log)；[build](../../../.local/world-director-mvp/preparation-admission-build-final.log) |
| `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`；`pnpm exec tsx scripts/run-oxlint.ts` 对本轮修改代码及夹具 | 最终 Host/Client 类型与对应 lint 通过，未降低规则或放宽输入 | [final-types](../../../.local/world-director-mvp/preparation-admission-final-types.log)；[源码/夹具 lint](../../../.local/world-director-mvp/preparation-admission-all-lint.log)；[补充测试 lint](../../../.local/world-director-mvp/preparation-admission-consent-lint.log) |
| `pnpm run verify-translation-pairing --write` 本轮 5 对 README/note；`pnpm run doc-sync` | 双语来源记录同步；29 passed、0 failed、0 skipped | [pairing](../../../.local/world-director-mvp/preparation-admission-pairing.log)；[doc-sync](../../../.local/world-director-mvp/preparation-admission-doc-sync.log) |

首轮新增取消测试 2 passed、4 failed：Hub 按既有契约将撤销 proof 归类为 `TEAM_ACTOR_PROOF_INVALID`，另两项 Promise 测试遗漏同步 entry 拒绝。已修正测试断言，未放宽 executor，随后 focused 6 项和完整回归通过。首轮夹具类型/build 因可变 `connection` 在闭包中可能为 undefined 失败，改为捕获已验证的连接；首次 lint 的 void/unknown/行长问题也已修复。首次日志保留为 [focused](../../../.local/world-director-mvp/preparation-admission-focused.log)、[fixture-types](../../../.local/world-director-mvp/preparation-admission-fixture-tsc.log)、[build](../../../.local/world-director-mvp/preparation-admission-build.log)、[lint](../../../.local/world-director-mvp/preparation-admission-lint.log)、[fixture-lint](../../../.local/world-director-mvp/preparation-admission-fixture-lint.log)。

checklist 仍为原 75 项，仅新增勾选 W0 第 2 项，目前 17 项勾选；没有新增、拆分或改写原验收项。W3 只完成撤销新准备权限的前置修复，尚未提供外部精确清理/终止/释放、完整 F8 子进程取消恢复或 product owner 编排，因此相关项保持未勾选。下一步需要按原跨所有者证据清点 Participant/Channel/Session 和未确认 IO，确认清理之后才原子结算取消与可释放占用；不得仅靠超时或 Native 状态推断目标不存在。所有命令使用项目内 TMPDIR，测试现场、日志和编译产物均留在项目内；没有发布或真实付费模型调用。

## W3 精确取消清理与 F8 验收（2026-10-09）

工作区仍未提交，源码基线 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba` 不冒充实现提交。本轮复用同一个 subagent 处理独立 Native 定义/结算，主 agent 完成 Team/Core proof、实际 IO、checkpoint/restore 和 Loader 进程验证。当前 journal stream 为 53，JSON/SQLite 明确拒绝 52；通用 SQLite 表结构与 Session format 没有变化。

Native `onWorldHireCleanup()` 只绑定 canonical Team 的单一运行时 owner，注册撤销后不能结算。`settleWorldHireCancellation()` 在队列外执行所有者对账，再入队复核原不可变身份、计划/member 配置、维护停稳及源仍有效。Team connection `cancelWorldCase()` 先保存原取消命令，排空已接受 Participant/Channel/consent IO，按原 UUID 查询/关闭两个 Channel、退出原 membership，并验证 Session 尚未物化、没有 activation/task/额外 Channel 责任。只有显式 owner not-found 且准备已排空才证明不存在；存储错误、丢失回复和未知 IO 保留原 cancel-requested、preparing、占用及维护责任。新退休/关闭 proof 严格绑定 run、owner 和目标，Hub 在策略 IO 后复核，pending invitations 经真实 Channel close 结算。

原子 `hire/abandoned` 保存 cleanup 证据、abandoned/terminated Entity、唯一取消结果、原命令回执与安全 requester wake。多个原命令保留原 sequence；最早 pending 命令为 cancelled source，后来命令返回 already-resolved。入职先赢返回 already-committed，不调用清理或删除任职；取消先赢则永久拒绝原事项入职。历史 Entity/Participant/Session/Channel 身份均保留；精确已清理的未完成 binding/Channel 不再阻塞显式运行，未清理责任仍拒绝。checkpoint 只允许确证不存在的原 Channel 省略引用，实际终态 Channel 仍必须有受保护历史；可写恢复重验 cleanup 的跨所有者证据，缺失时拒绝且不修补历史。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts --maxWorkers=1` | Native/现有生命周期 4 files、198 tests passed；新的 strict cleanup parser 和原回归 | [native-cleanup-lifecycle-tests.log](../../../.local/world-director-mvp/native-cleanup-lifecycle-tests.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'exact target reconciliation\|original cleanup responsibility\|linearizes\|live canonical' --maxWorkers=1` | 24 passed；两后端 absent/invited/provisioning/active/partial-channel/prepared 六阶段，实际邀请/Channel/退休回复丢失、Native append 故障、取消/提交两种获胜顺序、owner 撤销和多个原命令结算 | [world-cleanup-recovery-tests.log](../../../.local/world-director-mvp/world-cleanup-recovery-tests.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'unknown accepted preparation' --maxWorkers=1` | 2 passed；不在 Native 队列等待准备 IO，不因当前未发现目标而提前释放；IO 期间原命令/持久引用读取仍可完成 | [world-cleanup-drain-tests-final.log](../../../.local/world-director-mvp/world-cleanup-drain-tests-final.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'releases proven' --maxWorkers=1` | 2 passed；取消后真实 requester 消费结果 wake，真实两组三工具开启新业务申请/计划，重新预留岗位及有限 Entity 名额，所有技术身份均与原件不同且原件保留 | [world-cleanup-new-application-verified.log](../../../.local/world-director-mvp/world-cleanup-new-application-verified.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'original terminal cleanup' --maxWorkers=1` | 2 passed；可写恢复缺失原终态 Channel 证据会拒绝，Native 原结果与世界不被修补或改写，无推理 | [world-cleanup-restore-rejection.log](../../../.local/world-director-mvp/world-cleanup-restore-rejection.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'additional cancellation intent' --maxWorkers=1` | 2 passed；membership IO 已提交但回复未知时追加取消命令，不因 updatedSequence 改变误判原身份冲突；最终结算最早及新增原回执 | [world-cleanup-concurrent-intent.log](../../../.local/world-director-mvp/world-cleanup-concurrent-intent.log) |
| `pnpm exec vitest run packages/core/team/tests/schema.spec.ts -t 'Simulation cancellation cleanup' --maxWorkers=1`；`pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts -t 'unsupported durable history' --maxWorkers=1` | 13 strict scope tests passed；两后端旧 52 明确拒绝，2 passed | [scopes](../../../.local/world-director-mvp/world-cleanup-scopes.log)、[stream rejection](../../../.local/world-director-mvp/world-cleanup-stream-rejection.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-team/tests/channels.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/core/team/tests/schema.spec.ts packages/team/team-hub/tests/channel-invitation-admission.spec.ts --maxWorkers=1` | 当时 10 files、336 tests passed；之后补充的 strict scope、缺失恢复证据、追加命令和旧 52 拒绝另由上方 focused 命令覆盖 | [world-cleanup-regression.log](../../../.local/world-director-mvp/world-cleanup-regression.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-hire-cleanup.snapshot.ts --maxWorkers=1` | 源码 12 tests passed；真实 Loader、Agent/三工具、Team/Native、JSON/SQLite。三种准备阶段正常清理，真实 membership IO 后及 Native append 前/后 SIGKILL，再新进程恢复、第三进程精确重试；全程原身份/结果保留，恢复无模型调用且保持暂停 | [world-cleanup-source-snapshot.log](../../../.local/world-director-mvp/world-cleanup-source-snapshot.log) |
| 上述命令增加 `CLOCKY_EXAMPLE_MODE=lib` | 最终分发 12 tests passed；完整 build 后刷新最后修改的 Native bundle，再运行相同真实进程矩阵 | [world-cleanup-built-final.log](../../../.local/world-director-mvp/world-cleanup-built-final.log) |
| `CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-hire.snapshot.ts examples/simulation-company/tests/world-hire-cancellation.snapshot.ts --maxWorkers=1` | 原入职 SIGKILL/撤销准入源码回归 2 files、18 tests passed，不把清理改动冒充新人行动或产品 driver | [world-cleanup-existing-source.log](../../../.local/world-director-mvp/world-cleanup-existing-source.log) |
| `pnpm run build`；`pnpm exec tsdown --filter @clocky/clocky-simulation-local --env.CLOCKY_BUILD_FACE host`；`pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`；本轮代码/夹具 `run-oxlint.ts` | 完整构建、最后 Native 产物刷新、最终 Host/Client 类型与 lint 通过 | [build](../../../.local/world-director-mvp/world-cleanup-build.log)、[Native refresh](../../../.local/world-director-mvp/world-cleanup-native-refresh.log)、[types](../../../.local/world-director-mvp/world-cleanup-verified-types.log)、[lint](../../../.local/world-director-mvp/world-cleanup-verified-lint.log) |
| `pnpm run gen-cordis-catalog`、`pnpm run gen-doc-graphs`、`pnpm run gen-config-catalog`；对应 9 对 `verify-translation-pairing --write`；`pnpm run doc-sync` | 从源码更新派生 API/图/Config，中文 Config 仅对应来源行号变更；最终 29 passed、0 failed、0 skipped | [Cordis](../../../.local/world-director-mvp/world-cleanup-cordis-generate.log)、[graphs](../../../.local/world-director-mvp/world-cleanup-graphs-generate.log)、[Config](../../../.local/world-director-mvp/world-cleanup-config-generate.log)、[pairing](../../../.local/world-director-mvp/world-cleanup-pairing.log)、[Config pairing](../../../.local/world-director-mvp/world-cleanup-config-pairing.log)、[final doc-sync](../../../.local/world-director-mvp/world-cleanup-doc-sync-final.log) |

首轮真实目标清理 2 passed、10 failed，暴露未确认历史 channel/binding 阻塞结算或后续 start；已只针对确证 cleanup 修复 Native 门禁，后续六阶段全部通过，首轮保留 [world-cleanup-real-targets.log](../../../.local/world-director-mvp/world-cleanup-real-targets.log)。首次 aggregate 指出 cleanup optional 需要显式允许 undefined，首次 lint 的行长/条件已修复；日志保留 [first types](../../../.local/world-director-mvp/world-cleanup-types-first.log)、[main lint](../../../.local/world-director-mvp/world-cleanup-main-lint.log)。排空测试首次误读 persistence reference 的 revision，并导致屏障未释放；改为正确 cursor 与 finally 释放后通过，见 [first drain](../../../.local/world-director-mvp/world-cleanup-drain-tests.log)。新申请首次没有服务原取消 result wake，调度按正确因果 microstep 阻止后续 director wake；最终由真实 requester 消费原结果 wake 后提出下一申请，不删 wake 或绕过调度，保留 [first new application](../../../.local/world-director-mvp/world-cleanup-new-application.log) 与 [diagnostic](../../../.local/world-director-mvp/world-cleanup-new-application-diagnostic.log)。首轮 doc-sync 为 28 passed、1 failed，仅 Config 来源行号过期；已重生成并最小同步中文，不降低门禁，首次日志保留 [world-cleanup-doc-sync.log](../../../.local/world-director-mvp/world-cleanup-doc-sync.log)。

原 checklist 保持 75 项原正文、顺序与粒度，及时新增勾选 W3 第 8–10 项及 F8，现为 21/75。保存的原项正文见项目内 [checklist-before-cleanup.txt](../../../.local/world-director-mvp/checklist-before-cleanup.txt)；逐项去除勾选状态比较通过。完整 F1–F8 综合验收、产品 owner 编排、通用 world driver、新人行动、浏览器和 SDK 仍未完成，未借此改为已验收或将提案转为 implemented。所有测试/脚本/编译使用项目内 TMPDIR，原始现场和产物均在项目目录；没有发布或真实付费模型调用。

## W4 通用 driver、终态上下文与双场景冷恢复（2026-10-10）

工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。本轮继续只复用一个 subagent，独立负责 Native 终态上下文及真实授权测试；主 agent 实现 `simulation-world`、真实 Loader 双场景、消费链、窗口 claim 验证、冷恢复/暂停、构建与文档。该 driver 是执行 consumer，不是第二份持久世界，也不是浏览器 owner。产品原创建仍保持暂停；产品调度 owner 尚未接入此新 driver。

`SimulationWorldDriver` 使用原冻结编译结果和 canonical connection，在 Native wake/queue/window 上选择角色。接受计划以后通过现有维护、全身份预留、真实 Participant/Channel 准备与原子入职推进；没有公司/实验室名称分支。结果与首次行动分别由真实 Agent/Session/三个 Simulation 工具完成。Native 新严格 result/first-action selector 验证原 actor、原 wake、不可变结果和新人任职/binding，result 通信必须完整等于冻结的安全 JSON 通知，first-action 只可通过原招聘者私有通道介绍自己。director 没有规划上下文时只允许普通通信，不开放世界或资源管理操作。每次终态普通 post 也必须保存 exact consumed receipt。当前 stream 54 拒绝旧 53；通用 SQLite schema 与 Session format 不变。

两个场景在 JSON/SQLite 完成真实请求—私有交付—director apply—入职—新人独立首次行动—安全通知—普通收件消费—idle，共 18 次脚本模型请求。再次 advance 的模型计数和 Native revision 均不增加。新人只使用原批准 Persona、模板 description、当前职责、组织公开信息及新消息；observer 的私有 sentinel 不进入任何模型输入，director 自由 rationale 不进入新人 Session。全模型请求仍由 Session request-header/context-view/消息重建，脚本只读取这些真实 model messages。维护中实际持久 `user-pause-during-maintenance` 保持暂停；显式继续才执行剩余角色。新进程从完成 checkpoint 恢复时不推理、保持暂停，原 Persona、UUID、任职、请求/计划/结果、通信与回执原样保留，不重新准备或重新办理。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts`；新增 Native 源码定向 `run-oxlint.ts` | 70 schema tests passed；result/first selector 与规范安全渲染严格拒绝；原规划/消费/去重 focused 12 passed | [result-context-schema-tests.log](../../../.local/world-director-mvp/result-context-schema-tests.log)、[planning regression](../../../.local/world-director-mvp/result-context-planning-regression.log)、[Native lint](../../../.local/world-director-mvp/result-context-lint.log) |
| `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts --maxWorkers=1` | 117 tests passed；新增 12 项包括两后端 serial/window 真实三工具、错 actor/wake/result/purpose、未消费、篡改正文/路由/时间/body/依赖拒绝、撤旧 can-hire 后原结果仍有效、reject/cancel 安全通知及 exact receipt | [terminal-auth-world-suite.log](../../../.local/world-director-mvp/terminal-auth-world-suite.log)、[focused](../../../.local/world-director-mvp/terminal-auth-focused.log)、[lint](../../../.local/world-director-mvp/terminal-auth-lint.log) |
| `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-driver.snapshot.ts --maxWorkers=1` | 源码 8 tests passed；双场景/两后端正常及维护中暂停，真实 18 model calls；每例另开新进程恢复，0 model calls、保持暂停并严格比较原世界/新人/任职/通信 | [world-driver-pause-restore.log](../../../.local/world-director-mvp/world-driver-pause-restore.log)；原不含暂停的 4 项冷恢复见 [world-driver-cold-verified.log](../../../.local/world-director-mvp/world-driver-cold-verified.log) |
| 上述命令增加 `CLOCKY_EXAMPLE_MODE=lib` | 分发同一 8 tests passed，原完整 build 后刷新最终 driver bundle | [world-driver-built-restore.log](../../../.local/world-director-mvp/world-driver-built-restore.log) |
| `pnpm exec vitest run packages/simulation/simulation-local/tests/windows.spec.ts packages/simulation/simulation-local/tests/dispatch.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts --maxWorkers=1` | 6 files、272 tests passed；窗口冻结/公平队列/持久格式/准备/世界原协议回归 | [world-driver-regression.log](../../../.local/world-director-mvp/world-driver-regression.log) |
| `pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts -t 'unsupported durable history' --maxWorkers=1` | 2 passed，两后端原 53 明确拒绝 | [world-driver-stream-rejection.log](../../../.local/world-director-mvp/world-driver-stream-rejection.log) |
| `pnpm run build`；`pnpm exec tsdown --filter @clocky/clocky-simulation-world --env.CLOCKY_BUILD_FACE host`；`pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`；修改源码/夹具 `run-oxlint.ts`；`pnpm run constraints` | 完整 build、最后 driver 分发刷新、Host/Client 类型、lint 与 workspace constraints 通过 | [build](../../../.local/world-director-mvp/world-driver-build.log)、[driver refresh](../../../.local/world-director-mvp/world-driver-world-refresh.log)、[types](../../../.local/world-director-mvp/world-driver-typecheck-verified.log)、[lint](../../../.local/world-director-mvp/world-driver-last-lint.log)、[constraints](../../../.local/world-director-mvp/world-driver-constraints.log) |
| `pnpm run gen-cordis-catalog`、`gen-doc-graphs`、`gen-config-catalog`、`gen-module-graph`；对应 bilingual `verify-translation-pairing --write`；`pnpm run doc-sync` | 原始生成结果、必要来源行/新增包数据与图对侧同步；修复缺少 JSDoc returns 后最终 29 passed、0 failed、0 skipped | [Cordis](../../../.local/world-director-mvp/world-driver-cordis-generate.log)、[graphs](../../../.local/world-director-mvp/world-driver-graphs-generate.log)、[Config](../../../.local/world-director-mvp/world-driver-config-generate.log)、[module](../../../.local/world-director-mvp/world-driver-module-generate.log)、[pairing](../../../.local/world-director-mvp/world-driver-pairing.log)、[generated pairing](../../../.local/world-director-mvp/world-driver-generated-pairing.log)、[doc-sync](../../../.local/world-director-mvp/world-driver-doc-sync-verified.log) |

真实链验证揭示并修复两个 Native/Team 缺口：result/first 的普通 post 原先没有触发持久消费回执；窗口 prepare 使用原 snapshot 的 pending wake，导致合法 terminal claim 拒绝。现在对所有 world scope 记录消费，窗口只叠加已验证的 wake claim，业务 facts/revision 仍统一冻结。serial terminal 来源曾追加 decision/opening 之后的 state.revision，超出 view 的原 snapshotRevision；删除非必需的当前来源，保留 world/intent/result 三条原持久来源，serial 和 window 正例均通过。没有放宽错 actor/wake、未消费或普通通信 proof。

首次 driver 夹具缺少必需 input/commitments section；第二轮暴露窗口 claim；第三轮外部脚本误用历史 observe tool reply 当新视图，result turn 未提交。最终脚本只从真实当前 user projection 选择视图，排除历史 tool-result block，不读取 Native executor 或隐藏 driver state；实际业务代码没有迁就脚本绕过授权。冷恢复第一次把退休前 writer 状态当完成 proof，改为 checkpoint 真实退休后保存原证据。上述失败日志分别保留 [first snapshot](../../../.local/world-director-mvp/world-driver-first-snapshot.log)、[second](../../../.local/world-director-mvp/world-driver-second-snapshot.log)、[third](../../../.local/world-director-mvp/world-driver-third-snapshot.log)、[model diagnosis](../../../.local/world-director-mvp/world-driver-errors.log)、[first cold proof](../../../.local/world-director-mvp/world-driver-cold-restore.log)。

初次 `pnpm install --offline` 因现有 pnpm 供应链 metadata 缺失而失败，没有跳过策略；改用项目内 cache/TMPDIR 正常安装，1198 项 policy 通过，没有下载新依赖包。首次 aggregate 触发 pnpm 自动安装，再显示纯 world-types 的 SimTime 从 Host types 叶导入会污染 Client sessions；现使用纯 time-types 叶，最终双面通过。日志保留 [offline](../../../.local/world-director-mvp/world-driver-install.log)、[normal install](../../../.local/world-director-mvp/world-driver-install-online.log)、[first types](../../../.local/world-director-mvp/world-driver-types-first.log)。首次 doc-sync 26 passed/3 failed：新增包派生图、配对及 advance 返回说明缺失；第二次 28/1 的 Config/module 技术行顺序差异也已最小同步，见 [first doc-sync](../../../.local/world-director-mvp/world-driver-doc-sync.log)、[second](../../../.local/world-director-mvp/world-driver-doc-sync-final.log)，不改写首次失败为通过。

及时勾选原 W4 第 1–6 项，现为 27/75；原 75 项正文/顺序与项目内 [checklist-before-driver.txt](../../../.local/world-director-mvp/checklist-before-driver.txt) 比较保持一致，没有新增或拆分验收项。W4 剩余完整预算、轮转/阻塞停止证据，产品执行 owner、浏览器、case API 与 SDK 尚未完成；没有把直接 accepted compilation 的 keyless fixture 冒充原产品命令/浏览器闭环或 W6 完成。所有临时后端、原定义/proof、日志、cache、编译产物均留在项目内；没有发布或真实付费模型调用。

新增子系统说明及最后配对后，最终 `pnpm run doc-sync` 为 29 passed、0 failed、0 skipped，见 [world-driver-doc-sync-last.log](../../../.local/world-director-mvp/world-driver-doc-sync-last.log)。`pnpm run verify-built-package-invariants` 的 269 个实际分发 companion 通过 plain-Node Loader 检查，包含新增 simulation-world，见 [world-driver-built-invariants.log](../../../.local/world-director-mvp/world-driver-built-invariants.log)。最后 `git diff --check`、计划目录链接/末尾换行/空白、75 项正文顺序与 27 项勾选状态验证通过。

## 产品 World owner、原控制命令与 F3/F4/F6 恢复（2026-10-10）

本轮工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。主 agent 接通 World 专属产品 owner，既有 company owner 和采购/任务责任保持独立；只复用一个 subagent 同步停止词汇的 TS/Python parser 与消费者。原行政日志格式仍为 3、Native stream 仍为 54，本轮没有新增持久格式。

`prepareWorldOwned()` 在原准备完成后只安装单一惰性 `SimulationWorldOwner`。只读 control/status/export、初始化和页面读取不连接 Agent、不推理；首次已认证 running management 才附着原 Native Team owner 和 generic World driver。原 management ID/phase 仍由 Native 排队持久保存；完成 start 重试返回原结果，不覆盖后来的 pause，也不启动第二 owner。World control budget 使用原 director route，全部初始/生成角色仍共用 Native 和 Host pool 限额。ingress 使用原身份、当前 ready/active cognitive target 和认证 principal；新人物可以接收获准输入，半准备人物不在允许目标中。原 checkpoint/restore 命令按 creation.kind 选择 world/1 或 company/1，原定义/版本和模型 route 不依最新 catalog 重算。

冷 restore 先验证完整 Native/Team/Session/Channel 前缀，再保持 paused；已接受结构维护的原 Participant/Channel IO 可受控对账并结算，不执行模型。产品 owner 在原 held run 上提供 pause，恢复结算本身从不继续生产性调度。已接受计划或已提交入职不因退出而重做生成；用户使用新的显式 running management 身份后才完成通知/新人行动。company task read/review/cancel 保持原 family 校验，没有伪造 buyer/supplier 或任务配置套入 World。

| 实际命令 | 结果与范围 | 原始证据 |
|---|---|---|
| `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts --maxWorkers=1` | 最终源码 20 tests passed：两场景×两后端，正常和 accepted-before-reserve、真实 participant-afterIO、commit-before、committed-before-notification 四个 SIGKILL 边界；已认证 fetch 原创建/start/pause/checkpoint/restore。正常 18 model calls，冷读取/恢复 0 calls，显式继续后仅原后续 12 calls，无第二次计划生成 | [world-owner-source-recovery-final.log](../../../.local/world-director-mvp/world-owner-source-recovery-final.log) |
| 上述命令增加 `CLOCKY_EXAMPLE_MODE=lib`，先完成 `pnpm run build` | 同一真实产品矩阵分发 20 tests passed | [world-owner-built-recovery.log](../../../.local/world-director-mvp/world-owner-built-recovery.log)、[build](../../../.local/world-director-mvp/world-owner-build.log) |
| 上述源码/分发命令增加 `-t 'participant-afterIO'` | 最后补充 F4 各 4 passed：实际 newcomer membership 已 active、Entity preparing，在真实直接 activation controller 下拒绝，readiness/writer 未提前改变；原 UUID/binding/Session/Channel 仍复用 | [F4 source](../../../.local/world-director-mvp/world-owner-f4-source-verified.log)、[F4 built](../../../.local/world-director-mvp/world-owner-f4-built-verified.log) |
| `pnpm exec vitest run packages/client/ui-simulation/tests/run-status.client.spec.tsx packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/administration.spec.ts packages/simulation/simulation-product/tests/maintenance-control.spec.ts packages/simulation/simulation-product/tests/maintenance.spec.ts packages/simulation/simulation-product/tests/company-tasks.spec.ts --maxWorkers=1` | 6 files、128 tests passed：原暂停创建、准备/原请求、维护/采购任务回归、EN/ZH 新 stop 标签 | [world-owner-focused-regression.log](../../../.local/world-director-mvp/world-owner-focused-regression.log)；初步 baseline 50 项见 [baseline](../../../.local/world-director-mvp/world-owner-baseline.log) |
| `pnpm exec vitest run packages/simulation/simulation-product/tests/control-schema.spec.ts packages/sdk/client/tests/simulation.spec.ts --maxWorkers=1`；项目 `.venv` 下 Python `test_simulation.py` | TS 94 passed；Python 87 passed。control/operational 两层同步 idle、maintenance-blocked、position-capacity、authority-missing、plan-stale、plan-budget 六个精确 stop；未知 stop/扩展 start reason 均拒绝 | [TS](../../../.local/world-director-mvp/world-stop-ts-tests.log)、[Python](../../../.local/world-director-mvp/world-stop-python-tests.log)、[typed lint](../../../.local/world-director-mvp/world-stop-ts-lint.log) |
| `pnpm run test:gui`；`pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts -t 'default local topology through the full fetch carrier' --maxWorkers=1` | 初次 GUI 5287 passed、1 skipped、1 timeout；该既有 fetch test 单独复查 1 passed、88 skipped，未放宽 timeout 或改产品实现 | [GUI first](../../../.local/world-director-mvp/world-owner-gui-tests.log)、[focused recheck](../../../.local/world-director-mvp/world-owner-gui-timeout-verified.log) |
| premium `audit_project.py` 项目 strict audit；现有设计与 UX contract 核对 | 静态 0 errors/violations/warnings，仅扩展既有状态文案与类型，不改交互组件。此静态结果不冒充全浏览器场景或 W5 GUI 验收 | [audit JSON](../../../.local/world-director-mvp/world-owner-premium-audit.json)、[audit log](../../../.local/world-director-mvp/world-owner-premium-audit.log) |
| `pnpm exec tsc -b tsconfig.host.json tsconfig.client.json`；本轮 owner/admin/helper/夹具/UI labels `run-oxlint.ts` | 最终 Host/Client 编译与对应 lint 通过 | [types](../../../.local/world-director-mvp/world-owner-last-types.log)、[lint](../../../.local/world-director-mvp/world-owner-lint-final.log)、[F4 fixture lint](../../../.local/world-director-mvp/world-owner-f4-lint.log) |
| `pnpm run gen-cordis-catalog`、`gen-doc-graphs`、`gen-config-catalog`、`gen-module-graph`；对应 `verify-translation-pairing --write`；`pnpm run doc-sync` | 派生 API/依赖图与双语 owner/subsystem/note 更新，最终 29 passed、0 failed、0 skipped | [Cordis](../../../.local/world-director-mvp/world-owner-cordis-generate.log)、[graphs](../../../.local/world-director-mvp/world-owner-graphs-generate.log)、[Config](../../../.local/world-director-mvp/world-owner-config-generate.log)、[module](../../../.local/world-director-mvp/world-owner-module-generate.log)、[pairing](../../../.local/world-director-mvp/world-owner-pairing.log)、[doc-sync](../../../.local/world-director-mvp/world-owner-doc-sync.log) |

冷恢复矩阵首次 16 passed、4 failed，仅 accepted-before-reserve 的 fixture 在显式 restore 前把只读 Native 原 running 历史误断言为 paused；改为仅要求 explicit restore 后 paused，未通过读操作改写 phase，随后 F3 4 项及最终 20 项通过，保留 [first recovery](../../../.local/world-director-mvp/world-owner-process-recovery.log)、[F3 verified](../../../.local/world-director-mvp/world-owner-f3-recovery.log)。补充 direct controller 首轮 F4 测试将既有 maintenance-first 拒绝误当必须 readiness-first，导致受控恢复 receipt failed；现接受精确的 readiness 或 maintenance 拒绝并断言 writer 未分配，最后源码/分发均通过，保留 [F4 source first](../../../.local/world-director-mvp/world-owner-f4-admission-source.log)、[F4 built first](../../../.local/world-director-mvp/world-owner-f4-admission-built.log)。首次 aggregate 的 union family narrowing、pipe 可空和新增 stop 文案漏配已修；首次 lint 的行长/箭头格式已修，见 [types first](../../../.local/world-director-mvp/world-owner-types-first.log)、[fixture types](../../../.local/world-director-mvp/world-owner-recovery-types.log)、[lint first](../../../.local/world-director-mvp/world-owner-lint-first.log)。一次 GUI focused 命令误用不存在的 vitest.gui.config.ts，失败记录保留 [wrong config](../../../.local/world-director-mvp/world-owner-gui-timeout-recheck.log)，实际 test:gui 使用默认 root config，最终 focused 使用正确配置通过。

本轮及时勾选原 F3、F4、F6、冷回放/显式继续及 W6 双新 keyless 产品链五项，现为 32/75。原正文/顺序与 [checklist-before-owner.txt](../../../.local/world-director-mvp/checklist-before-owner.txt) 完全相同；未新增、拆分或改写验收条目。完整 F1/F2/F5/F7 综合证据、案件分页/敏感读取/取消命令、JSON 浏览器导入与相关交互、预算/停止全矩阵、完整 SDK 新 RPC 分发及真实模型试验仍待完成，不把本轮原控制接口联通宣称为 MVP 完成。所有临时输入/proof、崩溃现场、日志、cache 和编译产物在项目内；没有发布或真实付费模型调用。

## 2026-10-10 原案件读取、独立披露和产品取消

原产品目录提供 `listWorldCases` 与 `inspectWorldCase` 的 request/plans/execution/notification 四个有界分区；分页绑定 Native revision、credential、读取策略与当前取消提示。投影只选择原事实字段，不返回 Native snapshot、private runtime、Session 原文或消息正文。case prose 和 Persona 使用分别可卸载的 `caseReaders` 授权；run、context 和 journal 权限不隐式赋予它们。策略撤销或旧 readVersion 遮蔽正文，失效 continuation 需要刷新。取消提示由原行政 owner 提供，不形成 Native 写能力。

原 `cancel-world-case` 命令在身份 IO 前持久接受，Native 使用原 run/command/request 派生取消身份并裁决与入职的先后。取消先胜时 driver 不把已选计划/尚未预留的竞赛当作故障；准备中取消排空原 IO 并对账全部清理；已提交则保留 already-committed 事实。终态查询/重试无需 owner 或模型；未知 cleanup 保留 accepted 原件，受控暂停仍可提交。TypeScript/HTTP/Python 的原选择、严格 parser 和两端 SDK 均接通，取消查询保留原 `worldCancellation`。

| 实际命令/证据 | 已确认结果 | 原始输出 |
| --- | --- | --- |
| `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts --maxWorkers=1` | 源码 12 passed；公司/实验室 × JSON/SQLite × 预留前、Participant 实际 IO 后、已提交未通知；四分区、独立 case/Persona grant、撤权在途及旧策略读取；新进程终态原查询/重试均 0 model calls | [source final](../../../.local/world-director-mvp/world-case-cancel-source-final.log) |
| 上述命令增加 `CLOCKY_EXAMPLE_MODE=lib`，在完整 build 后执行 | 分发同一 12 passed | [built](../../../.local/world-director-mvp/world-case-cancel-built.log) |
| SDK client/server、case schemas、product administration/world administration/watch/collections focused | 8 files、228 passed；其中新增 case schema 20 与 cancellation boundary 8，协议端拒绝 actor 注入、另一命令/页面/分区和 withheld 隐藏字段 | [focused](../../../.local/world-director-mvp/world-cases-regression.log)、[schema](../../../.local/world-director-mvp/case-schema-tests.log) |
| Client runtime administration、persistent requests/command record renderer focused | 56 runtime + 19 renderer passed；新增取消 kind/failure 的两语言标签，收窄测试 method union 防止新增详情 DTO 触发 TS2590 | [runtime](../../../.local/world-director-mvp/world-cases-client-regression.log)、[renderer](../../../.local/world-director-mvp/world-cases-client-render.log) |
| 项目 `.venv` 的 `pytest test_simulation.py test_simulation_world_cases.py`，cache/pycache/TMPDIR 指向项目 | 94 passed；两端请求选择、严格字段/分区/状态、独立披露、原取消查询和当前归属校验 | [Python](../../../.local/world-director-mvp/world-cases-python-last.log) |
| Python 严格解析真实 fetch 保存的 12 × 5 份投影 | 60 个实际页面/分区匹配同一 DTO；无预构造业务成功对象 | [real wire](../../../.local/world-director-mvp/world-cases-python-real-wire.log) |
| 原 `world-owner.snapshot.ts` 源码/分发，筛选无 crash 情形 | 各 4 passed、16 skipped；完整原产品 start → hire → newcomer action → checkpoint → cold restore，计数保持 18/0，原 start 重试不解除后来暂停 | [owner source](../../../.local/world-director-mvp/world-cases-owner-source-verified.log)、[owner built](../../../.local/world-director-mvp/world-cases-owner-built-verified.log) |
| `tsc -b tsconfig.host.json tsconfig.client.json`、所涉文件 `run-oxlint.ts` | aggregate 与 lint 通过 | [types](../../../.local/world-director-mvp/world-cases-types-final.log)、[lint](../../../.local/world-director-mvp/world-cases-lint-last.log) |
| 完整 `pnpm run build`、plain-Node compiled companions | 197 client artifacts，269 compiled companions passed | [build](../../../.local/world-director-mvp/world-cases-build-final.log)、[invariants](../../../.local/world-director-mvp/world-cases-built-invariants.log) |
| `gen-cordis-catalog`、`gen-config-catalog`、七组 bilingual pairing、`doc-sync` | 最终 29 passed、0 failed、0 skipped；新契约归属映射与独立披露说明已补 | [Cordis](../../../.local/world-director-mvp/world-cases-cordis-verified.log)、[config](../../../.local/world-director-mvp/world-cases-config-final.log)、[pairing](../../../.local/world-director-mvp/world-cases-pairing.log)、[doc-sync](../../../.local/world-director-mvp/world-cases-doc-sync-final.log) |
| strict premium audit | 0 errors/violations/warnings | [audit](../../../.local/world-director-mvp/world-cases-premium-audit.json) |

失败/误调用保留而不计作通过：最初 snapshot 命令多传 `--` 导致扩大到全部文件，在新 reader 尚未接通时出现 owner 初始化失败，已停止该运行；正式源码/分发均使用精确文件路径。一次 owner 筛选没有匹配任何项（20 skipped），随后正确筛选验证 4 项。初次 SDK server 新路由在 parse 前解析可选 service，被严格拒绝测试指出，现先 parse 后 resolve。初次 types/lint 的待接 read exports、post 状态/事件字段、locale keys、行长均修复。文档 gate 指出同一行 block tags、不完整类型归属及中文目录的新增英文 link，修复后最终 doc-sync 29/0。对应原始失败输出：[snapshot wrong scope](../../../.local/world-director-mvp/world-case-cancel-source-first.log)、[protocol first](../../../.local/world-director-mvp/world-case-protocol-tests.log)、[types integrated](../../../.local/world-director-mvp/world-cases-types-integrated.log)、[client types](../../../.local/world-director-mvp/world-cases-client-types.log)、[lint first](../../../.local/world-director-mvp/world-cases-lint.log)、[catalog first](../../../.local/world-director-mvp/world-cases-cordis-generate.log)、[catalog type ownership](../../../.local/world-director-mvp/world-cases-cordis-generate-final.log)、[doc first](../../../.local/world-director-mvp/world-cases-doc-sync.log)。

本部分不是 W5 的完整浏览器验收：JSON 导入/创建预览/案件 UI、场景 SDK 完整路径、综合预算/公平/其余故障和真实模型/测量仍待补；没有新增或改写 checklist 项目，维持 32/75，不把 API/脚本证据冒充产品页面完成。

最终 `pnpm run test:gui --maxWorkers=2` 为 **412 files passed、5300 tests passed、1 skipped**，无 timeout/失败，见 [GUI](../../../.local/world-director-mvp/world-cases-gui.log)。最后 JSDoc 收口后的完整 build 再次记录 197 client artifacts，Host/Client aggregate 再次通过，见 [last build](../../../.local/world-director-mvp/world-cases-build-last.log)、[last types](../../../.local/world-director-mvp/world-cases-types-last.log)。新源码标签及 Client 测试 method union 只用于原界面记录和类型验证，没有新增案件页面，仍不勾选完整浏览器项。

## 2026-10-10 World 导入与案件工作区

JSON 文件/粘贴文本、原暂停创建、明确 start/pause、原定义导出以及 request/plans/execution/notification 案件分区已接入既有 Simulation 工作区。view store 保留有界原草稿、原 commandKey 与安全 URL 选择；预检 generation 失效后不能创建，已接受 payload 锁定。创建前先校验带 commandKey 的草稿容量，再保留/发送原命令，避免遗失未发送的原件。文件异步读取使用 generation/authority 防止迟到覆盖，显示已读取文件名。案件分区使用真实 runtime 窗口，关闭详情退休 private reader，分页携带原 revision/cursor；取消仍通过既有原命令 owner。图像检查修复了长 ID 按钮溢出和窄屏分区隐藏，响应式证据等待实际侧栏收起及 workspace 宽度后采集。

Client Runtime 四个新窗口、三个原命令与原回执比较有 146 项相关回归证据；新 Runtime focused 46 项在卷恢复后重新通过。Schema 的 Node/Client 声明冲突来自 TypeScript 为 inferred branded scalars/diagnostics 选择 Host re-export 名称：Host API 改用 types leaf，public scalar/diagnostic/typeface 明确锚定纯叶并保留原 shape/解析行为。actual Client Program 不再加载 Host SessionStore。新 Web fixture 明确纳入 Host aggregate、排除 Client face，并声明测试依赖；没有用类型抑制、删除测试或兼容旁路换取通过。

已确认命令：

- `tsc -b tsconfig.host.json tsconfig.client.json` 最终通过：[types](../../../.local/world-director-mvp/world-ui-types-last.log)。
- 新/相关 UI 与 World schema focused：5 files、148 passed：[focused](../../../.local/world-director-mvp/world-ui-tests-verified.log)。额外 case route restore/reject 15 passed：[route](../../../.local/world-director-mvp/world-ui-route-tests.log)；注册夹具新绑定补齐后 2 passed：[apply](../../../.local/world-director-mvp/world-ui-apply-verified.log)。
- `CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-workspace.snapshot.ts --maxWorkers=1`：真实 company/laboratory × JSON/SQLite 浏览器矩阵 4 passed，经过 HTTP/WebSocket、原产品命令、Agent 三工具、实际身份/Channel/Session、入职和新人 first-action。每 run 18 实际 adapter 请求，刷新/读取不增加计数；新人 Session 独立，默认 case/Persona body withheld。当前图像/状态最终矩阵：[matrix](../../../.local/world-director-mvp/world-ui-browser-visual-final.log)，实际侧栏收起后窄屏 focused：[responsive](../../../.local/world-director-mvp/world-ui-browser-responsive.log)。各 run 的截图和原证明在 `.local/world-director-mvp/browser/`。
- 完整 build 记录 197 client artifacts：[build](../../../.local/world-director-mvp/world-ui-build-route-final.log)。精确 world-schema inline-safe path 及 private 子路径拒绝 17 passed：[purity](../../../.local/world-director-mvp/world-ui-bundle-purity.log)。Strict premium audit 清零：[audit](../../../.local/world-director-mvp/world-ui-premium-audit-final.json)。
- Web 全范围回归发现旧可信 seed 缺失 required readiness；六个 seed 明确 ready，生产 gate 不降级。原 browsing 矩阵修后 2 passed：[legacy](../../../.local/world-director-mvp/world-ui-legacy-workspace-final.log)。

原 W5 的完整导入链、预览权限/额度/范围、四分区语义三项已有相应证据并立即勾选，清单 **35/75**，75 项文字和顺序不变。分页、取消与冷恢复 UI、撤权/离线、完整键盘/主题/缩放，以及场景 SDK 全路径不冒充验收；剩余 W0/W2/W3/W4/W6 继续保持原范围。

完整 Web/GUI 回归和 doc-sync 的最后结果仍在收尾，需以其终态日志补记：[Web](../../../.local/world-director-mvp/world-ui-web-regression.log)、[GUI final](../../../.local/world-director-mvp/world-ui-gui-final.log)、[doc-sync](../../../.local/world-director-mvp/world-ui-doc-sync.log)。首轮 GUI 为 5327 passed、1 failed、1 skipped，失败仅新方法缺失的注册 test double，已补并 focused 2 passed；重跑结果未确认前不声称全范围通过。

本轮宽范围终态更新：`pnpm run test:gui --maxWorkers=2` 最终 **415 files passed、5328 tests passed、1 skipped**，见 [GUI final](../../../.local/world-director-mvp/world-ui-gui-final.log)；`pnpm run doc-sync` 最终 **29 passed、0 failed、0 skipped**，见 [doc-sync](../../../.local/world-director-mvp/world-ui-doc-sync.log)。所涉 lint 只余 store 两行行长，已拆行并通过 [store lint](../../../.local/world-director-mvp/world-ui-store-lint.log)。完整 Web suite 仍为确认存活的进程（首轮先报告旧 seed 的两项失败，随后对应改正后 focused 2 项通过），不是已经通过的全范围结论。

## 2026-10-10 有界后继规划与 W2 证据核对

提交状态：工作区未提交，基线 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。World driver 使用 Native 已持久的 prepared 决策计数，包含没有 accepted 计划的尝试；达到冻结 `maxPlansPerRequest` 后返回既有 `plan-budget`，不再打开规划窗口。原请求、Persona、计划 hash、关键 read-set 与 supersedes 链保留。Native 自身仍在上下文准备和计划接受处执行限额。该变更不增加持久字段或改变 journal 格式。

| 实际命令 | 结果与范围 | 原始输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-replanning.snapshot.ts --maxWorkers=1` | 源码 4 passed；公司/实验室 × JSON/SQLite，真实 Loader/Agent/三工具/Team；关键授权 revision 在预留前变化，三次真实规划共 12 model calls，原 case 三个 stale 后继；连续三次 budget 停止 revision/calls 不变；checkpoint 新进程恢复保持 paused，显式 running 后仍 plan-budget，0 model calls，无身份预留或入职 | [source](../../../.local/world-director-mvp/world-replanning-source.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation/tests/world.spec.ts --maxWorkers=1` | 2 files、187 passed；严格 world parser、真实 apply/reject、精确 Session 消费、未接受窗口取消、模板/Persona 与来源、业务去重、无关 revision 不 stale、关键 read-set stale、Native 三次上限及原子入职/取消关系 | [protocol](../../../.local/world-director-mvp/world-replanning-protocol.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec tsc -b tsconfig.host.json tsconfig.client.json` | Host/Client aggregate 通过 | [types](../../../.local/world-director-mvp/world-replanning-types.log) |

W0 第一原项沿用已通过 readiness/maintenance 与当前严格协议证据验收。W2 第 1、3、4、5、6 原项由当前 187 项回归及此前真实 `world-protocol.snapshot.ts`、F3 进程强杀证据验收。版本/来源从 plan.operationId → decision.context.view.versions/model/policy/sources 和原 world.sequence 的冻结定义重建，不新增冗余版本字段。W2 第 7 原项现有完整 stale 与有界后继综合证据，完成即勾选。清单由 35/75 更新为 42/75，仅改原项勾选。原文字/顺序对比 [before](../../../.local/world-director-mvp/checklist-before-replanning.txt)。

W2 第 2 原项仍需 world 私有通知的专门拒绝组合证据；W2 第 8 原项尚缺资料不足后新申请关联旧案的协议与路径。W4 的所有资源限额/公平/停止矩阵以及其余 W3/W5/W6 项均不据局部预算证据勾选。首次 lint 仅新增 else 分支缩进失败，原输出保留在 [lint first](../../../.local/world-director-mvp/world-replanning-lint.log)，修复后的检查、构建与分发证据待下文终态登记。全部临时后端、日志、proof、checkpoint 和编译输出在项目内，无真实付费模型调用。

## 2026-10-10 资料不足后的关联申请

工作区未提交，基线仍为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。可信 `openHireIntent()` 接受严格可选 `priorRequestId`；同请求者/组织/岗位的最新案件已因 insufficient-information 拒绝时，新 applicationId 必须关联该原案。引用缺失、外来、不存在、未结、取消或其他拒绝原因均拒绝；同一业务身份修改原引用也拒绝。Native journal/fold 和运行时不变量同时校验原身份与前案关系，旧申请精确重试先返回保留的原件。世界上下文通过原申请记录展示该关联，不重新生成历史 Persona。

当前 journal stream 为 **55**，JSON/SQLite 明确拒绝 54 及更早格式，通用 SQLite schema 与 Session format 不变。新约束不能将旧未关联历史默认为合法，所以不使用兼容默认值。

| 实际命令 | 完整结果 | 原始输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-resubmission.snapshot.ts --maxWorkers=1` | 源码 4 passed；公司/实验室 × JSON/SQLite：真实 Loader/Agent/三工具/Team/generic driver 从第一次资料不足拒绝、safe 通知到第二次关联申请、入职、新人独立首次行动；未关联申请在副作用前拒绝；2 requests/2 plans/1 hire，30 model calls；checkpoint 新进程恢复保留两原案与任职，paused，0 model calls。该场景不直接调用 executeOperation 或 hire executor | [source](../../../.local/world-director-mvp/world-resubmission-source.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts --maxWorkers=1` | 最终 4 files、253 passed；新关联 parser/Native 拒绝、严格 original retry/checkpoint restore，既有同事项换 decision 防重、occupied/reserved/Entity/历史身份容量、原子结果与 wake；两后端明确拒绝 stream 54 | [regression](../../../.local/world-director-mvp/world-resubmission-regression-final.log) |

W2 第 8 原项完整完成即勾选，清单 **43/75**。测试的初次旧申请断言误用创建时尚无 requestId 的投影，已改为接受请求后保留原件。初次扩展 unit 测试试图越过旧拒绝 wake 的调度先后，导致 outbox 尚未 ready；曾诊断为夹具额度，增加额度没有解决，已撤回额度变更和该不合适的调度片段。unit 专注前案准入/回放，完整调度/容量由真实 driver 与既有 reserve tests 各自验证。保留失败 [first](../../../.local/world-director-mvp/world-resubmission-tests.log)、[focused first](../../../.local/world-director-mvp/world-resubmission-focused.log)、[focused second](../../../.local/world-director-mvp/world-resubmission-focused-final.log)、[budget diagnosis](../../../.local/world-director-mvp/world-resubmission-focused-verified.log)、[scheduler](../../../.local/world-director-mvp/world-resubmission-focused-last.log)、[expanded first](../../../.local/world-director-mvp/world-resubmission-regression.log)。

本轮还补 world 私有请求的原 Envelope/正文/发送者/位置拒绝组合，验证尚在收口，不提前勾选 W2 第 2 项。构建/分发、最后 lint 与 doc-sync 的终态待后续表格登记。所有中间文件仍在项目内。

## W2 通知拒绝与本轮验证收口

W2 第 2 原项已完整勾选，checklist **44/75**，W0/W1/W2 所有原项有对应通过证据。工作包保持待验收：实现仍为未提交工作区，不将基线 SHA 冒充实现提交，也不宣布整个 MVP 完成。

| 实际命令 | 结果与范围 | 原始输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'private request input' --maxWorkers=1` | 10 passed、125 skipped；两后端真实已接受 world request 与实际 Channel Envelope；复制 requestId 无 hash、错误 hash、Envelope、sender、位置均拒绝，尚无持久收件事实时连决策都不开，director model calls 为 0；纠正后原 Envelope 可精确重试，只有 1 case/1 plan/3 director calls | [verified](../../../.local/world-director-mvp/world-delivery-negative-verified.log) |
| 上述命令改 `-t 'real Hub proof boundary'` | 4 passed、135 skipped；两后端 world 请求的原 operation correlation 或 recipient audience 在实际 Hub serializer/proof 重验中拒绝，实际 Channel 无 Envelope，Native 无 publication/delivery receipt、无计划 | [Hub proof](../../../.local/world-director-mvp/world-delivery-hub-proof.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'publication\|proof\|outbox\|transport\|exact current accepted intent\|publishes through direct v4\|publishes a dependent intent' --maxWorkers=1`（实际 shell filter 使用普通 `|` 字符） | 49 passed、340 skipped；标准通信复用相同 authority/dispatch，真实 future deliverAt 在到期前拒绝；原身份、recipient audience、正文、fingerprint、依赖与 publication/checkpoint 的十类证据篡改拒绝 | [proof](../../../.local/world-director-mvp/world-w2-communication-proof.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts --maxWorkers=1` | 4 files、263 passed；前案/请求拒绝/业务去重/read-set/有界规划/原子入职/取消/旧 stream 54 拒绝/checkpoint；最后新增 Hub proof 4 项另以上行验证 | [final regression](../../../.local/world-director-mvp/world-w2-final-regression.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm run build` | 完整 Host/Client/distribution/web build 通过，197 client artifacts | [build](../../../.local/world-director-mvp/world-resubmission-build-final.log) |
| build 后 `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-resubmission.snapshot.ts examples/simulation-company/tests/world-replanning.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts examples/simulation-company/tests/world-protocol.snapshot.ts --maxWorkers=1` | 分发 4 files、30 passed，stream 55；双场景/双后端的正常与维护中新暂停、后继预算、关联新申请、真实 private request/apply/reject 及 accepted/result 后 SIGKILL/new-process 恢复；冷模型调用为 0 | [built snapshots](../../../.local/world-director-mvp/world-w2-built-snapshots.log) |
| 所涉 Host/Client aggregate 与全部本轮代码 typed lint | 早轮 aggregate 与 lint 通过，最后新增 Hub proof 测试的检查单列在下一段 | [types](../../../.local/world-director-mvp/world-resubmission-types-final.log)、[lint](../../../.local/world-director-mvp/world-w2-lint.log) |
| 四组 `verify-translation-pairing --write`；`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm run doc-sync` | 双语 Native/definition/driver README 与 owning proposal 同步；完整文档 29 passed、0 failed、0 skipped | [pairing](../../../.local/world-director-mvp/world-resubmission-pairing.log)、[doc-sync](../../../.local/world-director-mvp/world-resubmission-doc-sync.log) |

通知负例首轮误断言只允许 Native WorldError，实际 Team 更早的 due-publication 准入已拒绝且没有决策记录，改为断言该真实拒绝点和零模型调用。第二轮 copied-request 的测试正文恰好复刻原规范 JSON，属于原内容正例；改为单独复制 requestId、缺失 hash 后全部 10 项通过。首次 build 指出测试夹具可空 wake 的 index 类型错误，将已发布和已收件夹具分开，保留原必需 wake 类型；未弱化 parser 或生产 gate。首次 model lint 只为 ternary 分支缩进，已修正。保留 [negative first](../../../.local/world-director-mvp/world-delivery-negative.log)、[copied canonical](../../../.local/world-director-mvp/world-delivery-negative-final.log)、[build first](../../../.local/world-director-mvp/world-resubmission-build.log)、[lint first](../../../.local/world-director-mvp/world-resubmission-lint-final.log)。

W3 故障矩阵/公平资源限额、W5 综合浏览器/SDK、真实模型试验/测量及 W6 全范围仍按原 checklist 继续；本轮未新增/删改/拆分验收条目，未提交或发布。

最后 Hub proof 测试的 Host/Client aggregate 通过：[types final](../../../.local/world-director-mvp/world-w2-types-final.log)。其最后 lint 的一处箭头括号已修正，修后通过：[lint verified](../../../.local/world-director-mvp/world-w2-last-lint-verified.log)。75 个原验收项与 [before](../../../.local/world-director-mvp/checklist-before-replanning.txt) 的文字/顺序完全一致，`git diff --check` 及本轮新文件/计划文件结尾换行、尾随空白检查通过。

## W3 F1/F2 强杀及既有完整证据核对

当前未提交工作区、stream 55。真实已认证产品 World owner 加入两个仅测试屏障：Native commitWindow 已接受原 request/标准通信展开、driver 尚未发送；真实 Team postChannelEnvelope 已写入原 Envelope、Native outbox receipt 尚未保存。每个屏障通过 IPC 报告后由父进程 SIGKILL；新进程通过原产品创建/query/restore 路径保持 paused，读取/恢复调用模型为 0，新的显式 running 管理命令才完成原责任。原 request 身份/description/hash/operation/通知依赖全部复用。F2 再核对 Native receipt 的 Envelope ID/Channel/sequence 等于强杀前实际外部提交物，实际 Channel 只有一份该 Envelope，最终一案/一计划/一入职。原请求不重复生成；恢复后剩余模型调用为 15。

| 实际命令 | 结果与范围 | 原始输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts -t 'request-' --maxWorkers=1` | 源码 8 passed、20 skipped；公司/实验室 × JSON/SQLite × F1/F2，真实原产品/Agent/三工具/Team 与子进程强杀/恢复 | [F1/F2 source](../../../.local/world-director-mvp/world-f1-f2-source.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-local/tests/task-execution.spec.ts --maxWorkers=1` | 3 files、68 passed；新窗口/writer 拒绝、旧窗口结算、未确认退休占用、IO 不占 Native 队列、preparing 任务/直接激活及恢复准入 | [admission](../../../.local/world-director-mvp/world-w3-admission-regression.log) |
| build 后 `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-hire.snapshot.ts -t 'commit-before\|commit-after\|reserve-before-prep' --maxWorkers=1`（实际 shell filter 使用普通 `|`） | 分发 6 passed、6 skipped；两后端预留/append 前/append 后 SIGKILL，第二及第三新进程核对原身份、Persona、Relation/ready/result/两个 wake 原子性，0 再生成。既有该文件完整源码/分发各 12 passed 证据与新 6 项共同收口 F5 | [F5 built](../../../.local/world-director-mvp/world-w3-f5-built.log) |

同时核对并勾选已有完整证据的 W3 原容量预留、维护停稳、Team active 与 ready 区分、维护后保留暂停四项，以及 checkpoint 全部引用一项。其基础证据来自上文 world 原协议回归与维护/强杀矩阵；本轮 `world-w2-built-snapshots.log` 的双场景/双后端 World driver 8 项再次验证维护中新暂停及新增人物完整 checkpoint 冷恢复，68 项验证不可绕过的准入。只有一项提交前重验仍未完成 Channel/岗位变化专门负例。

完成即勾选 F1/F2/F5 与上述五项，共 8 个完整原项，清单 **52/75**。F7 World 未确认退休强杀矩阵、F1–F8 总项、缺版本/跨所有者证据组合项仍未勾选。没有新增或改写 checklist 条目。F1/F2 新断言初次 typecheck/lint 指出 typed request interface 与 z.json 的投影断言不等价及成员分隔符，已改为解析记录与原请求/operation Branded ID；没有绕过类型检查。分发、最终 types/lint 结果待下文终态追加。

F1/F2 分发矩阵使用已满足 build 前置条件的 `CLOCKY_EXAMPLE_MODE=lib` 和上述相同 snapshot/filter，**8 passed、20 skipped**：[built](../../../.local/world-director-mvp/world-f1-f2-built.log)。最终 Host/Client aggregate 与该夹具 typed lint 通过：[types](../../../.local/world-director-mvp/world-f1-f2-types-final.log)、[lint](../../../.local/world-director-mvp/world-f1-f2-lint-final.log)。新增屏障只属于测试，不改生产运行逻辑。

### 提交前通道、岗位读项与实际时间

`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'current safe boundary|position capacity reads' --maxWorkers=1` 最终 **4 passed、139 skipped**，JSON/SQLite：[precommit](../../../.local/world-director-mvp/world-w3-precommit-verified.log)。

真实准备只完成 director 新通道时，Native commit 缺 requester 通道确认而拒绝，revision/Persona/preparing/result 均不变；修改原预留通道 membership 的重试也在原 owner 拒绝。完成全部原通道后，入职 Relation 和 WorldResult 使用当前模拟时间 7，而非此前计划时间 0。另一双后端场景在可用容量内创建一个新的真实任职关系，关键 assignment/capacity read-set 变化使原计划 stale，保持准备责任，不产生入职/结果。原岗位、授权与模板重验及满员拒绝另由已通过的 world 原回归覆盖。W3 提交前重验原项因此完整勾选，清单 **53/75**。

首轮缺通道用例拒绝文本实际为 `Simulation channel retry changed its membership or limits`，已改为断言该准确错误。首轮岗位用例在容量 1 中添加任职，Native 已在变更 append 前拒绝 occupied+reserved 超额；未放宽生产约束，改用容量 2 的场景证明合法新增任职造成计划 stale。该历史输出保留：[precommit first](../../../.local/world-director-mvp/world-w3-precommit-tests.log)。

最终 World 全文件回归 **143 passed**：[world final](../../../.local/world-director-mvp/world-w3-world-final.log)。加入 F1/F2 后完整分发产品 owner 矩阵 **28 passed**：[owner built](../../../.local/world-director-mvp/world-w3-owner-built-complete.log)。最新 Host/Client aggregate 与本轮新增/修改测试 typed lint 均通过：[types](../../../.local/world-director-mvp/world-w3-types-final.log)、[lint](../../../.local/world-director-mvp/world-w3-lint-final.log)。计划目录 323 个本地链接、结尾单一换行、尾随空白，以及 `git diff --check` 通过；清单仍为原 75 项，文字/顺序与本轮开始前完全一致，完成 53 项。

## F7 未确认退休、真实卸载与迟到回调（2026-10-10）

当前 stream 55，未提交工作区。`world-retirement-probe.ts` 包装真实 in-process provider 返回的原 handle；只有 accepted World hire 已 reserved 并进入维护后，其 dispose 在有界 10ms deadline 后返回 typed termination-unconfirmed，实际 handle 未被替换或虚构终止。controller 已撤销原 Native writer，但没有 Team quiescence 或 Native release，岗位/身份预留与 actor 占用保留。真实 Native writer 的迟到 open/submit，以及原 Agent 的 model submit 均拒绝，不改变 revision、不增加模型调用。卸载分支通过 Loader 已挂载的 Simulation Teams fiber.dispose；它只保持 pending 或失败，不能报告成功停稳，未确认 writer 仍占容量。父进程在该持久状态 SIGKILL。冷产品 restore 重验原 Session/Team/Native，依据旧协调进程已退出确认原 epoch released，0 occupied actors、paused、0 inference；显式 running 后才完成原 Persona/身份/一次入职及通知。

| 实际命令 | 结果与范围 | 输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts -t 'retirement-' --maxWorkers=1` | 首轮 8 passed、4 failed、28 skipped；两场景×两后端 timeout/late-callback 全部通过，unload 夹具读取 DisposableList 错误 | [source first](../../../.local/world-director-mvp/world-f7-source.log) |
| 相同命令改 `-t 'retirement-unload'`，采用隔离 Loader composition | 修正卸载后 4 passed、36 skipped；与上一行 8 项共同覆盖 12 个源码 F7 场景 | [source isolated](../../../.local/world-director-mvp/world-f7-unload-isolated.log) |
| 上述 retirement 全矩阵命令增加 `CLOCKY_EXAMPLE_MODE=lib`，已满足完整 build 前置条件 | 首轮 8 passed、4 failed、28 skipped；只有新隔离 composition 的 bare-module 分发解析失败 | [built first](../../../.local/world-director-mvp/world-f7-built.log) |
| 分发命令改 `-t 'retirement-unload'`，隔离 composition 链接项目 examples/node_modules | 4 passed、36 skipped，与上一行已通过的 timeout/late-callback 8 项共同覆盖 12 个分发 F7 场景 | [built verified](../../../.local/world-director-mvp/world-f7-unload-built-verified.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts examples/simulation-company/tests/world-hire-cleanup.snapshot.ts --maxWorkers=1` | 当前分发 24 passed；原 product cancel 的业务提交竞赛、真实 Participant/Channel/membership cleanup 强杀与原取消查询/新进程复用，0 再生成 | [F8 current](../../../.local/world-director-mvp/world-f8-built-current.log) |

卸载的 fiber.dispose 会使 Loader 写回 config disabled。初次错误地在共享 fixture 上卸载，造成下一个冷进程缺 simulationTeams；确认该文件此前干净且差异只有本测试的自动 id/disabled/格式改写后，精确恢复其原字节。没有保留共享配置变更。现在配置、原配置副本、manifest 与模块链接都在各 test root 的 composition/；冷进程显式安装同一原配置副本，不用最新模板修补历史。分发需 examples 模块目录链接，源模式 facade 的成功不能代替此声明。保留失败 [unload first](../../../.local/world-director-mvp/world-f7-unload-verified.log)，原共享配置备份在 [original](../../../.local/world-director-mvp/world-f7-shared-cordis-original.yml)。

F7 完整原项完成即勾选。F1/F2 8 项、F3/F4/F5/F6 完整 owner/hire 进程矩阵与 F8 当前 24 项共同覆盖全部故障位置及 JSON/SQLite，F1–F8 总原项也勾选。清单 **55/75**，未新增/拆分/改写原项。必需版本/跨日志证据损坏的产品恢复拒绝组合仍待收口。

## 原版本与新增人物跨日志恢复拒绝（2026-10-10）

当前 stream 55，未提交工作区。新 `world-recovery-admission.snapshot.ts` 每组先经真实原产品/Agent 完成一个运行和新增人物 checkpoint，再由独立冷进程逐一破坏实际读取的证据。仅在 test read boundary 注入错误，不预构造成功世界，也不补写缺失历史。compilerVersion 未知、generated runtime model version 缺失和获准 template version 缺失在行政日志重放 parser 拒绝，Native open 和模型调用为 0。checkpoint 所需 world 实现不匹配，以及实际 newcomer Channel、Session、原请求通知 Envelope 的证据缺失，在已认证原 restore 命令返回 restore-failed 和结构诊断；owner 保持 not-held，start 不允许，Native revision 不变、模型调用 0。原 Template/Persona 从未重生成。

`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-recovery-admission.snapshot.ts --maxWorkers=1`：**4 passed**，公司/实验室 × JSON/SQLite，每组 7 个独立缺证据/版本冷进程，共 28 个拒绝路径：[source](../../../.local/world-director-mvp/world-recovery-admission-source-final.log)。在已满足 build 前置条件后增加 `CLOCKY_EXAMPLE_MODE=lib`，同样 **4 passed / 28 paths**：[built](../../../.local/world-director-mvp/world-recovery-admission-built.log)。Host/Client aggregate 与 typed lint 通过：[types](../../../.local/world-director-mvp/world-recovery-admission-types-hook.log)、[lint](../../../.local/world-director-mvp/world-recovery-admission-lint-final.log)。

首轮启动探针通过独立 ctx.plugin 的 injection scope 挂不到实际日志 facility，因而没有注入损坏；曾错误推断为惰性加载。读取代码确认行政服务在初始化重放日志，现通过服务发布事件用 `ctx.get` 取得实际 facility，在任何行政初始化读之前安装受控读损坏。验证显式要求 changed=true、正确原 stream/record 被探测、没有 Native open 或 writable owner；不以“没有副作用”掩盖未命中探针。保留 [first](../../../.local/world-director-mvp/world-recovery-admission-source.log)、[lazy wrong assumption](../../../.local/world-director-mvp/world-recovery-admission-source-lazy.log)、[probe diagnostic](../../../.local/world-director-mvp/world-recovery-admission-probe.log)、[hook focused](../../../.local/world-director-mvp/world-recovery-admission-service-hook.log)。

W3 最后缺版本/跨所有者证据原项完成即勾选，清单 **56/75**。W3 全部原项有对应完整证据，工作包转待验收；与其他工作包一样，代码未提交和剩余 W4–W6 全体验收不被隐藏。所有中间文件、copy/link、日志和运行目录在项目内，共享 fixture 仍为原内容。

本轮最终 Host/Client aggregate、全部新增/修改夹具 typed lint 通过：[types final](../../../.local/world-director-mvp/world-recovery-final-types.log)、[lint final](../../../.local/world-director-mvp/world-recovery-final-lint.log)。提案最小双语状态更新及 pairing 后完整 `doc-sync` **29 passed、0 failed、0 skipped**：[doc-sync](../../../.local/world-director-mvp/world-recovery-final-doc-sync.log)。计划/新文件本地链接、尾随空白、单一末尾换行和 `git diff --check` 通过；共享 `examples/simulation-company/cordis.yml` 与本轮开始前原字节相同。

### W4 已确认的未完成实现

只读核对发现 driver.hire 将所有 `SIM_WORLD_LIMIT` 误报 position-capacity；同码实际还包括 Entity、历史 Participant、Channel 和完整 reservation 字节。应提供结构化限额分类，不能解析错误 prose 猜测。Native 已记录 `SIM_BUDGET_LIMIT/stalled` 后 Team 决策可能抛 without-submission，World pump 未保留该停止事实，产品 owner 把它覆盖为 driver-failed；context overflow/model queue/历史 activation 容量也需按实际事实分类。底层 fair dispatch 已有三窗口等待上界和冷重开证据，但 World 持续竞争的 actor 服务序列仍需真实矩阵。以上仅记录缺口，不提前勾选 W4 剩余三项。

## W4 精确限额与持久预算停止（2026-10-11，局部完整实现）

未提交工作区，Native stream 55；本部分没有新增持久结构。`SimulationWorldError` 的 limit 构造要求精确有限额度类别，`failure` 将 position/entities/participants/channels/bytes/requests/commands/plans 与诊断 prose 分开。原 code 与名字保留；Native 限额所有生产点显式提供类别。driver 不再把全部限额误报为岗位满员。Native 已记录 budget/context/microstep stall 后，真实 Agent 因准入失败未提交不会把事实覆盖为 driver-failed。转发 Team drive 结果仅选择 entityId/nextAttemptAt，避免外来 reason/steps/rounds 覆盖已分类结果。产品 cold control 从原 Native stall 观察停止；即使 phase paused，未解决的预算仍禁止 start。预算增加本身不继续运行。

Host/Product DTO、TS Client/runtime 共用 parser、Python 两层 stop parser 与 EN/ZH 既有 RunStatus 文案同步九个新增原因：entity-capacity、identity-capacity、channel-capacity、world-byte-limit、world-request-limit、world-command-limit、budget-limit、context-limit、microstep-limit。没有新增组件或更改视觉 token。

| 实际命令 | 结果与范围 | 原始输出 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-product/tests/control-schema.spec.ts packages/sdk/client/tests/simulation.spec.ts packages/client/ui-simulation/tests/run-status.client.spec.tsx --maxWorkers=1` | 初步 5 files、373 passed；严格分类、原拒绝/去重/入职/取消及新增两层 TS parser。之后 RunStatus 新增九标签的双语言断言由完整 GUI 覆盖 | [baseline](../../../.local/world-director-mvp/world-w4-stop-baseline.log) |
| 项目 `.venv` Python `pytest python/sdk/tests/test_simulation.py`，TMPDIR/pycache/cache_dir 均指定项目内 | 97 passed；control/operational 两层新增 stops 与未知值拒绝 | [Python](../../../.local/world-director-mvp/world-w4-stop-python.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-limits.snapshot.ts --maxWorkers=1` | 最终源码 16 passed；JSON/SQLite × 岗位/Entity/历史 Participant/Channel、director 第一次模型请求预算、新人首次行动预算、context、microstep。真实 Loader/Agent/三工具与持久日志；重复推进不增加 revision/calls，checkpoint 独立新进程保持 paused、0 calls，预算/事件未解决不能继续；取消旧 overflow 决策后新尝试仍受原 512 byte 限制且不推理 | [driver source](../../../.local/world-director-mvp/world-w4-limits-source-final.log) |
| 同配置 `examples/simulation-company/tests/world-product-limits.snapshot.ts` | 源码 10 passed；真实已认证产品 create/start/pause/checkpoint/restore/control/read/export，五类停止不变为 driver-failed；冷恢复原预算 stop 仍显示且 start disabled，调用拒绝、0 inference；浏览/导出/重复读不追加责任 | [product source](../../../.local/world-director-mvp/world-w4-product-limits-source-final.log) |
| 完整 build 后，`CLOCKY_EXAMPLE_MODE=lib` 执行上述两文件 | 分发 26 passed；原额度和原 Persona/业务事实、token/stop 责任在新进程保持 | [built](../../../.local/world-director-mvp/world-w4-stop-built.log) |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-workspace.snapshot.ts --maxWorkers=1` | 真实浏览器 8 passed；公司/实验室 × JSON/SQLite × 成功/预算。实际 HTTP/WS/三工具/产品 owner：预算场景只有 requester 3 calls，明确“运行预算已耗尽”，继续 disabled，刷新不推理。因 Browser plugin 未提供，使用既有 Playwright Web composition | [browser](../../../.local/world-director-mvp/world-w4-stop-browser.log) |
| 上述浏览器命令 `-t 'budget=true'` | 补充 4 passed、4 skipped；点击真实刷新后核对已用 45 / 10044，再采截图，避免把先前标记 stale 的 0 charge 作为当前数值证据 | [current budget](../../../.local/world-director-mvp/world-w4-stop-browser-current.log)；截图在 `.local/world-director-mvp/browser/*-budget/` |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm run test:gui --maxWorkers=2` | 415 files、5346 passed、1 skipped，无失败；现有 Slot 故意错误路径 stderr 不改变其通过结果 | [GUI](../../../.local/world-director-mvp/world-w4-stop-gui.log) |
| premium strict project audit | 0 errors/violations/warnings；不以静态审核替代浏览器运行 | [audit](../../../.local/world-director-mvp/world-w4-stop-premium-audit.json) |
| 完整 `pnpm run build` | 197 client artifacts；随后 Cordis 生成产物变化，已按变更输入再次构建，终态见后续登记 | [first build](../../../.local/world-director-mvp/world-w4-stop-build.log) |

初次 16 限额矩阵 12 passed、4 failed：context cold restore 已取消旧 overflow decision，Native 允许重新准备，但原额度仍阻止推理；修正测试不误断言所有 overflow 永久禁止新尝试。microstep 两项发现 result facts 将底层 reason 覆盖已分类值，已在生产 result 投影修复。产品首轮 10 failed 因 limit helper 使用独立 proof 文件，入口仍尝试读成功闭环 proof；隔离该测试分支后全部通过。首次 lint 只有 pump 回调括号，已修。原输出保留：[limits first](../../../.local/world-director-mvp/world-w4-limits-source.log)、[context/micro verified](../../../.local/world-director-mvp/world-w4-limits-context-microstep.log)、[product first](../../../.local/world-director-mvp/world-w4-product-limits-source.log)、[lint first](../../../.local/world-director-mvp/world-w4-limit-lint.log)。

W4 剩余三原项整体仍未完成：model-pool/历史 Activation 拒绝需在实际拒绝点持久结构原因，避免 LlmRuntime 归一化丢失类型；公平性还缺 World 持续竞争的服务序列；request/plan bytes 受模型工具拒绝后的综合停止责任仍待补。本部分不新增/拆分 checklist，也不拿已通过 26 项冒充全部资源矩阵，清单保持 **56/75**。推荐后续记录 execution/admission-blocked 并保存原 decision/epoch/Session 或 selection/Team 上限证据；pool 拒绝已消费输入，必须取消未 accepted 决策、归还 wake 并结束窗口，显式继续以新 input/decision 重验；不能尝试重新唤醒已 consumed 原输入或重置 planning attempt 上限。

上一限额批次最终证据：完整 build（Cordis 目录重生成后）197 artifacts、Host/Client aggregate 及 changed typed lint 通过；最终 `doc-sync` 29 passed、0 failed、0 skipped，Cordis product-catalog 4 passed。日志位于 `.local/world-director-mvp/world-w4-stop-build-final.log`、`world-w4-stop-types-final.log`、`world-w4-stop-lint-final-owner.log`、`world-w4-stop-doc-sync-final.log`、`world-w4-stop-catalog-tests.log`。本批次末 `git diff --check` 与原 75 项文字/顺序比较通过，已勾选仍为 56。

## W4 普通决策模型池拒绝与显式继续（2026-10-11）

工作区 stream 56，未提交。真实共享池满且队列满时，`SimulationModelCapacityExceeded` 携带原占用，不解析错误 prose。Team 在 LLM 规范化错误之前以当前 writer/epoch 保存严格 `decision/model-blocked`，包括已刷盘的 Session 请求位置。Native 同批次取消尚未提交的尝试、归还原 wake、关闭可结算窗口并记录 `SIM_MODEL_POOL_CAPACITY`；并发用户暂停保持 paused。精确重试不追加、异 payload/外来或退休 writer/已接受效果拒绝。旧决策与所有已用 token/规划尝试保留，新显式管理命令以新决策重试原 wake。释放许可、只读查询、导出和原管理命令重试都不启动调度。模型池当前占用供新的显式 start 重验，原 Native 停止作为历史保留，冷进程不复制旧 live permit。

checkpoint/可写 restore 共同重验原拒绝的 Session 前缀、精确 context-view/已消费 input、active turn 和 request/header；没有 Native consumption receipt 的首次拒绝也不能跳过跨所有者核验。真实夹具在 checkpoint 的实际 Session read 边界篡改原拒绝输入，验证失败并保留旧完成 checkpoint，再恢复真实读取完成新 checkpoint。两个后端拒绝 stream 55，通用 SQLite SCHEMA_VERSION 与 Session format 0 未变。Host/Client DTO、TS/Python control 与 operational parser、EN/ZH 运行标签同步 `model-pool-capacity`。

| 实际命令 | 结果 | 原始证据 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/model-admission.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-product/tests/context-readers.spec.ts --maxWorkers=1` | 33 passed；两后端所有权、原子 wake/窗口、并发暂停、退休/已接受拒绝、原 block 冷回放、旧 stream 拒绝及披露 owner 释放 | [Native cold](../../../.local/world-director-mvp/world-w4-pool-native-cold-final.log) |
| `... pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-model-pool.snapshot.ts examples/simulation-company/tests/world-product-model-pool.snapshot.ts --maxWorkers=1`，`CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1` | 首轮最终 16 passed，driver 8 + 产品 8：两场景 × 两后端 × director/新人；另一个真实 World Agent 的已计费 provider 流占住实际池，没有人为设置 active 数或替代目标调用；实际原请求初始 3/6 calls，拒绝路径未调用目标 provider；冷进入 0 calls，显式继续后 15/12 calls且仅一份入职 | [source](../../../.local/world-director-mvp/world-w4-pool-source-final.log) |
| 同配置仅 `world-product-model-pool.snapshot.ts`，新增 SIGKILL 开关矩阵 | 16 passed；产品 8 个正常 checkpoint + 8 个 Native 拒绝 append 后、回复返回前强杀。跨独立进程从原 initial checkpoint/suffix 恢复，0 自动推理，显式新命令结算原 wake；原 management 重试不重复效果 | [product crash source](../../../.local/world-director-mvp/world-w4-pool-product-crash-source.log) |
| 完整 build 后，增加 `CLOCKY_EXAMPLE_MODE=lib` 执行两个模型池文件 | 24 passed；driver 8 + 产品 16，含上述输入损坏拒绝、真实占流、SIGKILL、冷恢复及原命令复用 | [built](../../../.local/world-director-mvp/world-w4-pool-built.log) |
| Host/Client aggregate 与全部 changed typed lint | 通过；最终新增 IPC runner 的 null pipes / unknown tuple 类型修复后再验 | [types](../../../.local/world-director-mvp/world-w4-pool-types-complete.log)、[base lint](../../../.local/world-director-mvp/world-w4-pool-lint-final.log)、[evidence lint](../../../.local/world-director-mvp/world-w4-pool-evidence-lint-final.log)、[IPC lint](../../../.local/world-director-mvp/world-w4-pool-crash-lint-final.log) |
| 项目 `.venv` Python `pytest python/sdk/tests/test_simulation.py`；TMPDIR/pycache/cache_dir 均在项目内 | 98 passed，包括新增 stop、两层 parser 与未知停止原因拒绝 | [Python](../../../.local/world-director-mvp/world-w4-pool-python.log) |
| 完整 `pnpm run build`，在 Cordis 公共目录重新生成后 | 197 client artifacts；无缺失模块或声明错误 | [build final](../../../.local/world-director-mvp/world-w4-pool-build-final.log)、[catalog generated](../../../.local/world-director-mvp/world-w4-pool-catalog-generated.log) |
| `pnpm run doc-sync`，Cordis 目录重生成后 | 29 passed、0 failed、0 skipped；随后说明普通决策/辅助 compaction 的范围边界并更新证据，最终终态另登记 | [doc-sync](../../../.local/world-director-mvp/world-w4-pool-doc-sync-final.log) |

Native/Team/World/product、TS parser 与 UI 标签的扩展回归跑了 121 files / 2418 tests：2415 passed，3 failed。两项原任务冷命令重试在新增 World owner 类型检查处失去“先显式恢复”的诊断，已在缺 owner 时先返回明确恢复要求；第三项旧披露插件测试缺少新增 case registrar，已补完整注册/各自释放关系。完整两份任务文件 24 passed，披露/Native 冷集合 33 passed，不把首轮失败计作通过。日志：[broad](../../../.local/world-director-mvp/world-w4-pool-owning-tests.log)、[focused failure](../../../.local/world-director-mvp/world-w4-pool-task-failure-probe.log)、[task fixed](../../../.local/world-director-mvp/world-w4-pool-task-regression.log)。后续最终组合及原采购回归另登记。

复用了一个既有只读 auditor，没有新建 subagent；审查原子取消/归还、epoch、Session 前缀核验、并发暂停、实时容量与显式 command 重试，未发现可落实阻断问题。首次测试错用 bare Native open 的暂停语义、未使用 canonical Team owner、未正确选择测试名，均修正后重新验证；未命中的 probe 为 8 skipped，不算完成。保留各初次日志，不删除失败来隐藏记录。生成脚本实际为 `gen-cordis-catalog`；首次误用不存在的脚本失败也未计作通过。

本段只完成普通决策模型池的责任。辅助 compaction 拒绝、历史 Activation 容量、world tool 字节/请求拒绝的持久责任及持续竞争公平性仍未完整验证/实现；W4 三个综合原项仍未勾选。清单保持原 75 项文字和顺序，本段结束前仍为 56/75。所有运行目录、编译产物、缓存和日志在项目内。

### 原链路回归与时序快照修复（2026-10-11）

原采购、公司、窗口、消息 outbox admission 与 checkpoint restore 的五份 REAL-composition 文件：源码首次 85 passed / 1 failed，分发 86 passed。失败仅在 JSON、1 秒 timeout、submitted 后 SIGKILL：另一个旧决策可能先完成 timeout/unknown settlement，也可能由冷恢复以 writer-revoked/仍待核对 reservation 接管；两种路径保留相同未知责任与完整 token charge。源码单独复验两后端该点 2 passed；未扩大生产 deadline、抹除 token charge 或改写 Native 历史。旧快照把这场合法竞态固定为 writer-revoked + reserved，现仅该故障点在测试投影上先断言两种合法原取消原因、两个完整未知占用、六份已结算调用、20120 / 1000000 charge，再使用 interrupted-before-recovery/unresolved 归一化。其余请求、操作、资源、窗口与各项快照内容不变，仅两份对应快照更新。生产状态与 CLI 仍输出原始原因。

两组任务测试的后续组合 67 项中 65 passed、2 个大型真实流程超过 5 秒测试外层上限，未改代码或超时时间后独立重验同两项 2 passed。原 24 项完整任务文件此前通过；当前最后一份完整 review 文件复验结果另登记。保留失败输出，不用“环境问题”覆盖证据，也不改变 Native 的 deadline 行为。

日志：[原源码](../../../.local/world-director-mvp/world-w4-original-regression-source.log)、[原分发](../../../.local/world-director-mvp/world-w4-original-regression-built.log)、[submitted 无修改复验](../../../.local/world-director-mvp/world-w4-window-submitted-recheck.log)、[两份 snapshot 更新](../../../.local/world-director-mvp/world-w4-window-race-snapshot-update.log)、[归一化 typed lint](../../../.local/world-director-mvp/world-w4-window-race-lint.log)、[任务后续组合](../../../.local/world-director-mvp/world-w4-pool-postfix-tests.log)、[任务无修改独立复验](../../../.local/world-director-mvp/world-w4-task-serial-recheck.log)。完整窗口源码/分发在更新后另验。

最终原链路证据：五份原 REAL-composition 文件分发 **86 passed**；源码其余四文件 **64 passed**，完整窗口文件在竞态投影修复后 **22 passed**，覆盖同一 86 个原场景；更新后完整窗口分发再验 **22 passed**，两份新归一化 snapshot 均通过。最后完整 `task-review.spec.ts` **15 passed**（保持原 5 秒外层限制）；`task-control.spec.ts` 的 9 项已在先前完整组合通过，context/readers、Native replay、旧 stream/权限、model capacity 与 Cordis catalog 也有上述最终证据。原采购、消息 proof、身份、窗口与 checkpoint 原项达到完整退出条件即勾选，清单 **57/75**，原 75 项文本和顺序不变。

原命令：`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/window.snapshot.ts --maxWorkers=1`，[source 22](../../../.local/world-director-mvp/world-w4-window-source-final.log)；相同命令增加 `CLOCKY_EXAMPLE_MODE=lib`，[built 22](../../../.local/world-director-mvp/world-w4-window-built-final.log)。最后 `pnpm exec vitest run packages/simulation/simulation-product/tests/task-review.spec.ts --maxWorkers=1`，[review 15](../../../.local/world-director-mvp/world-w4-task-review-final.log)。最终 Host/Client aggregate [types](../../../.local/world-director-mvp/world-w4-final-types.log) 通过；最后模块/说明边界与证据更新前 `doc-sync` [29/0/0](../../../.local/world-director-mvp/world-w4-pool-doc-sync-complete.log)，本段及勾选之后的最终文档门禁另登记。`git diff --check`、新增关键文件的单末尾换行和 checklist 原文本/顺序检查通过。

最终勾选与实施证据更新后的完整 `doc-sync` **29 passed、0 failed、0 skipped**：[final](../../../.local/world-director-mvp/world-w4-final-doc-sync.log)。清单原文/顺序及 **57/75**、`git diff --check` 均再次验证。没有剩余本轮测试子进程，普通决策 pool 部分完成；其余原项仍按上述范围待开发，不宣布 MVP 完成。

## W4 辅助 compaction 和 Activation 历史准入（2026-10-11）

工作区未提交。stream 57 增加严格辅助 compaction 拒绝：保留规范 writer/epoch、Session、完整 request 指纹和原 compaction/start 位置，拒绝时不扣未分发 token；存在尚未提交决策则原子取消/归还 wake，关闭可结算窗口。checkpoint/可写恢复重验原请求指纹、provider/model 与 start，实际 Session 读取边界改动输入即拒绝 checkpoint。Controller 和 Agent 的真实 compaction/request/LLM 链路经过 Loader，并非预构造 Native 成功对象。

随后 stream 58 增加 Activation 历史拒绝，通用 SQLite SCHEMA_VERSION 与 Session format 0 保持。Core Team 严格 details 保留 TEAM_CHANNEL_BACKPRESSURE 与原 Team/cursor/used/limit/Participant/Activation/Session/reservation；Hub 为 pending，controller 仅完整 disposeUnpublishedStart 成功才 confirmed，任一清理失败为 unconfirmed。未知清理保留 writer revocation 和 startup 占用，不从 AggregateError 猜状态。Native 记录原 epoch 与冻结限额；原件重试不追加、异 payload/未知字段/pending 清理拒绝；新启动与 running phase 无法绕过保留的历史上限。冷恢复可对账旧未知责任但不增加容量或推理，必须新场景。

Simulation Team 从真实 Team readback 验证 attempted Activation 未 bind、原 reservation/Session、release 状态，再记录 Native。checkpoint/restore 重验原所有者历史和释放证据。Director 在 delivery placement 处遇上限时，原 Channel Envelope 已发布但还未交到 Session，尚无 fair ticket：测试保留精确原 Envelope/Native outbox/delivery 责任。新人在 fair selection 后遇上限，则保留原 reserved ticket/wake，不打开决策窗口。两条实际路径都没有生成模型调用或新的 raw handle 重试，不把 committed 入职误作新人已行动。

| 命令/真实操作 | 结果和范围 | 日志 |
| --- | --- | --- |
| Native compaction/model block 与 model-capacity owning tests | 19 passed；JSON/SQLite strict parser、精确 retry、原 wake、暂停、无 token/虚构决策、旧 epoch拒绝和 replay | [native](../../../.local/world-director-mvp/world-w4-aux-native-final.log) |
| 新辅助 compaction product REAL snapshot | 源码 16 passed；两场景 × 两后端 × director/新人 × 正常 checkpoint/Native append 后 SIGKILL，含实际请求输入改动拒绝 | [source](../../../.local/world-director-mvp/world-w4-aux-source-final.log) |
| build 后 CLOCKY_EXAMPLE_MODE=lib，auxiliary product + ordinary product pool + auxiliary retirement | 42 passed：16 辅助、16 普通、10 原退休/卸载责任；Native 老版本不被兼容接受 | [built](../../../.local/world-director-mvp/world-w4-aux-built.log) |
| compaction/model admission/token/history 与 Team lifecycle focused checks | 48 passed / 395 skipped，明确按行为筛选；不作为整文件 443 项通过 | [owning](../../../.local/world-director-mvp/world-w4-aux-owning-regression.log) |
| 三个 Team owning files | 42 passed；严格 details、confirmed/unconfirmed cleanup、frozen history保留 | [Team](../../../.local/world-director-mvp/activation-history-team-tests-verified.log) |
| Simulation Team actual history probe | 4 passed / 143 skipped；两后端 confirmed/unconfirmed、Native epoch/rsv/原事实 retry、pending/字段拒绝、0 新 raw start | [Native history](../../../.local/world-director-mvp/world-w4-activation-native-probe.log) |
| World/Native/public stop/SDK/labels owning files | 6 files、430 passed，无失败 | [owning 430](../../../.local/world-director-mvp/world-w4-activation-owning-tests.log) |
| Activation product REAL snapshot，当前源码 | 23 passed + 最后原缓存 fixture 单项 1 passed，覆盖同一 24 路径：两场景 × 两后端 × director/新人 × confirmed checkpoint/confirmed append-SIGKILL/unconfirmed observed-SIGKILL；冷进程保持 paused、0 models/raw starts，未知责任经原日志对账但不重启 | [source 23](../../../.local/world-director-mvp/world-w4-activation-source-final.log)、[settled 1](../../../.local/world-director-mvp/world-w4-activation-source-settled.log) |
| 最终 build 后，Activation + auxiliary snapshot 分发 | 2 files、40 passed，24 history + 16 auxiliary，覆盖当前 stream 58 和两类停止/恢复 | [built 40](../../../.local/world-director-mvp/world-w4-activation-built.log) |
| 两端新增 stop；项目 Python .venv pytest test_simulation.py，所有缓存/临时路径在项目内 | 99 passed；control/operational enum及未知原因拒绝同步 | [Python](../../../.local/world-director-mvp/world-w4-activation-python.log) |
| 最终 Host/Client aggregate 与 typed lint | 通过；最新字段、Actor lifecycle callbacks、冷 parser、UI标签、IPC stdout和所有新夹具 | [types](../../../.local/world-director-mvp/world-w4-activation-types-frozen.log)、[lint](../../../.local/world-director-mvp/world-w4-activation-lint-final.log)、[Team lint](../../../.local/world-director-mvp/activation-history-team-lint-final.log) |
| 完整 pnpm run build | 197 client artifacts | [build](../../../.local/world-director-mvp/world-w4-activation-build.log) |

实际 snapshot 命令均为 `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts <上述实际文件> --maxWorkers=1`；分发在声明 build 前置满足后增加 `CLOCKY_EXAMPLE_MODE=lib`。当前源码 history 最后一项定向使用 `-t 'json.*company.*director.*unknown=false crash=false'`，结果为 1 passed / 23 skipped，未把跳过项算作通过。

初轮 Native 四项失败是同步 parser 错误被测试错作 Promise rejection；修正断言后全过。辅助 product 首轮 14 passed / 2 failed，读取缓存版本测试把空消息替换成空消息而没有实际损坏，改为增加真实 Message 并断言命中；chunk.finish 错字段由 TS 校验捕获，改用标准 chunk.reason 后补齐 error/end/flush 断言。Activation 首轮 24 failed 是场景预检正确拒绝 maxActivations 1/2 小于初始 actor 数；未弱化编译器，改为 max 3/4 并在真实同一 product connection 中先做两次已确认激活/休眠，0 模型调用。下一轮 20 passed / 4 failed 是误假设 director placement 已有 fair ticket；按真实 driver delivery 路径保留原 Envelope 责任后，当前 23+1 路径全过。旧 worker 载入前的单项仍执行 receipt===undefined，原错误输出明确显示已保留的真实 Envelope，重验 current fixture通过，不按假定改产品行为。

辅助 doc-sync 初轮 28 passed / 1 failed（3 个新 export JSDoc缺说明/returns），已补完整。Activation doc-sync 初轮 28 passed / 1 failed（生成 config catalog source位置过期），已按 generator 重建并同步两语源位置、Pair hashes；最终文档结果随后登记。所有失败日志保留，未宣称首轮通过。

复用同一已有 subagent 完成 Team 独立边界（此前只读定位，后明确授权实现），没有增开 agent。Root 持续拥有 Native、World、产品、SDK、全局说明/清单及最终验证。W4 三个综合原项仍包含 bytes/请求/计划等限额拒绝责任和持续公平性的未完成部分，因此不勾选部分条目。清单仍为 57/75，未新增、删除或改写原条目。日志、raw运行目录、缓存及编译产物全部在本项目内。

本轮全部所有权说明、双语对应、生成目录与证据更新后的最终 `doc-sync` **29 passed、0 failed、0 skipped**：[final](../../../.local/world-director-mvp/world-w4-final-boundaries-doc-sync.log)。配置源位置已按实际 EN 生成目录同步到 ZH 后配对。`git diff --check` 和原 checklist 75 项文本/顺序、57 勾选检查通过；未新增项或提前勾选 W4 综合项。剩余 bytes/请求/规划拒绝责任、公平轮转和 W5/W6 完整门禁继续推进，未宣布 MVP 完成。

## W4 世界提交拒绝、Envelope 字节与持续公平性（2026-10-11）

工作区未提交，Native stream 59；JSON/SQLite 拒绝 58，通用 SQLite SCHEMA_VERSION 与 Session format 0 不变。`decision/world-blocked` 只接受 Native 在原已消费、未提交决策的实际提交边界产生的请求/计划 bytes、requests/plans 或 request/resolve authority 拒绝；同事务取消原决策、归还 wake，并关闭可结算窗口。保存严格 proposal hash，超限原文留在已刷盘 Session，不把它复制进 Native 或放宽原字节限额。精确同正文重试重现原拒绝且不追加；异正文拒绝。checkpoint/restore 验证原 turn 成功 stage 和后续 submit 的精确正文 hash；篡改实际 Session 读取即拒绝，保留旧完成 checkpoint。已接受效果、普通结果/首次行动可修正工具错误不能被转换成此永久停止。

Core/Hub 的明确 Envelope 字节拒绝保留原 Team/cursor/channel/sender/key、完整 draft hash 和完整 UTF-8 bytes/limit，仅在 append 前且先按 sender/key 核对已写原件后产生。Team transport 只消费精确匹配的直接严格错误；丢回复、异 cursor 或 IO failure 保留未知责任。driver 在本批次 actor 执行后立即检查，不能等下次 pump 才显示拒绝。产品 `message-byte-limit` 优先于旧 idle cache，冷恢复和暂停仍禁用启动；Host/Client/TS/Python 严格 stop parser 与双语 RunStatus 同步。

| 实际命令或路径 | 结果与边界 | 日志 |
| --- | --- | --- |
| `TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/run.spec.ts --maxWorkers=1` | 172 passed；完整 world 修正、拒绝与精确重试/旧版本拒绝。最初过宽 authority 把可修正结果工具错误当停止，收窄到 request/resolve 后全过 | [owning](../../../.local/world-director-mvp/world-w4-submission-idempotency.log) |
| 同 TMPDIR、`CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-submission-limits.snapshot.ts --maxWorkers=1` | 源码 24 passed：两场景 × 两后端 × request-bytes/plan-bytes/authority × checkpoint/append 后 SIGKILL。实际三工具和 Session 损坏拒绝；原 3/6 calls、冷 0、原事实/预算保持，暂停不能绕过 | [source](../../../.local/world-director-mvp/world-w4-submission-source-evidence.log) |
| 相同 snapshot 配置 `world-message-bytes.snapshot.ts` | 源码 8 passed：两场景 × 两后端 × director 普通消息/新人首次行动。实际 21/12 calls，post 1 attempt、0 Envelope，无 outcome-unknown；原入职仍 committed，冷 0，无自动重试 | [source](../../../.local/world-director-mvp/world-w4-envelope-source-verified.log) |
| 相同配置 `world-fairness.snapshot.ts` | 源码 4 passed：两场景 × 两后端；director/普通成员各 12 次服务，24 次共 72 调用，加原完整链 18 = 90。真实 Native ticket/selection 的等待、服务间隔和批次 ≤2；逐次持久 wake 生成有限工作，不代替 actor 推理。真实维护 draining 下重复推进保持 maintenance-blocked 且 revision/calls 不变；完成保持 paused，显式运行后竞争；最终重复 idle 与冷 paused 0 calls | [source](../../../.local/world-director-mvp/world-w4-fairness-maintenance-source.log) |
| 项目内 Python `.venv`，`PYTHONPYCACHEPREFIX="$PWD/.local/world-director-mvp/pycache" python/sdk/.venv/bin/python -m pytest python/sdk/tests/test_simulation.py -o cache_dir="$PWD/.local/world-director-mvp/pytest-cache"` | 100 passed；control 与 operational 两层 stop 和未知值拒绝 | [Python](../../../.local/world-director-mvp/world-w4-byte-python.log) |

公平夹具首轮错用 result.steps（真实字段 controlSteps），修正后 4 passed；再加入真实 maintenance 后当前 4 passed。Envelope 夹具首轮假设错误模型数和 Channel 字段，按实际 21/12 calls、channelReservation.spec.members 修正；最后批次仍显示 idle 的真实产品问题已在生产 driver/observer 修复后验证。新 transport 证据测试首次错误使用 Team snapshot/draft 字段及 TeamError constructor，类型检查与断言捕获；仅修夹具后重验，失败输出保留。首个构建同样被这三个类型错误阻止，不算通过。配对命令初次传额外 `--` 被 CLI 拒绝，改用实际 `pnpm run verify-translation-pairing --write <pairs>` 后完成。没有用失败、跳过或源码检查冒充分发通过。

资源综合原项仍有三个缺口：实际业务申请历史总数、director delivery/newborn selection 的不可驱逐 resident/未知 writer 占用、World 普通消息到原重试限额并显式授予原件续试。既有 Native/采购测试不能替代这些 World consumer 路径；此综合项继续未勾选。停止原因综合项和 W5/W6 的完整验收继续保留原范围。最终分发、公平原项勾选及文档结果在下一段登记。

当前 owning 最终结果：Core/Hub/public stop/TS SDK/双语 RunStatus 的五份文件在首次组合中全部通过（共 239 项）；Team 完整 lifecycle 修正后 **393 passed**，包含四个 exact/异 fingerprint/异 Channel/untyped 拒绝路径。[初次组合（631 passed/1 failed）](../../../.local/world-director-mvp/world-w4-byte-owning-final.log)、[四项修正](../../../.local/world-director-mvp/world-w4-byte-evidence-corrected.log)、[完整 Team](../../../.local/world-director-mvp/world-w4-byte-lifecycle-final.log)。最后 JsonObject 类型检查另指出可选 idempotencyKey 不可包含 undefined；夹具明确断言接受的 Simulation post 必有原 key 后，Host/Client aggregate [最终类型检查](../../../.local/world-director-mvp/world-w4-byte-types-final.log) 通过，changed-owner [typed lint](../../../.local/world-director-mvp/world-w4-byte-fair-lint-final.log) 与新增四项 [typed lint](../../../.local/world-director-mvp/world-w4-byte-evidence-lint-verified.log) 通过。前两次 build 和首次 doc-sync 被夹具类型错误阻止，最终完整 [build](../../../.local/world-director-mvp/world-w4-byte-fair-build-verified.log) **197 artifacts**、[doc-sync](../../../.local/world-director-mvp/world-w4-byte-fair-doc-sync-verified.log) **29 passed、0 failed、0 skipped**。源码/分发尚未联合确认前不勾选公平原项。

最终分发验证：满足上述完整 build 前置后，`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-submission-limits.snapshot.ts examples/simulation-company/tests/world-message-bytes.snapshot.ts examples/simulation-company/tests/world-fairness.snapshot.ts --maxWorkers=1` **3 files、36 passed**（24 + 8 + 4）：[built](../../../.local/world-director-mvp/world-w4-byte-fair-built.log)。当前 frozen stream 59、所有新 parser/跨 owner 证据、冷 paused 0 calls 和有限批次竞争均在分发链上通过。真实公平四项与已有实际预算/Native冷停止矩阵覆盖 W4 第二综合原项全部范围，达到退出条件后立即勾选，清单 **58/75**。其余 W4 两综合项仍未勾选；只复用已有 subagent 实现独立 request-count 产品验证，不增开 agent。全部中间文件、日志、运行目录与 build 产物在项目内，未提交或发布。

最后勾选和本段证据更新后的 `doc-sync` **29 passed、0 failed、0 skipped**：[complete](../../../.local/world-director-mvp/world-w4-byte-fair-doc-sync-complete.log)。同最早保留的 `checklist-before-f7.txt` 比较时去除勾选标记，原 75 项文本和顺序完全一致，58 勾选，`git diff --check` 通过。首次比较误把已去标记的 `checklist-before-driver.txt` 当完整 Markdown，断言未通过；随后选择完整基准做实际比较通过，不改 checklist 来迎合脚本。

### 请求历史总数与 World 原消息重试（2026-10-11）

复用已有 subagent 新增完全独立 request-count 入口和 snapshot，root 阅读验证全部所有权断言，未给 director/新人新增 requester 权限。真实产品编译冻结 maxRequests=1、岗位 capacity=3；初始任职 1 + 真入职 1 后仍有 1 空位。原 can-hire Relation、ready/canonical requester 和有效期均当前合法。原案 committed 后，在实际 Native 管理入口精确重试原 application 不计额，新合法 application 明确 SIM_WORLD_LIMIT / requests；revision、所有 intent/operation/event/wake/binding/Channel Envelope 不变。原 create/start 精确重试也不启动调度。真实产品 checkpoint/新进程恢复核对原世界与通信事实，18 原模型调用、冷 0。[source](../../../.local/world-director-mvp/world-request-count-source.log) **4 passed**（两场景 × 两后端）。所有暂存/缓存/进程数据在项目内；分发结果后续登记。

Root 新增 World 原消息重试夹具：director 的普通消息和新人的真实首次行动经 Agent 三工具/独立 Session 提交，在实际 Team post 后故意丢回复，原 frozen outboxMaxAttempts 次都按同 key 读回同一真实 Envelope，然后停止 outcome-unknown，Native 尚无 receipt。浏览/重复control 不增 revision 或模型；checkpoint/冷进程保持原 unknown operation/世界和 paused、0 自动推理。原件未知阻止 start，只有可信 Native exact grant 和随后明确产品 running 命令才续试一次；原 action/fingerprint/id/Envelope 保持，一条 target Envelope、原 grant 精确重试不追加。没有用预构造 receipt 或绕过 transport 成功对象。

首次源码 **8 failed**：原运行已经真实耗尽并正确保留责任，但冷控制把 Native unknown 误显示为笼统 stalled。修复 World driver 的 Native outbox stall 投影与 product 冷观察，从 retained operation 派生 outcome-unknown、优先于旧 cache。[first](../../../.local/world-director-mvp/world-w4-outbox-source.log)。当前源码 **8 passed**：[source final](../../../.local/world-director-mvp/world-w4-outbox-source-final.log)。最初单项 probe 正则未覆盖测试名引号，仅 8 skipped，未算完成；实际执行全文件后取得上述结果。Host/Client aggregate [types](../../../.local/world-director-mvp/world-w4-outbox-types-final.log) 与所有 changed-owner [typed lint](../../../.local/world-director-mvp/world-w4-outbox-count-lint-final.log) 通过。该真实 consumer 问题未通过修改夹具断言去掩盖，未改 Native 责任或自动放开重试。

当前完成证据：`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/operation-retry.spec.ts packages/simulation/simulation-world/tests/driver.spec.ts --maxWorkers=1` 实际命中 **2 files、14 passed**，第三个拟用 driver.spec 不存在，没有算作通过：[owning](../../../.local/world-director-mvp/world-w4-outbox-owner-tests.log)。World 新生产停止投影在上述实际 REAL matrix 验证。最后完整 [build](../../../.local/world-director-mvp/world-w4-outbox-build.log) **197 artifacts** 后，`CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1` 同 snapshot 配置运行 `world-outbox-retry.snapshot.ts` + `world-request-count.snapshot.ts` **2 files、12 passed**：[built](../../../.local/world-director-mvp/world-w4-outbox-count-built.log)，包含原 grant/新明确管理命令与原 Envelope id 复用。Native 59 没有新增格式变更；最近 [doc-sync](../../../.local/world-director-mvp/world-w4-outbox-count-doc-sync.log) **29 passed、0 failed、0 skipped**。请求总数与消息重试 consumer 缺口现已完成，限额综合项剩余 resident/未释放 writer 的目标角色阻塞证据；复用同一已有 agent 独立补该路径。清单仍 **58/75**，不得把综合项拆开勾选。

上述范围说明/计划和证据更新后的最终 `doc-sync` **29 passed、0 failed、0 skipped**：[complete](../../../.local/world-director-mvp/world-w4-outbox-count-doc-sync-complete.log)。原 75 项文字与顺序、58 勾选和 `git diff --check` 再验通过。最新 root snapshot/build/docgate 已全部结束；同一 subagent 的 resident 独立工作继续，尚不计作验收证据。

## W4 resident 准入及完整限额验收（2026-10-11）

继续复用同一已有 subagent，仅拥有两个独立 `world-resident-capacity-*` 夹具。Root 阅读真实 provider/controller、Native writer/actor residency 和 Team hibernation 契约后实现生产修复。Native stream 59 与 Session/SQLite 格式未变化。仅直接带类型的 provider unconfirmed termination，且原候选 writer 仍是相同 revoked epoch，才返回 recovery-required；一般错误、未撤销 epoch 的伪 typed refusal 和权限/cancel 变化仍拒绝。满额时非 active 或无本地 actor 的未释放 writer 需要恢复，正常 busy/open-decision actor 仍不可驱逐并返回 capacity。结果指出阻塞 epoch 的 owner，原收费保持，重复准入不做退休 IO 或新 activation。三类拒绝路径及原 hibernation/residency owning 行为 [focused](../../../.local/world-director-mvp/world-w4-resident-owning-probe.log) **17 passed / 379 skipped**，后续完整生命周期和双语控制 [owning](../../../.local/world-director-mvp/world-w4-resident-owning-final.log) **2 files、455 passed**（396 + 当时 59 RunStatus）。

真实产品夹具冻结 maxResidentActors=1。Director 在原 requester 的已接受请求和已写原 Envelope 后，delivery placement 腾位失败：原 requester writer revoked 仍收费，尚无 director Session 收件/fair ticket，3 原模型调用、目标 0。新人在真实原子入职/维护完成后，同一 canonical connection 激活 director（0 推理），旧 director 停止未确认阻塞 reserved newcomer fair selection：原 committed、ticket/wake 保留，6 原模型调用、新人 0。重复原 ensureResident 3 次返回明确 recovery，revision/calls/raw startup 不变；Native reserveWriter 也因实际收费满额拒绝。SIGKILL 后新进程首先只读 inspect 仍核对旧 revoked epoch/used=1，显式认证 restore 按原 owner 对账后 release 同 epoch，charged=0、paused、0 models/raw starts，原世界/operations/selection 不变。

原 baseline [failed](../../../.local/world-director-mvp/world-resident-capacity-failed-baseline.log) 是真实产品 driver-failed；Root 修复狭窄分类后初始 8 首进程均达到 waiting/recovery，冷夹具误以为只读 inspect 会创建 held owner而失败：[first](../../../.local/world-director-mvp/world-resident-capacity-source.log)。按实际 read-only owner契约改测试，不放开生产收费，最终源码 [source](../../../.local/world-director-mvp/world-resident-capacity-source-verified.log) **8 passed**；子任务 types/lint的两个字段和格式问题保留日志，修正后全部类型/typed lint通过。没有预造 target 成功对象或更改真实 ensureResident 回值。

满足最新完整 [build](../../../.local/world-director-mvp/world-w4-resident-w5-build-verified.log) **197 artifacts** 前置后，`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-resident-capacity.snapshot.ts examples/simulation-company/tests/world-case-pagination.snapshot.ts --maxWorkers=1` **2 files、12 passed**（resident 8 + 下段分页 4）：[built](../../../.local/world-director-mvp/world-w4-resident-w5-built.log)。Host/Client aggregate [types](../../../.local/world-director-mvp/world-w4-resident-w5-types-verified.log) 和 owning [typed lint](../../../.local/world-director-mvp/world-w4-resident-w5-lint-verified.log) 通过；README 两语配对及最近 [doc-sync](../../../.local/world-director-mvp/world-w4-resident-w5-doc-sync.log) **29 passed、0 failed、0 skipped**。之后新增停止展示断言 [RunStatus](../../../.local/world-director-mvp/world-w4-stop-presentation-final.log) **67 passed**，补 director/newborn recovery、普通 residency capacity、未知 outbox 的两语言实际组件渲染，不把 committed 当 received。

原资源综合项所有类别的先前证据和本轮补足路径范围如下：ordinary/auxiliary shared pool 及 token 在真实 director/新人的消费点拒绝并保持原 Session/预算；Entity/Participant/Channel 上限、历史 Activation 的 confirmed/unconfirmed cleanup 均真实阻止准备/激活；resident/旧未释放 writer 现有上述目标 0 准入证据；请求历史 maxRequests 原已闭案继续计费、准确同件复用，新合法申请不能绕；maxPlans 原 unaccepted/stale/accepted 后继均不能绕；world request/plan完整字节与普通完整 Envelope bytes 两类实际拒绝；World 原消息 outbox retry 耗尽/原 key明确grant/冷续试；microstep 在真实Driver及产品停止。角色只走原许可职责：director不伪造requester、新人不伪造resolve。没有将不适用操作当成功额度路径。

停止综合项的 idle/fair maintenance 来自真实双场景/双后端 driver；budget/context/microstep 有真实产品与浏览器预算停止；容量和authority来自实际拒绝点的结构事实；unknown 来自真实target已写/回复丢失与provider未确认停止；各项重复观测/冷 paused 0推理、无 revision busy loop。本轮分发和额外双语组件证据达到两个剩余 W4 原综合项全部范围后立即勾选，清单 **60/75**，W4 全部原项完成。仍未宣布 MVP 完成；W5/W6 尚待完整验收，原 checklist 项数和文字不变。

## W5 两案分页、披露与真实浏览器修复（2026-10-11）

新增独立 `world-case-pagination-scenario.ts` + snapshot，复用真实 Loader/产品配置与 scripted external model。原定义预检冻结 capacity=4、maxRequests=8；第一案真实入职后，同一许可 requester 经原 Native administrative intent/wake 入口提出第二应用，完整三工具/独立 newcomer 走第二入职。两案各 18、共36个模型请求。暂停时 limit=1 真分页，共2页、不重不漏；query/filter/expectedRevision错误拒绝；一个新的明确 paused management 命令使Native revision实际推进，使用新正确 expectedRevision 的旧cursor仍被拒绝，首页刷新恢复。此新管理动作是明确测试命令，不是浏览/刷新隐藏执行。正文/Persona初始全 withheld，只授第一案的 case域时仅第一案rationale allowed、第一案Persona与第二案两域均 withheld；policy generation 变化也拒旧cursor。grant撤销后立即withheld。所有读取和原create/start精确重试都不改变业务/通信事实或模型计数，原两案、操作、绑定与Envelope通过真实checkpoint/冷进程核对，冷0调用。

初轮 [source](../../../.local/world-director-mvp/world-w5-case-pagination-source.log) 4 failed：Native openHireIntent不隐式发wake，正确保持18calls；夹具加原可信显式persisted wake后 [source wake](../../../.local/world-director-mvp/world-w5-case-pagination-source-wake.log) 4 passed。补真实revision变化后初轮 cold重复同managementId，没有新revision，原件幂等契约正确；改用明确cold新命令后 [source final](../../../.local/world-director-mvp/world-w5-case-pagination-source-final.log) **4 passed**。满足最新build后，和resident同run的 [built](../../../.local/world-director-mvp/world-w4-resident-w5-built.log) 中分页 **4 passed**。源码/分发均有原两案全链与cold读证据，没有预构造已成功业务替代执行。

Client/UI原 [23 passed](../../../.local/world-director-mvp/world-w5-case-pagination-client.log) 只能证明组件传参数与runtime独立读取，不能证明组合起来真翻页。新真实 browser/HTTP/WS/model/两持久后端测试导入含两初始请求的定义，pageSize=1；首轮 [browser](../../../.local/world-director-mvp/world-w5-case-pagination-browser.log) **4 failed**：真实next请求包含expectedRevision，runtime误把它并入选择scope，而WorldCases按run/filter选择，返回成功但UI空窗。Root修生产listWorldCases显示选择，仅run/status组成scope；cursor/limit/revision仍原样转发服务器约束。新增实际runtime二页响应回归确认API fence原样、选择scope保持及页面2替换原窗口。[client fixed](../../../.local/world-director-mvp/world-w5-case-pagination-client-fixed.log) **24 passed**，没有降低浏览器可见second-case断言。Browser plugin不提供，按已应用frontend-testing-debugging技能使用仓库Playwright真实scaffold；目标流为导入JSON/预检/暂停创建/明确start/两真实入职/暂停/World案件首页→下一页→返回首页→分权限详情→刷新及窄屏。

第一新增browserfixture错误用了Playwright-test专用expect matcher（当前Vitest没有），且漏了仓库Host/compiler face登记；Types/build捕获undefined matcher及越rootDir引用。换成仓库waitFor/isVisible/poll方式，并在apps/web client排除、tsconfig.host明确加入，保持单一compiler face。所有失败输出保留；之后 [types](../../../.local/world-director-mvp/world-w4-resident-w5-types-verified.log)、[owning lint](../../../.local/world-director-mvp/world-w4-resident-w5-lint-verified.log) 通过。Client scope修复后的 [types](../../../.local/world-director-mvp/world-w5-case-pagination-types-fixed.log) 与 [typed lint](../../../.local/world-director-mvp/world-w5-case-pagination-client-lint.log) 通过。最终修复build/browser及勾选结果在后段登记，不以先前UI mock冒充真实翻页。

Client scope修复后最终完整 [build](../../../.local/world-director-mvp/world-w5-case-pagination-build-fixed.log) **197 artifacts**；随后 `TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-cases-pagination.snapshot.ts --maxWorkers=1` **4 passed**：[browser fixed](../../../.local/world-director-mvp/world-w5-case-pagination-browser-fixed.log)。实际两场景×两后端、JSON导入初始2申请、原唯一create、36模型请求、独立新人、paused、pageSize1；网页可见case1→case2且case1按钮退出DOM，实际HTTP query保留原snapshotRevision和limit1，Native revision/calls不增加，返回首页/四分区private withheld/刷新/390窄屏+reducedMotion均通过，console pageErrors为空。原截图与proof保留在 `.local/world-director-mvp/browser/{json,sqlite}-{company,laboratory}-case-pages/world-*/`，包含 `01-case-page-two.png`、`01-notification.png`、`02-narrow.png` 与 query实际参数。不是直接绘制或mock出来的产品成功。

最新范围说明/清单勾选前 [doc-sync](../../../.local/world-director-mvp/world-w4-resident-w5-doc-sync-fixed.log) **29 passed、0 failed、0 skipped**。上述产品分页/冷进程、授权域与实际UI组合完成W5案件列表原项全部范围后立即勾选，清单 **61/75**；其他W5项没有因本项通过提前勾选，原75条文字/顺序保持。本轮仍未提交/发布，也没有把MVP标完成。最后note当前状态和证据更新后的文档结果另登记。

当前note/计划/61项勾选和全部证据更新后的最终 `doc-sync` **29 passed、0 failed、0 skipped**：[complete](../../../.local/world-director-mvp/world-w4-resident-w5-doc-sync-complete.log)。原75项文本/顺序与61勾选、`git diff --check`、新增分页文件单末尾换行均复验通过。Root实看真实第二页桌面与390窄屏截图，分页行/私有通知元数据清晰、无框架错误遮罩；未据此提前勾选全产品主题/键盘/GIF项。Root当前snapshot/build/docgate全部已结束，同一复用agent空闲；剩余W5/W6继续，目标保持active。

## W5 原命令查询、状态与两端 SDK 完整入口（2026-10-11）

Root 修复查询先于重试：`SimulationAdministrationRuntime` 对 unknown/notFound=false 原件不再次 send，必须先 lookup；not-found 仍保留未知责任，但允许原 key/payload 精确续试；found恢复原回执，终态不变。CommandRecord 在未知查询前不提供重试，两语提示同契约。Typed originals、权限退休、并发提交及严格world回执身份检查保持；未分配替代命令。首轮旧测试两项依赖未查询直接续发，改为先查not-found/通过query发现AUTH_INVALID后，[Runtime/UI owning](../../../.local/world-director-mvp/world-w5-query-first-tests-fixed.log) **85 passed**，新增UI query-first断言。Root还修复顶部Refresh缺失cases分支：重新读取当前run/status列表及已选section，两个读取独立、不启动运行。[Workspace/Case/Command](../../../.local/world-director-mvp/world-w5-case-refresh-tests-final.log) **48 passed**；旧一项假query不更新store而仍期待retry，按实际notFound状态补UI步骤，不撤销query-first约束。

真实取消浏览器：公司/实验室 × JSON/SQLite，6模型调用到原plan accepted、reserve之前；明确用户pause，确认取消实际双击仅一原command，真正HTTPserver接受后以浏览器AbortSignal deadline250ms与路由真实响应延迟400ms产生未知结果，非预构造success。等待pending结束后unknown可见、查询前retry不存在；查原回执后显示cancelled、无reservation/新人，不发送第二命令。刷新与shared browser context第二tab保持paused、原owner/open计数和calls不变。[cancel source](../../../.local/world-director-mvp/world-w5-case-actions-browser.log) **4 passed**。首轮错误文案定位、过早把pending的unknown当完成、浏览器newPage单页context不能添第二page均保留日志；改显式context和等待实际未知，unrouteAll wait排空callback，未忽略未处理rejection。

真实状态browser以scripted外部model提交reject（Native接受真实plan/result/reason）或scene capacity=1导致真实满额；maintenance在真实prepareWorldHire之后、IO之前暂停持有原preparing reservation，没有提前run资格。初始paused空窗口0model，Native变化明确显示stale；原顶部刷新缺失导致此旧窗口无法更新，修生产连接后真实刷新显示新case。拒绝有“信息不足；请提交新的申请”，容量有“岗位容量已占满”和disabled start，准备中有“正在准备身份，尚不能运行”、paused且无committedresult；invalid JSON失败在副作用前说明修正方式。上述12state + 4取消合并 [browser](../../../.local/world-director-mvp/world-w5-case-states-actions-browser.log) **2 files、16 passed**，Reload不引入calls、第二owner或命令。未知结果另有真实cancel HTTP及此前World outbox/pool/provider stop browser/public/UI证据。Browser plugin缺席，沿用仓库Playwright；代码变更按React与frontend-testing-debugging技能验证，所有scaffold/图像/日志在项目内。完整source/字节预算/fair/cold结果不被本窄浏览器矩阵替代。停止状态/原因/下一步原项完成后勾选。

SDK审计发现真实缺口：Host已有World preflight/create/prepare/export，而SDK此前仅有company对应方法与World case/control。同一已复用agent补TS protocol/server/client/API四方法与Python严格World DTO/同名snake方法；TS复用Host/parser owning facade，避免双份规范。另补未知必需Session event拒绝，unknown ignorable:true保留raw通知、typed transcript省略，不强cast为已知event。Core known vocabulary及ignorable只能true、protected context-view/channel-view不可忽略的实际契约已核对。World DTO/API/standalone parser通过严格unknown字段/stop/事件测试。

| 实际检查 | 结果与范围 | 日志 |
| --- | --- | --- |
| owning TS SDK world/simulation + server simulation | 3 files、161 passed | [owning](../../../.local/world-director-mvp/world-sdk-owning-tests-final.log) |
| SDK server world routing/parser | 4 passed | [server](../../../.local/world-director-mvp/world-sdk-server-world-tests.log) |
| Python scenario/world_cases/simulation `.venv` pytest，cache均repo | 113 passed | [Python](../../../.local/world-director-mvp/world-sdk-python-tests.log) |
| typed Session/context/compaction旧corpus行为筛选 | 68 passed、54 skipped，不把跳过计通过 | [old events](../../../.local/world-director-mvp/world-sdk-existing-event-regression.log) |
| TS stdio REAL world，two scenes×two backends | source4 passed | [TS source](../../../.local/world-director-mvp/world-sdk-ts-source.log) |
| Python stdio REAL world，同矩阵 | source4 passed | [Python source](../../../.local/world-director-mvp/world-sdk-python-source-guards.log) |
| 正式SDK wheel build，no-deps install到repo .local目录 | 实际路径校验；非source PYTHONPATH冒充分发 | [wheel](../../../.local/world-director-mvp/world-sdk-wheel-build.log)、[install](../../../.local/world-director-mvp/world-sdk-wheel-install.log) |
| 最新Root完整197-artifact build后，TS plain Node直接import lib/index.js + built jsonrpc-bin，Pythoninstalled wheel实际imports | 2files、8 passed；real18初始calls、cold新进程0；preflight/create/prepare/export、四case sections、already-committed原取消、control/checkpoint/restore/retry原commands；unknown stop/必需event拒绝，ignorable raw保留/typed省略 | [distribution](../../../.local/world-director-mvp/world-sdk-distribution-guards.log) |

实际snapshot命令：`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/sdk-world.snapshot.ts`、对应` sdk-world-python.snapshot.ts`，`--maxWorkers=1`。分发增加`CLOCKY_EXAMPLE_MODE=lib SDK_WORLD_INSTALLED="$PWD/.local/world-director-mvp/sdk-wheel-installed"`并组合两文件；前置最新 [fullbuild](../../../.local/world-director-mvp/world-w5-sdk-actions-build.log) **197 artifacts**与[Host/Client types](../../../.local/world-director-mvp/world-w5-sdk-states-types-final.log)。wheel实际命令 `UV_CACHE_DIR="$PWD/.local/world-director-mvp/uv-cache" python/sdk/.venv/bin/python scripts/build-python-release.py --package sdk --output-dir .local/world-director-mvp/sdk-wheels`；`uv pip install --python python/sdk/.venv/bin/python --no-deps --target .local/world-director-mvp/sdk-wheel-installed .local/world-director-mvp/sdk-wheels/clocky_sdk-0.1.1rc2-py3-none-any.whl`，TMPDIR均repo。Source build/include前置未被跳过，不使用Vitest package facade测试TS compiled client。四组SDK README双语配对、changed typedlint通过。

SDK首次缺Clocky.launch、observer未显式inject、用了不存在的Agent turn-end event，均由真实test/静态检查捕获后修正；改监听实际session/event并原子保存计数，保留原fail日志。两个原SDK项的全面协议/产物/过程恢复范围达到后立即勾选，加上述状态项，清单 **64/75**，不新增/改写原75条。HTTP创建deadline另在单独补真实浏览器原payload/双击/refresh/第二tab，暂停/取消/冷恢复综合项及其他W5/W6未提前勾。W6真实模型路由当前缺配置（无根.env与测试provider env），已一次异步询问，可独立工作继续，不将任务blocked或MVP完成。

HTTP创建额外真实浏览器矩阵达到原项全部范围：`TMPDIR="$PWD/.local/world-director-mvp/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-create-timeout.snapshot.ts --maxWorkers=1` [first full](../../../.local/world-director-mvp/world-w5-create-timeout-browser.log) **4 passed**，随后新增真正create doubleclick、输入未变化后 [final](../../../.local/world-director-mvp/world-w5-create-timeout-doubleclick.log) **4 passed**。两场景×两后端：真实Host已accept的World creation回复在250ms client deadline退休；UI pending结束后的unknown与先query无retry明确可见。原实际JSONpayload包含完整原definition+preflight+commandId，记录的唯一请求/定义和输入完全相同；等Native初始checkpoint完成后只query原件、openRegistered暂停run，不start、0models。Doubleclick仅一原创建HTTP，refresh和shared第二tab维持原opens/revision/0calls，未分配新owner/身份。原profile/quota/bootstrap通过实际端到端，不用预造success。截图/原accepted response/完整原payload（无密钥）留在项目 `.local/world-director-mvp/browser/{backend}-{scenario}-create-timeout/world-*/`。首次probe在accepted转completed的异步变化中重复点已经卸载的Query按钮，改为等待Native准备后一次原query，不把本来终态隐藏查询改为“需要重复写”。

最新含SDK和全部Root UI生产变更的完整 [build](../../../.local/world-director-mvp/world-w5-sdk-browser-build-final.log) **197 artifacts**；Host/Client [types](../../../.local/world-director-mvp/world-w5-sdk-browser-types-complete.log) 通过，query/action/state [typed lint](../../../.local/world-director-mvp/world-w5-actions-states-lint-final.log) 除老workspace fixture两长行外已通过，该文件两行仅换行修复后 [final](../../../.local/world-director-mvp/world-w5-case-refresh-lint-final.log) 通过；创建新fixture [lint](../../../.local/world-director-mvp/world-w5-create-timeout-lint.log) 通过。局部Client/Web builds只是独立浏览器验证前置，未冒充完整SDK/build，最终整体已按实际变更完成。原HTTP commandId/payload/查询先于续试和双击/refresh/第二tab范围齐全后立即勾选，清单 **65/75**；原75项无增删。W5剩余三综合项及W6继续，不能标记MVP完成。

最后65项勾选、当前note/两语README/SDK及证据更新后的 `doc-sync` **29 passed、0 failed、0 skipped**：[final](../../../.local/world-director-mvp/world-w5-sdk-browser-doc-sync.log)。原75条内容/顺序与65勾选、`git diff --check`通过。根代理查看拒绝和实际preparing/paused的真实桌面图，未把plan accepted当入职，也未显示隐藏rationale。当前root与复用agent测试子进程全部已结束；SDK/UI/日志/cache/wheel/build均在项目内，无commit/发布，MVP目标仍active。

额外视觉复核发现未完成的暂停路径问题：rejected图的案件/result/reason真实正确，但用户在后继普通director decision的observe与stage之间pause，provider调用总数10，Native保留open window3后产品把下一模型准入拒绝标driver-failed。这不满足未勾选的“用户暂停/取消/冷恢复”综合项，因此该项继续未勾，不把16state通过冒充暂停收口。已复用同agent承担Team模型准入/原writer取消/归还wake/可结算window的窄修复与确定性Agent验证；Root继续拥有World/product/UI适配，禁止泛catch所有paused错误或放开paused新推理。全部已勾项范围仍按上段限定，不宣称MVP完整。

### W5 真实撤权与断网观察（66/75）

`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-case-privacy.snapshot.ts`：4 项通过，公司/实验室 × JSON/SQLite。每项先真实执行两次申请、36 次 Agent 模型调用，再暂停；单独授权原计划理由与原 Persona。捕获权限仍有效时服务器已组装的计划响应，撤销后 metadata watch 清除旧正文并退休在途读取；放行旧响应也不能重显。断网后保留原案件 metadata，显示读取失败与“有更新 · 刷新核对”，恢复连接后敏感内容仍 withheld。所有只读操作不改 Native revision、不增加模型调用。

原始日志：`.local/world-director-mvp/world-w5-case-privacy-matrix.log`；截图、原始迟到响应及 proof：`.local/world-director-mvp/browser/{backend}-{scenario}-case-privacy/world-*/`。初次测试等待短于配置的两秒观察间隔；按真实 timer 设置十秒上限后完成撤权验证，无产品逻辑改动。初次断网断言使用不存在的文案，已改为实际中文反馈与过期标签。所有失败日志保留。该原项完整勾选，暂停/冷恢复与全面交互检查仍待完成。

### W5 流中暂停、原取消、冷加载与显式恢复（67/75）

Native journal stream 60 新增严格 `decision/paused`。`SimulationDecisionPausedError` 只表示同 writer 当前 prepared 未接受模型决策因已记录暂停而拒绝继续推理；Team 仅在直接 typed error、同 decisionId 且 Native 已确认 paused cancellation 后结束推理。保留原 token 已知/未知计费，归还原 wake，原子关闭可结算窗口。真正 provider、退休 writer、确定性及已接受工作失败不改标暂停。公共 DTO 和 Python parser 同步 `paused`，JSON/SQLite 拒绝 stream 59；通用 SQLite 和 Session format 未改。

`pnpm exec vitest run packages/simulation/simulation-local/tests/pause.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-team/tests/pause-admission.spec.ts packages/client/ui-simulation/tests/object-details.client.spec.tsx`：4 files、67 passed，日志 `world-w5-pause-owning-final.log`。Team lifecycle 9 项、暂停准入12项和窄 lint 由复用同一 worker 验证。Python test_simulation 101 项通过（此前 SDK 全套113项；数字不可混同）。

`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-cold-recovery.snapshot.ts`：4 passed，公司/实验室 × JSON/SQLite。真实 provider 首个成功 observe stream 在 finish 前受控等待，通过用户按钮记录 pause；完成后只有原 observe 一次调用、一个 paused cancellation、零申请。用户显式继续后完成原 Session/Agent/三工具闭环，总计18次模型调用，保留已完成 observe。完整检查点经原命令查询完成；独立 Loader 从保留根重新载入，浏览/刷新/定义文件导出0次新增模型调用、0次 writable open；显式恢复取得1个原 owner、保持 paused、原 World 人物/计划/身份/结果相等。此浏览器测试为同进程冷 Loader；前述 source/distribution SIGKILL 新进程测试独立拥有进程边界证据。

日志 `world-w5-cold-browser-matrix.log`；截图、原定义文件与 proof 在 `.local/world-director-mvp/browser/{backend}-{scenario}-cold-browser/world-*/`。`world-w5-pause-cancel-browser-final.log` 4 passed，重验原取消/HTTP未知查询与双击/刷新/第二tab。`world-w5-pause-rejection-browser-final.log` 4 passed，拒绝后暂停窗口关闭，页面未误标 driver-failed。完整 build 197 artifacts 通过（`world-w5-pause-build.log`）；后续只改 test fixture 与注释。初轮失败日志均保留：未查询异步原命令终态、错误期待重复 observe 第19调用、把 fixture 全局历史18次当成冷新增调用；按实际产品行为修正断言，未改宽产品保证。该原项完整勾选，不追加 checklist items。

### W5 键盘、主题、窄屏与减少动效（68/75）

`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-workspace.snapshot.ts -t budget=false`：4 passed/4 budget tests未选择（预算证据另有原完整8项）。公司/实验室 × JSON/SQLite，每项真实18次 Agent 模型调用；导入对话框 Tab/Shift-Tab 不越出，Enter 打开导入/案件并切换四分区；重载后窄屏以键盘关闭 inspector，原 visible case row 恢复焦点。导入预览与真实通知详情分别捕获浅/深 ×1440/390px，全页无水平溢出，减少动效时 workspace 无 running animation。

修复两个实际界面边界：冷页面首次 policy observation 可退休在途案件列表读取，列表必须随初始/替换 readVersion 重读，不能只重读私有详情；直接 URL/刷新后没有旧按钮 ref，关闭详情从当前表定位精确原 request row 恢复焦点。Native revision 更新不自动重置分页。定向 Client/UI25项通过（`world-w5-case-read-focus-units.log`），两级 client/web build通过。日志 `world-w5-ui-a11y-matrix-final.log`；每项 screenshots 与 proof 在 `.local/world-director-mvp/browser/{backend}-{scenario}-happy/world-*/`。已人工查看公司浅色desktop详情、深色窄屏预览及关闭后带焦点原行，正文/身份折行、预览scroll与操作均可读；其余同矩阵图片已生成。遵循 `.design-rules/SKILL.md` 的 accessibility/dark-mode/layout/keyboards/motion 适用规则。初轮不存在文案“关闭”的断言已按实际“返回集合”修正；此前空列表/焦点失败和中止矩阵日志均保留。

本任务没有创建 GUI PR，条件性的 PR GIF 交付尚不适用；未来创建 GUI PR 时仍必须遵循 record-browser-gif，使用该 PR 的真实 server/API/model flow。本次不提供 fixture GIF 作为真实模型证据。原 checklist 范围、顺序与75项数量不变，W5已完整勾选；W6仍待收口。

### W6 原始冷读取/恢复、历史量与占用（69/75）

`TMPDIR="$PWD/.local/world-director-mvp/tmp" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-cold-recovery.snapshot.ts`，`world-w6-cold-measurements-materialized.log`：4 passed。原始 `measurements.json` 在四组冷浏览器根，汇总含原文件绝对路径、SHA256、基线commit与原始样本：`.local/world-director-mvp/measurements-summary.json`。Apple M4 Pro、12逻辑CPU、24GiB、macOS arm64、Node25.9.0，Native stream60，scripted provider/version1，每项18次调用。每项历史量：6 entities、4 channels、7 decisions、5 operations、4 bound Sessions（3 materialized、1 unmaterialized）、248 Session events、53 durable surface events、3 published posts。后者是持久消息产生事件数，不冒称当前派生消息数。原驻留 chargedActors2；恢复后原始population另保存。

| 场景/backend | 冷Loader ms | 冷浏览 ms | 显式恢复 ms | 完整checkpoint ms |
|---|---:|---:|---:|---:|
| company/json | 119.52 | 311.33 | 173.06 | 2117.24 |
| company/sqlite | 122.30 | 325.05 | 117.36 | 1145.85 |
| laboratory/json | 120.23 | 321.23 | 166.14 | 2090.71 |
| laboratory/sqlite | 129.94 | 356.79 | 162.96 | 1147.09 |

计时为 performance.now 单调毫秒。Loader含Web composition；browse含浏览器加载/渲染；恢复/checkpoint含真实用户HTTP与原命令查询，因此不是纯Native算法耗时。保存了受控provider等待、test Host process RSS/heap及系统硬件；测试进程RSS含Vitest/browser客户端与模块缓存，不能当actor内存。样本不是清空OS缓存或独立进程启动性能，不据此制定SLO、宣称大规模或无限运行。前述独立进程 crash recovery仍只证明正确性。先前测量将仅驻留Session当总历史、试读未实体化Observer日志的错误已按权威 materialization/readFrom修正；失败日志保留。真实模型等待/usage仍由未完成真实样本项拥有。该原测量项完整勾选。

### W6 文档与范围收口（71/75）

复用同一 worker 只读审计 Scene/Product/Native/World/Team、公开DTO、Python parser 和 owner/invariant调用关系，未发现绕开扩展点的实现缺口。Root修正其指出的两项文档错误：simulation 子系统双语曾错误称case UI/产品驱动/入职编排待实现；提案顶部曾称W0进行中和使用旧stream进度。现状摘要改为当前工作区W0–W5验收、Native stream60、W6综合门禁/真实样本尚待完成，并引用原checklist/evidence。提案仍proposed，未伪称发布或实现治理/离职/真实外部世界效果。开发计划W5使用自身规定的“已验收”状态，W6表同步GUI/测量事实。

包README/Model Experience/API和generated catalogs按此前实际变更维护，Native/Team/UI的暂停、冷读取、权限及焦点契约同步双语。场景编译器README明确定义导出不等于运行备份，Native完整checkpoint另有原恢复合同；World/三工具将计划受理、任职、发布、持久收件、首次行动分开。Root按dsh-doc-site-sync只改canonical docs/subsystems/simulation.md/.zh.md，没有改变manifest/路由或发布网站。`pnpm run verify-translation-pairing --write docs/subsystems/simulation.md .agents/notes/proposed/feature/2026-10-08-world-director-mvp.md`后，`pnpm run doc-sync` **29 passed/0 failed/0 skipped**（`world-w6-doc-sync-status-verified.log`），涵盖双语、文档类型、links/graphs/catalog/model-experience和site投影/build。这两原项完整勾选。

临时artifact根 `.local/` 加入Git忽略，不改位置或删除任何文件；所有cache/wheel/浏览器图片/JSON测量/log/编译输出仍在项目中。SDK fresh wheel实际重装到本地target，`world-w6-installed-pause-guard.log`证明导入来自该已安装wheel，paused DTO可读且未知取消原因拒绝。完整Python SDK owning测试278 passed（`world-w6-python-sdk-owning.log`），与前述专门Simulation101项及更小选集113项区分。其余整合gates运行中，未据此勾选整合或MVP全部完成项。

### W6 严格输入与所有权不变量（72/75）

同一worker的独立只读审计确认 Scenario schema/compiler、Product world-schema/world-creation、Native world/journal、公开DTO与两端SDK的严格输入与拒绝路径，无绕过公开Native/Team能力的编排。stream60 `decision/paused` strict record在fold重验同current prepared未接受模型slot/epoch/ready/entity revision/paused，published projection校验取消后的context/operations/closedAt关系。commit/reopen和simulation/committed invariant都调用；新增Native10项拒绝坏record、running伪取消和不合格accepted/deterministic/unprepared slot，Team12项仅承认direct typed同id且Native确认，真实provider/旧writer错误保持失败。Python owning DTO未知取消原因拒绝，fresh installed-wheel同guard通过。

`pnpm run verify-built-package-invariants` 269 compiled companions通过plain Node Loader检查（`world-w6-built-invariants.log`）；完整owning选集实际301files/5063tests（`world-w6-owning-units.log`）初轮5054passed、9failed：8为旧UI unknown直接retry断言，1为重CPU运行下5秒company-task超时。修正六文件后87passed（`world-ui-query-first-owning-verified.log`），公司任务整文件15passed（`world-w6-company-tasks-recheck.log`），没有加大deadline、改产品guard或隐藏失败。新增World RPC使离线Fixture闭合switch不穷尽，现显式七方法unavailable拒绝、不伪造World成功；fixture整文件33passed（`world-w6-connection-fixture-owning.log`）。源码四snapshot文件76passed（`world-w6-source-snapshots.log`）、plain Node compiled TS/installed Python wheel两文件8passed（`world-w6-sdk-distribution-final.log`）保留实际session/private channels/original commands/paused恢复证据。该原项完整勾选；综合gate总项仍等最后lint/build/types。

全仓typed lint首次高并发持续约9CPU，已中止保留exit143日志后用CLOCKY_OXLINT_THREADS=2重跑。发现3:24已误emit到source树的108个未追踪生成文件；source-output门禁指出92个source树违规。按同basename TS源及source maps验证100个完整quartet、8个残余生成文件，全部搬到`.local/world-director-mvp/stray-emit-archive/`，原路径/mtime/SHA256保存于`stray-emit-archive-manifest.json`，未删除或修改source/lib，也未推测历史writer。`world-w6-source-outputs-verified.log`现0违规。剩余records-view test一行长度203已仅折行；最终全仓lint/build/types尚在运行。

### W6 最终本地门禁收口（73/75）

| 实际命令 | 结果 | 原始日志（.local/world-director-mvp/） |
|---|---|---|
| pnpm exec vitest run packages/simulation packages/core/team packages/team/team-activation-controller packages/client/runtime packages/client/ui-simulation packages/host/apiproxy packages/sdk/client packages/sdk/server --maxWorkers=2 | 301files/5063tests；初轮5054通过/9失败；失败六UI files修正后87全过、公司任务15全过，294其余files输入未改，不重跑已通过部分 | world-w6-owning-units.log；world-ui-query-first-owning-verified.log；world-w6-company-tasks-recheck.log |
| pnpm exec vitest run packages/client/connection/tests/fixture.client.spec.ts | 33 passed；七World方法明确离线unavailable，无伪造成功 | world-w6-connection-fixture-owning.log |
| Python SDK pytest全目录（cache/pycache均repo） | 278 passed | world-w6-python-sdk-owning.log |
| CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/sdk-world.snapshot.ts examples/simulation-company/tests/sdk-world-python.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts examples/simulation-company/tests/world-product.snapshot.ts --maxWorkers=1 | 4files、76 passed，真实source/两场景/两后端/原身份进程恢复 | world-w6-source-snapshots.log |
| CLOCKY_EXAMPLE_MODE=lib SDK_WORLD_INSTALLED=$PWD/.local/world-director-mvp/sdk-wheel-installed 对应两SDK snapshot文件 | 2files、8 passed；plain Node编译TS及已安装fresh Python wheel | world-w6-sdk-distribution-final.log |
| pnpm run build（Fixture最后变更后） | exit0、197 client artifacts | world-w6-final-fixture-build.log |
| pnpm exec tsc -b tsconfig.host.json tsconfig.client.json | exit0 | world-w6-final-fixture-types.log |
| CLOCKY_OXLINT_THREADS=2 pnpm run lint:contracts-ready | 全仓typed lint exit0；Source生成文件已归档，不通过排除产品源隐藏错误 | world-w6-lint-verified.log |
| pnpm run doc-sync（双语现状修正后） | 29 passed、0 failed、0 skipped | world-w6-doc-sync-status-verified.log |
| pnpm run verify-source-outputs；pnpm run verify-built-package-invariants（最后build后） | 0 source违规；269 compiled companions plain Node Loader通过 | world-w6-final-source-outputs.log；world-w6-final-built-invariants.log |
| git diff --check；原checklist正文/顺序比较 | exit0；原75项完全相同，仅勾选73项 | 本地命令及checklist-before-f7.txt比较 |

所有gate的TMPDIR在repo，Python UV/pytest/pycache/wheel、snapshot根、浏览器图片、测量、编译输出和归档均在repo。Full lint初轮被资源中止及生成产物/穷尽switch/line-length失败日志保留，最后exit0；未调低规则或延长测试deadline。修正的UI tests保留unknown起点，先同canonical key查notFound，随后exact原payload重试，later draft和一次retain继续验证。

唯一外部前提仍是可用真实模型路由：根.env和相关provider/local env未配置；127.0.0.1:1234、11434、8080的/v1/models只读检查均连接拒绝，没有执行真实模型。此前已请求用户提供provider/model或本地兼容URL/model，尚未收到。真实模型样本项和依赖全部必需证据的MVP最终完成项仍不勾选，提案保持proposed，不宣布MVP完成。

### 最后现状核对：提案摘要修正与模型路由阻塞

上一轮自动替换只匹配了不存在的加粗status行，没有命中真实`### 实施状态`正文，因此其“现状摘要已修正”记录有误。本轮直接以真实heading/结论边界重写EN/ZH正文，移除W0进行中、stream58、SDK/UI/pool/fairness未完成的陈旧摘要，明确W0–W5已验收、当前73/75、Native60及仅真实样本/最终接受未完成。原正文保存于`.local/world-director-mvp/proposal-status-before-correction.{md,zh.md}`。双语pairing重新记录后，`pnpm run doc-sync`29passed/0failed/0skipped（`world-final-proposal-status-doc-sync.log`）；`git diff --check`通过，原75项正文/顺序完全保留。没有运行新模型或勾选剩余两项。

前一次目标轮完成了大量实现/验收，属于progress；本轮也修正了权威提案文本，属于progress。真实模型路由缺失在此前记录异步询问的目标轮、上一目标轮与本轮连续出现，未收到provider/model或本地URL/model。重新读取当前环境：无根.env、provider/local模型配置；常用本地1234/11434/8080的/v1/models再次连接拒绝。所有可独立完成的工作和门禁已完成，剩余真实样本需要外部路由/用户配置，不以keyless结果替代真实试验。MVP最终完成项依赖该证据，因此目标不能标记complete。

### 2026-10-11 审查缺陷复验与修复

此前“W0–W5 已验收”指原 checklist 对应项的既有验证，不足以代表统一最终验收。本次将提案与开发计划统一为“已实现、对应项已有证据、待最终统一验收”，保留上方历史实施记录和原 75 项 checklist 的正文、顺序及 73/75 勾选状态。真实模型样本与最终 MVP 验收仍未完成，未提交或发布本次实现。

纯空白 `metadata.description` 的旧复现通过 JSON/SQLite 两后端再次确认：预检成功、原创建接受、随后 Team objective 校验失败。编译器现按 Team 的 trim 判定返回字段诊断，但保留合法描述原文与 hash/导出语义；产品测试确认拒绝先于命令、运行、Team、Session 或模型分配。预留身份前失效的计划现允许剩余额度内显式新 start，原 start 重试、维护责任及 plan-budget 仍受原约束。World 创建在串行原命令查询之后复核预检，明确的 `SIMULATION_PRODUCT_PREFLIGHT_CHANGED`（RPC `simulation-product-preflight-changed`）让 Client 保留 `notAccepted` 原件并允许新建意图重新预检；普通 invalid、传输失败或 not-found 不作为未受理证据。

| 本次验证范围 | 已观察结果 | 证据 |
|---|---|---|
| 原空白描述复现，修复前 | JSON/SQLite 2 项确认缺陷 | `.local/world-audit-20261011/core-blank.spec.ts`；本次执行输出 |
| compiler、world-description、world-administration 聚焦回归 | 3 文件 71 项通过；随后错误码断言更新纳入下行复验 | 本次执行输出 |
| 产品、Host、Client 与 SDK 的创建预检及拒绝错误回归 | 5 文件 103 项通过 | `.local/world-fixes-20261011/preflight-focused.log` |
| Client/UI 预检变化恢复 | 2 文件 27 项通过 | `.local/world-fixes-20261011/ui-focused.log` |
| 失效计划显式重规划与原命令约束 | 6 项通过，实际产品快照 4 项通过 | 本次 owner 回归与快照执行输出 |
| `pnpm run test:gui -- --maxWorkers=2` | 实际覆盖 packages/client 与 packages/host，415 文件、5367 通过、1 跳过；分隔符使并发参数未生效，不据此声称限制了并发 | `.local/world-fixes-20261011/gui-tests.log` |
| `pnpm run build` | 通过，记录 197 个 Client 产物 | `.local/world-fixes-20261011/build.log` |
| strict premium UI 审计 | 0 findings | `.local/world-fixes-20261011/premium-audit.json` |
| JSON/SQLite、1440/390 宽度实际浏览器恢复 | 4 项通过；重新预检后唯一暂停运行、0 模型调用 | `.local/world-audit-20261011/world-preflight-recovery-verified.log` |

补充复验：`CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner-replanning.snapshot.ts --maxWorkers=1` 的分发路径 4 项通过（`.local/world-fixes-20261011/replanning-built.log`）。真实浏览器新回归补入纯空白描述的字段诊断与零分配，再运行 `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-preflight-recovery.snapshot.ts`，两后端/两宽度 4 项通过（`browser-preflight-final.log`）；原创建超时与 World workspace 两文件 12 项通过（`browser-regressions.log`），结果未知时仍保留查询后原件重试。后两日志均位于 `.local/world-fixes-20261011/`。

编译器、产品、Host、Client/UI、SDK 和新浏览器测试的定向 lint 已通过，初轮格式/测试类型问题及浏览器回调括号问题的失败日志保留，最终见 `.local/world-fixes-20261011/lint-fixed.log`、`browser-lint-verified.log`。`pnpm exec tsc -b tsconfig.host.json tsconfig.client.json` 通过（`typecheck-final.log`）；`pnpm run doc-sync` 29 passed、0 failed、0 skipped（`doc-sync.log`）；上述日志均位于 `.local/world-fixes-20261011/`，`git diff --check` 通过。浏览器首轮一个初始化等待采用默认短 poll 超时，明确为 30 秒后完整复验通过，未放宽产品运行时限。未执行真实模型试验，亦未勾选剩余两项。
