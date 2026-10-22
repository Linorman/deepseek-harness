# P10：类型化读集、失效前驱与规划额度验收

2026-10-13，Asia/Tokyo。P10 完成，Native87/compiler9。相关实现不依赖全局 journal revision；后继方案保留 `supersedes`，已准备但失败或取消的规划仍占原案件额度。

## 修复

[World 原读集比较](../../../../../packages/simulation/simulation-local/src/world.ts)在关键对象变化时保留原 proposal/reads/hash/sequence，再追加 stale 原因与位置。新增两个具体修复：岗位在 accepted plan 后被实际 assignment 占满时，明确记录 `read-set-changed`；同候选人被另一原案件的招聘 hold 占用时，不再误报为授权丢失。真正 `SIM_WORLD_AUTHORITY` 仍为 `authority-unavailable`，其它十类非 position 配额错误保持原错误对象，不把所有限制转换为重规划。

[补证询问准入](../../../../../packages/simulation/simulation-local/src/world-evidence.ts)在问题展开前重验原 prepared resolve 的 reads。权限结束或读集过时拒绝，不创建 question/post；无关 revision 不拒绝。已接受原问题精确重试使用保留展开，历史问题不按后续修订重验。双后端两轮真实问答保留 input revisions 1、2，并以第三个方案消耗最后规划槽位，冷重开保留原件。

失效原因参与严格重放；Native87 明确拒绝旧流，避免新规则静默改读旧原因。JSON/SQLite 测试覆盖所有 0–86 与未知版本 99。Compiler 仍为 9；没有迁移、兼容默认值或历史重写。

## 验证

全部原件位于[本轮目录](../../../../../.local/world-completion/thread-01a1336a-readset)。

| 范围 | 结果和原件 |
| --- | --- |
| 新 Native87 与拒旧 | `native87.log`：5 文件/41 项；包含两后端拒旧流、真实占岗 stale、同人其他 hold、两轮补证、问答/到期/耗尽/取消及消费来源 |
| 类型化依赖领域 | `domains-final.log`：9 文件/160 项；组织既有人物、资金读集、人员、external rule/mediated、治理、制度与新占岗/补证测试。该轮业务规则与最终一致，运行于随后升级之前的 Native86；最终新格式由上述41项及以下完整矩阵复验 |
| 原规划次数/后继 | `planning.log`：7 项；无关 wake 不 stale，关键授权变更 stale，原前驱/supersedes 保留及额度停止，取消已准备尝试在双后端不退还额度 |
| 新岗位/候选人反例 | `position/` 保存实际 Native 原件；`conflict-before.log` 双后端复现旧分类，`conflict-after.log` 新6项+原原因回归4项通过，未选179项不计通过 |
| 补证过时反例 | `ask-stale-before.log` 双后端预期拒绝断言失败；`ask-stale-after.log` 8项通过。调用真正 expansion owner，不能把叶 schema 验证当作执行拒绝 |
| 真实 Loader | 最终 `source87.log` 与 `lib87.log` 各8项。公司/实验室 × JSON/SQLite 在三次关键读变化后保留三份 stale 前驱并稳定 `plan-budget`，重复 advance 不 append/不推理；另一组生成/既有人物招聘验证真实补证→后继plan→一次招聘 |
| 独立冷进程 | `matrix87.json`：16案例/40进程，warm288 scripted模型调用，cold0；重规划8案例各一次cold，补证8案例各两次cold。原始运行目录保留，不删证据 |
| 发布前置检查 | `build87.log` 完整构建/197 client artifacts；`lint87.log` 无错误；`doc-sync87.log` 29/29；host类型检查由构建和doc门禁验证 |

1865份相关source/lib/测试及配置输入保存在 `manifest87.json` 和 `source-lib87.tar.gz`，manifest SHA-256 为 `b033aaba4dd699402154d9a222e5f6aefc0b5642bb2deaa73d79c686230144bc`。这是本项相关输入，不是全仓最终发布冻结。未完成的 B05、P01、P12、P16 及 U/R 项仍保留原边界。

## 准确命令

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/world-position-readset.spec.ts packages/simulation/simulation-local/tests/world-evidence-rounds.spec.ts packages/simulation/simulation-local/tests/world-evidence-flow.spec.ts packages/simulation/simulation-local/tests/world-evidence-deadline.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'planning attempt|read sets when|stale predecessors|unrelated later wake|replanning|critical'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_REPLANNING_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-readset/loader87" WORLD_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-readset/evidence-loader87" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-replanning.snapshot.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_REPLANNING_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-readset/loader87" WORLD_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-readset/evidence-loader87" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-replanning.snapshot.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

旧 external 单元夹具缺少 request source 的 accepted actor decision，因请求额度投影失败；补齐该纯 fold 测试的明确来源后，18项与最终160项均通过，不冒充真实模型来源。旧版本、初轮红测试及 lint 失败日志均保留，最终矩阵仅计 `*87` 目录。没有提高预算、延长超时、刷新快照、提交或推送。
