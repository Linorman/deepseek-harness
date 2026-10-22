# R12 当前实现文档与生成目录

2026-10-15；文档输入 hash `beff9798da4412c8f08622a51b61fa8e3decc5652d2115cb1304748075f77c9e`，420 个当前文档／生成输出／双语提案／生成程序输入。[清单](../../../../../.local/world-completion/r12-docs/inputs-final.json)、[归档](../../../../../.local/world-completion/r12-docs/inputs-final.tar.gz) SHA-256 `c513fe91bacf81c8c09289dc693bc8f38f43ebf643dae4fd75aeaf9aa6f24f5b`；[逐文件重新读取](../../../../../.local/world-completion/r12-docs/archive-verification.json)全部通过。此归档不代替 runtime 验收。

## 当前契约

World、Local、Product、scenario、SDK、Client runtime 与 UI README 使用当前 Native96／manifest6／compiler9 契约，记录精确 pin、治理自动安全边界、外部模拟、人员义务、独立权限、认证管理、source/lib/wheel 分发与控制查询生命周期。清除了“v1 编写／SDK 分发／治理生效尚未实现”等过期表述；危险边界故障矩阵的验收状态继续诚实保留。

[双语原提案](../../../../notes/implemented/feature/2026-10-08-world-director-mvp.md)的当前实施状态已合并为实际合同及证据入口。原增员阶段评估与75项清单继续独立；本轮112项范围不被历史缩减版替代。原提案继续 proposed，最终生命周期必须等待 R13；真实 provider、预算、规模和完整组合验收均不借文档宣告通过。JSON／安全 YAML／完整 v1 编写、治理／资源／人事／模拟外部、真实用户管理及两端 SDK 入口均链接当前 owner。

[治理边界 Agent Note](../../../../notes/implemented/bug-fix/2026-10-15-native-governance-boundaries.md)、[键盘控件 Agent Note](../../../../notes/implemented/feature/2026-10-15-world-authoring-keyboard-controls.md)与[控制轮询 Agent Note](../../../../notes/implemented/bug-fix/2026-10-15-simulation-control-polling.md)已双语配对。源码／实际 lib 完整三场景的 keyless runnable 证据见[Root 原件审计](../../../../../.local/world-completion/u14-product/current-root-audit.json)：JSON/SQLite×公司/实验室/协会×两模式12格、36独立PID，其中24cold零模型；实际脚本 Agent 经三工具执行，无手动代替治理结案。U13 的 wheel／source 模式仍单独保留，不用文档或脚本模型声称真实模型质量。

## 生成与验证

以下均在项目根目录执行，统一 `TMPDIR="$PWD/.local/world-completion/tmp" XDG_CACHE_HOME="$PWD/.local/world-completion/pnpm-cache" npm_config_state_dir="$PWD/.local/world-completion/pnpm-state"`；过程与构建产物留在项目内。

| 准确命令 | 结果／日志 |
|---|---|
| `pnpm run gen-cordis-catalog` | [105 artifacts，1 written](../../../../../.local/world-completion/r12-docs/cordis-current.log)，包括真实 teams 依赖 |
| `pnpm run gen-cordis-api` | [105 artifacts，0 written](../../../../../.local/world-completion/r12-docs/gen-cordis-api-current.log)，子系统 API 已由当前源码生成 |
| `pnpm run gen-client-catalog` | [当前 slot catalog](../../../../../.local/world-completion/r12-docs/gen-client-catalog-current.log)，最终 Client 构建消费 |
| `pnpm run gen-tool-catalog` | [实际 tool plugin boot／严格 schema](../../../../../.local/world-completion/r12-docs/gen-tool-catalog-current.log)，未改变三工具权限模型 |
| `pnpm run gen-config-catalog` | [当前 Config／注入依赖](../../../../../.local/world-completion/r12-docs/gen-config-catalog-current.log) |
| `pnpm run gen-doc-graphs` | [8 graph docs](../../../../../.local/world-completion/r12-docs/gen-doc-graphs-current.log)，含事件 producer/consumer 和模块关系 |
| `pnpm run verify-translation-pairing --write`，显式修改的 owner／提案／note | [owner](../../../../../.local/world-completion/r12-docs/owner-pairing-current.log)、[原提案](../../../../../.local/world-completion/r12-docs/proposal-pairing-current.log)、[control](../../../../../.local/world-completion/u14-product/control-pairing-first.log)；原文和译文均实际修改，不仅更新 hash |
| `pnpm run doc-sync` | [当前第二轮29/29](../../../../../.local/world-completion/r12-docs/doc-sync-second.log)，51.83s；包含类型化文档、网站构建／导航、生成目录、Mermaid、双语 pairing、格式／预算、README Model Experience／限制和链接等 |
| `pnpm run doc-sync`，补入 U15／R12 证据页后 | [最终记录](../../../../../.local/world-completion/r12-docs/doc-sync-final.log)；最终状态由此日志及 checklist 完成行记录 |

原 `design.md`、`development-plan.md`、HTML 与旧证据作为原始范围及历史输入保留，没有改写原始提议以伪造完成。后续实现变化仍须 R11 重新选择相关门禁。
