# C5 治理真实进程丢失验收

G12 完成。真实 Loader/Agent/三工具/Channel 路径在投票、结案、enact 的原 append 前后及已送达通知的回执 append 前停止，父进程收到实际 barrier 后 SIGKILL。每种后端每个断点均连续启动两个新进程；恢复 paused，模型调用为零，完整 world 与实际只读 durable 投影相同。close/enact 原件精确重试不增 revision；通知丢失显式对账原 operation/Team receipt，业务 world 不变。

准确命令均在项目根目录，临时文件留在项目内：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-crash.snapshot.ts --maxWorkers=1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-crash.snapshot.ts --maxWorkers=1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec oxlint examples/simulation-company/tests/world-norm-crash-scenario.ts examples/simulation-company/tests/world-norm-crash.snapshot.ts
```

[source 最终日志](c5-crash-source-final.log) 14 passed；[plain Node lib 日志](c5-crash-lib.log) 14 passed；[lint](c5-crash-lint-fixed.log) 通过。lib 前 [build](c5-build-fixed.log) 完成全部 197 产物。首次测试探针发现测试用 append 子集 parser 将无关 settled outcome 当成 dispatch outcome，修正为可选 status；生产 parser 未放宽，失败日志保留。

[输入与实际 barrier 样本 hash](c5-crash-input-manifest.json) 保留 14 份原始 before/durable/entries。两个模式采集器使用同名路径，因此保留样本不逐份归属 source/lib；两套独立终态日志证明各自完整矩阵，不能把同名样本假称两份。样本来自实际存储观察，不构造期待状态。

本项仅治理断点；人员/外部断点、完整新场景/DTO/SDK 与综合 R06/R11/R13 继续未完成。没有自动启动模型、修改不变量或提高阈值。
