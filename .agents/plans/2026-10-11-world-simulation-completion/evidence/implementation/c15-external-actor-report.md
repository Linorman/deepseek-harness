# C15 独立模拟代表

外部 `interact/v2` 通过 Native 独立代表记录、原有限 Persona、真实 canonical Participant/Session/Channel 与统一 World driver 准备并联系供应商。代表不是雇员：外部组织保持 `cognition:none`，表示关系为 `represents`，展开不创建 assignment 或转移资产。原确定性 `interact/v1` 保持自身语义。Native stream 71 拒绝旧日志，不改变通用 SQLite/Session 格式。

## 当前完成范围

准备保留原 Plan、所有技术身份、冻结模型路由、generation 及 maintenance owner；IO 在 Native 写队列外执行。Native 在精确原停稳下核对 Persona、binding 和两个确认 Channel，将 committed representation、ready、原结果和请求者联系 wake 原子提交。Requester 的真实结果决策发起新 Channel 联系，代表首次决策由真实 Channel 收件触发；不伪造代表 sender 或 first-action wake。精确 commit 重试返回原件。

生成认知身份的保护通过 `worldActorPreparations()` 同时覆盖招聘和代表：virtual Entity/history 占用、保留 UUID、不可逆 preparing Persona/phase、readiness、对应业务关系和标准 Channel binding。直接 controller、connection activation、fair nomination 和未准备绑定都不能提前赋予代表普通行动。其他结构变化不能旁路原外部预留。

代表记录的模型输入使用自身有限 Persona、外部主体公开 name/description、自身授权的事实投影及新的 canonical Channel 消息，不使用主组织或 director Session。真实 Sender 从 Participant/binding 派生；原结果只携带结构化身份和请求单位。私密底价与 director rationale 在真实 Session、模型输入和安全结果三个位置分别排除。

## 证据与命令

公司／实验室 × JSON／SQLite 经真实 `cordis.yml` Loader、Agent/Session、observe/stage/submit、维护、Participant 与 Channel owner 和统一 driver 运行。每模式4个case／12个OS进程；首次各15模型调用，两次独立 checkpoint writable restore 各0调用、paused。每条 post 从实际 Channel journal 的 sender/envelope/sequence 和 recipient Session 的完整 source/body 同时核验。

2026-10-12 当前 [完整真实验证报告](c15-verification-report.json)、[输入／库hash清单](c15-final-input-hashes.json)与 [58个原件／日志](c15-external-actor-raw/)已登记。source 和 plain Node lib 各4case／12OSprocess；全部24条实际Channel／Session对应消息由 [root复核](c15-root-artifact-verification.json)重验，16次 cold均0model。报告 hash `1014e662bfe1e49578e316485507287bc1b54ed3de67284240c46c17defc9367`；当前输入清单 hash `fe89fde77dc54c14f0f330bdf914f541fa51046499ae1530a50d1308af3f85d1`。输入包含5个owned文件、1963个package源码和2577个JS产物，root逐项重验全部hash一致；源码清单不含仓库外第三方依赖。focused169／Native HMR3、旧招聘／preparing／v1规则 compiled16、types／type-aware lint／JSDoc／full build、doc-sync29均通过。旧build、失败prefix、维护拒绝期望更正以及生成器type-only import识别诊断保持历史，不替代最终证据；生产generator已恢复原字节，type-only导入修复后生成成功。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-external-actor.spec.ts packages/simulation/simulation-local/tests/world-external.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/simulation-local/tests/writers.spec.ts packages/simulation/simulation-local/tests/entities.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-team/tests/participants.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts > .local/world-completion/tmp/c15-regression-final.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build > .local/world-completion/tmp/c15-build-release-evidence.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-domain-disposal.spec.ts > .local/world-completion/tmp/c15-hmr.log 2>&1
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external.snapshot.ts examples/simulation-company/tests/world-preparing.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts --maxWorkers=1 > .local/world-completion/tmp/c15-lib-regression.log 2>&1
```

## 未解决范围

X05 尚未完成：相同身份的第二展开被明确拒绝，不能当成共享 reservation／对话复用。准备中取消保留 `cancel-requested`、Person／容量／维护，不提前释放；原清理与外部 SIGKILL 故障矩阵仍待 X12。X06 的真实 fixture 证明已有资金和库存留在原主体、独立身份及关系不变，但没有非空供应商合同继承证据；保持未勾选。外部 actor 正常消费共享现有模型/token/resident/history 准入，完整超限矩阵仍待 X10。裁决、source/sink、v1 作者入口、产品 DTO/UI/SDK、真实模型质量及支持规模均未因此完成。

真实 fixture 使用 Native 默认的 result wake 作为提交后的首次联系责任；代表自身 first cognition 由随后真实 Channel receipt 启动。直接 controller 在维护阶段按精确 maintenance code 拒绝，独立 readiness（无维护遮挡）由既有 O06 真实 Loader 与 Native preparing guard 回归证明。本次不把两者混称为同一拒绝来源。
