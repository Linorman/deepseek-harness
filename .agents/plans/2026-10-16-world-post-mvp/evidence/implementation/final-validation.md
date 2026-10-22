# F0 / A1–A3 验证记录

2026-10-19：F0 与 A1–A3 按原 24 项验收完成，未新增 checklist 条目。六组长期 workload 各完成 32 轮及独立冷恢复，原始进程结果、输入一致性和批次兼容证明均通过。B–E 和整体 H 保留原状态；早先失败/中断仍保留，不计为成功。

## 当前验证

命令在项目根运行，`TMPDIR`、Python 缓存、测试数据、截图和编译产物均在项目内。tsx IPC、真实 localhost 和子进程检查按项目规则通过宿主执行，未绕过业务拒绝断言。

| 检查 | 当前结果 | 原件 |
|---|---|---|
| `pnpm run build` | 完整 Host/Client 构建与类型检查通过；197 Client 产物 | [构建](build-current.log) |
| `pnpm run lint:contracts-ready` | 通过；前置 typecheck 已通过 | [lint](lint-current.log) |
| `pnpm run test:gui` | 434 文件、5541 通过、1 既有跳过 | [GUI/Host](gui-current.log) |
| author Web snapshot | JSON/SQLite 各通过；实际认证 HTTP、source Host / built Client，0 模型调用 | [浏览器](a1-continuation-browser.log) |
| simulation + SDK tests | 252 文件通过；7 文件中版本快照/目录覆盖已修复，生命周期超时文件单 worker 原时限重跑通过 | [首次整合](simulation-sdk-current.log)、[76项重跑](isolated-timeouts-current.log)、[3个版本快照](f0-scenes-current.log) |
| Python SDK 相关四文件 | 457 通过 | [Python](python-current.log) |
| `pnpm run doc-sync` | 29 gates 通过 | [文档](f0-completion-doc-sync.log) |
| `pnpm docs:check` | 站点构建通过，2582 内部片段引用、193 raw-Markdown 文件 | [站点](docs-site-current.log) |
| 基线记录器/报告器/集合校验单元验证 | 20 通过，缺失/重复/乱序/坏结果/超时和未证明的输入差异不能判为完成 | [脚本](f0-acceptance-tests.log) |
| 源码旁产物检查 | 0 违规 | [产物](source-outputs-current.log) |

目录覆盖修复后的两后端测试单独通过，三场景快照只更新本次协议 pin。整合运行保留原始失败日志，未将其记作全套通过。A2 的20例真实 Session/故障进程、10例真实 owner 竞争，以及 A3 的 owner、冷恢复和权限矩阵分别见 [A2证据](../a2-core.json)、[A3证据](../a3-core.json)；A19 的实际 HTTP 权限撤销和因果跳转见 [浏览器证据](../a19-browser.json)。

## 功能与边界

A1 提供私有 revision/CAS、字段冲突与完整原件、有界图/键盘操作、独立保存布局和带许可/固定依赖的惰性模板包。A2 提供有限 Persona 审核、退回/重新生成/对比，真实候选人 Session 接受及原身份录用，报价或接受时预留的一次性费用。循环薪酬未交付。

A3 提供固定 IANA 2026e 的民用时间转换、班次/例外/有限 recurrence 和明确 DST 歧义策略；日历原命令可刷新恢复。组合委员会路线在投票前冻结，制度影响预览受 case 与 context 独立授权并保留真实来源。日历唤醒不隐含房间/设备资源预留。Native journal 98、checkpoint manifest 8、草稿日志2明确拒旧；Session 格式仍为0。

`.playwright-mcp/world-post-mvp-complete.gif` 来自同一 SQLite 实际 HTTP 流程的六帧：1200×834、12秒、714795字节。已解码检查末帧，包含 Persona r1/r2 实际对比。Browser plugin 不可用，使用项目 Playwright；配置装有 scripted 测试 provider，但创作/人工审阅流程没有模型调用，不能作为真实模型推理演示。未发布远端。

## F0 完整长期基线

[集合校验](f0-collection-final.log)返回 `complete: true`、6 组、0 issue；[准确命令及退出码](f0-longitudinal-collection/verification.json)、[完整指标和输入 hash](f0-longitudinal-collection/summary.json)、[37 份逐字原件及来源映射](f0-longitudinal-collection/raw-copies.json)保留在项目中。原始运行目录及完整 Native/Team/Session 数据仍在 `.local/world-post-mvp/f0-longitudinal/`，没有移动或删除。

三个原始批次分别为 laboratory `1792333087908875000`、association `1792337889212043000`、company `1792338832170825000`。每批 `input-drift=[]`；共同硬件为 Apple M4 Pro、12 CPU、24 GiB，Node v25.9.0，source 模式。每场景/后端 32 轮，warm 结束后另启 cold；并发 1、模型并发 2。有效部署预算、resident 上限、模板/领域版本和实际构造输入见各自 manifest 与[范围说明](f0-contracts.md#长期基线的场景范围)。

旧 association 仅缺少其后来增加的 knowledge 上限，旧记录器仅缺少 company 专用 Team 预算；校验器按固定历史 hash 逐字反向重构，证明这些改动未影响复用的场景及有效环境。其他输入全部与当前源码匹配。本集合保留各批次来源，不将它们称为同次执行；旧 association 失败和 company 校准中断仍列为 excluded failure。

| 场景/后端 | 轮数 | p50 / p95 / p99 秒 | 最大观测 RSS GiB | 活跃 / resident / writer | 历史 Participant / Activation | cold 秒 |
|---|---|---|---|---|---|---|
| 公司 / json | 32 | 152.417 / 316.495 / 334.792 | 2.224 | 34 / 3 / 3 | 34 / 557 | 38.411 |
| 公司 / sqlite | 32 | 133.253 / 283.368 / 293.479 | 2.127 | 34 / 3 / 3 | 34 / 557 | 38.110 |
| 实验室 / json | 32 | 51.993 / 165.723 / 178.167 | 5.972 | 3 / 2 / 2 | 3 / 192 | 4.695 |
| 实验室 / sqlite | 32 | 54.108 / 159.753 / 170.000 | 6.116 | 3 / 2 / 2 | 3 / 192 | 4.706 |
| 协会 / json | 32 | 4.502 / 7.933 / 8.291 | 0.988 | 4 / 2 / 2 | 4 / 69 | 0.900 |
| 协会 / sqlite | 32 | 3.663 / 6.955 / 7.132 | 0.892 | 4 / 2 / 2 | 4 / 69 | 0.922 |

公司每后端完成 32 个独立候选人的真实 Session 接受及原身份录用、一次性费用守恒；实验室完成 96 个提案/投票和 32 个制度；协会完成 32 次日历/外部裁决。公司、协会 cold 验证 Native/Team checkpoint；实验室 cold 仅验证 Native governance/norm 重放，不宣称完整 Team 备份。所有 cold 进程均无模型调用。

分位数为 32 个原始轮次的 nearest-rank 统计，RSS 为轮末采样，不代表连续峰值。公司与协会 usage 来自 scripted fixture，实验室无推理；不据此推断真实 provider 费用或 token 效率。此轮只固定初始基线，不宣称 B 阶段性能改善，也未测量维护暂停占比。

[源码与产物复核](runtime-revalidation.json)确认原验证范围的 941 个文件、7 个构建产物及 79 个核心证据 hash 匹配；唯一已登记的记录器变化为 company 专用测试预算。完整集合校验再次确认当前运行输入一致。原 build/typecheck、lint、GUI、SDK、真实浏览器及故障恢复证据可复用；最终文档和 whitespace 检查单独执行。
