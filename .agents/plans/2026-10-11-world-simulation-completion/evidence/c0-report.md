# C0 基线与回归证据

日期为 2026-10-11（Asia/Tokyo）。本证据只拥有 B01–B04，不修改生产代码或旧 checklist。`dsh-pre-push-checks` 用于选择已有行为的 owning 回归；没有提交、推送、刷新 snapshot 或调用真实模型。

## 集成输入 B01

`HEAD` 为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`，它不是本次未提交实现的版本。`git ls-files -z --cached --others --exclude-standard` 列出 tracked 和未跟踪输入后，保存普通文件字节及 symlink 目标的 SHA256，归档 10,165 条输入。排除凭证、依赖、编译/测试输出、运行状态和当前 evidence，排除路径逐项保存在 [manifest](c0-baseline-manifest.json)。[源码归档](c0-baseline-source.tar.gz) 的 SHA256 为 `6bdface8a2362e8a2d959e1afcaf8dd04e5ed74c1fbf60971fbbae23401c0aae`；完整文件清单的输入 hash 为 `0be2b7b05f5397d5ca4030333c28f4877abd0947d4dfc089b59322663b63808b`。验证逐条比较归档中的字节及 link target，无需改 Git index 或创建 commit。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" PYTHONDONTWRITEBYTECODE=1 python3 .agents/plans/2026-10-11-world-simulation-completion/evidence/c0-baseline-verify.py > .agents/plans/2026-10-11-world-simulation-completion/evidence/c0-baseline-verify.log 2>&1
```

[验证日志](c0-baseline-verify.log) 确认 10,165 条 hash 全部一致。原 HTML 保持在 `source-design.html`，hash 为 `e63bcbf66050e4c3e9761f2aa65dacbbf17179d286603678406aa692796fbe25`。[版本来源 hash](c0-baseline-metadata.json) 固定 Native stream `60`、场景 `clocky.world/v0` 和 driver/checkpoint implementation `world/1`。恢复此基线应先解包到项目内独立目录，再按原 lockfile 提供依赖；归档不包含凭证、node_modules 或 built lib，不能直接覆盖正在开发的工作区。

## 原范围 B02

原招聘 checklist 的完整字节 hash 为 `d1181063335ff11b7324f4c538ccc082459385c1244bfe0c68b0bd1629423368`。归档保留其 75 条正文、顺序和 73 勾选，以及旧 development-plan、design 和 implementation-evidence；verifier 对当前旧 checklist 再验 hash，未改其范围或勾选。[assessment](../assessment.md) 明确其招聘子集与原设计三领域完整 MVP 的差异。原真实模型样本与最终接受两条仍未完成。

## 已有行为回归 B03

聚焦源码命令：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-scenario/tests/compiler.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-product/tests/maintenance-control.spec.ts packages/simulation/simulation-product/tests/world-preflight.spec.ts --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/c0-focused.log 2>&1
```

[日志](c0-focused.log)：6 files / 107 tests passed，exit 0。覆盖编译器 JSON 创建与拒绝、产品原命令、readiness、Native 维护、产品维护控制和 preflight。已有 owning fixtures 包含 JSON/SQLite；此命令使用 source，不代表 built artifact 或浏览器复验。

真实 Loader/Agent/原命令与冷恢复命令：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts examples/simulation-company/tests/world-product.snapshot.ts examples/simulation-company/tests/world-case-cancel.snapshot.ts --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/c0-source-recovery.log 2>&1
```

[源码恢复日志](c0-source-recovery.log)：3 files / 112 tests passed，exit 0，耗时 745.51 秒。测试逐一执行公司/实验室 × JSON/SQLite；原创建覆盖接受、终结、Participant 和 Channel 预留/建立/ready 的 SIGKILL；owner 覆盖请求/Channel、reserve、退休、Participant IO、commit 和 notification 的 SIGKILL，并验证冷恢复 paused、原身份与显式 start 语义；取消覆盖 reserve 前、Participant IO 后和 commit 后原通知责任，纯冷回放零模型调用。模型为 scripted `company/scripted` version `1`，不计作真实模型质量证据。测试自己使用的 `.local/world-director-mvp/tmp` 同样在本项目内。

回归期间输入层并行增加显式 YAML 解码和诊断字段，owner 保留 v0 JSON 定义及其正常 hash；[运行输入记录](c0-regression-inputs.json) 保存冻结起点、结束时源码 hash、变化路径及新文件。结束时源码 hash 为 `60f6bc7a31cf8874bf48f184a02f9513fa67b9150a612aa39a1f9a72dda04f11`，仅表示观测到的结束状态，不声称每个子进程均载入此同一状态。本轮证明已有招聘/JSON 回归，不能据此验收全部新领域或最终 diff。

本轮未重跑全仓 build/lint、lib、SDK、浏览器或真实模型；不得把历史日志称作本轮结果。开发者可复用既有证据时应先核对其实际输入。

## 路由与硬预算 B04

[静态检查](c0-baseline-metadata.json) 仅记录根 `.env` 与相关配置变量是否存在，不记录值，不发送网络请求。根 `.env` 不存在，相关 local/provider/API-key 环境变量均未配置。World fixture 使用 keyless scripted 模型。现有 `live-model-benchmark-scenario.ts` 是单 observer 的 opt-in 样本，具有 token/model-call 边界，但不是 World 评估入口，也没有费用硬上限。

B04 保持未勾选：仍缺可用且已授权的 provider/model version 路由、固定的每 run token/决策/mutation/费用硬限和 bounded World eval 入口。本检查不把 keyless Agent 调用当真实 provider 样本，未阻止其它领域的实现工作。
