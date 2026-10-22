# C6 人事接线与原路径回归

已有候选人录用增加严格 Native 领域、原身份委员会选择和通用原子 onboarding wake。真实四角色 fixture 在公司/实验室 × JSON/SQLite 的 source4/lib4 已完成，O01 已勾选；准确证据见[已有候选人验收](c6-existing-report.md)。候选人不因测试需要取得操作权限或临时任职；独立任职委员投票。固定 resident=3，token 等上限不因失败提高。

Native schema 与 provider 由同一 Cordis effect 清理，关闭新准入后先排空原 owner；清理失败报告原错误并保留原 lease，不等待一个永远被该失败阻塞的独立 disposer。实际取消业务先前已经成功，但 accepted-before-reserve 子进程在 Fiber teardown 以 unsettled top-level await/13 退出；修改后真实 source 12 项取消矩阵通过。受控失败单测验证错误被报告、准入关闭、原 lease 未早释放、replacement 被拒。没有把 writer callback 被移除或未确认退休推断当已观察事实。

原路径证据：

- [source 精确选择](c6-source-focused.log)：autonomous/Norm/booking 三文件共 12 passed；同批 cancellation 的四个 teardown 失败完整保留，不称整批通过。
- [取消 source 修复](c6-cancel-source-fixed.log)：12 passed，两个后端三个真实断点、公司/实验室及原件冷恢复。
- [原路径 lib](c6-lib-regression.log)：4 files / 24 passed，含相同取消矩阵、生成新人与初次行动、Norm 和独立预约。
- [当前领域/审批/失败清理单测](c6-existing-current-tests.log)：38 passed；包含确认 Channel 的原 reservation 无 requester 索引、缺失/错配/歧义拒绝。
- [最终核心 typed lint](c6-lint-final.log)、[canonical 领域 lint](c6-canonical-lint.log) 通过。
- [最终 doc-sync](c6-doc-sync-final.log)：29 passed；首次四个文档 gate 失败已修，日志保留。

准确原路径命令：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-autonomous.snapshot.ts examples/simulation-company/tests/world-norm.snapshot.ts examples/simulation-company/tests/world-booking.snapshot.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts --maxWorkers=1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts --maxWorkers=1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-autonomous.snapshot.ts examples/simulation-company/tests/world-norm.snapshot.ts examples/simulation-company/tests/world-booking.snapshot.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts --maxWorkers=1
```

误启动：`pnpm run test:snapshot -- ...` 将分隔符原样传给 Vitest，未选择文件而启动整套。该错误选择的进程及子进程已终止，日志 `c6-source-regression-correct.log` 保存，不能作为完整回归通过证据。最初遗漏 snapshot config 的命令返回 no tests，保存 `c6-source-regression.log`。

旧 Web 全套已出现 cold/sources/states/task-matrix 失败，且之后源文件与产物变化；已停止该混合输入运行并保留 [终止记录](c5-web-interrupted.json)。独立 [强原命令终态浏览器矩阵](c5-web-cold-original-terminal-all.log) 4/4 通过，仅为该检查时输入的冷恢复证据，不能替代最终 UI 全套或 U14/U15。

所有运行根、日志、build 产物留在项目内。完整 v1、领域 DTO/SDK、调岗/离职、外部代表及最终 R11/R13 继续待办。
