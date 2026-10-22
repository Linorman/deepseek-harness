# C32 v1 作者工作台与真实浏览器证据

2026-10-13，Asia/Tokyo；工作目录 `/Volumes/projects-mac/deepseek-harness`。JSON 与 SQLite 两个真实浏览器用例全部通过，创建各自唯一的暂停原件，全程零模型调用。最终 Simulation UI 为 **41 个文件、405 个测试通过**；Client、Host 聚合类型检查与 scoped typed lint 均 exit 0。

## 输入与实际执行方式

[浏览器程序](../../../../../apps/web/tests/world-v1-authoring.snapshot.ts) 最终 SHA256 为 `dce462b9c49c8be247d9ff870a0cf7526cc1ac187fbfdc9f539069e509e5843e`；第五轮成功程序为 `831dd355313b6afebbc4fdad3eb435eebee8852429585466f48a476d9017a9a8`。实际使用项目 Playwright 脚手架、已构建的前端 bundle、真实 HTTP/WebSocket、Cordis Loader、Simulation Product/Administration、Native、Team、Participant、Session 和 JSON/SQLite 持久化服务。当前没有 Browser 插件，故采用项目维护的 Playwright 路径。模型路由来自原有 `world-external-mediated-model.ts`，创建与浏览不调用它的推理方法；计数读取该实际适配器模块保留的请求数组。

这不是 source/lib 双执行矩阵，也不是 SDK 发行包验证。测试由 Vitest 执行，Loader 加载实际部署；前端来自本次成功完整构建产物。原 v1 输入与安装 catalog 来自现有 `examples/simulation-company/tests/fixtures/world-v1-product/deployment.ts`。第六轮只在测试的本地深拷贝中追加一条 advisory 制度及正文 canary，没有修改共同 fixture、生产 source 或 lib。测试通过显式 `Config.world.authoringTemplates` 发布该公开模板，模板不从私有运行或其定义导出推导。

父任务在焦点修复后的完整构建中记录 197 个前端产物，日志为 [.local 构建记录](../../../../../.local/world-completion/c31-v1-preparation/root-tests/build-focus-fixed.log)。后续 C31 fresh 冻结的 [5,346 项 source/lib/config 输入清单](../../../../../.local/world-completion/c31-v1-preparation/final-matrix-20261013-retry/inputs-before.json) 的内容集合 hash 为 `beb06512c96ad734ed54833e1cd9d747afd92b300dd842fb43e37b220a6468ce`，清单文件自身 SHA256 为 `abb27922b3207ba44c84094c259442116f36262ff121732dab35c9831c003ed6`。当前 `WorldDraftTable.tsx` 的 SHA256 为 `a4957d8c454728859c52345232b1596f12a72b39f81c0547a0586478c372a5db`，其 `lib/client.js` 为 `3b16fa861b19af2c05abadb2b723cc374104c864ae4344155a9bd5e02666ee91`，均与该清单吻合。这个清单在第五轮成功执行后、第六轮前生成，不能称为全部浏览器执行均具有执行前冻结；它也不包含新 browser test 或 `apps/web/dist`。父任务独立审计另外补齐这些实际浏览器输入和原件。

## 已验证行为

- 模板、JSON 文件、YAML 文件与空白骨架进入同一 v1 工作台；完整模型逐字段往返相同，11 个表单分节全部可用，原 v0 保留其 reserved 行为。
- 源码与表单共享一个草稿。委员会成员的未完成 JSON 保留为可修正原值；切换源码与表单不丢失。未知容器字段保留并显示源码编辑提示。取消源码重生成确认或拒绝容量超限编辑时，复合字段显示父草稿原值。
- 将普通目标引用改成未声明人物后，共享编译器返回 `behavior.initialGoals.0.target.personId / unknown-reference`；实际定位按钮将焦点移到 `initialGoals` 的目标单元格。
- 编辑委员会、初始制度、资源、外部身份和初始目标；清空制度结束时刻产生 `null`。JSON/YAML 往返及实际 create HTTP payload 等于包含全部原字段的预期完整定义。
- 真实预检展示安装模型、操作 pin/implementation/generation、字面委员会成员/quorum、实际 validated 与 advisory enforcement、模拟来源计数、默认额度及预览承诺；advisory 正文 canary 不进入预览。预检之前没有 create 请求或模型调用。
- 双击确认仅发送一个原 `world-create`。实际 Native 暂停，存在初始完整检查点与已确认 Team；三个真实 local-agent Participant 对应原 Native binding，三个 Session ID 均 reserved/unmaterialized，没有 Agent、决策或操作，也没有物化 Session 日志。
- 打开已登记运行、重新加载以及从该运行导出 JSON/YAML 保持原完整定义、唯一原创建、原 Native revision 和零推理。
- 模板选择器键盘进入与 Tab 焦点限制、单元格 Enter 编辑、诊断焦点、1440/390 两种宽度、浅/深主题、reduced-motion 稳定后零持续动画均通过；外层没有水平溢出。窄屏实际展开检查 drawer。

## 成功原件与截图

| 后端 | 实际 origin | 原件摘要 | 保留的运行目录 |
|---|---|---|---|
| JSON | `http://127.0.0.1:57303` | [proof.json](../../../../../.local/world-completion/c32-v1-authoring/json/browser-1k3ss4/proof.json) | `.local/world-completion/c32-v1-authoring/json/browser-1k3ss4` |
| SQLite | `http://127.0.0.1:57317` | [proof.json](../../../../../.local/world-completion/c32-v1-authoring/sqlite/browser-96vNZa/proof.json) | `.local/world-completion/c32-v1-authoring/sqlite/browser-96vNZa` |

两个目录都保留真实 overlay、workspace、Session roots、Native JSON 日志或 SQLite 数据库、原定义导出与六张成功截图；`proof.json` 是测试断言摘要，原件验收另由父任务读取数据库/日志完成。两个目录的 `original-export.json`、`original-export.yaml` 均已通过严格输入解码和完整定义相等断言。

已视觉检查最终 [1440 浅色预览](../../../../../.local/world-completion/c32-v1-authoring/json/browser-1k3ss4/01-preview-light-1440.png)，validated 与 advisory 同时清楚显示；最终 [390 深色 drawer](../../../../../.local/world-completion/c32-v1-authoring/json/browser-1k3ss4/01-preview-dark-390.png) 与 [暂停运行重开](../../../../../.local/world-completion/c32-v1-authoring/json/browser-1k3ss4/02-paused-original-reopened.png) 也保留。此前第五轮的这三种布局均逐张视觉检查过；JSON/SQLite 最终目录各自另外保留 `00-located-reference.png`、`01-preview-light-390.png` 与 `01-preview-dark-1440.png`。

第五轮成功原件的 [父任务独立审计](c32-v1-authoring-root-audit.json) 保留其原范围：5,720 个输入、72,908,634 字节完整副本、34 个成功原件；两后端均实际读取 Native version 76、34 个 records、唯一 bootstrap/初始 checkpoint、唯一原命令和零模型调用，并通过 plain Node 的 built decoder 核验 JSON/YAML 导出。该输入捕获发生在执行后，第五轮审计不冒充包含新增 advisory 的第六轮审计。

最终第六轮的 [advisory 独立原件审计](c32-v1-authoring-advisory-root-audit.json) 同样 exit 0，输入集合 SHA256 为 `4d99852d3dfcdee85ec4bcbcc9e61b18c020becf8a9c53afc22687053d1cd870`，5,720 个输入的完整副本合计 72,909,180 字节，另核验 34 个成功原件。它明确记录执行后捕获，额外覆盖最终 browser program、脚手架/config/`apps/web/dist`，并独立读取两个新 Native 原日志/数据库及以 plain Node built decoder 核验两个格式导出；这项独立 decoder 检查不改变浏览器本身的运行模式。第五轮审计及原副本保留，没有覆盖或冒用为新范围。

## 六轮历史与焦点回归

所有六轮日志、失败截图、失败 DOM 与两后端运行目录均保留，未删除或改写失败结果。

| 轮次 | 日志 | 结果与原因 |
|---|---|---|
| 1 | [browser-first.log](../../../../../.local/world-completion/c32-v1-authoring/browser-first.log) | 2 failed。测试强制 focus 未选中的 `tabIndex=-1` 单元格，Enter 仍编辑旧 active 单元格；修正测试选择动作。目录 JSON `browser-NgfCq1`、SQLite `browser-W5hsgg`。 |
| 2 | [browser-second.log](../../../../../.local/world-completion/c32-v1-authoring/browser-second.log) | 2 failed。真实 click→快速 Enter 暴露旧 rAF 抢走编辑器焦点、触发 blur 提前提交；这是生产缺陷。目录 JSON `browser-qlWw70`、SQLite `browser-a5MRbB`。 |
| 3 | [browser-third.log](../../../../../.local/world-completion/c32-v1-authoring/browser-third.log) | 2 failed。焦点修复后复合输入保留已通过；测试误认为诊断消息包含 `missing-person`。实际消息为 `Referenced Entity must be declared`，改用真实可读目标及 raw path 定位。目录 JSON `browser-O8NDeg`、SQLite `browser-NVt5xd`。 |
| 4 | [browser-fourth.log](../../../../../.local/world-completion/c32-v1-authoring/browser-fourth.log) | 2 failed。预览通过；测试在主题/reduced-motion 切换同 tick 即采样旧过渡，看到 6 个 running animation，改为等待稳定后的零动画。目录 JSON `browser-mZszpk`、SQLite `browser-B8QKIR`。 |
| 5 | [browser-fifth.log](../../../../../.local/world-completion/c32-v1-authoring/browser-fifth.log) | **2 passed，8.70s**。JSON `browser-0cXFL5`、SQLite `browser-YBk069`；零模型调用、一次原创建及实际检查点断言全部成立，尚未包含 advisory 展示补证。 |
| 6 | [browser-sixth-advisory.log](../../../../../.local/world-completion/c32-v1-authoring/browser-sixth-advisory.log) | **2 passed，9.37s**。本地定义深拷贝同时具有 validated/advisory，正文 canary 不入预览，整套原流程在新目录重新通过；生产 source/lib 与共同 fixture 不变。 |

第二轮缺陷的 [修复前组件回归](../../../../../.local/world-completion/c32-v1-authoring/focus-regression-before.log) 为 1 failed/2 passed：执行旧选中单元格的 rAF 后 textarea 被移除。生产修复仅在延迟 `focusCell` 回调中检查 `editingRef.current`，编辑期间不抢焦点；commit/cancel/locate 仍先退出编辑并恢复单元格焦点。[修复后定向回归](../../../../../.local/world-completion/c32-v1-authoring/focus-regression-after.log) 为 3 个文件/16 tests passed。原 C31 运行已协调停止并保留，修复与重建后才进行第五轮；没有在矩阵继续执行时修改冻结源码。

## 准确命令与静态检查

以下命令均在上述工作目录执行。浏览器第一至第六轮使用同一命令，只将输出重定向为相应轮次日志；程序逐轮修正，最终程序 hash 已在上文注明。

```sh
CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-v1-authoring.snapshot.ts > .local/world-completion/c32-v1-authoring/browser-sixth-advisory.log 2>&1
pnpm exec vitest run packages/client/ui-simulation > .local/world-completion/c32-v1-authoring/unit-final.log 2>&1
pnpm exec tsc -b tsconfig.client.json --pretty false > .local/world-completion/c32-v1-authoring/typecheck-focus.log 2>&1
pnpm exec tsc -b tsconfig.host.json --pretty false > .local/world-completion/c32-v1-authoring/typecheck-host-final.log 2>&1
pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-simulation apps/web/tests/world-v1-authoring.snapshot.ts > .local/world-completion/c32-v1-authoring/lint-final.log 2>&1
pnpm exec tsx scripts/verify-export-jsdoc.ts > .local/world-completion/c32-v1-authoring/jsdoc.log 2>&1
pnpm exec tsc -b tsconfig.host.json --pretty false > .local/world-completion/c32-v1-authoring/typecheck-host-advisory.log 2>&1
pnpm exec tsx scripts/run-oxlint.ts apps/web/tests/world-v1-authoring.snapshot.ts > .local/world-completion/c32-v1-authoring/lint-advisory.log 2>&1
pnpm exec vitest run packages/client/ui-simulation/tests/world-v1-author.client.spec.tsx > .local/world-completion/c32-v1-authoring/focus-regression-before.log 2>&1
pnpm exec vitest run packages/client/ui-simulation/tests/world-v1-author.client.spec.tsx packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/world-draft.client.spec.ts > .local/world-completion/c32-v1-authoring/focus-regression-after.log 2>&1
```

[第一次完整 UI 集](../../../../../.local/world-completion/c32-v1-authoring/unit-all.log) 为 404 tests passed；新增真实焦点回归后，[最终完整集](../../../../../.local/world-completion/c32-v1-authoring/unit-final.log) 为 405 tests passed。最终 Client/Host 聚合类型日志与 scoped typed lint 日志为空，均 exit 0；公共 JSDoc 检查通过。单独直接调用 ESLint 没有仓库配置，不能算有效检查；最终使用仓库 `scripts/run-oxlint.ts`。新 browser test 已由父任务登记到 Host compiler include，并从 Client `apps/web` 项目排除。

## 验收边界

本报告证明作者入口、完整草稿保留、显式 v1 预检、真实一次暂停创建、原定义导出与上述浏览器交互。只执行 Chromium；没有声称触屏设备或完整 200% zoom 矩阵。源码重生成取消、容量拒绝及未知字段提示的边界由组件/草稿回归覆盖，未冒称它们都经过浏览器。

重新打开的 World Overview 仍明确显示 Host domain reads 尚未发布；组织、治理、外部世界的实际产品投影与完整工作流没有由本证据实现或验收。**U14/U15 保持未验收**；本报告不替代生产 provider/model、SDK 分发、完整产品生命周期或各领域投影验收。未增加或勾选任何 checklist 项，现有 U01–U03 由父任务独立读取原件和输入 hash 后决定。
