# C27–C28 初始化、v1 compiler 与有限日历基础

日期：2026-10-13。Native stream 76；v1 compiler 2。本记录是完整 MVP 的分段证据，不替代公开创建命令、SDK/UI 或综合故障矩阵验收。

显式 v1 parse/compile/verify/export 入口使用有界 JSON/YAML 解码，严格覆盖完整作者分组；关系诊断检查身份、引用、组织环、任职区间/容量、委员会门槛、资源/控制权和时间。resolved 固定完整原定义、实际模型与限额、领域 pin 和 bootstrap 输入。原默认产品 API 仍使用 v0，没有静默将 v0 当 v1。

Native 先持久保留完整初始化责任记录 R，再在单个记录 S 原子提交所有 ready、World、初始资源/事实/私有 belief、场景来源制度、模拟外部身份和有限日历；R<S。失败应用保留 preparing 与原身份。真实准备 helper 精确重试读取原 binding/确认 Channel，再应用原书，不通过普通 Participant 创建绕过未结算禁令。初始 Norm 的来源不含虚构提案、投票或 resolution；后续真实提案服从冻结委员会策略。初始事实与 World 同 S 的回放，仅允许完整原 payload 与 prior R 来源相等。

日历来源固定在原 bootstrap；每次实际消费持久保留接收者，岗位按当时有效任职选人，普通目标派生 wake 不预建 world request；每轮只排一个有界后继。完整书与 occurrence 历史使用原冻结字节上限。

## 命令与结果

以下路径均位于项目内的 `.local/world-completion/c28-bootstrap/`；所有失败原日志保留。

- `TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-preparation-v1.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-scenario/tests/v1-compiler.spec.ts packages/simulation/simulation-local/tests/world-bootstrap.spec.ts packages/simulation/simulation-local/tests/world-governance.spec.ts packages/simulation/simulation-local/tests/world-norms.spec.ts scripts/client-bundle-purity.spec.ts`：7 files、289 tests 通过，`combined-verified.log`。包括双后端真实 Native/Team 初始化、应用失败/原件重试、同 S fact 的伪正文/缺书拒绝、原 v0 准备194项回归、纯 compiler 与治理/制度、客户端 wire 纯度。
- `TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build`：`build-cycle-fixed.log` 完整通过，197 client artifacts；内含 host/client tsc。纯类型/JSDoc 变化不改变模型或日历运行行为。
- `examples/` 消费者目录下，用五个独立普通 Node 进程分别 `await import(process.argv[1])` core root、world-authoring、world、world-domains、scenario：`compiled-schema-imports-retry.log` 全 status0。最初在 root 运行因根包不声明这些依赖而失败，原日志保留；未修改 resolver 规则。
- scoped lint：`lint-complete.log` 零错误；`doc-sync-complete.log` 29 gates 全通过，包含 JSDoc、目录/图和双语配对。目录更新仅同步原声明块与来源行；过程保留 `*-generator-pair-diff.json`。
- C27 初始制度/委员会 helper 的60项及执行覆盖证据：`.local/world-completion/c27-norms/report.md`。

真实 Loader 的首次冷恢复发现初始 fact 同 S 被旧严格后序校验拒绝；完整原件/来源校验后修复。编译产物矩阵又发现 norms→governance→scheduler→norms 的 TDZ；governance 事件 ID 改为独立 primitive 叶子后重建。未跳过 lib，未放宽初始化准入或任何额度。

## 未完成范围

S01/S04/S05/S06/S07/S08 的公开产品命令及完整拒绝范围尚未验收，S10 只证明日历任职选择和有限 horizon，未将其等同全部截止/生效/回应排序。Director 事件声明已保留，执行授权尚待实现（S11）。双 SDK、作者 UI、第三场景、综合剧本与真实 provider/model 试验继续待办。原112项 checklist 不新增、不删减，不以基础实现完成宣称完整 MVP 完成。

## S09 原件独立核验

最终输入 SHA-256 `62d90438179f218032c4f7b6ee78a80a2dbddbdd31ba609cd4146bdd0c04d7e9`：5,314份当前文件及完整58,948,635字节副本逐一相等。root 独立审计命令 `python3 .local/world-completion/c28-bootstrap/root-audit.py`，结果见[审计原件](c28-world-bootstrap-root-audit.json)。12格为一次性 initial goal、周期 calendar goal、岗位 calendar × JSON/SQLite × source/plain Node lib；共36独立进程、24次冷恢复零模型、16真实 canonical posts、226原始产物。initial 与 calendar 的新请求均由真实 accepted Decision 派生，原初始化无预建 intent；岗位 case 以真实显式管理取消未执行 wake，使时钟依次到1/3/5并换任，不能把取消当角色接受工作。所有初始 checkpoint 为 paused/unmaterialized，两个独立 cold 保留原书/日志/实体/Session/Channel/occurrence。最终记录位于 `.local/world-completion/c28-world-bootstrap/final-matrix-20261013/`。

[实际 Loader 两种模式的准确命令、完整输入及失败历史](c28-world-bootstrap-proof-20261013.md)与 root 审计共同完成 S09；checklist 已仅勾原 S09，现为54/112。
