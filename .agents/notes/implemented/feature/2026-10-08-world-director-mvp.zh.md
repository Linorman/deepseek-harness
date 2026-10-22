# Agent Note: 持久世界模拟 MVP

Status: implemented

[English](2026-10-08-world-director-mvp.md) | 中文

## Problem

用户需要编写组织，让独立角色请求变化，并在重启后保留人物、决策和未完成责任。仅修改提示词、使用静态采购模板或绘制组织图不能证明这些性质。[原增员阶段](../../../plans/2026-10-08-world-director-mvp/development-plan.md)与[完整化设计](../../../plans/2026-10-11-world-simulation-completion/design.md)区分首个纵向交付与已经完成的本地三领域 MVP。

## Decision

World run 保留一个 canonical Team、一个 Native 提交顺序和拥有独立 Session 的 director。组织单位、岗位是非认知实体；角色保持 canonical Person/Participant/Session 身份。公司、实验室和协会定义通过同一领域 driver 使用治理、人事及模拟外部交互。原采购流程继续作为独立组合受支持。

### 编写与所有权

`clocky.world/v1` JSON 与安全 YAML 使用同一个浏览器安全的严格编译器。解析、引用/容量检查及显式默认值解析先于预览。模型路由、模板、领域实现和额度来自已安装白名单；定义不能提供凭据、可执行代码或任意 provider 地址。预检不分配身份、不推理。创建重新检查目录世代和hash，保留原定义与完整resolved部署承诺，并在IO前保留稳定身份。准确重试使用原件；导出的定义用于新建世界，不是运行备份。

`simulation` service定义持久协议；`simulation-local`校验并折叠唯一权威日志；`simulation-scenario`编译定义；`simulation-world`协调领域和效果；`simulation-team`拥有canonical身份及Session准备；`simulation-product`拥有认证命令、授权读取和执行owner。Client与SDK消费严格公开DTO。编排使用公开service与可释放注册，不引入第二个世界数据库或Agent循环。

### 权限、决策与效果

普通角色和director通过已记录的Agent/Session observe、stage、submit决策工作。暂存不授权执行。Native受理检查准确writer epoch、已消费context、当前scope、证据、grant、额度及实现pin。领域lease覆盖已准入回调、未知IO和未完成维护；卸载关闭新准入，不替换尚未对账的实现。认证用户命令有自己的审计来源，不冒充世界内角色。

规划以base revision记录来源，执行在串行提交点检查明确read-set与当前权限。无关进展不自动使计划失效。计划与生成Persona成为不可变受理原件；重试不能重新生成或改变业务身份。通信、交付、context消费、首次行动与业务完成分别记录。可信结果投影发布已提交结构化事实；模型声明不是回执。

治理冻结提案正文、electorate、规则及独立来源票据。Native仅在窗口结算边界关闭符合条件的投票，保持pause优先并原子取消失效deadline工作。提案通过不代表制度生效：enact仍需独立授权请求。advisory文本与validated策略分开。生效、可知、记录和通知时间不同；模拟时间保持准确十进制表示。

### 人事与外部范围

招聘在canonical准备前保留容量；准入计算occupied加reserved。针对尚未结束招聘意图的重复请求保留同一业务身份，真正的新申请重新检查权限和容量。录用已有人员保留原身份并要求当前eligibility。新人和代表仅在原Persona、任职及私有Channel确认后ready。readiness是激活与恢复不可绕过的门槛，不是提示词约定。

调岗与离职保留时态任职和原交接义务。撤权限制后续工作，但不擦除Session或已知历史。退休未确认时继续计入容量并保留清理责任。不能循环使用历史身份绕过额度，也不能仅因超时就释放可能已产生效果的责任。

外部身份使用稳定key。规则响应保留实际输入和计算结果；mediated响应保留其已受理裁决；代表拥有独立有限Persona、Session和按调用方隔离的私有Channel。重复联系复用canonical代表。MVP外部行为全部模拟：不能凭空补造有证据要求的库存或合同，也不能调用真实网络、付款或邮件适配器。

### 调度、隐私与恢复

有界调度记录原触发与决策，保持普通角色公平性，并按已声明时间、请求、模型、token、历史及驻留限制停止。模型和Team IO在Native写队列外执行；纯校验及append拥有原子业务变更。维护在结构变更前关闭准入并排空已接受IO。新的pause/cancel优先于陈旧自动继续；重启恢复为paused，重新推理必须显式新start。

读取授权、操作权限、模型输入选择及产品披露相互独立。director仅获得case范围证据，不读取所有角色历史；低权限角色不继承其Session。准确模型输入与所选来源可以从持久context/Session记录重建。列表提供有界metadata；正文、Persona、票据、context和Session内容各自授权。读取、刷新、导出和导航均不获取可写owner或继续推理。

Native stream 97、manifest 7与compiler 9拒绝不支持的原artifact；通用SQLite和Session格式版本未改变。checkpoint保留领域pin、原结果、身份绑定及待通知/清理责任。跨日志准备使用意图与回执，不声称存在全局事务。缺失或改变canonical证据时拒绝可写恢复。恢复重放已受理原件，不调用模型、随机生成或真实外部效果。

### 产品契约

工作台以同一草稿连接表格与JSON/YAML源码，保留表单不支持字段、定位诊断，并仅在显式确认后创建暂停run。World导航提供概览、事项、组织、制度及外部视图；engine检查独立保留。用户管理依次经过预览、原命令提交和保留回执。未知结果通过原command身份查询或显式重试。主题、键盘、焦点、窄屏和减少动效遵循[DESIGN.md](../../../../DESIGN.md)与[UX-CONTRACT.md](../../../../UX-CONTRACT.md)。

[默认 Web 组合](../../../../packages/bundle/web-app/README.zh.md)直接安装世界目录及三个可移植起始模板，无需自定义 overlay。独立角色预设只提供仿真工具。管理服务在预检时解析保存的默认模型，并在受理时重新核对，然后为重试和冷恢复保留具体原路由。共享编译器及执行 owner 不依赖这些 Web 默认配置。

## Verification

[112项完成清单](../../../plans/2026-10-11-world-simulation-completion/checklist.md)拥有验收及原证据链接。[当前UI验收](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/ui-current-acceptance-proof-20261016.md)验证真实Web/Loader/Agent流程和当前交互输入。此前故障、SDK、历史和规模证据只在其owner输入仍适用时复用。[真实模型报告](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/live-model-expanded-proof-20261016.md)保留全部失败及公司/实验室有界样本，不证明通用模型可靠性或完整自治真实模型剧本。[超时调查](../../../plans/2026-10-11-world-simulation-completion/evidence/implementation/timeout-root-cause-proof-20261016.md)区分已观察资源争用、已修复轮询及未记录逐操作证据的历史环境。

## Alternatives considered

**只交付增员。** 身份、维护和跨日志恢复是主要风险，因此它适合作为首个纵向证明，但不满足扩展验收范围。完整MVP中的治理、离职和外部交互各有独立契约及证据。

**只修改策略文本或给采购driver加分支。** 文本不能证明持久身份与权限；采购特化分支不能证明场景通用性。纯编译器与共享领域driver显式拥有这些责任。

**让模型修改世界状态或维护另一套世界数据库。** 模型声明不能提供授权、去重或崩溃一致性。Native原子事实和跨owner意图/回执继续拥有权威。

**要求全局revision不变，或把pause当作ready。** 这些简化会拒绝无关进展或放行未准备好的身份。明确read-set、当前权限与canonical readiness对应真实不变量。

**从多Team、热替换实现或不受限领域代码起步。** 这些方案引入尚未解决的所有权及恢复语义。已安装版本化领域可以通过维护中的能力边界扩展，但不承诺可热替换的持久ABI。

## Consequences

维护可能暂停整个本地世界，在所有权未知的故障后保留容量。持久历史和保守拒绝有存储及运维成本。定义导出不能替代checkpoint恢复；预发布格式拒绝不承诺迁移。小规模真实模型样本、实测工作负载和通过的故障用例只支持已记录范围，不证明无限规模或自治正确性。

## Deferred and related ownership

[Post-MVP路线](../../../plans/2026-10-16-world-post-mvp/design.md)继续拥有图形编写、更深组织流程、受保护归档、便携备份和迁移、隔离实验、多规划者及可选真实外部适配器/联邦。[更广评测设计](../../../plans/2026-10-16-world-mvp-finalization/design.md)提出更完整的真实模型剧本和可复用费用账本工具；有界验收运行器不宣称实现每项扩展。

[持久模拟协同](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)仍因更广分布式范围保持proposed。[视觉层提案](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.zh.md)保留自己的交付边界。已实施checkpoint、canonical恢复、治理、授权与轮询说明继续拥有各自机制，没有任何说明被此功能概述完整取代。

### 有界模型协议

已保存定义中的可选 `bounded-v1` 固定模型可见行为：初始制度通知使用确定性空决策，不声称模型理解；观察默认引用已准备上下文；招聘明确要求 `expectedTime: null` 与空 evidence。未带该标记的日志仍按原展示重放。完整请求预检与 BasicCompaction 共用 TokenMeter，保留原始事件及权威上下文，无法容纳的必要内容在计费调用前拒绝。超额确认使用原始暂停管理请求，实际用量、确认和必要区间补充均可审计，且不会开始调度。验证覆盖日志量级用量、JSON/SQLite 冷重放、真实工具链的请求拒绝，以及无密钥默认 Web 场景。

### 压缩、终止与原始通知

消费凭据保持原始上下文与唯一输入的顺序。重复展示必须通过压缩开始、摘要、替换来源及结束事件证明原展示被合法压缩；仅追加相同正文不能制造消费凭据。规范消费失败与超时以明确的 Native 停止原因取消决策、归还唤醒并关闭已结算窗口，阻断模型继续计费重试。旧超时记录不带新停止标志，历史重放不迁移。按章节观察减少重复正文；结果通知引用由所有者解析冻结动作，仍受原始结果、消费与授权校验。回归覆盖压缩后提交、伪造恢复与重复输入拒绝、内部错误后零追加模型调用、JSON/SQLite 超时冷重放及真实工具链的通知引用。

### 普通通信的身份与接纳

普通消息只从已确认投递的操作派生回复映射，并记录到 required 输入章节；不根据姓名猜测或隐式转换 Participant ID。暂存与最终接纳共用同一收件人及时间校验。已排队消息的类型化拒绝保留提案哈希和次数，归还原唤醒并关闭已结算窗口，按原 maxConflictRetries 有界重试；新上下文说明未产生副作用，持续失败以明确通信停止原因终止。存储异常保持独立且不能被吞成业务拒绝。回归覆盖同轮错误 ID 纠正、最终拒绝后仅接纳一次、重试耗尽、伪造拒绝记录、存储失败及 JSON/SQLite 冷重放；独立 Web 用例从真实回复映射故意使用 Participant ID，再由模型纠正。
