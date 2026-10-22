# P12 四层案件状态与真实故障验收

2026-10-14，Asia/Tokyo。完成原 P12 与下节记录的 R07，清单 92/112；未新增 item。Native95、checkpoint manifest5、compiler9。

## 实现与实际修复

沿用[持久执行观察](p12-execution-proof-20261014.md)，本轮增加真实 Loader/Agent/Team 和认证产品 fetch carrier 的故障验证。每个运行先完成一个案件，再让第二案件进入指定状态；读取 request、plans、execution、notification 四区，逐项与原 Native request/source/plan 对照，不使用 run stop 推断案件状态。

实际试验发现 World 产品 owner 仅在已有 maintenance 时执行恢复，遗漏了尚未进入 callback 的 armed 责任。现在显式 restore 同时对账这类责任；仍有未确认 callback 时不报告恢复成功。live 与 cold control 从原 executions/outbox 投影 unknown，cold start 继续要求 restore。后台 timer、advance 与 checkpoint 清除内存提示都不能绕过保留的 callback 责任。取消后的对账也检查未确认观察。

| 第二案件状态 | 原请求与计划 | 执行与业务事实 | 通知与恢复 |
|---|---|---|---|
| rejected | request rejected，原计划 accepted/reject | 没有执行 callback，唯一 rejected result | 明确拒绝，不制造 unknown；冷态保持原件 |
| blocked | request open，原计划 accepted/apply | 实际岗位已被第一案填满，Native 拒绝；blocked/position-capacity，无 result | 暂停、冷读取与 restore 不重做第一案 |
| armed | request open，原计划 accepted/apply | arm append 后、callback 前 SIGKILL，投影 unknown，无新人预留 | 原 provider 确认无 Native duty 后 settled；没有重发 IO |
| participant | request open，原计划 accepted/apply | canonical Participant 已创建，回执尚未返回时 SIGKILL；原 reservation preparing | 原身份对账完成已接受招聘，保持暂停，无新模型调用 |
| committed | request committed，原计划 accepted/apply | Native hire commit 返回前 SIGKILL，callback 尚未确认 | 原唯一结果不变，原 callback 对账结案，不再录用 |
| notification | request committed，callback settled | 唯一 committed result 保留 | 真实 Target 已接受 Envelope，丢失回执形成 outbox unknown；恢复前后原 operation 全量不变、原 Envelope 及同 sender/payload 消息均唯一 |

所有场景均由实际脚本模型走 observe/stage/submit 和独立 Session；拒绝分支由模型对其可见的明确第二案描述作出，用于状态验证，不是模型质量评估。没有预构造成功 DTO、改业务阈值或模拟角色 sender。该产品入口使用真实 Host `toFetchHandler`/`InProcessApiClient` 与认证 lease；不是浏览器/HTTP socket 验收。

## 证据

- [输入 manifest](p12-fault-20261014/inputs.json)：1,333 份相关 source/test/lib/config，hash `c613bf41167c7876d698fac153a5b849a3da26a4682da8ad8842dd690e6716dc`；运行时代码在最终矩阵前冻结，验证后捕获。
- [最终 source](p12-fault-20261014/verified-source.log) 12/12、[最终 plain Node lib](p12-fault-20261014/verified-lib.log) 12/12：六状态 × JSON/SQLite × 两模式，24 组。lib 校验实际依赖路径及空 execArgv，没有 tsx/loader。
- [可重跑审计](p12-fault-20261014/audit.py)、[逐原件结果](p12-fault-20261014/audit.json)、[输出](p12-fault-20261014/audit-fixed.log)：72 PID，24 次实际 SIGKILL（不是 timeout），48 个 cold 进程 model=0，768 个四区 DTO 通过 Python 严格 parser。request/plan 独立映射、原结果/资源、Native Entity 集与已有 binding/预留身份保持；原件在项目 `.local/world-completion/p12-execution-faults/verified-{source,lib}`。
- 第一 cold 先做零写入读取，再显式提交 restore、对账原责任；第二 cold 读取已恢复状态，并精确重试同一完成的 restore 命令。第二次不是重新执行 writable restore；不会获得第二 owner。恢复后重新查询 `afterViews`，不是保存恢复前的旧 view 冒充结果。
- notification 的原 Native operation（含 attempts、fingerprint、id）在 producer、restore 后与第二 cold 全量相等。实际 canonical receipt 由 Target 返回并保存；读取完整有限 Channel 前缀，原 Envelope 身份/正文相等且唯一，相同 sender/payload 也只有一条。业务始终 committed，通知始终 unknown，不降成 rejected 或再发一份。
- [产品/SDK/dispatcher 回归](p12-fault-20261014/regression.log) 6 files/269 通过；[Host 类型和编译](p12-fault-20261014/host-build.log)、scoped lint、[doc-sync](p12-fault-20261014/doc-sync.log)29/29通过。测试脚本的最后审计断言另有类型/lint 空日志；新脚本由 Node/source 路径运行，不作为分发包入口。

身份范围仅为此场景的 Native Entity/已有 binding 与原 reservation identities 保持、且没有新增 Entity。没有据此宣称完整 canonical Participant/Session/Channel 数量或 Session 正文审计；完整跨 owner 证据仍由 R02/R05 负责。本场景没有配置一次性费用，资源不变不能冒充付费录用的扣款恢复证明。

## 准确命令

项目根设置 `BASE="$PWD/.local/world-completion/p12-execution-faults"`、`TMPDIR="$PWD/.local/world-completion/tmp"`；Python 设置 `PYTHONDONTWRITEBYTECODE=1`。所有原件、IPC、缓存与编译产物在项目。

```sh
CLOCKY_SNAPSHOT=replay WORLD_EXECUTION_EVIDENCE_ROOT="$BASE/verified-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-execution-observation.snapshot.ts --maxWorkers=1
CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay WORLD_EXECUTION_EVIDENCE_ROOT="$BASE/verified-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-execution-observation.snapshot.ts --maxWorkers=1
PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python "$BASE/audit.py"
pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-product/tests/case-schema.spec.ts packages/simulation/simulation-world/tests/execution.spec.ts packages/sdk/client/tests/simulation-world.spec.ts packages/sdk/server/tests/simulation-world.spec.ts --maxWorkers=1
pnpm exec tsc -b tsconfig.host.json
pnpm run build:lib:host
pnpm run doc-sync
```

## 保留的失败与未验收范围

首个 rejected pilot 在 pause 后尚有 driver 排空写入，读取前后的完整 snapshot 比较失败。现在明确等待实际 `inFlight=false` 再做该静态读取断言；没有把产品后台写入归咎于读取。早期 TypeScript 对异步赋值的过度窄化及样式错误已修正，日志保留。长 TMPDIR 使 tsx CLI 的 Unix socket 返回 EINVAL，改用项目内较短目录，未移到项目外、未申请 sandbox 绕过。审计最初将 TMPDIR cache 当成场景，改为按实际 barrier 原件识别运行，仍严格要求24组。

前轮原件未检查通知恢复后的 view/operation；本轮只读审计指出后已补齐，并用最终24组重新验证。早期 pilot 与首轮8案/12案不是最终输入的替代证据；所有失败仍在项目原目录，未刷新快照或扩大 timeout/额度。

R07 的旧路径回归见下节。R06 的完整领域故障矩阵、GUI、全部 SDK 分发和真实 provider/model 质量实验仍各自验收，本报告不替代。U04 还要求界面和独立内容权限综合证据，不能只因 P12 通过就勾选。

## R07 旧路径回归

当前 Native95/manifest5 下，完成原 R07；清单 92/112。[Native/Team focused](p12-fault-20261014/r07-focused.log)10文件480项、[实际 acceptance](p12-fault-20261014/r07-acceptance.log)18项、[采购/窗口 keyless](p12-fault-20261014/r07-procurement-window.log)2文件42项全部通过。

| 原行为 | 本次证据 |
|---|---|
| 采购、资源转移及旧任务流程 | company snapshot：create、转移/任务前后 SIGKILL、opaque decision、bootstrap response recovery |
| task 原身份/接受/结算 | Native task-outbox/execution/completion/evidence/interaction：原 attempt/source、拒绝路径、取消、冷读与完成事实 |
| 消息 proof 与消费 | Team world：实际 Hub sender/payload/Envelope/sequence/audience 变造拒绝、Channel 消费与提交关系 |
| 窗口与预算 | Native run/windows、window snapshot、acceptance-budget：原 slot 顺序、已接受效果、字节/append 失败及精确重试 |
| checkpoint 与冷恢复 | Native checkpoints、Team restore：严格 manifest5、引用、生命周期及原件恢复 |
| 招聘与取消 | Team world、产品269及本报告24组真实产品链；原 accepted Persona/计划/身份与结果不重复 |

精确命令（同本报告项目内 TMPDIR）：

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/windows.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-local/tests/task-outbox.spec.ts packages/simulation/simulation-local/tests/task-execution.spec.ts packages/simulation/simulation-local/tests/task-completion.spec.ts packages/simulation/simulation-local/tests/task-evidence.spec.ts packages/simulation/simulation-local/tests/task-interaction.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/restore.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-local/tests/world-acceptance-budget.spec.ts --maxWorkers=1
CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/company.snapshot.ts examples/simulation-company/tests/window.snapshot.ts --maxWorkers=1
```

此前169文件宽跑退出1、缺完整结尾的记录仍是失败记录，未将其改写为全绿。本次按 R07 所列旧行为重新选择相关验证，18项也在当前输入下复验；没有增大时限、降低阈值或移出项目。没有宣称完整仓库、所有新领域或平台矩阵通过，R11仍负责最终集成门禁。
