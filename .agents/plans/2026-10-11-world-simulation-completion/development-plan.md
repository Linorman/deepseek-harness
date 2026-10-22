# 世界模拟完整 MVP 开发计划

本计划把[剩余设计](design.md)落实为可独立评审和验证的工作包，目标是补齐原 HTML MVP，不能用现有招聘 checklist 的 73/75 替代。基线、能力矩阵和本轮抽查见[评估](assessment.md)，任务验收见[checklist](checklist.md)。计划日期为 2026-10-11；C0–C7 是本轮编号，与原文 M0–M6 和旧计划 W0–W6 分开。

## 1 执行顺序

依赖主线是 C0 → C1 → C2/C3/C4 → C7。C3 的人事原子机制可在 C1 后与治理并行，但其制度批准集成等待 C2；C4 的外部规则/裁决可在 C1 后实现，独立代表准备依赖 C3 的共用身份机制。C5 在 C1 后开发，最终配置接线依赖 C2–C4。C6 每个领域随协议同步扩展 SDK/API，完整产品验收等待 C2–C5。

| 里程碑 | 工作包 | 可观察交付 | 禁止提前宣称 |
|---|---|---|---|
| A 基础可扩展 | C0、C1 | 原招聘无回归；普通目标可发新事项；测试领域无需改 driver | 三领域 MVP 已完成 |
| B 领域闭环 | C2、C3、C4 | 制度生效、已有候选人录用、调岗离职、三类模拟外部交互 | 原型 fixture 等于完整产品 |
| C 作者和观察体验 | C5、C6 | 文件/表单创建三个场景，所有领域可检查、干预和恢复 | UI 列出状态等于后台可执行 |
| D 完整验收 | C7 | 关键故障、双后端/SDK/浏览器、真实模型及采购回归达标 | 缺真实样本或未知责任仍算完成 |

每包交付实现、严格输入、拒绝路径、keyless 场景、协议消费者、当前文档和必要 ADR 修订；测试不能留到 C7 集中补。按依赖拆 PR，真正互相依赖的 PR 使用仓库的原生 stack 流程；本次文档交付不创建、提交或推送这些 PR。

## 2 C0 固定基线和范围

**责任：集成维护者。规模：小；风险：现有工作区未提交，不能把 HEAD 当实现版本。**

输入是现有招聘提案、原 HTML 和当前源码。确认现有修改的归属、固定可复现的集成 revision、记录 source/分发/浏览器证据。保留旧 75 项及勾选状态，新验收只在新 checklist 维护。核对现有合同：Native stream 60、`clocky.world/v0`、`world/1` checkpoint、七个 World RPC、一个 canonical Team；确立新格式拒旧策略。

落实真实模型试验所需的 provider/model 路由和每 run 硬预算，但不让这个配置前提阻止 C1–C6 的 keyless 工作。不得在仓库正文或日志写凭证；不可用路由记为待配置，不能借脚本模型勾选真实试验。

退出：集成基线可复现、已有关键测试可运行、原 scope 不被静默缩减；评估引用的文件变化时更新 hash 和结论。现有大范围 build/lint/SDK 证据可在输入未变时复用，变更触达后仅重跑对应部分。

## 3 C1 领域协议和自主请求基础

**责任：Simulation 协议和 Native 所有者。规模：大；风险最高，先证明跨层路径再扩展领域。依赖：C0。**

代码落点为 [world schema/types](../../../packages/simulation/simulation/src/world.ts)、[Native world fold](../../../packages/simulation/simulation-local/src/world.ts)、[business acceptance](../../../packages/simulation/simulation-local/src/business.ts)、[journal](../../../packages/simulation/simulation-local/src/journal.ts)、[context](../../../packages/simulation/simulation/src/context.ts)、[world driver](../../../packages/simulation/simulation-world/src/driver.ts)、[tool schema](../../../packages/simulation/tool-simulation/src/schema.ts)及模型接入。

1. C1a 固定 domain/operation/version envelope、WorldIntent、typed read-set、结果、审计来源和错误分类；明确严格 schema 注册与浏览器类型入口。实现版本 pinning 和 lease/disposer，未知必需版本拒绝恢复。
2. C1b 让普通目标决策在已记录操作权限内申请新事项，Native 派生身份、保留业务 key、规范化 request + post，并完成真实消费校验。保持一个逻辑世界请求及展开后额度计算。
3. C1c 提取领域执行分派，将现有 generate-and-hire 移入组织 handler；driver 只驱动计划/事件/维护。保留原 plan/Persona、取消与恢复语义。
4. C1d 实现版本化 WorldFact/Norm 基础、有效/可知时间和有界投影；新增每 actor/周期请求、mutation、字节和实施 lease 计费。将状态和未知原因同步两端协议。
5. C1e 接入会议室预约测试领域，走真实 Agent、Channel、Native 接受与回放；不能在 driver 增加该业务分支。

退出：不预建 HireIntent 的目标能产生合法世界请求；普通 actor 无法假冒 director；旧 epoch/未消费输入/坏 evidence 被拒；无关 revision 不误判 stale；卸载与恢复不换实现；原招聘场景保持通过。此包修改持久格式时同步所有 parser/replay/checkpoint 及 SDK，不能先产出别的消费者读不懂的日志。

## 4 C2 治理和制度

**责任：治理模块、Native 和模型上下文所有者。规模：大；依赖：C1。**

在 `simulation-world` 增加 governance 模块，在 `simulation` 增加严格定义，在 `simulation-local` 加拥有对应事件的 fold 与不变量。复用现有 [Relation](../../../packages/simulation/simulation/src/entity-types.ts)、[knowledge](../../../packages/simulation/simulation/src/knowledge.ts) 和 scheduler；不修改 Team task review 为多人审批。

1. C2a 提案、冻结 electorate、正文 hash、阈值/quorum/deadline，真实 Decision 派生独立投票；拒绝重复、冒名、迟到、旧版本和变更正文。
2. C2b 确定性 close，记录 immutable resolution 和派生 wake，定义同模拟时刻 deadline 的固定规则；close 不能受 director 自由文本操纵。
3. C2c enact/revoke 的 world 请求、NormVersion、区间和公告责任原子提交；context-view 引用准确事实版本。
4. C2d 第一项 validated 招聘审批规则，reserve/commit 两次核验；未安装执行器只能 advisory，不能伪装强制规则。
5. C2e 两后端 vote/close/enact kill/reopen 矩阵、旧正文/缺批准拒绝与隐私测试，治理查询 DTO/SDK 同包交付。

退出：CEO 的“大家已批准”消息不起作用，委员实际投票才生成通过凭据；同 resolution 不能批准不同正文；明天生效的制度不提前约束，公告与生效分开，重复恢复不重复投票/生效。可从决策追到票、resolution、Norm 和通知。

## 5 C3 人员和任职完整生命周期

**责任：组织模块、Native Entity/资源/任务所有者、Team 生命周期所有者。规模：大；依赖：C1，批准集成依赖 C2。**

优先修改 [hire fold](../../../packages/simulation/simulation-local/src/world-hire.ts)、[entities](../../../packages/simulation/simulation-local/src/entities.ts)、[writers](../../../packages/simulation/simulation-local/src/writers.ts)、[participants](../../../packages/simulation/simulation-team/src/participants.ts)、[world cleanup](../../../packages/simulation/simulation-team/src/world-cleanup.ts)、[owner](../../../packages/simulation/simulation-product/src/world-owner.ts)。

1. C3a 提取可复用的稳定身份 reservation/prepare/cleanup；generate-and-hire 回归原行为；hire-existing 复用原 Person/Participant/Session，检查候选人资格、冲突任职及 cognition。
2. C3b 引入岗位/必要资源预留与义务查询，定义可取消责任、不可转移责任及 handoff-required。将 authority generation 放入 Native 准入，不能只隐藏 UI 按钮。
3. C3c 调岗在安全维护内关闭旧 assignment、开新区间、更新授权并原子保存结果/wake；身份与历史记忆不变。
4. C3d 离职先阻止新职责，结清旧 task/operation/outbox/resource/wake 责任，再结束任职。需要退休时取得精确 controller 停止回执，未知仍占容量；重新入职复用身份、新建任职。
5. C3e cancel/commit 竞赛、资源变更和批准 stale、迟到 writer、退休失败及 SIGKILL 恢复；对应产品预览/提交/查询和双 SDK 同步。

退出：任何中断不会形成双任职、重复扣款、早释放 writer 或失踪义务；普通离职不调用不可逆 terminated；既有人物再入职不换 Session。若底层 owner 无法证明安全处置某类义务，返回明确阻塞，不通过新增宽权限绕过。

## 6 C4 外部世界以及 C5 C6 产品接线

### C4 三种模拟外部交互

**责任：外部模块与 Team 准备所有者。规模：大；依赖：C1，代表路径依赖 C3a。**

增加 ExternalIdentity registry/unique key、类型化 AdjudicatedOutcome、representation 与来源字段；纯规则保留实际样本和版本。director 只能提交允许的环境结果；已知库存/合同优先。rep prepare 复用结构 mutation，原子建立 represents、ready、结果和 wake。外部接口的 Native 定义/投影和 SDK 随模块加入，driver 不硬编码供应商。

确定性规则、director 裁决和独立代表分别至少一个 keyless 场景。对同外部 key 并发展开、输入私密 canary、采样/准备/commit 后杀进程、额度拒绝和 notification 丢失分别测试。退出：复用同主体和最多一个有效代表，恢复不重抽样、不继承 director 历史、不重复资产；任何 URL/真实适配器请求在副作用前拒绝。

### C5 完整场景、YAML 和日历

**责任：scenario compiler、产品 preparation、scheduler 所有者。规模：中到大；依赖：C1；最终整合依赖 C2–C4。**

在 [schema/compiler](../../../packages/simulation/simulation-scenario/src/compiler.ts) 增加新版本定义和 domain metadata；复用维护中 YAML parser 并配置拒绝不安全结构，语义校验作用于同一 JSON 模型。原始和解析后容量都限制。支持初始资源、公开事实、私有知识、委员会、稳定外部身份、关系/通道和普通目标事件。

持久日历每次只排下一个有限事件，引用岗位时在触发时冻结接收者。明确预算、horizon 和 no-event 的停止原因。准备新增数据均保留原始意图/回执，故障后零模型、相同身份继续；定义导出不混入运行私有状态。

交付三个可直接导入的定义：公司治理招聘、研究实验室项目/外部评审、小型协会委员/志愿者调岗。运行策略通用，只换定义与安装领域参数；第三场景不能以改名字重复同一招聘脚本充数。退出：JSON/YAML 往返语义一致、所有引用错误有字段诊断、暂停创建不推理、目标可以自主产生世界请求。

### C6 作者界面、领域观察与双 SDK

**责任：产品/Host、Client runtime、UI 与 SDK 所有者。规模：大；可分批跟随 C1–C5。**

在现有 [WorldCreationDialog](../../../packages/client/ui-simulation/src/client/WorldCreationDialog.tsx)、[WorldCases](../../../packages/client/ui-simulation/src/client/WorldCases.tsx)、[Client administration](../../../packages/client/runtime/src/client/simulations/administration.ts)、[Host RPC](../../../packages/host/apiproxy/src/api/rpc-map.ts) 等 owner 上扩展。没有新第二控制面。

C6a 同步版本化 DTO、Host handler、TS/Python parser/replay/SDK；C6b 基础表格与文件源码共享草稿、模板/空白/导入入口和完整预览；C6c 制度/投票来源、任职时线、义务、外部表示查询；C6d preview/submit/query 原命令管理、所有失败/未知/撤权状态；C6e 实际服务器与模型链路浏览器测试、分发产物 SDK 冷恢复和 GUI PR GIF。

退出：用户能从基础表单创建完整暂停世界、明确 start、沿 case 定位来源和阻塞；超时/双击/刷新/多标签保持一个原命令和 owner；只读/导出/查看领域列表不推理；撤权后的迟到响应不重新显示私密正文。全图未加载必须显示覆盖范围。实施 UI 时读取项目设计规则和适用 UI 技能；本次只是后续设计，不据静态源码宣称新 UI 通过视觉 QA。

## 7 C7 综合验收和 MVP 后路线

### 综合验收

**责任：集成/测试维护者及领域 owner。规模：中；依赖：C0–C6。**

以真实产品命令启动原设计完整剧本，脚本模型通过实际 Agent/三工具/Team；先治理再招聘、外部互动、调岗和离职。关键 checkpoint 以子进程屏障杀进程，恢复后逐一核对原 Persona、原身份、原 vote/Norm、原账目与通知责任；最后重新读取完整 Session，验证每次模型输入可重建。

覆盖三个场景 × JSON/SQLite，源码路径和 build 后 plain Node/SDK 产物路径分别验证。故障矩阵按业务边界选择，不要求把无关 UI 主题与每个底层故障做无意义全笛卡尔积；每个危险提交边界必须有两后端证据。原采购、task、Channel proof、checkpoint、招聘全链维持回归。

真实模型试验至少包括公司和非公司场景，覆盖有效治理/招聘/外部请求、缺信息、越权及私密 canary。执行前固定 provider/model version、每 run token/决策/世界 mutation 上限和费用上限；达到任一硬限就停，不因演示失败自动加预算。保存合法可审阅的输入引用、计划、结果、拒绝、用量及人工判定；协议错误与模型质量失败分别归类。仍使用确定性测试判断防重/权限/恢复，不能用少量真实样本成功替代。

分别测冷恢复、votes/事实历史增长、人员 churn 和外部重复访问：记录硬件/版本、输入规模、resident/history/队列、token、延迟及原始样本。实施者先提出目标 workload 和阈值，验收者确认后固定；本设计不虚构现有规模保证。没有可用真实路由时，C7 明确未完成，其他包仍可独立验收。

### 验证命令和证据要求

| 阶段 | 执行方式 | 产物与范围 |
|---|---|---|
| 单包行为 | `pnpm exec vitest run` 加实际 owner 测试路径；新增文件在实现包中提供 | 正例与所有新 parser/权限/版本拒绝路径，记录精确命令 |
| 世界闭环 | `CLOCKY_SNAPSHOT=replay pnpm run test:snapshot` 加对应真实场景文件 | 不 refresh 或 record 来掩盖断言失败；新增世界场景需可 keyless |
| 分发 | `pnpm run build` 后选择 `CLOCKY_EXAMPLE_MODE=lib` 的场景和 SDK 产物测试 | 新注册模块实际存在；Python wheel 安装位置和缓存都在项目内 |
| UI | build 后 `pnpm run test:web:built` 加真实浏览器用例 | 关键操作/状态、权限、窄屏/键盘，GUI PR 附真实模型 GIF |
| 类型/静态/文档 | 按实际 diff 执行 `pnpm run typecheck`、`pnpm run lint`、`pnpm run doc-sync`、`git diff --check` | 相关检查只跑一次；修改输入、失败或新风险才复跑 |
| 真实模型 | 使用实施时明确提供的 bounded world eval 入口，配置来自已授权 profile | 新入口尚未实现，不伪造当前可运行命令；需要真实 route 和预算 |

每个通过项登记 revision/未提交输入 hash、命令、日期、后端、source/lib、测试结果和日志/产物路径。日志必须脱敏；不得只写“有测试”或把静态类型通过当实际恢复通过。按 [dsh-pre-push-checks](../../skills/dsh-pre-push-checks/SKILL.md)选择当前 diff 所需检查；CI 拥有平台矩阵，不无理由运行 Windows Wine。

### MVP 之后的路线

以下不计入本次分母和必需 checklist；只有前一阶段证明其必要性才进入。

| 原阶段 | 主题 | 进入条件与后续交付 |
|---|---|---|
| P1 | 作者体验和领域深度 | 完整 MVP 通过；再加图形编辑、offer/市场、多委员会与 Persona 草稿审阅；两类非公司复杂定义无需改 driver |
| P2 | 长期运行和效率 | 保存真实 churn/历史/消息基线后，针对瓶颈做局部热变更、代表休眠与引用保护归档；不先承诺无限存储 |
| P3 | 模拟质量 | 有人工质量基准和泄漏探针后，增加隔离生成助手、可替换环境模型、多个规划者；仍单一最终提交 |
| P4 | 实验与可移植性 | 有跨 Run/Team/Channel/Session 完整引用清单后，做一致备份、显式迁移、分支身份重映射和对比 |
| P5 | 真实外部与分布式 | 单独立项、明确用户授权、对账设计和测得的单机瓶颈；不是本地 MVP 的前置条件 |

## 8 本轮文档交付验证

本节只记录 2026-10-11 文档与现状抽查，不用于提前勾选 C0–C7 的产品实现项。文档采用仓库文档规范与 prose standard；保持既有源代码、旧 checklist 和历史记录不变，仅在已有双语提案中新增本计划入口。

| 检查 | 结果 | 证据 |
|---|---|---|
| 附件和工作区源码 | 完成 33 项矩阵；附件字节一致副本与关键源 hash 已保存 | [输入清单](evidence/source-manifest.json) |
| focused 实现抽查 | 5 files / 162 tests passed | [日志](evidence/focused-tests.log) |
| driver keyless/冷恢复 | 1 file / 8 tests passed | [日志](evidence/world-driver.log) |
| 双语提案 pairing | 1 组记录更新；全仓 pairing 门禁通过 | [日志](evidence/pairing.log)，仅新增关联段落 |
| `pnpm run doc-sync` | 29 passed，0 failed，0 skipped | [日志](evidence/doc-sync.log) |
| 新文档本地链接、编号、算术、换行及 `git diff --check` | 4 篇文档、33 项矩阵、112 项 checklist 校验通过；无空白错误 | [检查报告](evidence/document-check.json)与[diff 检查](evidence/diff-check.log)；新目录另作补充验证 |
