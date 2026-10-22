# P02：实际 Loader 领域目录准入验收

2026-10-13，Asia/Tokyo。本证据只验收原 P02，不新增 checklist items，不声称 P01/P16/U12 或完整 MVP 完成。主线 C42 由另一个活跃任务推进；本轮仅新增独立目录准入测试及其双语测试 Note，没有修改并发的业务上下文源码。

## 实现与拒绝路径

[实际 Loader 测试](../../../../../packages/simulation/simulation-local/tests/world-catalog-admission.spec.ts)复用正式 simulation-local 测试配置，分别在 JSON/SQLite 新进程启动真实 provider。其[消费 fixture](../../../../../packages/simulation/simulation-local/tests/fixtures/world-catalog-admission.ts)从 `ctx.simulations.domains('local')` 获取正式注册表，逐一核对全部导出的内建 pin。当前 12 个操作：organization 的 generate-and-hire、hire-existing、transfer、depart；governance 的 propose-norm、vote、propose-hire-approval、enact-norm、revoke-norm；external.interact 的 1/2/3 三版。测试将样本 pin 集合与公开导出集合比较，新增内建 pin 后必须添加样本。

每个 pin 都实际获取并释放原实现 lease，解析合法 request、plan、非提交结果和 mutation，共 48 个不同完整样本。每个样本中每个对象分别注入额外字段，每组 100 个载荷拒绝用例；另外拒绝四种 envelope 的额外字段、伪造 requester、未知 domain/operation/version 和不匹配的 implementation generation。拒绝分类由真实 `SimulationWorldDomainError.code` 断言。所有检查前后实际存储目录为空、commit 事件为零；不分配 run、人物或模型。Loader 卸载后，全部原 pin 的 acquire/pin 都以 implementation-unavailable 拒绝。

已复核 [Native createWorldIntent](../../../../../packages/simulation/simulation-local/src/world.ts) 在构造业务事项前执行所选 schema，`assertWorldAdmission` 要求原 manifest 的 live admission；[mutation owner](../../../../../packages/simulation/simulation-local/src/world-mutation.ts) 在 reducer 前解析 mutation。不是仅测另建注册表、跳过正式 owner 的配置链。既有 registry/protocol/disposal 回归同时验证四类严格 parser、嵌套宽松 schema 注册拒绝、精确世代与异步退役责任。

## 固定输入和实测结果

[正式矩阵](../../../../../.local/world-completion/thread-01a1336a-catalog/matrix)保留执行前后完整清单及 5,419 个输入的字节副本（60,600,730 字节），共同 SHA-256 为 `922fd3c74b41a25ac08d5bb0feb75c2bcefe5e8394f72bf7e949b099b7e74172`。before/after 完全一致。此副本包含 source/lib 与配置，但不包含凭证或依赖安装目录；不冒称 Git HEAD 代表未提交工作区。

source 四个测试文件 74 项通过，compiled Loader 两项通过。四个真实 Loader PID 分别为 92266、92267、92431、92432；source 实际解析 src，compiled 实际解析 lib 且 execArgv 为空。编译产物为项目已有构建，本轮没有重建或修改正式代码。[独立审计](catalog-admission-root-audit-20261013.json)逐文件核对副本 hash、四进程结果、实际空存储、12 pin 及 100 拒绝路径的一致性。每个进程原 stdout/stderr、启动参数和退出状态均保留。

类型检查及仅新增两文件 lint exit0，双语配对 exit0。全量 doc-sync 的运行结果为 27 passed、2 failed：并发 C42 新 Note `2026-10-13-recorded-actor-business-context.md` 的 Status 头部格式，以及 simulation-local README 的 Model Experience 段落位置。日志原样保留；本轮没有覆盖另一任务的文档，R11/R12 不据此勾选。目录测试 Note 没有产生上述错误。

## 精确命令

从项目根执行，日志、TMPDIR、源码副本及构建产物均位于本项目。

```sh
sh .local/world-completion/thread-01a1336a-catalog/run-matrix.sh
PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/thread-01a1336a-catalog/audit.py
TMPDIR="$PWD/.local/world-completion/tmp" node --import tsx/esm scripts/run-oxlint.ts packages/simulation/simulation-local/tests/world-catalog-admission.spec.ts packages/simulation/simulation-local/tests/fixtures/world-catalog-admission.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/world-completion/thread-01a1336a-catalog/host.tsbuildinfo --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run verify-translation-pairing --write .agents/notes/implemented/testing/2026-10-13-world-domain-catalog-admission.md
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[脚本](../../../../../.local/world-completion/thread-01a1336a-catalog/run-matrix.sh)保留完整 source/lib 命令。前两次 source 探针分别验证请求范围和扩展后的四类范围；首轮 lint 的缩进及 any-array 问题已在正式矩阵前修正，失败日志保留。最终 lint、type、pairing、doc-sync 及审计日志在[证据目录](../../../../../.local/world-completion/thread-01a1336a-catalog)。

## 验收边界

P02 的所有内建注册、未知字段/操作/版本在执行前拒绝已有上述实现及实测证据，现勾选该项。样本不穷举每个合法联合分支；严格注册规则检查全部 schema 结构，各领域既有测试继续负责语义。空非提交 result 不代替已提交结果正确性。未测试真实业务副作用、模型质量、SDK 发行、GUI 或 SIGKILL；这些仍归原对应未勾项。当前并发主线后续变化应重新判断受影响的证据，不能把本次局部通过用于最终全仓验收。
