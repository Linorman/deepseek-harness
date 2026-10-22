# C34 原场景导出与文件导入浏览器证据

2026-10-13，Asia/Tokyo；cwd `/Volumes/projects-mac/deepseek-harness`。作者台与原运行的 JSON/YAML 导出，经真实文件选择器重新导入后，完整 v1 定义、所有 null 值和作者写入的私有事实保持相同。JSON/SQLite 两个正式浏览器用例全部通过，每个用例仅创建一个暂停原运行，之后没有恢复请求或推理，原 Native 快照及 revision 保持不变。

## 导出用途与实际模式

两个入口都显示相同的双语用途说明：原始场景定义用于创建新世界，不含运行进度、会话、凭证或宿主路径，不是运行备份。作者菜单复用已有 Menu footer，按钮名统一为“导出定义”；[README](../../../../../packages/client/ui-simulation/README.md) 与其中文配对明确保留 authored private facts，不附加执行身份或私有运行记录。

本证据由项目 Playwright 脚手架执行，因为 Browser 插件不可用。前端使用稳定完整构建的 bundle，HTTP/WebSocket 与 Cordis Loader、产品 API、Native、Team、Session、JSON/SQLite 后端都是真实服务；模型采用原有 `world-external-mediated-model.ts`，计数读取它实际保留的推理请求数组。共同 v1 fixture、原 C32 测试/报告、shared model 均未修改。所有项目输出、Loader roots 和 Chromium/tsx 临时目录由显式项目内 `TMPDIR` 保持在仓库中。

这里没有 source/lib 双执行矩阵或 SDK 发行验证，也没有 writable restore。语法解码仅用于比较文件值；另外对每个重新导入的完整定义调用真实 authenticated HTTP `simulation.world.preflight`，通过实际 Host 编译/预检比较承诺 hash 与 catalogGeneration。使用原 metadata 重新编译已保留运行定义的完整 S06/S08 证明由 C33 与父任务独立审计补齐，不能以单独 decoder 代替。

## 输入与成功原件

[独立浏览器程序](../../../../../apps/web/tests/world-definition-export.snapshot.ts) SHA256 为 `a90e57762562e0ea707858cb96eb0a1e0355efc7d64edeb44ec601cbfce09655`。共同构建记录 [197 个前端产物](../../../../../.local/world-completion/c33-v1-resolution/root-tests/build-first.log)，其后 doc-sync 29/29 通过才启动正式浏览器。C33 的 [5,346 项冻结 source/lib/config 清单](../../../../../.local/world-completion/c33-v1-resolution/final-matrix-20261013/inputs-before.json) 的集合 hash 为 `581c86c87f898abc016ed92f529f55cff0b747c271948ed2f828fb6ce49bf5c7`，文件自身 SHA256 为 `9c91d11a9e9e3ea8918805f724d3a05ac09fed4547a5a0f78150df85ab595276`。UI workbench、locale 源码和 `lib/client.js` 字节与该清单一致；浏览器程序和 `apps/web/dist` 的补充输入由父任务另行捕获，不能声称该清单本身涵盖全部浏览器输入。

| 后端 | 实际 origin | 完整断言摘要 | 保留的 case root |
|---|---|---|---|
| JSON | `http://127.0.0.1:63392` | [proof.json](../../../../../.local/world-completion/c34-world-export/json/browser-NcirVE/proof.json) | `.local/world-completion/c34-world-export/json/browser-NcirVE` |
| SQLite | `http://127.0.0.1:63407` | [proof.json](../../../../../.local/world-completion/c34-world-export/sqlite/browser-AUlRSG/proof.json) | `.local/world-completion/c34-world-export/sqlite/browser-AUlRSG` |

两后端的实际基准预检 hash 都是 `sha256:5c488bbcc7ad73aa32082b3257d89b960fad68bdd42931997413d206d25c7e5c`，catalogGeneration 为 `deployment-1`。每个后端的作者 JSON/YAML、原运行 JSON/YAML 四份文件重新导入后，实际 Host 预检均返回相同承诺。两个原运行的 Native revision 都为 33；四次导入及其预检结束后，整个 Native snapshot 与保存的原快照逐字段相同。

每个成功 case root 保留 `author.world.json`、`author.world.yaml`、`run.world.json`、`run.world.yaml`、两处用途说明截图、四张重新导入截图、overlay、实际 Native 数据及 Team/Session roots。文件值严格等于原始 `WorldScenarioV1`，包括 authored private fact 正文和 nullable intervals。下载文本不含实际 run/Team/Participant/Session ID，亦不含当前项目、scaffold workspace/persistence 或 case root 宿主路径。没有实际执行状态或私有运行记录混入场景文件；`proof.json` 中另行保存的实际快照是本地验收原件，不能误认为用户导出的定义。

已逐张视觉检查 [作者导出说明](../../../../../.local/world-completion/c34-world-export/json/browser-NcirVE/author-export-purpose.png)、[原运行导出说明](../../../../../.local/world-completion/c34-world-export/json/browser-NcirVE/run-export-purpose.png) 和 [YAML 重新导入工作台](../../../../../.local/world-completion/c34-world-export/json/browser-NcirVE/run-reimport-yaml.png)。说明在实际菜单中清楚显示，文件回到同一 v1 工作台与 11 个分节。

[父任务独立原件审计](c34-world-export-root-audit.json) exit 0，输入集合 SHA256 为 `526eb75d2a6c62aee837afc100ff01c91b98d75e2f48ba354339bb360a601309`，5,721 个输入的完整副本合计 72,922,896 字节，另核验 38 个成功原件。该补充输入捕获明确发生在浏览器执行后，不能称为全输入执行前冻结。审计以 plain Node built decoder 独立核对 8 个下载文件的完整定义相等、实际 Host hash/generation，并读取 JSON/SQLite Native version 76 的唯一 bootstrap/检查点、sourceDefinitionHash、原暂停快照/revision 和零推理/零恢复；实际 opaque IDs 与 root paths 的排除也逐项核对。独立 decoder 检查不改变浏览器本身的实际执行模式，也不替代原 metadata 复编译证明。父任务另亲自检查两处用途说明截图；原 C32 证据保持不变。

## 命令、检查与失败历史

```sh
mkdir -p .local/world-completion/c34-world-export/tmp
TMPDIR="$PWD/.local/world-completion/c34-world-export/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-definition-export.snapshot.ts > .local/world-completion/c34-world-export/browser-second.log 2>&1
pnpm exec vitest run packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/world-modules.client.spec.tsx > .local/world-completion/c34-world-export/component-final.log 2>&1
pnpm exec tsc -b tsconfig.client.json --pretty false > .local/world-completion/c34-world-export/typecheck-client-final.log 2>&1
pnpm exec tsc -b tsconfig.host.json --pretty false > .local/world-completion/c34-world-export/typecheck-host-final.log 2>&1
pnpm exec tsx scripts/run-oxlint.ts packages/client/ui-simulation/src/client/world-locales.ts packages/client/ui-simulation/src/client/WorldAuthorWorkbench.tsx packages/client/ui-simulation/tests/world-author.client.spec.tsx apps/web/tests/world-definition-export.snapshot.ts > .local/world-completion/c34-world-export/lint-final.log 2>&1
pnpm run verify-translation-pairing --write packages/client/ui-simulation/README.md > .local/world-completion/c34-world-export/pairing.log 2>&1
git diff --check -- packages/client/ui-simulation apps/web/tests/world-definition-export.snapshot.ts
```

[最终浏览器日志](../../../../../.local/world-completion/c34-world-export/browser-second.log) 为 1 file/2 tests passed，7.52s；[窄组件回归](../../../../../.local/world-completion/c34-world-export/component-final.log) 为 2 files/18 tests passed，包含两语作者导出用途与纯定义输出。Client/Host 聚合类型与 scoped typed lint 日志为空，均 exit 0；README 配对已记录，diff check 通过。父任务登记新测试的 Host include/Client exclude。

[第一轮浏览器日志](../../../../../.local/world-completion/c34-world-export/browser-first.log) 保留 2 failed：两个入口的四个下载与唯一暂停创建已经完成，但测试在 `File.text()` 异步读完前立即检查分节，读取到 0 而非 11。仅将新测试改为等待草稿加载完成；没有修改生产 source/lib。失败 JSON `browser-BHq6QQ` 和 SQLite `browser-gSa1zW` 的导出、截图、DOM 与运行 roots 均保留，不能计为最终成功。初次 Client 类型调用先于新测试 compiler-face 登记产生已知 rootDir/vendor 错误，旧 `typecheck-client.log` 也保留；最终使用已登记的聚合程序并通过。

## 范围

这项浏览器验证证明原定义导出用途、实际文件下载/导入、完整值/null 保留、真实 Host 预检承诺一致与原运行不变；它没有恢复运行进度，没有新建第二个运行，也没有新增模型工作。只执行 Chromium 1440×1000、中文浏览器；两语说明由组件测试覆盖。没有声称 U14/U15、完整领域产品投影或 SDK 发行完成。未新增或勾选 checklist 项，S08 由父任务结合 C33 的原 metadata 复编译和独立原件审计决定。
