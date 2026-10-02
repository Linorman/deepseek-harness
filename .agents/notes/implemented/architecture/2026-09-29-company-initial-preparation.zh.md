# Agent Note：初始检查点前的公司场景准备

Status: implemented

[English](2026-09-29-company-initial-preparation.md) | 中文

## Problem

初始完整检查点之前，目标端已提交但响应丢失时，公司初始化仍须可恢复。重新创建实体或重置余额会重复或破坏持久事实。尚无完整 manifest 时，检查点恢复不能对账准备过程。

## Decision

[生产准备模块](../../../../packages/simulation/simulation-product/src/company-preparation.ts) 在调用者持有的 paused 运行上对账 version 1 的 buyer／supplier 采购拓扑。严格的受信任设置定义名称、原始库存、参与者 route、规范 Team 目标及检查点采集额度。调用者随创建意图保留设置，并在关闭运行前排空准备。原生 bootstrap 与临时 Team connection 拥有既有的独占退休登记；准备不增加竞争的退休 owner。

写入前，准备拒绝已推进的调度、决策、输入、被改动的 profile／余额及无关拓扑。仅补建缺失实体和资源，不重置保留值。根团队、参与者、Session 与频道身份来自原生持久 reservation。相同在途请求共用一个操作；不同请求不能替换它。检查点采集发布初始完整 manifest，再排空临时 connection 后返回。不激活 actor，不调用模型。失败检查点在原身份下保持终态；明确使用新的检查点请求才可采集后续完整 cut。

[可运行公司示例](../../../../examples/simulation-company/tests/product-preparation-scenario.ts) 消费这个生产实现。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 继续负责调度所有权、行政控制与自动执行。[持久协调提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md) 保留独立的执行、调度与恢复取舍；两份提案均未被完全替代。

[持久创建决策](2026-09-29-persistent-company-creation.zh.md)定义公开分配、原请求结果及 paused 准备句柄；本记录保留其独立规则。

安装的确定性工作流通过有界受信任 topology 扩展基础：含 buyer／supplier／purchase 在内最多 32 个 actor 和 32 个频道。单一解析器校验唯一身份、完整频道成员及报告路由，供准备、容量准入和单目标 ingress 使用。全部 actor 继承既有进程内 placement，capabilities 为空；频道 limits 固定为空。创建在 preparation 与 driver 设置中保留匹配 topology，独立于后来修改的模板。额外 actor／频道的部分提交对账原 reservation，初始／维护 checkpoint 包含全部 Session／频道引用。额外 actor 不继承库存 controller 或普通 Team 工具权限。

## Alternatives considered

**盲目重复所有 create。** Entity／resource create 会拒绝已有身份，也不能证明已有事实仍匹配所请求的准备。

**没有 manifest 时调用普通 restore。** 这会跳过未解决的创建责任，也无法依据完整 cut 校验跨 owner 来源。

**准备期间激活 actor。** 这会允许在初始跨 owner 持久事实验证前推理，并在没有调度命令时占用驻留容量。

## Consequences

模块要求调用者独占持有尚未启动的公司拓扑。它是 Host 准备能力，不提供公开创建目录或浏览器指定的存储选择。不分配产品 run／command 身份，不实现场景 driver，不启用自动任务。发现仍是显式启用的只读行为。失败准备保留部分原生历史供明确对账。

[采购 driver](2026-09-29-company-procurement-driver.zh.md) 负责准备后的控制批次，不替代拓扑对账或初始检查点责任。

## Verification

真实 JSON／SQLite owner 测试覆盖精确重试、共用在途工作、已有事实变化、邀请响应丢失及终态检查点失败。Keyless Loader snapshot 在 Team、实体、参与者、频道、资源和检查点提交后杀死进程，再对账同一运行。验证规范身份、恰好两个参与者、完整的未实体化 Session 引用、零 actor／模型调用、已完成重试不写入，以及初始 manifest 的校验／恢复后保持 paused。

[Topology 回归](../../../../packages/simulation/simulation-product/tests/topology.spec.ts)在 JSON／SQLite 验证独立第三审核人、精确第二频道送达、部署元数据改变后的 checkpoint／冷恢复、零推理、资源余额不变、同来源不同任务及获准第三 actor ingress。准备测试以原身份对账丢失的额外 participant 邀请响应，保留完整未物化 Session／频道引用。
