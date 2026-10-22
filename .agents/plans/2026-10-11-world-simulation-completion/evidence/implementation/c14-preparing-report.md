# C14 preparing Entity 准入证据

O06 的 readiness 校验在现有 Native/Team 所有者中已经实现。本次只新增 [真实 Loader scenario](../../../../../examples/simulation-company/tests/world-preparing-scenario.ts) 和 [进程测试](../../../../../examples/simulation-company/tests/world-preparing.snapshot.ts)，不修改生产行为、额度或 checklist。源码与最终 stream 70 Host 编译产物均通过真实 Loader 和产品回归，O06 可勾选。

## 已验证的路径

公司、实验室分别覆盖 JSON/SQLite。真实 `cordis.yml` Loader 使用现有 `world-driver` composition；完整冻结编译输入先存入 fixture root。额外人物以 Native `preparing` 创建，真实 Participant 已 `active`、Participant/Session 永久 binding 已确认，但 Native readiness 未完成；profile 故意包含 `readiness: ready` 和 `role: director`，不能替代 owner 准入。没有 maintenance 屏障掩盖 readiness。

真实 requester Activation 通过 Native decision 提交一个 `task/create`，由真实 Team owner dispatch 出 applied receipt 和 pending Task。随后在 paused 和 running 两阶段拒绝 preparing 的 Native writer reservation、Native fair nomination、connection decision open/submit、Native task execution reservation、connection task assignment、connection/direct controller fresh 与 resume。Native snapshot 在每组拒绝前后完全相同，原 pending Task 没有 attempt。

直接 controller 的拒绝会持久保留并释放 startup reservation；恢复允许对账这份退休回执，不赋予 writer、Activation 或 Session。`coldReplace` 对该人物不存在的 epoch 返回 `TEAM_ACTIVATION_NOT_FOUND`，因为正常 preparing 生命周期没有 Activation history 可供替换。测试断言其 Activations 为空、writer 不存在、Session 仍 unmaterialized、模型调用为零。

运行中的真实 `SimulationWorldDriver.advance()` 消费该人物普通 wake，Native 记录 cancelled / Entity unavailable，driver 返回 idle。没有 decision、task attempt 或模型调用。真实 checkpoint 保存原人物、原 task creation/receipt 和原 pending Team Task；随后两次独立 OS 进程 writable restore，先验证 paused/零推理，精确核对原件，再重复准入拒绝与 driver 检查。每个源码或 lib 矩阵为 4 个 case / 12 个 OS 进程。

额外运行已有实际产品 `world-owner` 正常公司/实验室 × 双后端矩阵。其中生成新人进入 preparing 且 Team membership 为 active 时，现有 probe 通过直接 controller 拒绝 ordinary activation；随后保持原招聘提交及独立新人首次行动回归。

## 准确命令与结果

所有命令在项目根目录执行，临时文件由 `TMPDIR=$PWD/.local/world-completion/tmp` 约束在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_PREPARING_EVIDENCE="$PWD/.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-raw" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-preparing.snapshot.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-source-third.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-owner-tests.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts -t "crash='' only" > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-hire-source-final.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts --type-aware examples/simulation-company/tests/world-preparing-scenario.ts examples/simulation-company/tests/world-preparing.snapshot.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-lint.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_PREPARING_EVIDENCE="$PWD/.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-raw-lib-before-build" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-preparing.snapshot.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-lib-before-build.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_PREPARING_EVIDENCE="$PWD/.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-raw-final-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-preparing.snapshot.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-lib-final.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts -t "crash='' only" > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-hire-lib-final.log 2>&1
```

源码 Loader 4/4、现有 owner 单测 47/47、源码实际产品招聘 4/4（其余 36 个故障测试按过滤跳过）、新增两文件 type-aware lint exit 0。主代理完成 [当前全 Host build](../../../../../.local/world-completion/tmp/c14-build-final.log) exit 0 后，最终 stream 70 plain Node [Loader 4/4](c14-preparing-lib-final.log) 与 [实际产品招聘 4/4](c14-preparing-hire-lib-final.log) 通过。旧 09:40 compiled lib 的 Loader 4/4 另外保存，不用作最终 build 证明。

## 原件、hash 和范围

[源码 40 文件清单](c14-preparing-source-manifest.json) 的 `inputHash` 为 `a96dbec64cba208deb7dc588118ed51d9bbd674451404bcc6bb46722c4f5ef01`。它包含当前准入源文件 inventory、测试/配置，以及 20 份实际原始样本：12 份进程命令与 stdout/stderr、4 份 frozen accepted inputs、4 份原 Entity/Native task/Team Task proof。它不是全部传递依赖清单，不能拿此 hash 声称整个仓库构建已验证。[旧 lib 清单](c14-preparing-lib-before-build-manifest.json) 单独包含 8 个编译入口与另 20 份实际样本。

[最终产物与命令日志清单](c14-preparing-final-manifest.json) 记录当前 stream 70 的 8 个实际编译入口，`compiledEntryHash` 为 `dea6cd6b3621957d0fbfc28669cda5d9464e6d3f936e6a11018b04b7c862e760`；它与源码 inventory hash 独立。最终 lib 另有 20 份原件，含 12 份独立进程样本、4 份 original accepted inputs 和 4 份原 proof。完整 `lib/index.js` 已包含 Native folds，hash 记录入口原字节；清单不假装包含所有第三方依赖或完整分发包。样本校验逐份核实 exit 0、paused/preparing、modelCalls 0；两次 cold fixture 同时精确核实 binding、Entity revision、原 operation/result/receipt 和原 pending Task。

首次新测试对 dispatch 状态错误期望 applied，真实返回 settled（业务 result 为 applied）；[原失败日志](c14-preparing-source.log) 和 `c14-preparing-raw-first-failed` 保留。第二次错误期望 connection.recover 拒绝，真实 owner 成功清理已 released startup reservation；[原失败日志](c14-preparing-source-second.log) 和 `c14-preparing-raw-second-failed` 保留。修正后断言 Native 不变、原 Task 不变、无 Activation/Session/model。已有产品过滤的首次 `-t 'crash= only'` 全 skip，保留在 [原日志](c14-preparing-hire-source.log)，不作通过证据；正确过滤见上文。

本项不声称 SIGKILL 故障矩阵、外部代表、v1/SDK/UI 或完整 MVP 已完成。新 preparing case 使用正常 checkpoint 与两次独立新进程 restore；`coldReplace` 证明无合法既有 epoch，未伪造历史 Activation 来绕过 Native integrity。生产准入没有放宽，无新 checklist item。

## 最终封闭评价审计后的当前产物

外部 Native append 补存实际输入／输出并增加封闭效果必需校验后，全 build 再通过；O06 原源码准入 inventory 未改。当前 [8个产物与20份 preparing 原件](c14-preparing-current-manifest.json)由 [当前 Loader4／外部4](c14-lib-verified.log) 和 [当前产品招聘4](c14-product-verified.log) 验证，仍为12个 preparing OS 进程／8次 cold／0模型。更早的 compiledEntryHash 是当次实际执行记录，保留为历史证据，不替代当前产物清单。
