# Agent Note: Simulation 系统问题核实、开发设计与实施计划

Status: proposed

[English](2026-10-21-simulation-system-reliability.md) | 中文

## Problem

2026-10-21，用户对单独授权请求答复“先不用”。剩余真实模型验证及浏览器/GIF 证据暂缓，原第12天运行保持暂停，五项未完成条目继续保留，不因暂缓而勾选；本次答复不授权启动真实推理或录制。

当前原 checklist 为47/52：W0～W6、原运行恢复前核对及共享代码/协议/文档验收已完成。剩余为需单独授权和预算的 W7 真实阶段验证，以及真实 Host/模型浏览器流程与 GIF；原第12天运行保持暂停。下方静态复核记录检查基线，最新完成度与证据见 Development plan，未新增 checklist 条目。

2026-10-21 的 [系统与业务测试报告](../../../plans/2026-10-21-simulation-system-reliability/evidence/system-business-issues.md) 表明，Simulation 已能执行真实独立角色决策，但停止控制、故障解释、长程读取和推理效率仍不足以支撑无人值守长程运行。本提案核实 SYS-01～SYS-14，定义后端开发设计及详细验收清单。工作区已包含部分实现；以下静态复核保留检查时的基线，最新实现和完成度以 Development plan 的原 checklist 与证据为准，历史核实表保留原设计起点，D1～D6 定义目标约定，不能把全部设计统称为尚未实现或已经完成。

核实基线为 2026-10-21 当前工作区，分支 `master`、HEAD `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`，包含大量既有未提交修改；因此 HEAD 本身不能重现本次检查对象。本次仅静态检查源码、约定和已有证据，不运行测试、不启动模型、不恢复暂停运行、不修改业务代码。历史日志中的通过结果仅代表原测试批次，不作为当前工作区重新验证通过的声明。

[原始审计](../../../plans/2026-10-21-simulation-system-reliability/evidence/harbor-day12-final-audit.json) 记录第 12 天、62 个决策、45 个实质决策、11 个实质行动主体、18 笔未完成订单；`worldIntegrity=true`、`mechanicallyComplete=false`，全年覆盖和恢复条件未满足。未完成订单必须保留，不能以清空责任换取成功状态。1,669 笔用量结算和约 45,546,584 token 来自测试报告的汇总，未在本次重新聚合，也不是提供方账单。

### 本次静态复核

本次按用户要求独立检查，没有使用 subagent、重新运行测试、启动模型或续跑案例；仅维护本文双语版本与源码指纹记录。已有复选框和实施日志保持原状，不凭静态阅读新增勾选。当前源码身份见 [本次复核清单](../../../plans/2026-10-21-simulation-system-reliability/evidence/current-static-review.json)；这是文件级核对清单，不是完整可构建工作树快照，也不能替代 W0 的独立基线。

结论是：报告的主要问题有依据，但当前修复已超出报告时点。下一轮应完成停止/恢复闭环、实际初始上下文预检和长历史容量验收，而不是重复实现已有故障分类或压缩抑制。以下“存在实现”只指源码，历史日志也不证明当前所有未提交修改已通过集成验收。

| 问题 | 当前源码判定 | 仍需处理 |
|---|---|---|
| SYS-01 | 原裁判桥接、真实身份绑定及 [外部备份 provider](../../../../packages/simulation/simulation-world/src/harbor-archive-provider.ts) 已存在。 | 核实 Native、Team、Channel、Session 与案例目录的一致切面；不能用 Native 检查点代替完整备份。 |
| SYS-02 | 当前输入身份、显式提交和空提案约束存在。 | 保留旧历史/新输入的回归；提示词不能保证模型行为，最终文字不能自动完成决策。 |
| SYS-03 | [stage 预检](../../../../packages/simulation/simulation-team/src/preflight.ts) 已按当前上下文和精确 pin 校验 payload，并限制诊断大小。 | 不再按“完全没有预检”开发；检查阶段覆盖、错误后有效暂存保留和最终 Native 拒绝路径。 |
| SYS-04 | 预检比较当前 requestId，错误在替换暂存前拒绝。 | 保持跨请求权限与冷恢复后的身份约束。 |
| SYS-05 | v3 转发原请求，执行器不要求模型转抄完整正文。 | 保持原文、执行身份和真实裁决；不改写旧失败运行。 |
| SYS-06 | 精确 Harbor v1/v2/v3 仍存在；[Native journal](../../../../packages/simulation/simulation-local/src/journal.ts) 当前为 102。 | 原样归档不等于可执行恢复。旧版本续跑前必须确认精确 parser 和可审查迁移，不能只改版本头。 |
| SYS-07 | 按 Team 串行生命周期更新的机制存在。 | 在停止、备份和退休组合下核实 writer/队列最终释放，不扩大过期授权快照的复用。 |
| SYS-08 | [小型控制投影](../../../../packages/simulation/simulation-local/src/control-observation.ts)、结构化超限和 SQLite 分页回放已存在。 | 详情仍完整回放；控制投影仍扫描关系。创建预检尚未测量实际初始上下文，见 F1/F2。 |
| SYS-09 | [压缩实现](../../../../packages/compaction/compaction-basic/src/index.ts) 已有持久 no-gain 指纹、增量阈值和有界近期扫描；用量归因也已接入。 | 不再认定完全缺少抑制。需确认当前源码回放/溢出/取消交互；真实长程节省及质量仍未知。 |
| SYS-10 | [Native 控制](../../../../packages/simulation/simulation-local/src/run-control.ts) 已持久化目标、双时钟映射、cut 和收尾预算；执行前检查及 [自动保存调度](../../../../packages/simulation/simulation-product/src/stop-checkpoint.ts) 已存在。 | P0 完成所有入口、在途结果对账、冷恢复与保存失败的集成闭环；存在代码不等于所有旁路已证明安全。 |
| SYS-11 | [安全失败分类](../../../../packages/simulation/simulation-product/src/failure.ts) 已保留 typed code/status，区分支付、限流、网络、上下文和读取失败。 | 确认 Host/两侧 SDK/冷恢复均保持分类和 owner/batch 新鲜度；余额问题本身仍由提供方账户处理。 |
| SYS-12 | 已报告的 HMR、Root 时序、迟到回调与端口 Cookie 修复存在。 | 本轮不扩为前端重设计；多窗口/长连接覆盖仍不能从后端静态阅读推出。 |
| SYS-13 | [领域摘要](../../../../packages/simulation/simulation-world/src/harbor-summary.ts) 已分层结果、计数授权和来源新鲜度。 | W3 已经源码与证据审核完成原五项；公开 result payload 与私有 request/context 权限继续保持独立。 |
| SYS-14 | 原运行只验证到第 12 天，全年机械验收未完成。 | 属于证据缺口；只有后续明确授权和预算后才能续跑。 |

### 已确认的剩余边界与开发设计

**F1 / P1：创建预检只证明很小的请求下界。** [requestCapacity](../../../../packages/simulation/simulation-team/src/request-budget.ts) 目前计算 `safetyMarginTokens + 2`，World preflight 没有传入实际初始角色/世界上下文。它正确返回 unknown，而不是虚假可用；但仍不能提前发现大段必需规则、指南和角色视图本身就超限。下一步由实际输入构造所有者提供纯构造器，预检复用同一必需块，报告准确 UTF-8 字节、估算 token、输出预留、安全余量和窗口来源。尚不能获知的 preset/系统提示/工具封装须标为 partial/unknown；只对可证明不可能的配置拒绝，不推断全年成本，也不额外调用模型。对应 W6 第六项。

**F2 / P1：分页日志读取尚不是增量详情投影。** `inspectPaged()` 在一致 SQLite 前缀内逐页 fold，避免第二份完整 entries/index 数组，但每次详情仍从创建记录回放到尾部；返回状态和业务 payload 本身也可能很大。JSON 仍完整解码，raw SQLite 归档仍会收集全部有界记录并进行 base64/JSON 编码。小型控制 DTO 避免深复制全部正文，但仍遍历 decisions、operations、entities 等关系，不能称为固定时间读取。先完成容量矩阵；仅在测量证明必要时引入带源哈希/版本校验的增量派生投影，并复用写入所有者维护计数。分页字节、源字节、序列化峰值与总状态大小分别计量；禁止把响应分页当作磁盘 IO 有界。对应 W6 第一至第五、第八项。

**F3 / P0：暂停、Native 保存和完整外部备份仍是不同保证。** Harbor 明确声明 `checkpointCoverage='external-state-required'`；[World owner](../../../../packages/simulation/simulation-product/src/world-owner.ts) 的停止保存只在原检查点完成后记录该依赖。已有完整外部备份 provider 是另一条 capture/verify/restore 链路，不能据此把停止状态改成 completed。下一步统一观察原 cut、物理检查点身份、外部包哈希、覆盖范围和重试结果；若停止策略仍只收集 Native/Team 数据，必须保留 external-state-required 并提供明确的完整备份操作。恢复先验证全部清单与原始裁判文件，缺失、篡改或不支持的 provider 必须失败，不得重新初始化世界。对应 W1 第七/九项、W6 第七项。

**F4 / P0：未知外部结果必须保持只读对账。** 当前 [reconcile](../../../../packages/simulation/simulation-world/src/harbor-execution.ts) 调用 `recordedResult()`，没有旧回执时保留 unknown，不重新派发；新执行在 CLI（命令行界面）变更前复核停止目标。这是正确方向。余下开发以“目标更新与派发的可排序生效点”为核心，逐条检查管理、重试、定向执行、未来消息和 Native schedule 入口；把派发前、裁判完成后、回执落盘后、Native 追加前的故障分别纳入现有 W1 验收。unknown 不能通过重发、删除责任或回拨时间消除。

**F5 / P1：受控原始归档不能解除旧格式恢复限制。** [archiveRaw](../../../../packages/simulation/simulation-product/src/index.ts) 要求原注册 run、独立完整记录披露授权，并在 IO 后复核，返回原始逻辑记录及哈希，不获取 writer。它不是物理 SQLite/WAL 备份，也不证明业务状态有效。当前 102 reader/writer 不支持旧版本时必须拒绝；如需要继续原运行，先离线保留原包，再设计显式、版本专属的隔离转换器，核对原 prefix/hash、ID、序列、上下文证明和多存储引用，转换后生成新格式检查点。不能将 `.tmp` 中的试验脚本视为受支持迁移工具；任何无法证明等价的历史保持只读。对应 W6 第七项、W7 第二项及共享格式验收。

**F6 / P1：领域结果的新鲜度和权限是交付条件。** 当前摘要利用真实 `publishedAtNativeSequence`、最新同目标结果和未确认效果判断计数是否可信；旧证据返回 unknown，未授权上下文返回 withheld。保留公共结果本身的既有公开约定，私有请求、业务键及角色视图分别授权。裁判 `ok=true` 只表示命令接受，订单履约仍需独立事实；联盟/雇佣关系在当前协议未建模时为 not-applicable，不能输出技术绑定数或假零值。下一步核对列表/详情/导出共用映射、撤权与卸载行为，满足后再勾选 W3。

### 下一步执行顺序与 checklist 使用方式

沿用下文 W0～W7 和共享验收的原 checklist，不重置已有勾选，不因看到实现就把未完成项标为完成。每项关闭需记录对应源码身份、命令、结果及未覆盖边界；以下交付顺序把剩余工作绑定到已有条目，不另建竞争清单。

| 批次 | 具体开发交付及原 checklist | 必须形成的验收证据 | 前置条件与退出规则 |
|---|---|---|---|
| A：停止与恢复闭环 | W1 第三/七/九项；按 F3/F4 审核入口、保存依赖与只读对账。 | JSON/SQLite 的双时钟、断线、冷恢复、崩溃窗口、失败保存/重试及解除后恢复；未完成责任保持一致。 | 先固定源码；任一入口可越界或 unknown 被重发则不能进入真实长测。 |
| B：领域与观察交付 | W3 全部五项；复核 W2 在当前源码的 Host/SDK 传递。 | committed+ok=false、接受但未履约、陈旧/缺失证据、跨 principal/角色、撤权、旧 cursor、卸载与导出一致性。 | 读取不得触发模型/CLI 或提升披露；通过证据审核才更新原勾选。 |
| C：初始上下文与容量 | W6 第一至第六/第八项；按 F1/F2 补纯预检、测量和必要投影。 | 1/10/100 MiB、两种后端、冷/热 provider、单读/并发；记录耗时、读取/编码字节、RSS、控制可用性及失败阈值。 | 先确定预算再测量；已有 1 MiB 报告不能替代 10/100 MiB，也不能把新进程冷读称为 OS 冷缓存。 |
| D：备份与旧格式 | W6 第七项、W1 第七/九项、共享格式条目；按 F3/F5 完整打包和必要隔离迁移。 | 原源不变、精确 pin/hash、缺失/篡改拒绝、原目录不可用时完整隔离恢复、迁移前后业务与证明等价。 | 无可靠旧 parser/迁移或缺外部日志时停止在只读归档，不能伪称原运行可续跑。 |
| E：发布前收口 | 共享验收五项；复核 W4/W5 当前输入未变，更新 README/JSDoc、TS/Python 严格协议及双语文档。 | 按 diff 的聚焦检查、类型/lint、文档门禁及真实 Loader 的 keyless 快照；逐项记录运行和未运行范围。 | 本次不执行这些测试；后续变化才按 owning skill 选择必要检查，不盲目重跑全仓。 |
| F：阶段性真实验证 | W7 全部五项，沿原 run 和原检查点核对后分阶段继续。 | 原裁判审计、身份/信息隔离、原正文、订单责任、用量/压缩质量、年中恢复与全年覆盖分别记录。 | 必须另行取得真实运行授权，确定费用/token/时间上限和停止条件；本文件不授权续跑。 |

当前验证结论仅为静态核实完成。文中原测试日志、已勾选条目和容量样本均为已有工作记录；本次不新增“测试通过”“全年可用”或“已完成迁移”的结论。业务代码、原始日志和暂停运行均不因本文维护而修改。

### 逐项核实（历史设计基线）

“已落实”表示源码存在所述修复，不表示本次重新验证。P0 为停止边界，P1 为可靠性、成本和可观察性，P2 为扩展验证。

| 问题 | 静态核实与代码证据 | 下一步与优先级 |
|---|---|---|
| SYS-01 独立裁判接入 | [HarborExecution](../../../../packages/simulation/simulation-world/src/harbor-execution.ts) 从原请求取动作和真实 Team/Session 绑定；[HarborCase](../../../../packages/simulation/simulation-world/src/harbor-case.ts) 校验源码、保留执行身份并拒绝缺失原始世界后重建。基础接入已落实。 | P1 保留多存储恢复要求；新生角色由创始者代表的限制须明确。全年覆盖进入 W7。 |
| SYS-02 新旧决策混淆 | [input.ts](../../../../packages/simulation/simulation-team/src/input.ts) 明确当前 `inputId`、观察、空提案和提交；[model.ts](../../../../packages/simulation/simulation-team/src/model.ts) 将暂存绑定当前 decision。提示修复已落实，不能保证模型推进。 | P1 W4/W5，保留新输入独立提交和不自动补空决策的约束。 |
| SYS-03 暂存与结构纠错 | [工具说明](../../../../packages/simulation/tool-simulation/src/index.ts) 明确暂存无效果；[schema 校验器](../../../../packages/core/tools/src/json-schema.ts) 支持判别分支、字段路径、未知字段拒绝。通用 stage 只做部分领域预检，尚非所有领域的完整纯结构预检。 | P1 W4，按已安装版本提供准确预检与最小示例。 |
| SYS-04 旧 requestId | [model.ts](../../../../packages/simulation/simulation-team/src/model.ts) 在 resolve/scenario-resolve 暂存阶段比较当前 `requestId`，赋值到 staged 之前拒绝不匹配。 | 修复已落实；W4 将历史重用与修正后提交纳入回归。 |
| SYS-05 转抄改写 | [v3 plan schema](../../../../packages/simulation/simulation-world/src/harbor-protocol.ts) 只允许 `{forwardOriginal:true}`；执行器从 Native 原请求读取 payload。 | 修复已落实；W1/W4 保留真实裁决、原内容和重试身份，不修写旧失败记录。 |
| SYS-06 版本与长度 | 同一协议文件保留 v1/v2/v3 注册；order/loan 引用分别允许 106/105 字符。版本化修复已落实，不能据此恢复更早被改变 schema 哈希的试验。 | P1 W2/W6，给不可观察历史明确原因和受控导出。 |
| SYS-07 生命周期竞争 | [控制器](../../../../packages/team/team-activation-controller/src/index.ts) 的 `withCurrentEntryBinding` 使用按 Team 的 `teamStatusTails`；另有每 epoch 队列和有界 cursor 重试。 | 已落实所述竞争修复；W1 停止收尾复用该路径，不能扩大为跨异步授权快照复用。 |
| SYS-08 长程额度和读取 | [Local inspection](../../../../packages/simulation/simulation-local/src/index.ts) 默认 100,000 条/16 MiB，索引命中前仍完整读取日志并计算前缀哈希；产品分页发生在观察快照之后。提高至 1 GiB 只改变上限。 | P1 W5/W6，分离控制读取与全历史、测量内存与读取成本。 |
| SYS-09 无收益压缩 | [pre-step](../../../../packages/compaction/compaction-basic/src/index.ts) 每步检查压力，失败后继续；[region](../../../../packages/compaction/compaction-basic/src/region.ts) 拒绝不更短摘要，但引擎没有跨步骤无收益指纹状态。现有 `maxOverflowRetries` 不能限制普通压力路径重复。 | P1 W5，确认存在重复付费机会；不能把全部 1,669 笔结算归因于它。 |
| SYS-10 指定日停止 | [产品管理输入](../../../../packages/simulation/simulation-product/src/control-types.ts) 只有 phase/tokenRecovery；[World owner](../../../../packages/simulation/simulation-product/src/world-owner.ts) 调用无参数 `advance()`；[driver](../../../../packages/simulation/simulation-world/src/driver.ts) 的可选 `until` 只约束该批次未来 Native 事件，Harbor `advance` 另行推进裁判日期。 | P0 W1。确认缺少跨时钟、持久化且可恢复的停止目标；并非底层完全没有时间边界。 |
| SYS-11 失败原因 | [Company owner](../../../../packages/simulation/simulation-product/src/company-owner.ts) 和 World owner 均清除旧 `last`；Company 丢弃异常参数，World 只记录日志。`LlmFailure` 已有 code/status/retry-after，但公共 control 未承载该分类。 | P1 W2，修复原因传递；不要重建已有 LLM 失败体系。 |
| SYS-12 连接与认证 | [HMR](../../../../packages/client/hmr/src/client/index.ts) 处理隐藏页面连接；[renderer](../../../../packages/client/ui-renderer/src/client/index.ts) 观察 root 注册；[cookie owner](../../../../packages/client/connection/src/product-auth.ts) 按实际监听端口固定名称。 | 修复路径存在；保留多窗口、长连接和迟到回调覆盖，端口隔离不是保密边界。本计划不重设计 UI。 |
| SYS-13 业务语义 | [World projection](../../../../packages/simulation/simulation-product/src/world-read-projection.ts) 独立控制 businessKey/正文披露；[case execution](../../../../packages/simulation/simulation-product/src/cases.ts) 提供通用 outcome/payload。Native committed 可对应 Harbor `ok=false`，两者不是同一种成功。 | P1 W3，领域摘要及结果分层；没有证据表明应取消披露权限。 |
| SYS-14 长期验证 | 原审计说明测试在第 12 天停止，并未完成 horizon、decisionCoverage、checkpointCoverage、recoveryCheck。 | P2 W7，属于证据缺口；本次不能认定全年实现失败，也不自动续跑。 |

### 已有证据及边界

[Harbor 单测日志](../../../plans/2026-10-21-simulation-system-reliability/evidence/harbor-forward-unit.log) 显示 8 项通过，[Harbor 快照日志](../../../plans/2026-10-21-simulation-system-reliability/evidence/harbor-forward-snapshot.log) 显示 4 项通过，[驱动失败日志](../../../plans/2026-10-21-simulation-system-reliability/evidence/driver-failure-stop-tests.log) 显示 58 项通过。这些是历史测试输出，不能相加为全仓覆盖，也不能证明所有未提交改动或未来设计已通过。针对重复压缩频率、峰值内存和列表陈旧状态的完整因果链，目前证据不足，必须作为测量任务而非既成结论。

## Proposal

### 所有权与不变量

Native 拥有持久化控制事实和准入；Product 负责鉴权、幂等命令、观察及调度生命周期；World provider 解释案例时钟、外部执行和领域结果；Team/Session 拥有真实输入消费及用量证据。扩展现有插件能力，不把 Harbor 特殊规则硬编码进通用 agent-loop。

停止目标与场景固有终点分离。暂停不代表业务成功，Native `running` 不代表 driver 活跃，检查点请求已受理不代表完整备份，Native 结果写入不代表裁判接受。控制事实不能被 UI 连接、提示词、缓存或旧批次结果覆盖。所有新增模型可见停止信息、预检提示和摘要均须来自可回放的 Session 事件。

### D1：持久化停止目标与双时钟边界（W1）

新增独立的 run-control 命令/事件，由 Native 串行写入；Product 使用已认证 principal，调用方只保留幂等 commandId，不自选角色权限。控制更新、暂停和执行准入必须共享可排序的控制 revision。目标字段建议如下，名称在实现时纳入严格 schema：

| 字段 | 含义与规则 |
|---|---|
| `targetId` / `revision` | 当前目标身份及单调控制版本；相同命令相同输入返回原结果，换输入拒绝。 |
| `clock` | `native` 或精确版本的领域时钟，例如 `harbor-day`；禁止用浏览器日期或 wall-clock 推导。 |
| `boundary` | 规范化时间值；Native 保持 SimTime 精度，Harbor 使用裁判 day。不可设置到已确认时间之前。 |
| `mode` | `at-boundary`：到达边界关闭新的业务准入；`drain-admitted`：仅完成到达边界时已受理的工作集合及其必要协议收尾。 |
| `state` | `armed → draining → paused`，另行记录 checkpoint 的 pending/completed/failed；不能把保存失败当作仍在运行。 |
| `cut` | 触达边界时的 Native revision、领域 revision、时间及已受理工作身份，冻结收尾范围。 |
| `checkpointPolicy` | 是否保存及保存策略；暂停完成和可恢复性分别有明确证据。 |

领域 provider 声明时钟观测和动作时间影响的纯解释接口，Harbor 至少覆盖 `advance`、wake/消息投递的未来工作和隐式推进日期的动作。解释器只回答是否越界、依据哪个 revision，不改写动作。Native 事件仍受自身边界约束；领域时钟与 Native 时间不能假定永远相等。不存在可靠映射的多时钟场景明确拒绝安装该目标，不能声称已经保护。

执行顺序为：持久化目标 → stage 可纠正预检 → Native 提交/准入检查 → 外部执行前再次检查 → 裁判回执落盘和 Native 对账 → 检查触达边界 → 关闭新业务准入、收尾、暂停和保存。只在 stage 或 driver 最外层检查都不足以防止其他入口绕过。Host 管理、重试、冷恢复和定向执行同样检查；reconcile 优先读取已有执行回执，不能因新停止目标而丢失已经产生的外部效果。

目标更新与外部派发使用同一串行授权边界。若跨界请求已经发出，不能承诺撤回；更新先关闭后续准入并等待该执行可确认，返回 pending 或 outcome-unknown。只有证明当前位置和仍可执行工作不越界，才确认目标生效；若当前已超过新目标则拒绝该目标并保留暂停。进程在“外部已执行、Native 未记录”之间崩溃时，恢复先对账，不能重发或回拨裁判。

`at-boundary` 不撤销已产生的业务责任；已经发出的动作必须完成对账，未派发工作保留为暂停。`drain-admitted` 在 cut 冻结集合，只允许该集合的裁决、结果写入和必要通知；不允许通知再生成任意新业务请求，或以新的多轮讨论无限延长收尾。所有收尾保持日期不越界，并有最大步骤、token、现实时间预算；耗尽则暂停并列出剩余责任，不能宣称收尾完成。需要之后日期才履约的订单继续保留。

到达 day 12 不是完成 365 天案例，不能触发伪造的 `finish`。11→13 在目标 12 下返回可纠正的越界拒绝，不静默改成 12；11→12 允许，之后不再产生越界工作。普通 start 不能绕过已触达的目标；必须显式修改/解除目标，再单独恢复。没有事件可推进时可以停在边界之前并报告 idle，不为凑日期自动制造模型决策。

停止目标必须进入 Native 回放和检查点引用。现有 [manifest](../../../../packages/simulation/simulation/src/checkpoint.ts) 保留完整 Native 前缀、Team/Channel/Session 引用，不能直接假定其包含外置 Harbor 文件。完整恢复交付需通过 provider-owned 备份清单绑定裁判源清单、原日志、bridge 回执及 Native/Team/Session 的一致切面；暂不支持时明确 `external-state-required`，仅声明暂停或部分保存。保存失败保持暂停，重试同一保存身份且不启动推理。

### D2：安全故障分类和观察一致性（W2）

复用 [LlmFailure](../../../../packages/llm/llm/src/types.ts) 的 `code/status/providerRetryAfterMs`；在失败归属仍明确的适配器/Team/driver 边界保留结构化原因，Product 只公开白名单。新增观察包含 `category`、`retryDisposition`、`actionCode`、`failureId`、失败发生时间和关联 Native revision。通用异常降级 unknown；不能只根据字符串匹配“余额不足”就赋予业务或重试权限。

| 类别 | 处理语义 |
|---|---|
| payment-required / insufficient-balance | HTTP 402 只能先确定支付受阻；有可靠 provider code 才细分余额。要求账户处理及显式恢复。 |
| rate-limited / network / provider-unavailable | 标记可重试性质和有界 retry-after；沿用既有 owner 显式恢复策略，不顺带新增自动重试循环。 |
| context-limit / request-budget / token-overrun | 区分模型窗口、单请求准入和区间用量；保留现有恢复/额度确认路径。 |
| protocol-unavailable / history-limit / storage / integrity / unknown | 指向安装版本、读取额度、保存或一致性处理；不能反复启动模型代替修复。 |

把安全失败记录与 driver 当前实例/批次身份绑定；成功的新批次只能清除自己的旧失败，保留审计事实。冷恢复看到历史 running 但无 live owner 时返回 owner-unavailable/recovery-required，不能复用过期 failed/advancing。phase、driver、inFlight、stop 和 checkpoint 继续独立表达，并携带各自来源 revision/observedAt；两种来源未在同一切面观察时不伪装成原子快照。

列表、详情和导出复用同一安全映射。原始 message、路径、HTTP body、凭据与 provider requestId 不直接进入普通 DTO；按权限诊断使用受控 correlation ID。当前 [observe/runStatuses](../../../../packages/simulation/simulation-product/src/index.ts) 会把多种读取失败合并为 unavailable，应保留 missing、unsupported-version、history-limit、corrupt-history 等安全区别；撤权后整批仍拒绝，单个损坏运行不能掩盖其他授权运行。

### D3：领域业务摘要与成功分层（W3）

新增可注册的纯领域投影器，按精确 domain/operation/version 选取，只读取已验证 Native 结果或已登记的原始裁判证据，不触发模型、不获取执行 owner、不运行会改变世界的 CLI。Host 提供披露权限并在异步读取后复核；投影器不能自行扩大授权。缺少投影器返回 unsupported，不能把零项当作零责任。

统一输出三层：`submission`（已提交/已受理/拒绝）、`execution`（待执行/裁判接受/裁判拒绝/未知）、`businessOutcome`（已达成/未达成/未知/不适用）。Harbor `receipt.ok` 仅证明该命令被裁判接受；订单是否交付、目标是否实现须有对应裁判事实。每个结论携带 request/result/source revision、证据引用和覆盖范围，列表/详情/导出使用同一转换器。

摘要逐字段返回 allowed/withheld/not-applicable/unknown。公开业务标签、私有正文、业务键和角色视图分别授权；公开摘要不等于完整 payload 可见。Harbor 公司/联盟/雇佣关系来自领域证据；原始角色 Session 数、业务实体数、由创始者代理的实体数分别计数，不能把技术绑定数当业务组织规模。计划内只定义后端 DTO，UI 改动另行实施。

### D4：可纠正的协议预检（W4）

扩展现有 stage 校验，基于当前 prepared context 和精确版本的领域 schema 做无副作用预检，返回有界 `path/code/expected/allowedValues`。预检不得分配 request、执行裁判、改写 payload 或提供未授权当前请求信息。失败保留此前有效暂存值，并明确本次 replacement 未被接受；修正后提交仍执行 Native 权限、时序和完整约束检查。

最小示例来自拥有该 schema 的版本化领域描述，覆盖 `after`、`action.kind`、`resolution.kind` 和 Harbor forwarding；不由通用工具拼出未经验证的业务动作。将示例或提示纳入冻结且可回放的上下文。对 final prose、重复 stage、过期 requestId、未知字段、跨请求权限和 Unicode/长正文分别保留回归。不允许宽松解析默默丢弃模型输入字段；裁判输出的显式公开字段投影另有约定，不应误改成全量公开。

### D5：压缩抑制与用量归因（W5）

先利用已有 [token reservation](../../../../packages/simulation/simulation/src/tokens.ts) 中 `decisionId/compactionId/sessionSequence`、[compactionStream](../../../../packages/simulation/simulation-team/src/compaction.ts) 和 Session 请求事实分类：业务选择、调控者裁决、结果通知/收尾、普通通信、压缩、无法归因。类别必须互斥且能对账总量，无法确定时进入 unknown；普通消息可与决策共享一次请求，不能机械拆分或重复计费。分别展示 input/output/cache read/cache write、reserved/unknown/settled，不把 token 当费用，也不把请求数当业务决策数。

先区分固定系统/工具上下文、可压缩历史、保留尾部和请求输出预留。固定上下文已经占满窗口时返回明确压力原因，不能持续压缩极短历史。用统一 token meter 衡量压缩前后收益，保留现有摘要来源、工具配对、surface generation、取消和提交前校验。

新增类型化 no-gain 结果，指纹覆盖所选 surface 节点身份与内容、替换代次、实际影响摘要的输入、目标模型、已解析策略和 meter/算法版本。无关日志 seq、墙钟和新增失败记录不能改变指纹。相同输入在普通 pressure 下不再次付费；输入有小幅变化时，按新增可压缩 token 门槛和有界冷却合并重试；策略或模型确有变化时重新评估。阈值属于验证过的 Cordis Config，默认值由固定样本对比决定，本提案不伪造成本收益数字。

只保留每 Session/策略有界的近期抑制状态，并将重启所需最小事实记录到可回放事件中，不记录第二份私有正文；恢复不能把原样无收益摘要再付费一次。手动压缩可显式覆盖一次抑制，不能启动后台重试。context-overflow 可选择更激进的合法范围，但同一无收益输入不应无限重做；只有持久 surface reduction 才重试原请求，继续遵守 `maxOverflowRetries`。新日志类型同步更新 Session 解码和两侧 SDK。

### D6：有界读取与创建前检查（W6）

已有产品分页和 inspection index 应继续使用。问题在于 [inspectExisting](../../../../packages/simulation/simulation-local/src/index.ts) 先读完整日志，且 [snapshot](../../../../packages/simulation/simulation-local/src/run.ts) 使用 detached copy；缩小页面或加大缓存不能证明磁盘读取和内存有界。先量化 journal bytes、条目数、每次读取字节、replay/hash/copy 时间、峰值 RSS、并发观察数和冷恢复耗时。

第一阶段提供现有 owner 的小型权威控制投影，携带 revision 和新鲜度，停止/暂停/保存不依赖重放完整浏览历史；冷态或其他 owner 无法证明时返回明确 unavailable。第二阶段在存储 reader 层实现固定截止 sequence 的分页扫描/校验，SQLite 使用一致读切面；JSON 原子大文档仍须完整解码的问题需要单独选择分段格式或声明其受限支持，不能只在数组上 slice 后声称流式读取。

详细状态走已验证检查点/投影基线加后缀，或维护有界派生索引。现有检查点仍要求从 sequence 0 的完整保留前缀恢复，不能未经设计就把它当可直接反序列化的权威快照；新增基线必须有精确版本、来源哈希、完整性和失效规则，无法验证时退回有界原始重放或明确拒绝。cursor 绑定 run、截止 revision、过滤器、排序、principal 与披露策略代次；续页期间世界变化时返回同一切面或 stale，不混合前后计数。

创建 preflight 检查可确定的时钟支持、模型上下文容量、单请求额度、初始必需上下文大小、provider 版本和备份能力；未来全年消耗只能标为估计/未知。运行的冻结额度不因部署改大而重写。超限返回维度、实际值/所需值与已授权的处理建议；正文只能显式截断并带 coverage，结构化权威状态不能截断成“完整”。原始导出按现有所有权和披露权限授权，缺少 parser 时只允许受控原始归档，不静默用新 parser 解释旧数据。

## Development plan

复选框按已完成并核验的实现/验收任务实时更新，未勾选表示尚未完成。按职责拆独立 PR，存在代码依赖才建立顺序依赖；不把所有工作塞进一个重构。

| 工作包 | 顺序/依赖 | 主要修改所有者 | 完成条件 |
|---|---|---|---|
| W0 证据与基线 | 首先 | 本提案、原测试产物 | 固定工作区和证据身份，明确历史通过范围。 |
| W1 强制停止 | P0；W0 后 | simulation 定义/local、product owner、world driver/Harbor、checkpoint、Host/SDK | 双时钟不越界、断线/重启有效、暂停/保存状态独立。 |
| W2 故障与状态 | P1；可独立于 W1 开发，集成其停止原因 | llm 失败边界、Team、product/control、Host/SDK | 安全原因可达，旧批次原因不复活，明确恢复策略。 |
| W3 领域摘要 | P1；复用 W2 观察规则 | world provider、product projection/disclosure、Host/SDK | 三层结果一致、领域计数明确且不升权。 |
| W4 协议纠错 | P1；独立，复用 W1 越界预检 | simulation-team/model、tool-simulation、领域 schema | 在提交前可纠错，Native 最终校验不弱化。 |
| W5 压缩与成本 | P1；先归因，再抑制 | compaction/basic、Session、simulation-team/tokens、product | 同内容无重复付费、溢出恢复仍有效、总量可对账。 |
| W6 长程读写 | P1；先测量，复用 W1/W2 | simulation-local/storage reader、product/read/preflight | 超限仍可控制，小读取成本有界，坏历史可诊断。 |
| W7 阶段长测 | P2；W1/W2/W5/W6 完成后 | 现有 runnable examples、原始案例审计 | 经用户授权逐阶段续跑，机械与人工验收分列。 |

### W0：固定证据

- [x] 将实际实施基线固定为可审查 commit，并记录当前脏工作区中所依赖的修复；不能只引用上述 HEAD。
- [x] 保留原报告、审计、日志和关键源码哈希；临时目录证据需归入项目内批准的持久证据位置，才能用于正式 PR 长期引用。
- [x] 建立 SYS→W→用例映射，保留旧失败 run；单独标注缺失原始协议/存储的运行，不尝试改写修复。

开发基线已固定为独立快照 commit `0e85170d1236cfe846ebc3b88a073d848903fb47`，引用为 `refs/clocky/development/simulation-system-reliability-baseline`，未移动当前分支或更改用户索引。[证据清单](../../../plans/2026-10-21-simulation-system-reliability/evidence/manifest.json) 保留 8 份原始报告/审计/日志和 11 个关键源码哈希；`python3 .agents/plans/2026-10-21-simulation-system-reliability/evidence/verify.py` 已验证文件哈希、快照树和 vendor 无差异。原始产物作为不可修改证据保留，文档中的原相对链接仍按其原始目录解释。原失败/暂停运行未被打开或重写；SYS-06 所述旧 schema 证明不可读仍作为已知历史限制，不能凭此快照宣称修复。

| 问题映射 | 工作包与验收用例归属 |
|---|---|
| SYS-01/05/06 | W1/W4/W6/W7：Harbor case、Harbor snapshot、冷恢复及版本哈希。 |
| SYS-02/03/04 | W4/W5：Team world/model-observation、schema 诊断、原输入身份与暂存修正。 |
| SYS-07 | W1：Team activation-controller 并发退休、暂停收尾与 writer 释放。 |
| SYS-08 | W5/W6：inspection/index、request-budget 和容量基准。 |
| SYS-09 | W5：compaction-basic/compaction-loop-repro 与跨恢复抑制。 |
| SYS-10 | W1：Native scheduler/management、Company/World owner、双时钟边界。 |
| SYS-11/12 | W2：driver 故障与读取分类；保留现有 cookie/HMR 组装回归。 |
| SYS-13/14 | W3/W7：domain-read/disclosure、原始裁判与阶段长测。 |

### W1：停止控制

- [x] 在 Service Definition 增加控制类型、事件、严格解析、不变量和查询；在 Local 同一写队列中持久化目标与 cut。
- [x] Product 增加鉴权与幂等更新/解除命令；普通 start 校验目标，撤权与相同 ID 换 payload 均拒绝。
- [x] World/Company driver、Native drive、Harbor executor 和管理/重试入口统一检查；不得仅给 `advance(until)` 传参即宣称完成。
- [x] 实现并发更新与外部派发的顺序保证；为在途、已越界、未知结果提供明确回执，不把 pending 当生效。
- [x] 实现两种停止模式、固定收尾集合及预算；保留未派发工作、未完成订单和不确定外部责任。
- [x] 目标达到后停止自动新唤醒；从日志产生模型可见约束，不改写已消费输入。
- [x] 将控制事实和外部案例备份依赖纳入检查点/恢复；保存失败、部分保存、重试和完整保存分别可观察。
- [x] 覆盖 11→13 拒绝、11→12 停止、等于/早于当前时间、无事件、未来消息、其他管理入口绕过和并发收紧目标。
- [x] 覆盖外部提交前后崩溃、Native 记录前崩溃、断开 UI、JSON/SQLite 冷恢复、失败保存和显式解除后恢复。

W1 的 Harbor 时钟解释器、冻结上下文中的停止信息、pending/draining/paused 时不再生成角色机会，已通过 `.tmp/simulation-system-development/harbor-clock-tests.log` 的 17 项测试；相关 World 类型检查通过。Native 停止目标与产品控制入口仍在集成，Native 定义、持久化、回放与不变量已通过 `.tmp/w1/tests.log`、`.tmp/w1/types.log`、`.tmp/w1/lint.log` 验证，第一项已完成；其余集成验收仍未完成。

W1 Product/Host/SDK 的鉴权、幂等更新/解除、冷态 receipt、排队后撤权及停止后 start 拒绝已由 `.tmp/w2/w1-final-tests.log` 的 256 项测试和 `.tmp/w2/w1-final-python.log` 的 12 项 Python 用例确认，相关 Host/SDK 类型检查及 lint 通过；当前原始接口回归并不替代自动保存、完整外部备份或所有旁路的验收。

W1 双时钟与收尾进一步由 `.tmp/w1/dual-clock-tests.log` 的 20 项用例和当前源码 Harbor Loader 验证：`.tmp/simulation-system-development/harbor-dual-clock-snapshot.log` 的 5 项通过，剩余一项在加载阶段因 esbuild 服务终止而失败，随后相同用例在 `.tmp/simulation-system-development/harbor-dual-clock-retry.log` 单独通过。Native 日界映射、未来 Native 唤醒/消息拒绝、11→13 修正到 12、足额收尾及不足额保留通知均有证据；映射时钟先触达时报告 `native-boundary-reached`，不伪造裁判日期。先前收尾失败已确认是测试预算 100,000 小于冻结单请求预留 262,144；现在分别验证合理有限预算和不足预留预算，未改变生产准入。自动保存与显式逻辑重试由 `.tmp/simulation-system-development/stop-checkpoint-complete-tests.log` 的 10 项用例验证，保留原失败物理检查点。完整外部备份和全入口复核仍待完成。

W1 第三/九项现已完成：原 Native/Company/World 公共执行路径在循环、计划准入、实际派发及调度/消息处使用同一停止事实；`.tmp/simulation-system-development/stopping-final-unit.log` 的 5 个文件 37 项覆盖源层守卫、在途结果、冷恢复、保存失败/显式重试以及控制提交后调用方断线丢失确认。`.tmp/simulation-system-development/harbor-stop-current-final.log` 的 6 项当前源码 Loader 用例覆盖 JSON/SQLite 双时钟、11→13 拒绝并修正到 12、两种停止模式、足额/不足额收尾及普通 start 拒绝；所有用例直接使用原裁判和记录的角色选择。`.tmp/simulation-system-development/reconciliation-proof-final.log` 的 29 项包括真实裁判执行/回执后 Native 追加失败、回执缺失和派发前目标改变；未知结果只读对账，不重新派发。这里只证明后端独立于已断开的调用方保留目标，不宣称新增浏览器矩阵通过。第七项也已由 [完整备份停止快照](../../../plans/2026-10-21-simulation-system-reliability/evidence/harbor-full-backup-stop-snapshot.log) 的两后端用例完成：原案例目录下线后恢复目标/cut/命令历史/save disposition，单独 Native 保存仍明确为 external-state-required，不伪装成完整备份。

### W2：故障与观察

- [x] 找到 typed failure 从提供方到 driver 的丢失位置，保留稳定 code/status；通用异常归 unknown。
- [x] 新增安全 DTO/schema、失败身份、actionCode 和 retryDisposition；不直接传原始异常。
- [x] 持久失败与当前 owner/batch 对齐；保留 phase/driver/inFlight/stop/checkpoint 的独立语义和来源。
- [x] 区分历史读取 missing/limit/version/corrupt/owner-unavailable；单行失败与整批撤权行为分别保留。
- [x] 复用既有先成功后失败用例，覆盖 402、429、网络、上下文、未知异常、保存失败和恢复后过期回调。
- [x] 使用包含 token、路径和私有正文的错误夹具验证脱敏；分类映射不授予自动重试或权限。

W2 已验证 typed failure 传递、安全 DTO 与脱敏，原记录在 `.tmp/w2/tests.log`（70 项）、`.tmp/w2/tests3.log`（55 项）、`.tmp/w2/python.log`（6 项）及 `.tmp/w2/typecheck.log`。批次范围有重叠，不能相加为全仓覆盖；持久批次失败、陈旧回调拒绝和安全读取类别现已通过 `.tmp/w2/final-tests.log` 的 122 项组合测试及 `.tmp/w2/tests7.log` 的 JSON/SQLite 冷恢复用例；保存失败用例已由 `.tmp/w2/save-test.log` 确认；W2 六项现已完成。

### W3：领域读取

- [x] 定义版本化投影注册/卸载和 unsupported 行为；投影函数只使用已授权证据。
- [x] 以 Harbor 实现三层结果、来源引用、组织/角色/代表关系计数和未完成责任。
- [x] 列表、详情、导出共用映射；保留 private payload、业务键和 Persona 的独立授权。
- [x] 覆盖 `committed + ok=false`、裁判接受但订单未完成、结果未知、缺失证据和历史版本。
- [x] 覆盖跨 principal、跨角色、读取中撤权、旧 cursor、投影器卸载和缓存不串权限。

W3 的五项由当前源码审核及既有证据确认完成：`.tmp/w3-final-tests.log` 的 8 个文件 96 项用例覆盖列表/详情/导出、独立披露、撤权、旧 cursor 和投影器卸载；`.tmp/w3-freshness-tests.log` 的 11 项覆盖真实发布序列、陈旧/缺失/未来观测和未确认效果；`.tmp/w3-snapshot.log` 的 4 项真实 Loader 用例覆盖 JSON/SQLite、精确 v1/v2/v3 与冷恢复。另有 `.tmp/w3-python.log` 的 95 项及相关类型/lint 证据。公开结果按原契约保留，私有请求和环境分别授权，旧观测不伪装为当前计数。本次在确认这些记录覆盖当前投影源码后更新原五项，没有新增条目。

### W4：协议预检

- [x] 基于当前 prepared context 和 exact pin 增加领域纯结构预检；新增诊断限制大小和允许值数量。
- [x] 为阶段提供经 schema 验证的最小示例；记录提示的模型可见来源，保持 v1/v2 精确哈希及 v3 forwarding。
- [x] 覆盖未知字段、缺少 `after`、错误 `command.kind`、错误 resolution 层级、旧 requestId 以及失败暂存不覆盖有效暂存。
- [x] 验证修正只产生一次有效操作；重复 stage/submit 不重复外部执行，final prose 不补造空决策。

W4 预检、版本化示例及暂存拒绝路径已通过 13 项聚焦测试，相关 Team/World 类型检查和 lint 通过；原始记录在项目内 `.tmp/w4/tests.log`、`.tmp/w4/types.log`、`.tmp/w4/lint.log`。`.tmp/w4/world-tests.log` 的 202 项 World 测试通过；随后停止控制集成发现 Harbor 子路径缺少源码映射，早前 `.tmp/w4/snapshot.log` 加载了旧 Harbor 编译文件。补映射后 `.tmp/simulation-system-development/harbor-stop-snapshot-final.log` 的 6 项当前源码 Loader 用例通过：JSON/SQLite 的 11→13 暂存拒绝、同一决策修正到 12 并只推进一次、暂停后拒绝普通 start，以及原有 v1/v2/v3 和冷恢复回归；第四项重新确认完成。

### W5：成本与压缩

- [x] 先从现有 reservation/Session 证据生成分类统计和 unknown 桶；输入、缓存、输出总量与原始结算逐项对账。
- [x] 增加固定上下文、可压缩历史、尾部与收益测量，记录 attempt/skip/no-gain 及关联来源。
- [x] 实现类型化 no-gain、稳定指纹、最小内容增量、冷却、容量上限和冷恢复重建；不靠错误字符串或整个 Session revision 判定。
- [x] 保持手动路径、成功后的重新选择、取消优先级、工具配对及 surface generation 校验。
- [x] 用固定样本验证多步不变输入只付费一次，新有效内容/模型/策略变化重新评估，细小尾部变化不会每步付费。
- [x] 覆盖 provider overflow、model-free prune 后摘要失败、无进展溢出、重启、并发和手动单次覆盖。
- [x] 报告节省的请求/估计 token、实际已报告 token、耗时与摘要质量；不以接受无收益或错误摘要取得性能通过。

W5 类型化 no-gain、原样重试/小增量抑制、冷回放、手动路径、取消、工具配对和模型/策略变更由 `.tmp/w5-tests.log` 的 183 项聚焦测试验证；`.tmp/w5-snapshot.log` 的 keyless 溢出恢复场景通过（1 项通过，10 项按选择跳过）。尚未以这些结果宣称新抑制策略的所有溢出交互或成本报告已完成。

W5 用量归因现已进入已授权的运行 metrics 和 Python 严格 DTO；`.tmp/w5-tests.log` 的 189 项测试验证分类及逐桶对账。[原运行只读账本报告](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-ledger-report.json) 核对 1,669 次尝试、1,665 次完整结算及 4 次未知；已知 token 合计 45,546,584。14 份原 Session 完整逐帧解码并检查连续事件后，398 个压缩引用均由原位置的 `compaction/request` 精确佐证，397 次完整结算的已知用量为 8,680,744 token；其余 1,271 次尝试因取证器不重解释旧业务上下文而保留 unknown。报告没有打开新格式 Native writer、恢复运行或调用提供方。

W5 固定上下文压力诊断、attempt/skip 事件及所有原清单交互现已通过 `.tmp/w5-tests.log` 的 191 项聚焦测试和 `.tmp/w5-overflow-tests.log` 的 7 项真实循环用例，另有 `.tmp/w5-product-tests.log` 的 139 项 Product schema 用例、Python DTO 测试、类型检查和 lint。[固定样本测量](../../../plans/2026-10-21-simulation-system-reliability/evidence/no-gain-benchmark.json) 在 11 次等价压力检查中仅执行 1 次摘要、跳过 10 次，估计避免 10,920 输入 token；没有实际提供方用量，原 8 节点完整保留且无无收益摘要提交。耗时约 2 ms 只属于本地确定性夹具，不能代表真实模型或全年性能。W5 七项现已完成。

### W6：容量和读取

- [x] 建立 1/10/100 MiB 及部署许可更大日志的固定测量集，记录冷/热、单读/并发、JSON/SQLite 的时间、读取字节和 RSS。
- [x] 先提供小型控制投影和结构化超限原因，验证无法打开详情时仍能安全暂停并请求保存。
- [x] 存储层实现一致前缀的分页读取；为 JSON 完整文档解码选择分段设计或明确支持上限，保持受限失败。
- [x] 若引入投影基线，定义版本、完整性、来源身份、验证和失效回退；不把派生索引升级为未经验证的权威。
- [x] 完成稳定 cursor/coverage、权限代次、源移动/篡改/缺失/损坏检查和有界缓存淘汰。
- [x] preflight 只拒绝可证明的不可能配置，未知长期消耗明确说明；冻结 run 额度不被部署更新覆盖。
- [x] 定义受控原始归档和完整多存储备份清单，冷恢复时缺少 Harbor 原日志必须明确失败。
- [x] 在同一机器/同一样本上先确定可审查的延迟和内存预算，再验收；小型读取不得随全日志线性复制，不能只靠提高上限通过。

W6 第一/二/三/四/八项已完成。[容量矩阵](../../../plans/2026-10-21-simulation-system-reliability/evidence/capacity/matrix.json) 及其八份原始报告记录 JSON/SQLite 的 1/10/100/200 MiB 固定大 profile 日志、独立进程冷/热/双读者测量，原始数据库/JSON/WAL 字节哈希前后相同，未调用模型。预算在测量前固定：控制 p95≤250 ms、控制 RSS 增量≤8 MiB、详情≤30 s、运行时基线≤256 MiB、读取峰值增量≤8×样本 MiB+64 MiB、源读取≤256 MiB；初次超预算的失败未通过提高预算消除。JSON 去掉完整私有快照缓存、只保留源验证过的引用索引，Storage 改为逐记录累计完整 JSON 字节，保持精确包装/UTF-8 拒绝边界。10 MiB 双读者峰值增量从约 156 MiB 降至 100 MiB；200 MiB 最坏详情约 JSON 2.28 s、SQLite 3.22 s，控制 p95 分别约 0.192/0.168 ms。

现有 `.tmp/w2/w6-owned-control-proof.log` 的 2 项和 `.tmp/w2/w6-control-snapshot.log` 的 2 项真实 Loader 用例证明详情超限时活跃 owner 仍可读取小控制、暂停及保存；冷态诚实报告 owner/history 不可用。`.tmp/w2/w6-paging-tests.log` 的 16 项覆盖一致分页与读取边界；本轮 `.tmp/simulation-system-development/readonly-byte-accounting-tests.log` 的 9 项保留完整字节/多字节语义，`.tmp/simulation-system-development/json-inspection-cache-final-tests.log` 的 12 项验证修改返回值、坏/旧索引及来源变更不能污染下一次观察，相关 lint 通过。本轮未引入可直接信任的投影基线；所有详情仍由原前缀回放，JSON 完整解码有显式上限，SQLite 页最大 2 MiB。新进程不是 OS 冷缓存，报告字节不是物理 IO；固定样本不证明任意历史形状或全年容量。原第五/六/七项的补充验收见下文，W6 八项现已全部完成。

W6 第五项由 [来源与权限验收](../../../plans/2026-10-21-simulation-system-reliability/evidence/raw-archive-integrity.log) 的 19 项用例补齐：相同 revision 改写来源仍使 hash 改变并拒绝旧 cursor，暖读后来源移动/缺失/损坏不会被缓存掩盖；权限代次、精确 coverage、IO 后和最终发布前撤权分别受限。缓存只有一个受 inspection 条数/字节限制的引用索引槽，换源替换、关闭清除，不按 run 累积。第六项由 123 项定向测试和 [完整 quota Loader 验收](../../../plans/2026-10-21-simulation-system-reliability/evidence/initial-context-quota-snapshot.log) 的 10 项完成：Company/World 复用实际必需上下文构造器，精确核算 UTF-8/JSON 字节，按同一准入策略估计 token 下界；512-byte 配置在分配 run/command/Session 前拒绝，完整 envelope 与未来消耗保持 unknown，冻结额度不重写。[初始测量](../../../plans/2026-10-21-simulation-system-reliability/evidence/initial-context-measurements.json) 保留三个角色的真实已知子集。第七项由 [原始归档 Loader](../../../plans/2026-10-21-simulation-system-reliability/evidence/raw-archive-loader.log) 的两后端流程、195 项归档聚焦测试、独立全记录授权及上述完整 Harbor 包验证共同完成。原始归档可以保存未获 Native 验证的版本101逻辑字节，但不能成为完整备份或执行许可。

### W7：后续长期验收

- [ ] W1/W2/W5/W6 的 keyless 验收通过后，另行取得继续真实模型运行的用户授权；本计划不授权自动恢复。
- [x] 续跑原 run `25e846c3-9afa-4917-bd74-cd32dd9e709c` 前核对完整检查点 `product-checkpoint/7bb2f44c-50dc-4bf3-9e1f-53f7c9e9d510` 和全部外部存储；不以重建新世界冒充续跑。
- [ ] 先约定短期阶段终点、真实费用/token/时间上限、检查点频率和失败退出条件，再考虑第 180 天后恢复及全年覆盖。
- [ ] 每阶段核对原始裁判审计、未完成责任、身份隔离、来源视图、请求正文一致性、压缩质量和用量归因。
- [ ] 机械完成与人工业务因果/隐私检查分别记录；任何停止、余额不足或未完成全年都不得伪标通过。

W7 第二项的 [原检查点 inventory](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-checkpoint-inventory.json) 已实际核对原 run、原 product-checkpoint、14 个 Team/Channel owner、14 个 Session 及 427 个 Harbor 原文件，gaps=[]。原 10242 条101 Native 记录经固定 W0 的纯 Native/Harbor 解析器验证；显式转换通过 creation passport 绑定原前缀 hash 与冻结的独立历史 presenter，当前102回放 [投影严格相等](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-native-migration-proof.log)，历史101检查点描述原样保留，新记录只允许102。没有把缺少 preflight 文件的 W0 整个 App 声称为可运行旧 Loader。约 300.5 MB 的完整原包已在项目私密 `.tmp/w7` 中转换并 [完整隔离恢复](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-full-restoration.json)，最终目录 [再次冷打开](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-restored-cold-open.log) 仍为同一 run/day12/paused，新102 anchor 完成，原请求逐字段相等。[原所有者复核](../../../plans/2026-10-21-simulation-system-reliability/evidence/original-owners-unchanged.log) 的哈希全部未变，模型调用为0。完整私有包不提交；这证明可恢复性，不证明已续跑或全年验收。其余 W7 项继续等待单独的真实运行授权、预算/终点约定和阶段执行证据。

## Alternatives considered

**仅靠提示词或浏览器定时暂停。** 不能保证断线、跨日请求、冷恢复和后台派发的边界；保留模型可见目标，但把执行约束放在 Native/provider 准入。

**仅把 `until` 传给现有 driver。** 该参数为批次级 Native 时间限制，不能约束原始裁判日期或持久化目标；可作为底层实现的一部分，不能成为全部设计。

**只提高额度、读取上限和重试次数。** 可缓解本次运行，但不能消除全量读取、无收益付费和停止不确定性；配置仍可用，不能替代结构修复。

**自动修补模型参数、补造空决策或将裁判接受视为业务成功。** 会改变模型选择或虚构完成证据；采用精确预检、可纠正拒绝和结果分层。

**立即更换整套记忆/压缩架构。** [可回忆压缩提案](../feature/2026-07-06-recallable-compaction.zh.md) 有更大范围的记忆目标，不是修复重复无收益调用的前置条件；本轮先实现有界抑制及可对账测量。

## Acceptance criteria

完成条件按工作包验收，不用一次真实模型“看起来跑通”代替确定性边界。下列命令是未来实施后的建议检查入口，本次没有执行这些测试；新增用例文件名由对应工作包确定。

| 范围 | 现有检查入口及需补的断言 |
|---|---|
| W1/W2 | `pnpm run test packages/simulation/simulation-product/tests/company-owner.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts`；加入双时钟停止、并发与故障归因。 |
| W1/W4 | `pnpm run test packages/simulation/simulation-world/tests/harbor-case.spec.ts packages/simulation/simulation-team/tests/world.spec.ts`；保持版本、原 payload、私有视图和预检拒绝。 |
| W3 | `pnpm run test packages/simulation/simulation-product/tests/world-domain-read.spec.ts packages/simulation/simulation-product/tests/world-case-evidence-disclosure.spec.ts`；加入结果分层及撤权。 |
| W5 | `pnpm run test packages/compaction/compaction-basic/tests/compaction-basic.spec.ts packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts`；增加跨步骤、跨恢复的 no-gain 抑制。 |
| W6 | `pnpm run test packages/simulation/simulation-local/tests/inspection.spec.ts packages/simulation/simulation-local/tests/inspection-index.spec.ts`；增加真正有界读取与并发切面。 |
| 回放/恢复 | `pnpm run test:snapshot examples/simulation-company/tests/harbor.snapshot.ts`，并扩充停止、故障和冷恢复场景，覆盖 JSON/SQLite。 |

- [x] 每个 PR 按实际 diff 运行 [pre-push 检查](../../../skills/dsh-pre-push-checks/SKILL.md)，报告所跑范围、失败与未跑项；不要求每包都重复全仓测试。
- [x] 更新 TypeScript 协议、[客户端 SDK](../../../../packages/sdk/client/src/api.ts)、[服务端 SDK](../../../../packages/sdk/server/src/simulation.ts)、[Python SDK](../../../../python/sdk/src/clocky/simulation_base.py) 及相关严格解析；新增 Session 事件同步更新两侧 Session 事件所有者。
- [x] 更新所属 README/JSDoc、子系统说明与双语记录，运行相关类型检查、lint 和 `pnpm run doc-sync`；产品/模型可见变化补 keyless runnable-example snapshot。
- [x] Native journal、检查点或 SQLite 格式有结构变更时按各自版本机制演进并明确拒绝不支持旧格式；Session format 仍为 0。保留 Harbor 既有精确领域版本，不能借通用版本升级重解释旧证明。
- [ ] 涉及产品 GUI 的后续 PR 补真实服务/模型流程 GIF；本文仅定义后端接口，不包含 GUI 实现。

共享第二项已由 [协议一致性审阅](../../../plans/2026-10-21-simulation-system-reliability/evidence/sdk-protocol-consistency-audit.md) 完成：Native/产品定义贯通 Host dispatch、TS 低/高层 API 和 Python 严格模型；包含 nativeBoundary/标量 cut、安全故障与 driver 来源、world-case/v4、原始归档和用量归因。新 compaction/assessment 与 end.noGain 现在由两侧 SDK 严格验证，拒绝额外字段、错误 hash/计数和成功 end 携带 noGain；新纯校验 leaf 不引入 Node/Cordis 运行时。[TS 12 项](../../../plans/2026-10-21-simulation-system-reliability/evidence/sdk-compaction-evidence.log) 与 [Python 188 项](../../../plans/2026-10-21-simulation-system-reliability/evidence/sdk-python-protocol.log) 同时覆盖 Session 词汇表、UUID 版本/variant、safe-integer 和 UTF-16 标签边界。相关定向类型/lint/runtime 与配对检查通过；全仓构建、文档门禁及其他共享条目仍单独验收。

共享第一/三/四项已完成：[完整构建](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-build.log) 包含 Host/Client 两个 TypeScript aggregate 和实际产物；[全仓 lint](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-lint.log) 通过；[doc-sync](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-doc-sync.log) 29 项全部通过。[Client/Host 检查](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-client-host-tests.log) 为 448 个文件、5677 项通过、1 项跳过，不与其他批次相加；SDK 严格载荷校验后的 [压缩真实 Loader 回放](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-compaction-replay.log) 1 项通过、10 项按选择跳过，[实际构建 leaf 导入](../../../plans/2026-10-21-simulation-system-reliability/evidence/final-built-leaf-smoke.log) 也通过。Native 当前 journal 为102，旧101只有显式转换的 hash-verified prefix/profile 可重放；旧检查点描述保留，新锚点102，Session format 保持0，Harbor 精确 v1/v2/v3 parser 契约不重解释。编译器曾触发默认4 GiB堆上限，最终编译使用 `NODE_OPTIONS=--max-old-space-size=8192`；产品读取/内存验收预算没有提高。80 个由 sourcemap 证明为旧编译输出的未跟踪 src 产物已可逆保存至项目 `.tmp/simulation-system-development/preserved-source-emissions`，不编辑生成声明来通过 lint。

停止状态的协议适配保留原界面布局和操作：计数取小型控制投影的标量字段，并明确为开始收尾时的范围，不冒充当前剩余责任。对应当前前端/Host 测试已通过；真实 Host/真实模型浏览器流程及 GIF 没有执行，仍保留原共享第五项未勾选。额外 premium 静态审计只报告既有 InfoHint 由共享 Tooltip 注入 focus/hover handler 而工具未识别的项，原报告和复核保存在项目 `.tmp`，没有伪报静态审计通过。当前总进度47/52；剩余四项 W7 与该 GUI 发布证据均须单独的真实运行授权及预算，原第12天运行保持暂停。

### 与现有设计的关系

已检查 [Harbor 集成](../../implemented/feature/2026-10-21-harbor-original-judge.zh.md)、[决策边界](../../implemented/bug-fix/2026-10-21-simulation-decision-boundaries.zh.md)、[运行状态](../../implemented/architecture/2026-10-01-simulation-runtime-status-observations.zh.md)、[只读历史](../../implemented/architecture/2026-09-29-simulation-readonly-history.zh.md)、[持久协调提案](../architecture/2026-09-17-durable-simulation-coordination.zh.md) 和上述可回忆压缩提案。它们仍分别拥有身份、提交、观察、读取和记忆约定；本提案新增可靠性设计与交付顺序，不完整取代任何现有机制，因此保留，不归档或改写旧提案。

## Risks

**停止与已经派发的外部效果存在竞争。** 需要明确定义生效时点并保留未知责任，不能用取消 Promise 证明外部停止。收尾范围若不冻结，纯消息也可能造成无限延长。

**两种时钟及旧格式可能不支持直接继续。** 不可靠映射或缺失精确 parser 时拒绝保护/恢复并给出归档路径。正式部署前先完成版本与证据保留方案，不承诺对早期未正确版本化数据进行无损升级。

**新的读取缓存和摘要可能扩大披露。** 每次读取及返回前复核权限，缓存绑定策略代次；原始导出与私有摘要不能因可诊断性要求而开放。

**压缩抑制可能延后必要恢复。** 只抑制已证明无收益的等价输入，保留 changed-input、manual、overflow 的有界路径；性能改善须与上下文完整性一起验收。

**当前集成证据仍依赖本地临时目录和脏工作区。** W0 已固定原始报告和独立开发基线；后续修改的当前状态由文件指纹辅助定位，不能以旧快照证明全部新实现。正式验收应把对应源码身份和新增日志收入持久证据包。全年时间、费用、业务质量和容量结论仍未知。
