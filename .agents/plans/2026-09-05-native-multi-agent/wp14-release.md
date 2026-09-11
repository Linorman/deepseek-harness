# WP14：双 SDK、全仓、发行与文档晋级

主责：发布与文档负责人。负责 G32/G33。前置：各功能包具名验收、WP12 cutover、WP13 全场景；早期可准备矩阵和文档清单。必读[总计划](overview.md)、[交接模板](handoff-template.md)和[pre-push 规则](../../skills/dsh-pre-push-checks/SKILL.md)。

## 同一候选提交

所有最终检查针对一个不可变候选提交。记录源码提交、canonical npm/vendor/native tarball、Python wheel/runtime、生成 schema 和 fixture。不得将之前提交的 coverage、其他分支的 GIF 或历史 pack 成功与当前代码混用。

发现代码、生成物或 fixture 修复时产生新候选提交，重新判定哪些证据失效。平台 runner 或凭证缺失登记 BLOCKED_ENV；可以继续其他独立检查，但不能晋级主提案。

## 双 SDK 与协议清单

逐项核验 Team/Participant/Channel/Task/Envelope/receipt/Activation/budget、principal inbox、child execution、cancel、review、integration、supervisor 与分页结果。TypeScript 与 Python 在成功、错误、未知格式、断开、取消、超时、subscription close 上含义一致。

Host Remotes、Typert 生成、SDK protocol/server、TS client、Python models/runtime carrier 原子更新。actor-free 数据保持严格解析；未知字段、凭证泄露、旧 version 和歧义 provenance 必须拒绝。SessionEventMap/生命周期变化同时核验[两 SDK snapshot owners](../../../docs/testing.md)。

测试 bundled runtime 真正加载新包与默认配置。源码 client tests 通过但打包运行时缺插件、缺 resolver dependency 或缺 native package 都不能通过。

## 仓库与发行检查

以当前 package scripts 和 CI workflow 为权威，确认版本后执行不可约最终检查。以下是现有命令族，具体 provider、Python 和平台矩阵从当前 workflow 选取，不能复制过期命令替代真实发行程序。

```sh
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run duplication
pnpm run test:coverage
pnpm run hygiene
pnpm run test:snapshot
pnpm run doc-sync
pnpm run website:build
pnpm run release:verify --family clocky
```

同时执行 WP13 的 keyed/distributed/browser/performance、两 SDK 测试及[release workflow](../../../.github/workflows/release.yml)的 canonical pack 和 isolated consumer。依[发行脚本](../../../scripts/release/families.ts)选择 Clocky、vendor、native family，核验三平台消费同一批 tarball，Python 运行时使用对应构建产物。

最终矩阵明确 Linux/macOS/Windows 的必需和不适用项。Windows 的正式证据由 CI 提供；没有已知 Windows 故障时不运行 Wine 检查。self-skip 只满足普通无密钥 CI 的运行规则，不满足提案要求的真实 provider 验收。

## 文档收敛

1. 逐项复核本目录 G01–G33 的源码与当前候选提交证据，修正文档中的已过期描述。
2. 主提案保留架构选择、替代方案、代价、当前保证和仍有价值的边界；执行清单留在本计划，不复制到 implemented 架构正文。
3. P0/P1 和相关 implemented Notes 按实际 owner 整理。不能仅依据 Status 标签认定某项已实现，不能以“已经有很多测试”替代具名证据。
4. 按[文档层级](../../../docs/AGENTS.md)更新 architecture、subsystem、包 README、用户说明和生成 catalog，避免顶层重新列包内所有测试。
5. 按[双语约定](../../../docs/i18n/README.md)同步对侧、重记实际修改的 pair；不调用未请求的批量翻译流程。
6. 对被 WP12 完全替代的 Note 作 scoped supersession 审核。部分仍约束 compat 的保留，符合归档条件的按冻结 triplet 流程处理。
7. 只有所有 acceptance 有当前证据时，才能把主提案改写为实际已交付决策并迁到 implemented。修复所有 inbound links，包括本目录和双语路径。

## 最终验收产物

| 产物 | 内容 |
|---|---|
| Acceptance ledger | 33 项均有 owner、提交、场景、证据链接与最终状态 |
| SDK parity | 所有新数据、错误、分页/取消/订阅和 bundled runtime 的双语言结果 |
| Release manifest | 同一候选提交及各 canonical 包摘要，不含 secret |
| Platform matrix | Linux/macOS/Windows 和 native/Python 的真实 workflow 结果 |
| Product proof | keyless、keyed、distributed、browser/GIF、性能结果 |
| Documentation closure | 实际 Note 生命周期、对侧一致、链接/生成/website 验证 |

本包完成是“可审查的发行候选及全部证据”。自动发布、merge 或外部公告仍遵守用户当时授权和仓库流程；本开发计划不授予未来部署凭证或公告权限。
