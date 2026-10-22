# U04 案件状态与独立授权验收

2026-10-14；工作区实现，非仅 Git HEAD。输入 hash 及逐文件清单见[inputs](../../../../../.local/world-completion/u04-execution-ui/inputs.json)，原始日志与浏览器 proof 索引见[artifacts](../../../../../.local/world-completion/u04-execution-ui/artifacts.json)。所有临时、构建和浏览器产物均在项目内。U04 完成，清单 93/112；不因此宣布 U05–U15 或完整 MVP 通过。

## 实现与实际权限

必填 `clocky.world-case/v2` lifecycle 从同一 Native 前缀公开请求、当前计划、执行回调/业务结果和通知事实。详情 parser 核对对应原件；中间计划页不假装包含最终历史，末页核对当前计划。TypeScript 与 Python 拒绝缺失状态轨、旧 v1 及矛盾数据。场景版本、Native stream 和 Session 格式不因这一 DTO 变化而改变。

列表和检查器直接使用 Host lifecycle，不依赖尚未发布的领域扩展；执行受阻、回调未知和业务已提交可以分别显示。执行原因和原计划引用可见，查看原计划及恢复选项仅导航，未提交新计划、命令或执行。人员/代表/联系准备责任不伪装成招聘预留。

案件正文、补证答案与 Persona 使用独立授权；run owner、错误 entity 的 context grant、Persona grant 均不能替代案件正文权限。实际补证测试先复现 IO 后撤权仍返回答案，再验证最终 admission 遮蔽答案而保留元数据。浏览器同时具备案件与 Persona 授权时，对该新人的实际 Session 历史读取仍返回 `TEAM_HUMAN_ACTOR_FORBIDDEN`。context 的独立授权、撤权、迟到响应也用实际公司/实验室决策验证。

## 验证

下列命令均使用 `TMPDIR="$PWD/.local/world-completion/tmp"`。Browser plugin 不可用，按 frontend testing skill 使用项目 Playwright。浏览器 Host 从 source 解析，使用刚构建的真实 client bundles；不是 compiled Host 或已安装 wheel 验收，后者仍属 U13。

```sh
pnpm exec vitest run packages/simulation/simulation-product/tests/world-case-lifecycle.spec.ts packages/simulation/simulation-product/tests/world-case-evidence-disclosure.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-product/tests/case-schema.spec.ts packages/sdk/client/tests/simulation.spec.ts packages/sdk/client/tests/simulation-world.spec.ts packages/sdk/protocol/tests/simulation-world-results.spec.ts packages/client/ui-simulation/tests/world-cases.client.spec.tsx packages/client/runtime/tests/simulation-world.client.spec.ts --maxWorkers=2
UV_CACHE_DIR="$PWD/.local/world-completion/tmp/uv-cache" uv run --project python/sdk --group test pytest python/sdk/tests/test_simulation_world_cases.py python/sdk/tests/test_simulation.py
pnpm run build
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-execution-state.snapshot.ts apps/web/tests/world-case-privacy.snapshot.ts apps/web/tests/world-context-privacy.snapshot.ts --maxWorkers=1
pnpm run gen-cordis-catalog
pnpm run doc-sync
```

| 范围 | 后端与模式 | 结果与日志 |
|---|---|---|
| 实际双案件、补证撤权 | JSON/SQLite，source owner，零模型读 | [2 文件 4 项通过](../../../../../.local/world-completion/u04-execution-ui/owners-quiet.log) |
| 严格契约、SDK、UI/runtime | source；v2 四轨、正文/Persona 分离与只读导航 | [6 文件 191 项通过](../../../../../.local/world-completion/u04-execution-ui/contracts-final.log) |
| Python 严格 parser/client | source Python，不宣称 wheel | [139 项通过](../../../../../.local/world-completion/u04-tracks/wire-python-final.log) |
| Host/Client 编译及实际 Web 产物 | types + lib + browser build | [197 client artifacts](../../../../../.local/world-completion/u04-execution-ui/build-v2.log) |
| 实际浏览器状态与授权 | JSON/SQLite，公司/实验室；真实产品/Agent/scripted model/Channel/Session；非真实 provider | [3 文件 14 项通过](../../../../../.local/world-completion/u04-execution-ui/browser-complete.log) |
| 文档、双语、生成 API | 当前 U04 docs/catalog | [29 门禁全部通过](../../../../../.local/world-completion/u04-execution-ui/doc-sync.log) |

浏览器状态六组覆盖 armed 未确认、容量受阻、已提交但回调未确认；每组检查 390/1440px、浅深主题、减少动效、键盘进入原计划、恢复入口只读、无 page/console error，Native 完整快照和模型调用数不变。另八组覆盖公司/实验室双后端的案件/Persona 与 context 授权、撤销后的迟到 HTTP、断网保留过时元数据且不复活正文。原截图与 proof 都保留在 artifacts 索引指向的项目目录。

变更文件 scoped lint 通过；命令与诊断保留在 `u04-execution-ui/lint-v2.log`、`lint-final.log`、`lint-browser-final.log` 和 `u04-tracks/*lint*.log`。最终一个 browser arrow-parens 格式错误单独修复并复检，不改执行语义。此前完整 GUI 422 文件、5449 项通过发生在 v2 四轨接线之前，最终受影响范围以本表 191 项及实际浏览器为准。

## 保留的失败与范围

并发 build 时两个 JSON owner 曾触发默认 5 秒 timeout，原 `u04-tracks/complete-final.log` 保留；安静单 worker 复跑 4/4 通过，没有放宽时限。早期浏览器缺 execution provider 及旧导航名的失败保留，修复实际组合及导航后才运行本表完整 14 项。首次新 browser 文件误进 Client aggregate 导致构建失败，已加入既有 Host aggregate 并排除 Client；那次生成的 92 个未跟踪编译旁产物按映射与时间精确识别后保存在项目内 quarantine，未删除用户文件。

premium 全项目 audit 仍有五项既有表单检查失败，保留在 `u04-execution-ui/premium-audit.json`；U15 未勾选。组织/制度/外部 domain reads 仍待真正发布，U05/U06 保持未勾选。U04 不提供真实模型质量、分发安装、完整故障矩阵或规模证据。
