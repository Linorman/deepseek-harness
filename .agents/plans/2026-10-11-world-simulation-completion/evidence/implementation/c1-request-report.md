# C1 通用请求与自主目标证据

日期 2026-10-11–12（Asia/Tokyo），最后登记 2026-10-12。实现/测试输入 hash 为 `50c8d8a16aa656637ae1f844190c0e11b0ed43d4fffe07814151d1665cef3e8c`，逐文件见[manifest](c1-input-manifest.json)。所有临时文件、缓存、归档与编译输出在本项目内；未 commit、push、refresh snapshot 或请求真实模型。

本部分完成 P03：新的 world/request 携带明确 domain/operation/version、businessKey、expectedTime、typed evidence 和严格已安装payload。Native从实际已消费Decision/epoch/规范binding派生主体；goal上下文冻结当前任职与操作授权，并可在接受请求/私有post的同一批次创建此前不存在的HireIntent。业务唯一键现在按run/domain/operation/businessKey派生，目标/主体/前案变化拒绝。

普通消息不会成为目标：driver仅对Native调度器保存的结构化world-goal wake选择goal上下文；实际通信仍是message。请求者/Session自述、未知domain/operation/version与不合法payload在新案/operation前拒绝。正常招生成新人、原独立Session/通知/暂停/恢复语义保持。

Native stream 61在world operation/intent日志保存已消费实现pin，request/plan保留同一pin及真实source，缺失/改变pin在fold拒绝；旧60及更早日志在两后端拒绝。typed读集替换招聘专用字段，覆盖world-definition、position entity、can-hire relation及assignment relation-set hash（包括空集合）。公共纯domain registry仅提供严格schema、保留parser、generation lease/disposer；尚未完成动态Native注册/执行分派与真实执行lease集成，P01/P02/P15/P16不提前勾选。

| 验证 | 结果 | 日志 |
|---|---|---|
| Native/协议 | 294 passed / 4 files | [c1-native-tests-current.log](c1-native-tests-current.log) |
| source真实Agent | 12 passed / 2 files，company/laboratory × JSON/SQLite；autonomous为无预建intent、原产品命令及新进程恢复 | [c1-agent-source-current.log](c1-agent-source-current.log) |
| lib真实Agent | 12 passed / 2 files，需前置全量build | [c1-agent-lib.log](c1-agent-lib.log) |
| lib最终新工具schema | 4 passed；公司/实验室，两后端，18次脚本工具推理，冷恢复零推理 | [c1-autonomous-lib-final.log](c1-autonomous-lib-final.log) |
| schema/browser边界 | 60 passed / 3 files；retained request parser可读，lease不重开，纯入口/private旁路检查 | [c1-schema-check.log](c1-schema-check.log) |
| locale helper类型 | 15 passed / 3 files；仅helper类型放宽为Record<Key,string>，保留界面实现 | [c1-locale-test-types.log](c1-locale-test-types.log) |
| build/types | Host/Client tsc、bundles、web；197 client artifacts | [c1-build-pass.log](c1-build-pass.log) |
| docs | 29 passed / 0 failed / 0 skipped | [c1-doc-sync-final-pass.log](c1-doc-sync-final-pass.log) |

准确命令：

Native/协议：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation/tests/world-domain.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/run.spec.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-native-tests-current.log 2>&1
```

source真实Agent：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-autonomous.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-agent-source-current.log 2>&1
```

lib真实Agent：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-autonomous.snapshot.ts examples/simulation-company/tests/world-driver.snapshot.ts --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-agent-lib.log 2>&1
```

lib最终新工具schema：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-autonomous.snapshot.ts --maxWorkers=1 > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-autonomous-lib-final.log 2>&1
```

schema/browser边界：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/tool-simulation/tests/schema.spec.ts packages/simulation/simulation/tests/world-domain.spec.ts scripts/client-bundle-purity.spec.ts > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-schema-check.log 2>&1
```

locale helper类型：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/client/ui-simulation/tests/creation-preflight.client.spec.tsx packages/client/ui-simulation/tests/needs-you.client.spec.tsx packages/client/ui-simulation/tests/world-creation.client.spec.tsx > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-locale-test-types.log 2>&1
```

build/types：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-build-pass.log 2>&1
```

docs：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync > .agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c1-doc-sync-final-pass.log 2>&1
```

最终 typed lint 对 C1 源码/测试、纯入口门禁及构建所需的 locale helper/JSDoc 修正共 28 个文件执行，最终全列表exit0无诊断，见[c1-lint-pass.log](c1-lint-pass.log)；此前draft helper行宽/arrow格式及隐式Object字符串化已修复；命令使用 `TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts`，文件列表为本 manifest 的前述对应 .ts/.tsx。生成命令为 pnpm run gen-cordis-catalog、gen-tool-catalog、gen-module-graph；工具schema JSON与module图/表同步双语并重新记录pairing。根/包文档及原提案更新当前contract；提案保持proposed。

保留早期失败：消息误入goal导致额外请求、future source超过snapshotRevision、tool oneOf的非固定tuple、工作区新语言表的literal helper类型、缺少export JSDoc和生成目录/pairing过期。分别修正实际owner或类型/注释；没有调整不变量、断言、deadline、预算或record snapshot制造通过。

范围限制：仅当前已安装organization.generate-and-hire/1走Native新封装；其它domain schema类型不等于已实现对应业务。governance、norm/facts、existing hire、transfer/departure、external world、完整v1输入、日历、完整产品/SDK观察与故障/真实模型验收均继续待办。目标wake当前由受信Native入口持久保存；作者场景goal/calendar入口仍归S09，未宣称已完成。下一步C1c将移出driver招聘执行，安装受控domain处理器，并接入会议室测试domain的真实请求/Channel/恢复；其后补完整domain DTO/persisted/schema版本与SDK消费者。

已向用户请求真实provider/model/profile及硬预算信息，不要求发送密钥；没有答复时继续keyless实现，B04/R08保留缺口。

构建期触达的 draft helper 标签仅对非字符串输入使用 JSON 文本，合法 id/version 的展示保持原文本；JSDoc 和测试类型修正不改变产品流程。
