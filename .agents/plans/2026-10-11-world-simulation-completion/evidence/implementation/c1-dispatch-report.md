# C1c 招聘执行分派证据

输入见 [manifest](c1-dispatch-input-manifest.json)，SHA256：`36b09185957fc21694f94ca9a31128c02d25cab16f08c34dbe2bef7b14c5455d`。日期 2026-10-12。保持原 112 个 checklist items，仅完成 P13，不把 hiring handler 分派等同于全部动态 Native 领域实现。

原 driver 的 reserve/quiesce/Participant/Channel/commit/finish 逻辑移至 OrganizationWorldExecution；driver 使用精确 pin dispatcher，仍统一选择 Native wake、上下文与调度，无公司/实验室剧情分支。产品 owner 和直接示例调用者传入 Cordis effect scope。执行必须与 Native 原计划完全相等，按原 schema/implementation/generation 解析和 acquire；同 plan 回调不可并发。

lease 在未知 IO、未结预约与精确未完成 maintenance 期间保留，包含已 committed 招聘。卸载先关闭新执行、排空已准入回调；仍有 Native 责任时显式报告 implementation-unavailable，保留原 lease，不无限等待、不释放业务占用。Cordis cleanup 记录该失败；原 lease 仍允许原责任对账。Native 尚未新增持久 unavailable 状态或动态 reducer manifest，P15 仍未完成。

真实 Loader 场景注入 hire commit 后 finishMaintenance 失败，断言原 committed reservation 与 active maintenance；卸载 effect Fiber 后仍由原 driver.reconcile 结算，模型调用不增加，无第二 reservation；显式继续后新人独立行动/结果通知完成。新进程 paused restore 保持原结果且零推理。覆盖公司/实验室 × JSON/SQLite。

准确已执行命令（日志仅重定向到本目录）：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run test packages/simulation/simulation-world/tests/execution.spec.ts packages/simulation/simulation/tests/world-domain.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_ENTRY=src pnpm run test:snapshot examples/simulation-company/tests/world-execution-retirement.snapshot.ts examples/simulation-company/tests/world-autonomous.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib pnpm run test:snapshot examples/simulation-company/tests/world-driver.snapshot.ts examples/simulation-company/tests/world-execution-retirement.snapshot.ts examples/simulation-company/tests/world-autonomous.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=src pnpm run test:snapshot examples/simulation-company/tests/world-owner.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation-world/src/{driver,execution,organization}.ts packages/simulation/simulation-world/tests/execution.spec.ts packages/simulation/simulation/src/world-domains.ts packages/simulation/simulation-product/src/{administration,world-owner}.ts examples/simulation-company/tests/{world-driver-scenario,world-model-pool-scenario,world-execution-retirement.snapshot}.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run test packages/client/ui-simulation/tests/world-draft.client.spec.ts packages/client/ui-simulation/tests/world-modules.client.spec.tsx packages/client/ui-simulation/tests/world-components.client.spec.tsx packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/workspace.client.spec.tsx
```

`CLOCKY_EXAMPLE_ENTRY` 不是 loader 的选项，上述 source 命令实际采用默认 src；第一次误命名 c1-dispatch-lib.log 的同变量测试也是 src，不能作为 lib 证据。最终 lib 使用正确 CLOCKY_EXAMPLE_MODE=lib，未 refresh/record。

- [46 单测](c1-dispatch-tests-final.log)：精确 pin/篡改拒绝、未知 IO lease、同 plan 并发拒绝、callback drain、真实 Cordis 卸载及 domain registry。
- [source 新恢复/自主申请 8 项](c1-dispatch-retirement-source.log)；[正确 lib 16 项](c1-dispatch-lib-verified.log)：完整 driver 8、恢复故障 4、自主申请 4。
- [原 source owner/取消矩阵 52 项](c1-dispatch-owner-source.log)：此前拆分验证；[最终 source owner 40 项](c1-dispatch-owner-final-source.log)另以最终输入验证，包括 request-before-publish、Channel/Participant IO后、reserve/commit窗口、退休超时/卸载/迟到回调及结果通知前 SIGKILL。
- [build](c1-dispatch-build-fixed.log)：Host/Client 类型与打包、Web 完成，197 artifacts。
- [typed lint](c1-dispatch-lint-current.log)：10 files、exit0；[doc-sync](c1-dispatch-doc-sync.log)：29 passed。
- [证据链接](c1-dispatch-evidence-links.log)：2294 Markdown files全部相对链接及fragment通过。
- [Client helper 消费者](c1-dispatch-client-helper.log)：75 tests/5 files。

保留首次 lint 失败与自动格式修正、首次 build 失败日志。现有 UI 的 world-fixtures helper 无 Client 后缀，Host aggregate 误导入 Client runtime；改为 world-fixtures.client.ts并更新5处引用，符合现有双 compiler face 命名，不改 UI 行为。README与拥有提案同步双语与pairing。复用同一只读 subagent复查，两处lease/卸载缺陷修复后无新增发现。

P01/P02/P14/P15/P16保持待办：Native领域配置/纯transition注册、第二真实领域、持久未结责任恢复以及完整domain DTO/SDK仍需实现。此增量不宣称 governance、人事变动、external或完整v1场景完成。
