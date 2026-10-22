# C14 外部确定性模拟规则

`external.interact/v1` 已通过已安装 Native 领域和统一 driver 实现确定性库存查询。支持范围是 `simulated-rule`／`clocky.external.availability/1`，其实际输入与输出在原请求、计划对应的 Native append 中保留。X02 已通过 source／plain Node lib 的完整确定性规则流程；其他外部模式和完整 MVP 不以本项通过代替。

## 实现与拒绝路径

请求接受固定 `(run, scope, externalKey)` 业务身份，与显示名称、请求者、Decision ID 无关；相同 key 复用原主体，不允许重绑。请求者必须有当前任职和精确目标的原操作授予。计划仅能确认 `evaluate-rule`，不能选择数量、sender 或观察正文。纯规则仅读取授权外部主体在请求单位下的 Native inventory，忽略 money／其他 owner；没有库存账户返回 unknown，有明确零余额的账户才返回 known zero。此结果是已记录账面库存，不是合同或可用信用承诺。

Native 将实际排序库存 ID／revision／owner／unit／quantity、原请求与计划、策略／实现 pin、实际结果、模拟与记录时间保存为 `externalEvaluation`，与业务结果和通知 wake 原子提交。回放使用保留结果，仅验证确切原来源、输入和算术，不调用策略 evaluator，不重新抽样或推理。完整表和实际 append 均受冻结 UTF-8 字节额度约束。checkpoint 对稳定身份与实际交互分别保留指纹；缺失或篡改评价、结果替换、额外实体／资源／制度变化均拒绝。

`resource-owner-set` 读项冻结完整相关库存集合；已有余额改变或未知库存首次出现使旧计划 stale，资金和无关账户不造成冲突。精确 mutation 重试返回原结果、零 append；异 payload 拒绝。URL／凭证／sender／source／sink 字段、未安装 policy 和未实现模拟方式在身份或业务副作用前拒绝。实际 Channel 发言仍使用原请求者／director proof；本规则不会伪装供应商 sender。

## 验证与原件

公司、实验室各在 JSON／SQLite 使用真实 `cordis.yml` Loader、独立 Agent／Session、observe／stage／submit、私有 Channel／Envelope 和统一 `SimulationWorldDriver`。三个真实目标分别发起同 vendor key 的两次查询和另 key 的未知库存查询。规则返回原库存 7，资金 999 不进入结果；所有账户保持原值，两个同 key 请求复用身份。实际 Native stream 读回三份 `externalEvaluation`，逐份等于保留交互；原件包含完整 frozen resolved 输入、实际安全结果及原日志记录。

每个 source／plain Node lib 矩阵有 4 个 case／12 个 OS 进程，包括两次连续独立 writable checkpoint restore。每次 cold 都保持 paused、0 模型调用、相同身份／输入／实际输出／结果／资源。原过程 stdout／stderr、启动命令和退出状态分别保存，不用一个恢复摘要覆盖另一次。

准确命令（项目根目录；全程未读取 `.env` 或访问真实 provider）：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-external.spec.ts packages/simulation/simulation-local/tests/world-domain-disposal.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/simulation-local/tests/world-norms.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-team/tests/personnel-terminal-evidence.spec.ts > .local/world-completion/tmp/c14-regression-final.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build > .local/world-completion/tmp/c14-build-verified.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external.snapshot.ts --maxWorkers=1 > .local/world-completion/tmp/c14-source-verified.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay WORLD_PREPARING_EVIDENCE="$PWD/.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c14-preparing-raw-verified-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external.snapshot.ts examples/simulation-company/tests/world-preparing.snapshot.ts --maxWorkers=1 > .local/world-completion/tmp/c14-lib-verified.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-owner.snapshot.ts -t "crash='' only" --maxWorkers=1 > .local/world-completion/tmp/c14-product-verified.log 2>&1
```

2026-10-12 最终结果：[focused 111/111](c14-regression-final.log)；source 外部4/4；编译外部4/4＋preparing4/4，原产品招聘4/4（其余36按准确过滤跳过）；类型／type-aware lint／全 build 通过，最终 [doc-sync 29/29](c14-doc-sync-verified.log)，生成目录 owning tests4/4。[332文件 scoped 源清单与8个实际入口](c14-external-manifest.json)的 input hash 为 `41ef7cf2d6935a1fa92fe2a0613d6064d07a9317c24dca915c375a6e8188b79e`，compiled entry hash 为 `674f49ed8c3c47b0df6bcfa9988328cccb2c8f54d52aa8b04ebb82ff624dec92`；这不是全部第三方传递依赖或 wheel 清单。[48原件](c14-external-raw/)包含每 mode／scene／backend 的 frozen 输入、原输出、完整实际 Native mutation 以及三个独立进程记录。[root独立核验](c14-external-root-verification.json)逐项验证24份实际评价的原输入、原量／unknown 和 append／结果来源；24个 OS 进程中16次 cold 为0模型调用。完整 append 的 UTF-8 精确／少一字节测试，以及实现遗漏封闭效果、缺失输出、结果替换、篡改原输入和额外实体变化拒绝均通过。旧的调试、parser 期望、初版仅派生结果、一次 key 正则回退误改造成的7项拒绝测试失败日志均保留在项目临时目录；正则恢复后111项通过，未放宽额度或阈值。它们不作当前持久输出的验收依据。

## 保留缺口

未实现 director-mediated 裁决、独立代表认知／展开、代表共享额度、预配置 registry 导入或 source/sink grant。v1 编辑／通用产品 DTO／浏览器／SDK 分发和外部 SIGKILL 矩阵仍待完成。没有真实 provider 质量或费用试验，没有吞吐／churn 支持规模声明。X01、X03–X13 和原 checklist 其余未完成项保持未勾选；Native stream 从基线 69 增至 70，通用 SQLite／Session 格式不随之更改。
