# C10 严格人事生效时间

日期：2026-10-12；当前输入 hash `5462b2224f69d5411d8dc4b0c85914747bc9c7bbc68636e2e3979983e8474319`，见 [输入原件](c10-time-input-manifest.json)。Native stream 69；checkpoint manifest 3、Session format 0、通用 SQLite schema 不变。保留原 dirty tree，无 commit/push/PR。

完成既有 O08，checklist 35/112；没有新增 items。完整 MVP、通用日历、人员故障矩阵与 UI 验收仍未完成。

## 实现

每个实际已接受、expectedTime非null的 World intent，原 request acceptance 批次只追加一个 `world-execution-time` 纯时钟边界。边界绑定原 intent/request/operation、真实 decision/epoch/canonical binding、fingerprint/installed pin，以及原 expectedTime和deadline phase。Source验证、队列key分配、完整投递/时钟batch字节和 pending事件额度均在append前执行。

消费时只推进原模拟时钟，不产生 actor/model wake、Persona、第二请求或后继计划。历史terminal/cancelled请求的同一边界仍是原时钟事实，不恢复执行权；不能取消、改time、换 source、伪造保留ID或在cold重排。领域仍在实际安全边界重验原请求和计划。早期时间返回等待，严格时刻错过返回stale-time；修改日期须新授权请求，不回填旧请求/计划/已冻结decision slots。

## 真实流程证据

[source-final8](c10-personnel-time-source-final8.log) 与 [plain Node lib-final8](c10-personnel-time-lib-final8.log) 各8/8：公司／实验室 × JSON／SQLite × on-time／missed。每组fresh+独立cold，共16 cold暂停、零模型调用。预算仍为原 catalog resident2、microsteps32、maxBytesPerRequest/Plan4096等原件，无额度放宽。

原人物实际私有memory wake在0；管理员实际目标决策在1提出expectedTime/requestedEffectiveAt3，独立director在1生成原apply。Native保存唯一pending边界3，无预留或结构效果。on-time driver消费纯边界，在3完成requested3/actual3的原调岗；原request/intent/plan、source/director time1 slots/contexts及Sessionprefix均精确保持。

missed由明确owner调用实际 `run.drive(until4)`，只消费原纯边界/推进时钟，无模型。实际driver.advance返回stale-time，revision不变，模型调用不增加，无新decision/slots/wakes/plan/reservation/mutation/result。重复原件与新进程paused cold重验均保持；不声称cold后自动resume。

准确命令、四个fixture文件SHA256、最终source/lib各16共32份raw originals SHA256及旧pilot阶段见 [fixture manifest](c10-personnel-time-agent-manifest.json)。本次逐项验证4源码+32raw哈希均匹配，旧阶段不覆盖。

## 验证

- `TMPDIR=$PWD/.local/world-completion/tmp pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-personnel-time.snapshot.ts`：source8；加 `CLOCKY_EXAMPLE_MODE=lib`：lib8。前置 `pnpm run build` [final log](c10-build-final.log)，exit0、197 client artifacts。初次build读到正在写入的新unit unused import而失败，保留 [旧log](c10-build.log)，filefreeze后重新构建通过。
- [clock owner unit7](../../../.local/world-completion/tmp/world-execution-time-manifest.json)：实际canonical Session view/input append+flush、当前注册modelRequest observe/stage/submit owner boundary，没有LLM，不能冒称模型产出。JSON/SQLite实际provider重开保持原key/time/source，非新OS进程（后者由上述actualfixtures覆盖）。terminal历史prefix仅证明clock no-op，不声称真实人员commit。
- 真正一事件额度不足与完整实际wirebatch字节减1均before-append拒绝，request/decision acceptance/clock不发布；新fixture事先声明较小额度，失败后不加额度。源/pin/id/time/phase/重复篡改拒绝，消费无新World effect/decision/wake。命令与7pass/type/lint日志在同项目 `.local/world-completion/tmp/world-execution-time-manifest.json`。
- 早期scheduler/治理/人员定向71/71：[log](c10-boundary-regression.log)。最终更广6文件234项命令：[log](c10-regression-final.log)，231通过、3因原5000ms测试/activation disposal超时失败（并行构建/大型检查期间），没有业务断言失败。保持代码、超时和产品预算不变后精确重跑 `pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'wrong-sender|stale predecessors'`：4/4通过、152skip，[log](c10-world-timeout-recheck.log)。不将首次整批写成全绿。
- `pnpm exec tsc -b --pretty false` exit0：[log](c10-types-final.log)。`pnpm run lint` exit0：[log](c10-lint-final.log)。
- `pnpm run doc-sync` 29/29：[log](c10-doc-sync-fixed.log)。初次正在写入unit的类型错误与generated event/config source位置stale保留；按generator owner重建并同步中英引用及配对后通过。
- `git diff --check`通过。所有 TMPDIR、编译产物、cache、raw样本及日志保留在项目目录内；未改真实凭证/Provider配置，不生成项目外临时文件。

## 范围

本项证明原严格请求时间、actual commit时间、明确missed-time拒绝和冻结原件；不代表通用calendar occurrence、任意quota/领域、未知退休/取消IO/人员SIGKILL矩阵完成。时钟是内部Native调度事实，不新增Session必需event或agent-loop输入；所有实际模型材料仍通过原context-view与Session记录。双SDK完整新public域DTO/分布包/产品流程验收仍保留U12/U13未勾。
