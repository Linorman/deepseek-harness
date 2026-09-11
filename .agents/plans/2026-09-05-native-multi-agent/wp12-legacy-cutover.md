# WP12：Legacy 产品入口与发行清理

主责：包与兼容性程序员。负责 G24/G25。前置：相关 Team 替代行为通过验收，整体产品切换依赖 WP05/10/11。阶段 A 即可做只读清单；不得提前删除仍承诺的行为。必读[总计划](overview.md)、[接口 C7](contracts.md)和[Agent Notes 规则](../../notes/README.md)。

## 当前基础与范围

默认 Team presets 已不暴露旧 subagent/workflow，但[base bundle](../../../packages/bundle/base/cordis.patch.yml)仍保留 disabled Goal 配置，[工具 catalog](../../../docs/tool-catalog.md)仍列 legacy 工具，[release family](../../../scripts/release/families.ts)仍发现相应 public packages。[Session header](../../../packages/core/session/src/types.ts)还包含 origin/delegationDepth。

本包负责字面意义的产品与发行退出，不只设置 disabled。对有实际 custom/internal consumer 的代码保留其兼容行为和 rationale；无消费者的删除。

## 清单与决定

逐个记录 goal、goal-round-driver、command/tool-goal、subagent provider/control/report/fork、script workflow/ralph 的生产调用、custom example、source import、config row、generated entry、SDK carrier、snapshot 和 release dependency。测试中的负向 absence 断言不算仍支持该能力。

每个候选作二选一：仍有合法显式消费者则移到 private packages/compat、采用 clocky-compat-* 包名及 legacy_* tool 名；无消费者则删除。不得只改 package private 而仍从主发行包依赖进来，也不能因一个工具退出就删除仍有独立用途的底层能力。

## 实现步骤

1. 给所有仍承诺行为找到已通过的 Team 替代场景：并行委派、continue/interrupt、review、workflow、goal、Session inspect。缺替代则报告对应包，不先删。
2. 对保留的兼容包完成 import/exports/dependency/config/examples 统一迁移。它们不能注册 shipped Team 工具名，不能获得 Team actor authority。
3. 从 release family 和产品 catalog generator 的输入范围排除 compat；明确检查 transitive dependency、bundler entry 和 package files。
4. 删除 base 的 legacy disabled rows 和不再需要的 resolver dependencies；实际 custom composition 显式挂载 compat。
5. 将 Session origin/delegationDepth 的兼容需求移到其自有 versioned descriptor event。保留 parentSession 作为 fork seed lineage，不重建 parent authorization。
6. 更新 durable header parser 和两 SDK projection/fixtures；旧 pre-release 格式按政策拒绝，不增加 converter。
7. 从生成器重建 tool/config/API/module catalogs，更新 package map、subsystem、用户文档和双语对侧。
8. 运行源码与打包 absence probes；具名兼容示例仍可运行。避免用宽泛排除整个测试目录掩盖真实产品入口。

## 验收清单

| 检查对象 | 通过条件 |
|---|---|
| 默认 profiles/presets | 只有 Team 控制，不含 disabled 的旧产品控制行 |
| Source 与 imports | shipped source 不依赖旧私人 child ownership |
| Catalog | 生成规则排除 compat，不能靠手删生成文字 |
| Tarball 与 SDK runtime | 无 legacy 产品工具名及 release dependency reachability |
| Compat | private、独立名称、显式加载、真实 smoke 通过 |
| Session header | 旧 product 字段退出，lineage 与 authority 分离 |
| 功能替代 | 每个仍承诺行为有 Team runnable example |
| Agent Notes | 仅完全替代才能合并/删除；部分仍当前的决策保留 |

## 检查与交接

变更包名/exports/build 输入时必须运行 build、相关 hygiene、release pack 和 isolated consumer probe。复用[发行脚本](../../../scripts/release/families.ts)的真实成员发现，不维护一份只在测试中正确的包列表。

Agent Notes 按[archive 工作流](../../skills/dsh-archive-agent-notes/SKILL.md)处理；冻结 archive 永远不编辑。现有 subagent/goal/workflow rationale 只在源码和兼容消费者确实退出后重新分类。

交接迁移/删除清单、consumer→replacement 对照、absence scanner、compat smoke、两 SDK 格式结果、pack probe 和已更新文档。建议先兼容隔离，再 core header 退出，最后默认/catalog/release 字面清理；每片不得使既有显式消费者无替代地失效。
