# C28：真实 Native bootstrap、初始目标与有限 calendar

验收日期：2026-10-13（Asia/Tokyo）。一次性 initial-goal、person calendar goal、position calendar 三类 × JSON / SQLite × source / plain Node lib，共 12 格通过。create + 两个新进程 cold 共 36 个不同 PID；24 个 cold 全程 paused、模型调用为 0。source 6 例用时 40.26 秒；lib 6 例用时 7.61 秒。

本例使用真实 Loader 和既有冻结 `world-external-mediated-model.ts`。受信 legacy company 编译结果只提供原拓扑、Persona、预算和运行配置；真实 Native / Team API 准备 Entity / Participant / Session binding / Channel / relation 后，调用 `run.initializeWorld()` 完整初始化。这个证据不声称完整 v1 产品创建链路完成，也不覆盖 S01 / S07。checklist 由 root 评估 S09 / S10 范围，本子任务不修改或新建 items。

初始化原件包含两份资源账户、director-only 私有 fact、requester 私有 authored belief、真正 scenario-origin 初始 Norm、原委员会成员与冻结规则、scenario-origin 预配置外部 identity，以及一次性 goal 或有限 calendar。原 retained 序号 R 严格早于 applied S；actor ready、world、初始 fact / Norm 等完整资料与真实 source 都在同一 applied record S 发布。initial checkpoint 保存 paused / 0 模型、所有 Session unmaterialized、无 Agent、无预建 intent / decision / operation。超过 maxTime 的真实 initialize 请求先被拒绝且前后 snapshot 完全相同；合法初始化的原请求精确重试不新增 revision。

initial-goal case 的真实 occurrence.source.kind 为 initial，由原一次性 body stock 在 t1 触发；person calendar case 为 calendar，原 startsAt 1 / period 2 / maxOccurrences 3 只先排一个 occurrence。两者从空 intent 开始，只有明确 setPhase(running) 后实际 Agent 执行 simulation_observe / simulation_stage / simulation_submit，经 canonical 私有 Channel、director 实际模型裁决、Native v3 commit，产生唯一 stock request 与实际 inventory-as-of known quantity 7 fact。每个 create 调用 12 次模型，保留 actual request / plan / result / decision / operation / binding provenance 与两条真实 canonical post；初始资源、belief 与 Norm 保持原件。未来 calendar successor 仅在原 occurrence 消费后排期，没有预展开事项。

position case 用实际 Native drive（maxDriveSteps 仅降低至 1）消费 t1 / t3 / t5 occurrence，真实 relation/update 在 t2 结束旧 requester assignment，真实 relation/create 给 observer 新 assignment；原接收者分别为 requester / observer / observer，旧 t1 selection 不被重写。每次实际 selection 后，用户管理 API 明确取消尚未 productive 的原 goal wake，保留真实取消记录；这不是角色完成工作、接受旧债或模型成功。该 case create 与 cold 均 0 模型，无 intent / request / decision / operation，有限最后一次之后不再有 successor。

完整 checkpoint 后的两次新 PID cold 精确对账 world、worldBootstrap、resources、knowledge、relations、decisions、operations、scheduledEvents / wakes；原完整 journal prefix、Channel records、Session binding / content / unmaterialized 状态保持不变。16 条 canonical post（按各格独立原件计）均对应真实 sender Participant、唯一 accepted Channel envelope、唯一 canonical Agent inbox 及 user/message。私有 director canary / rationale 不进入 requester Session 或信封。lib 子进程无 --import / tsx，execArgv 为空，运行包均解析 /lib/。

最终输入共 5,314 文件，完整 runtime source / lib / config 副本共 58,948,635 bytes，逐文件复制 hash 均匹配；执行使用原项目路径，before / after-lib / after inventory 完全一致。聚合 SHA-256：`62d90438179f218032c4f7b6ee78a80a2dbddbdd31ba609cd4146bdd0c04d7e9`。最终保留 226 个原始运行产物，包括 Native / JSON / SQLite / Channel 数据、Session、实际初始和最终 checkpoint、original seeds、horizon 拒绝前后状态、model requests、精确 command / args / PID / exit / signal / stdout / stderr。`verified-matrix.json` 记录所有 root / PID / calls / source R/S / occurrence times / 逐文件 hash；独立 verify.log 已 exit 0，root 另在 `evidence/implementation/c28-world-bootstrap-root-audit.json` 核验全部当前输入与完整副本、36 PID、24 cold0模型、16真实 post、226原件。

精确最终执行命令（cwd `/Volumes/projects-mac/deepseek-harness`）：

```sh
TMPDIR="$PWD/.local/world-completion/c28-world-bootstrap" WORLD_BOOTSTRAP_EVIDENCE_ROOT="$PWD/.local/world-completion/c28-world-bootstrap/final-matrix-20261013/src" CLOCKY_EXAMPLE_MODE=src CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-bootstrap.snapshot.ts > .local/world-completion/c28-world-bootstrap/final-matrix-20261013/source.log 2>&1
TMPDIR="$PWD/.local/world-completion/c28-world-bootstrap" WORLD_BOOTSTRAP_EVIDENCE_ROOT="$PWD/.local/world-completion/c28-world-bootstrap/final-matrix-20261013/lib" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-bootstrap.snapshot.ts > .local/world-completion/c28-world-bootstrap/final-matrix-20261013/lib.log 2>&1
python3 .local/world-completion/c28-world-bootstrap/verify-evidence-20261013.py .local/world-completion/c28-world-bootstrap/final-matrix-20261013 > .local/world-completion/c28-world-bootstrap/final-matrix-20261013/verify.log 2>&1
```

输入 inventory 命令为 `python3 .local/world-completion/c28-world-bootstrap/freeze-inputs-20261013.py <manifest-path>`；最终目录的 inputs-before.json / inputs-after-lib.json / inputs-after.json 全部一致，runtime-copy.json 描述复制范围和逐文件校验。scoped lint 与 fixture tsc 已通过；root 联合完整 build、29-gate doc-sync 与最终 scoped lint 的结果由其 owning foundation report 记录。没有 publication、push 或额外实验。

历史失败和修复均完整保留并排除于最终验收。最初 4 个 cold 被旧事实回放的严格大于 World 序号规则拒绝；parent production 修复只接受完整原 bootstrap fact 的同 S / prior R 来源。第一次 lib 的 4 例暴露 norms→governance→scheduler 的真实 ESM TDZ；parent 改用纯 event-identities 来源后重 build 并在真实 consumer cwd 逐个 plain Node import 验证。新增 initial 变体的 4 个 fixture 构建失败版本（暂用 calendar，或空 initialGoals）也保留。`history-complete-failures-20261013.json` 将这 12 个实际失败进程逐个链接精确 fixture SHA-256；`history-final-manifest-20261013.json` 保存 400 历史原件路径与 hash。第一次 8 格期间发生的纯 type / JSDoc 字节变化没有被宣称输入不变；最终 12 格在联合 source / lib 稳定后用新目录、完整输入副本与一致 hash 重跑。

本子任务只新增两个 world-bootstrap example 程序及 Loader fixture，未修改 production、旧冻结 model / fixture 或 checklist。所有中间、runtime 副本、编译 / 测试产物均保存在项目文件夹中。
