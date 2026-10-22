# 世界模拟 MVP 之后的详细验收 checklist

本清单对应[Post-MVP 设计](design.md)和[14 个开发工作包](development-plan.md)。它只包含新增后续能力，不替代原 MVP checklist，也不把 MVP 收尾重新计入进度。F0 与 A1–A3 已按原 24 项验收完成；三场景长期原始基准、冷恢复与输入一致性证据已收齐。B01–B19、C01–C14 已验收；2026-10-20 用户确认继续暂缓人工评分，C15/C16 保留未勾选和明确缺口。D01–D17 已完成联合验收；用户确认 E 先完成本地测试实现，E02–E06、E09–E14 已验证，E01/E07/E08/E15 保留真实接入与生产资格缺口，见 [D/E 验收](evidence/implementation/de-final-validation.md)。H01–H07 已完成横向验收，原 98 项中 92 项勾选；C15/C16 由用户于本次再次确认暂缓人工评分，E01/E07/E08/E15 保留资格缺口，见[最终验收报告](evidence/final-acceptance/report.md)。未新增 checklist 条目；复用的底层能力须在新用例中验证后才能成为该项证据。

每项完成需登记工作包、源码/配置/产物 revision 或 hash、准确命令、日期、后端及 source/lib 模式、结果/原件链接、未解决事项。部分满足保持未勾选。E 组为两个可选立项，未立项标“未启动/不适用”，不能勾成通过，也不阻止 P1–P4 验收。

## F 横向基础 F0

- [x] F01 明确各阶段新增范围和已有基础，原 MVP 及其四个剩余验收项不纳入本清单分母。
- [x] F02 公司、实验室、协会三个非同构场景固定定义/领域版本、输入规模和可观察结果，无主 driver 业务分支。
- [x] F03 每个新增对象明确持久 owner、真实身份/来源、权限、版本、取消/未知及重试语义，投影不可独立写世界。
- [x] F04 长期 workload 固定硬件、后端、运行长度、活跃/驻留/历史量、并发和模型策略，保存原始基准。
- [x] F05 每个工作包有最小纵向交付、依赖和拒绝路径，尚无需要的分布式/计费平台不预先实施。

## A 作者体验与领域深度 P1

- [x] A01 A1 草稿保存具备 revision CAS、父版本和原定义，stale 明确冲突，不静默覆盖他人编辑。
- [x] A02 A1 图、表单、JSON/YAML 共用一份定义，切换和导出往返保留所有支持字段；未知字段明确拒绝或只读。
- [x] A03 A1 图形创建/移动/连线转换为 typed draft commands，经同一 compiler 拒绝坏引用、环和容量错误。
- [x] A04 A1 模板编辑和运行变更清楚区分；运行拖拽仅生成 preview，提交使用原 commandId/payload。
- [x] A05 A1 undo/redo 只撤草稿操作；已提交业务必须用独立补偿命令，不能重写历史。
- [x] A06 A1 有界图标明时点/revision/覆盖窗口，逐层加载和搜索不泄漏不可读对象；列表提供等价键盘操作。
- [x] A07 A1 模板包固定依赖/版本，导入数据不执行附带代码；布局保存不成为业务事实。
- [x] A08 A2 PersonaDraft 保留来源/hash/revision，审核修改使旧批准失效，accepted 出生事实不被后续编辑覆盖。
- [x] A09 A2 有限模板审阅、退回和重新生成有明确状态/预算；只读/预检不推理，审核不扩大内容权限。
- [x] A10 A2 offer 固定候选人、岗位、金额/单位、条款 hash、批准和有效期；counteroffer 新建 revision。
- [x] A11 A2 候选人独立真实决策接受同一条款；delivered 不等于 accepted，冒名/旧版/过期接受拒绝。
- [x] A12 A2 接受/撤回/截止及两个不兼容 offer 竞争至多一次录用，岗位和资源约束不被新 ID 绕过。
- [x] A13 A2 身份准备未知及已接受义务保留预留，取消/到期不盲目释放；恢复不换 Persona/Session 或重复收费。
- [x] A14 A2 循环薪酬若交付则有有限周期、资金来源和独立承诺结算，未交付时明确不能由一次费用推导。
- [x] A15 A3 例外/班次/recurrence 编译成规范模拟时间，时区版本和歧义固定，horizon/发生次数有界且重启不重复。
- [x] A16 A3 改排班只改变未接受的未来 occurrence；岗位收件人按触发时冻结，旧 wake/任务不随调岗重定向。
- [x] A17 A3 组合委员会固定 ReviewRoute/hash、步骤、AND/OR、electorate 与期限，缺步骤/循环/混用旧正文批准拒绝。
- [x] A18 A3 代理授权显式持久，超范围/撤销/到期代理拒绝；成员变化使用创建时固定策略。
- [x] A19 A3 制度影响预览列出真实已有义务，冲突由已安装规则解决或明确阻塞；因果链可追到实际票据/生效/通知。

## B 长期运行与效率 P2

- [x] B01 B1 测量 churn、治理历史、重复外部交互、混合消息/mutation、查询及冷恢复，原始样本和目标阈值先冻结。
- [x] B02 B1 区分当前活跃、resident、未释放 writer 和历史身份，报告 p50/p95/p99/内存/暂停比例及 token/cost。
- [x] B03 B1 索引有 schema/version、源 prefix hash/cursor，重建后校验并原子发布；中断保留旧可用索引。
- [x] B04 B1 删除派生索引后可从权威日志重建，索引不能改变业务结果或授权来源。
- [x] B05 B1 分页绑定同 revision/reader generation，不重复遗漏；索引落后回退有界或显示 index-building。
- [x] B06 B1 搜索建议、数量和缓存同样受权限控制，撤权使旧 cursor/迟到结果失效。
- [x] B07 B2 pins 覆盖 checkpoint、case/plan/批准、context、outbox/cleanup、备份与分支，跨 owner 引用闭包完整。
- [x] B08 B2 归档 dry-run 显示影响，copy/verify/switch 可恢复；物理删除不在首次归档中自动发生。
- [x] B09 B2 被引用记录可从 archive owner 按原身份/hash 读回，缺片段/坏 hash 明确失败而非空历史。
- [x] B10 B2 复制/切换前后/索引重建/恢复故障不会丢 pin、重复删除或丢失未完成责任。
- [x] B11 B2 归档不偷偷重置历史 Participant/Activation 容量；释放容量若新增必须有独立契约/版本和拒绝测试。
- [x] B12 B3 自动休眠只在任务/通道/IO 责任允许时发生，原 Person/Session 保持，未知退休继续 charged。
- [x] B13 B3 表示切换独立于休眠，冻结 generation、事实/记忆映射、义务和真实切换结果，不改 cognition 或重铸资产。
- [x] B14 B3 无法证明摘要足够时禁止降级，只允许保留原 Session 的休眠；切换中断恢复原责任。
- [x] B15 B3 局部 mutation footprint 覆盖实体/关系/资源/通道/权限和 epoch，被影响对象关闭新准入，无关角色可继续。
- [x] B16 B3 多 owner gate 按稳定顺序获取；取消、冲突、超时和卸载无死锁，提交前重验 read-set/权限/预算。
- [x] B17 B3 全球制度、未知 footprint 或不支持的 provider 回退全 run 维护，原因可见；不单改 maxPendingMutations 上限冒充热变更。
- [x] B18 B3 两后端覆盖热变更与旧窗口/任务/撤权/退休/checkpoint 的竞赛和进程退出，最终仍单 Native 提交顺序。
- [x] B19 B1–B3 在固定 workload 下达到预登记改善目标，未通过删历史/放宽额度/漏计辅助调用制造性能提升。

## C 认知与模拟质量 P3

- [x] C01 C1 GenerationJob 固定目的、输入实际内容/来源、输出 schema、目标 audience、预算和模型/策略版本。
- [x] C02 C1 助手使用独立 canonical Entity/Participant/Session，不共享全知 director 历史；跨 scope 复用明确拒绝。
- [x] C03 C1 输出先持久化再 validate/incorporate，accepted 后中断不重新生成，未知输出保留责任。
- [x] C04 C1 生成助手无 world 写权，不能自授读写或真实适配器能力；全部调用计入共享额度。
- [x] C05 C1 新模型输入可从 Session 重建，重新生成显式计费；读取/审核/预检不隐式推理。
- [x] C06 C1 canary、scope 切换、撤权和迟到输出测试证明低权限文本未读高权限材料；人工审核不代替输入隔离。
- [x] C07 C2 PlannerAssignment 严格限制 domain/scope/effects、期限、最大尝试、深度和子任务数。
- [x] C08 C2 两规划者可并行产出不可变计划，但由单提交者重验 read-set；冲突保留 stale/supersedes，不 last-write-wins。
- [x] C09 C2 子任务与辅助调用归入父 run/实验预算，父取消关闭新准入但不丢已接受效果。
- [x] C10 C2 公平队列无无限抢占或自对话，卸载/超时/恢复保留已接受 lease 和责任，收益有测量依据。
- [x] C11 C3 至少一种环境模型声明状态、输入/effect schema、步长、随机性和 source/sink 上限，通过 domain 接入无需改 driver。
- [x] C12 C3 采样保存实际结果和实现版本，重放不重抽；切换模型保留合同/库存，无法映射就开新实验。
- [x] C13 C3 人物演化保留原值/新值、经历来源和有效期，不改出生 Persona，不因技能变化授岗位/工具权限。
- [x] C14 C3 关系感受/信念与世界事实分开，字段和周期变化量有界；旧 context 不回填新状态。
- [ ] C15 C3 固定/留出场景、对照配置和 rubric 在执行前登记，报告质量、隐私、事实一致性、成本和全部失败。
- [ ] C16 C3 judge 与人工评价来源分开，模型版本/非确定性明确，不用单次故事或 seed 宣称普遍质量改善。

## D 实验与可移植性 P4

- [x] D01 D1 BackupManifest 包含全部 Native/Team/Channel/Session cut、附件、领域版本、hash 和跨 owner 引用。
- [x] D02 D1 导出关闭新准入并获得一致保护读视图，未完成 IO 明确保留；复制 live 数据文件不被当一致备份。
- [x] D03 D1 copy/verify 完成后才发布 bundle，中断保留原件且精确重试，不覆盖唯一成功备份。
- [x] D04 D1 凭证、token 与主机路径不成为便携执行配置；私密日志权限和加密策略明确，密钥不随包导出。
- [x] D05 D1 脱敏数据集与完整可写恢复备份分开，删去必要证据后不得宣称等价恢复。
- [x] D06 D1 目标空存储/不同目录或主机 staging 校验所有 hash/版本/引用/冲突后原子登记 paused，未显式 start 不推理。
- [x] D07 D1 缺 reducer/provider、坏片段/附件/通道、未物化 Session 误判和导入中断都有拒绝或精确恢复证据。
- [x] D08 D1 离线 MigrationPlan 固定 source/target/转换器/输入 hash，转换新副本且原包不变。
- [x] D09 D1 无法恢复审批、Persona、sender/receipt 等证据的迁移拒绝，未知必需事件不跳过，每个支持版本对有测试。
- [x] D10 D2 分支从可验证 quiescent cut 初始化，记录父来源/差异/预算/版本和记忆继承策略。
- [x] D11 D2 所有可写 run/Team/Participant/Session/Channel/epoch/operation namespace 全新；lineageKey 仅用于比较。
- [x] D12 D2 原历史作为不可变 provenance，不能换 ID 后继续信任旧 proof；继承模型输入由新 Session 明确记录。
- [x] D13 D2 分支和父 run 无法向彼此可写身份/通道执行；未决真实外部效果拒绝分支或只读，真实 adapter 默认禁用。
- [x] D14 D2 对比绑定同起点、差异变量和 lineageKey，区分事实/质量/成本/停止差异，不把相关性当因果。
- [x] D15 D2 CausalIndex 只用真实事件引用建边，缺来源显示 unknown；读取深度/字节/权限有界且可重建。
- [x] D16 D2 不支持的自动分支合并明确拒绝，不能直接拼日志或静默套父运行当前状态。
- [x] D17 D1/D2 新主机恢复、版本转换、分支身份隔离、私密记忆/坏引用与进程故障矩阵通过，原运行无副作用。

## E 真实外部与分布式 P5 可选

- [ ] E01 E1 明确业务动作、真实用户授权责任和适配器能力后独立立项，不从模拟 CEO/委员会批准推导现实权限。
- [x] E02 E1 AdapterGrant 固定动作/目标/额度/有效期/环境，凭证只在 Host，模型/导出拿不到 secret。
- [x] E03 E1 intent、原幂等键与授权快照在 IO 前持久，receipt 验证实际目标和结果，同原件重试不重复现实效果。
- [x] E04 E1 timeout/断流/撤权后的未知结果保留占用并对账，无幂等/查询能力时禁止自动重发。
- [x] E05 E1 取消仅在真实支持阶段有效，补偿另有明确授权/记录，不承诺任意现实效果可回滚。
- [x] E06 E1 replay、branch、backup/import 和只读检查默认不能调用真实 effects，simulated/real 来源明确。
- [ ] E07 E1 mock/fault 与 provider 测试环境先证明重复/丢 receipt/限额/撤权/恢复，再独立开启正式环境。
- [ ] E08 E2 有单机测量或独立隔离需求证明立项必要，未启动不会阻止本地 P1–P4 完成。
- [x] E09 E2 每个对象唯一 home partition/ownership generation，旧 owner fenced，网络分区不能形成双 writer。
- [x] E10 E2 跨 run 消息有业务 ID、源序号、因果前置、版本和授权，durable inbox/outbox 去重并保存 receipt。
- [x] E11 E2 重复/乱序/丢包/目标已提交回执丢失的恢复不重复业务，不凭 retry 次数推断成功。
- [x] E12 E2 跨区资源有预留/确认/settlement，unknown 不能双边自由支配；不将两个 append 宣称原子事务。
- [x] E13 E2 模拟时间保守推进，缺因果前置/分区落后明确阻塞；永久不可达和晚到事件有正式策略。
- [x] E14 E2 分布式 checkpoint 包含各区一致 cut 和在途责任，新 owner 接管/迁移/恢复校验版本和引用。
- [ ] E15 E1/E2 真实权限和跨区安全/一致性经过独立审查，条件不足保持未交付，不靠增加 Team 数或进程数宣称完成。

## H 每包共同交付

- [x] H01 新 public/persisted/tool 输入有严格 parser，所有拒绝、旧版本和 malformed 边界有测试。
- [x] H02 状态、幂等、取消、unknown、原子事实/派生责任和跨 owner receipts 有真实恢复证据。
- [x] H03 Host、Client runtime、TS/Python SDK 与分发产物同步，未知必需事件明确拒绝。
- [x] H04 长操作保留原 commandId/payload，timeout/刷新/多标签不重复业务，查询/预览/导出不意外推理。
- [x] H05 UI 具备空/错/加载/陈旧/撤权/未知状态，键盘和等价列表、窄屏/主题/减少动效实测，GUI PR 有真实流 GIF。
- [x] H06 每包随实现更新 owner README/子系统/双语 Agent Note 和必要 runnable snapshot，按实际 diff 跑相关测试及门禁。
- [x] H07 阶段完成按适用 checklist 与原始证据判定，P5 未立项不算失败也不算通过，不通过调整分母或删除难项制造完成率。

## 验收登记

| Checklist ID | 工作包 | revision 或输入 hash | 命令/后端/source-lib | 结果与原件链接 | 未解决事项 | 验收日期 |
|---|---|---|---|---|---|---|
| H06、H07 | 文档、产物与阶段完成登记 | [最终验收及 98 项原条目完整性](evidence/final-acceptance/validation.json)、[交付证据映射](evidence/final-acceptance/delivery.json) | 当前 Host 类型检查、单文件 lint、doc-sync 29/29、源码旁产物 0 违规；最终 Markdown/whitespace 和 hash 核验见总报告 | [交付审计](evidence/final-acceptance/delivery.md)：六 owner README、子系统、双语 Agent Note 和 runnable/fault 证据接续；37 份性能原件及最新 C3 24 试验/5376 样本验证一致；H01–H07 通过 | 92/98，原条目文字/顺序/分母保持；C15/C16 用户继续暂缓，E 四项资格缺口保留；P3 不宣称完整质量验收，P5 不宣称生产交付，原 MVP 验收独立 | 2026-10-20 |
| H05 | 当前 UI 联合验收 | [当前源码/构建/截图/GIF hash](evidence/final-acceptance/ui.json) | source Host + built Client、认证 HTTP/WebSocket；JSON/SQLite；author 2 项与 governance 2 项通过，状态/组件 47 项通过；Host 聚合类型检查通过 | [界面验收](evidence/final-acceptance/ui.md)：真实 Space/Enter/Tab、焦点、等价列表、1440/390 × 明暗、reduce 的实际样式和零横向溢出；当前六帧本地 GIF 已解码检查；首次错误焦点断言失败原件保留 | 实际创作/人工审阅流程零模型调用；GIF 不代表真实模型推理或 provider 资格；未创建 GUI PR 或发布远端 | 2026-10-20 |
| H01–H04 | 横向契约验收 | [最终契约核验](evidence/final-acceptance/contracts.json)；D/E 最终验收与后续审查合并 1613 个当前源码 hash 全匹配 | JSON/SQLite、source、真实 Loader/HTTP、TS/Python 与 plain Node built；复用输入未变化的 2242 项契约和 1003 项 Python 验证，准确命令见原 manifest | [契约报告](evidence/final-acceptance/contracts.md)：严格输入/拒旧、持久恢复/原回执、两 SDK 和原命令并发/刷新/断线责任通过；后续构建更新 Team 产物 hash | 仅现有已交付范围；C15/C16 人工评分与 E01/E07/E08/E15 资格缺口保留；不宣称新增真实 provider 或跨主机资格 | 2026-10-20 |
| D10–D13、D17；E09–E14 | D/E 独立审查修复 | [修复后源码与验证 hash](evidence/de-review/hashes.json) | JSON/SQLite、原失败复现、同进程与冷恢复、真实 Loader 和 built 快照 | [5 项发现及修复](evidence/de-review/review.md)：身份碰撞、Session 惰性预留重试、时间边界对象隔离、来源承诺拒绝及原消费回执；原验收范围保持 | E01/E07/E08/E15 仍未交付；已有 Session 重试需枚举持久 header；不扩大为真实 provider/跨主机资格 | 2026-10-20 |
| D01–D17 | D1/D2 联合验收 | [当前源码、产物 hash 与完整命令](evidence/implementation/de-final-validation.json) | JSON/SQLite；Source、真实 Loader、空存储迁移/SIGKILL 矩阵与 plain Node built 快照；具体分项见 [验收报告](evidence/implementation/de-final-validation.md) | Simulation 2744、Product 1154、Host/Client/TS 契约 2242、Python 1003 项通过；built 三快照 6/6；build/typecheck/lint、NodeNext 278、compiled invariant 269 与 doc-sync 29 门禁通过；首次失败及聚焦复验原件保留 | 受支持的 initial/settled seed；不支持的 owner 状态/媒体/自动 merge 明确拒绝；2 个 opt-in benchmark 与 1 个需显式外部历史样本的既有测试跳过，未计为通过 | 2026-10-20 |
| E02–E06、E09–E14 | E1/E2 本地测试实现 | [当前输入与原始日志](evidence/implementation/de-final-validation.json) | 两后端本地 durable sink、双 run mailbox/ownership/checkpoint、真实 Loader 冷进程与故障对账；无真实 provider 调用 | 效果原件/撤权/到期/额度/补偿、消息去重/私密游标/旧 owner、保守时钟及完整联邦引用通过；[独立本地协议复验](evidence/d1/independent-protocol-review.md) 的两个问题已修复 | 用户确认仅本地测试；E01/E07/E08/E15 保持未勾选，不宣称真实授权设计、provider 资格、部署收益或生产安全审查完成 | 2026-10-20 |
| D10–D13；D14–D16 续验 | D2 | [当前源码 hash 与明确范围](evidence/implementation/d2-completion.json) | source + 真实 Loader；JSON/SQLite；准确四文件命令见证据，19/19 通过；built 双进程快照 2/2 通过 | [完整日志](evidence/implementation/d2-final-tests.log)：离线空存储/父推进后的原 cut 分支、time5 动态事实、新 namespace/Session 实际输入、源运行保持、公私记忆和真实媒体拒绝、内部事件隔离、Entity 引用与纯文本/其他 ID 域隔离、内部 v1 拒绝/v2 运行、provenance 完整闭包/坏引用、真实新 compiler/driver start-idle；Product/Host/SDK 证据由其 owner 登记 | 仅受支持的 initial/settled seed；未完成义务及缺 seed owner 状态拒绝；Token 为周期预算，实际 budget 纳入比较；最终 built 双进程快照已通过；D17 联合矩阵由总验收登记 | 2026-10-20 |
| D14–D16 | D2 有限比较/因果查询/合并拒绝 | [源码 hash 与范围](evidence/implementation/d2-initial-query.json) | `TMPDIR="$PWD/.tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/experiments.spec.ts`；真实 Loader、source、JSON + SQLite；2/2 通过 | 同父 cut 和 lineage 比较、事实/质量/成本/停止分类，质量/成本缺证明确 unknown；仅 Native 原记录引用构边，伪 snapshot 无影响；权限、深度/节点/完整字节限制与重建通过；自动 merge 明确拒绝 | 动态历史分支与进程故障另由 D10–D13/D17 验收；本记录不宣称质量改善 | 2026-10-20 |
| B07–B11、C07–C10、C15/C16 自动部分 | B/C 检查修复 | [修复与验证](evidence/review-2026-10-20/review.md) | JSON/SQLite 归档拒绝回归、Native/模型池共同预算检查、真实评估 CLI | 完整 header/图片元数据不匹配拒绝；根任务自身子树超支拒绝；评估元数据时间与额外报告字段拒绝 | 人工评分继续暂缓；C15/C16 保持未勾选；旧 hash 证据只代表修复前版本 | 2026-10-20 |
| B01–B19、C01–C14 | B/C 续验 | [当前 hash、准确命令与日志](evidence/implementation/bc-continuation-2026-10-20.json) | JSON + SQLite；source owner/Host/TS/Python API、真实 Loader 和独立 keyless subprocess；沿用 hash 匹配的冻结性能批次 | [当前验收记录](evidence/implementation/bc-continuation-2026-10-20.md)：134 个既有源码/证据 hash 与 37 份性能原件匹配；测量测试改用固定历史样本，生产验证器仍拒绝未知漂移 | 维持原有限实现范围；不宣称冷索引、全体热变更或真实模型吞吐改善 | 2026-10-20 |
| C15、C16（部分完成，未勾选） | C3 | [预登记](evidence/implementation/c3-v2-registration.json)、[固定/留出配置及 rubric](evidence/implementation/c3-v2-suite.json) | source 纯确定性资源评估；24 试验、5376 实际样本；`register` → `run` → `verify`，命令见 [C3 证据](evidence/implementation/c3.md#registered-resource-comparison-2026-10-20) | [全部轨迹、失败/停止、成本和评价来源](evidence/implementation/c3-v2-results.json)；0 自动约束失败，来源/防覆盖/篡改拒绝有真实 CLI 回归 | 用户明确继续暂缓人工评分；人类可信度、因果合理性、角色差异及一般认知质量仍无评分，模型 judge 未执行；不把 parser 隐私探针当完整 Session 泄漏证明 | 2026-10-20 |
| B01、B02、B19 | B1–B3 | [冻结性能证据](evidence/b1/implementation.json)、[原始样本完整性](evidence/b1/v2-integrity.json) | 三场景 × JSON/SQLite，各 32 轮，严格串行；12/12 进程、192 轮、6 次冷恢复零推理；测量期源漂移为零 | 索引 warm/old 为 0.556/0.650、局部 rename/full 为 0.050/0.065，均达原目标；身份、writer、分类 token/unknown、p50/p95/p99、峰值内存、维护比例均保留 | 冷索引查询为旧实现 1.705/1.767 倍；generated-hire 维护仍占 18.41–28.75%，不宣称总体长期加速或任意人员热变更；人工评价继续暂缓 | 2026-10-19 |
| B12 | B3a | [源码 hash、命令及范围](evidence/implementation/b3a-residency.json) | source，JSON + SQLite；6 项 owner 测试及 2 项真实 Loader snapshot | 闲置阈值、pending wake、原 Session 恢复、未知退休继续 charged 且不重复退休通过 | 按需有界策略；表示切换和局部 mutation 独立验收；全局门禁已通过 | 2026-10-19 |
| C01–C10 | C1/C2 | [源码及命令证据](evidence/implementation/c1-c2.md) | journal 100；JSON + SQLite；Native/Team 33 项、真实 Host→A2 2 项、冷进程快照 2 项 | 独立输入/身份、持久输出、预算/撤权/晚响应、双领域规划与单提交、恢复不重复推理均通过 | 使用 keyless provider；并发收益为固定延迟对照，不声称真实模型质量提升 | 2026-10-19 |
| C11–C14 | C3 | [源码及产物 hash](evidence/implementation/c3-hashes.json) | source/真实 Loader；fixed、seasonal × JSON、SQLite；准确命令见[证据](evidence/implementation/c3.md) | 6 项聚焦验证通过；实际采样重放、原承诺保留、拒绝 profile 绕过、人物版本与原 context 不变 | 仅确定性供需模型；无运行中模型迁移；长期质量与人评仍由 C15/C16 验收 | 2026-10-19 |
| B03–B06 | B1 | [实现 hash 与准确命令](evidence/b1/implementation.json) | source；JSON + SQLite；185 项聚焦集成、Python 2 项及相关编译 | 原子持久索引、进程中断、删索引重建、原权限重读、revision/credential/policy 游标和迟到响应 fence 通过 | 仍按既有预算读取完整源前缀；未宣称冷恢复加速；192 轮矩阵及有限 B19 目标已通过；冷索引查询代价已登记 | 2026-10-19 |
| B13、B14 | B3b | [源码 hash、命令及有限范围](evidence/implementation/b3b-representation.json) | JSON + SQLite；真实 Loader/Session/Native 注册表 4 项、独立可运行快照 2 项 | generation、旧实现准入 fence、原身份资产历史、中断对账及幂等重放通过 | 初始表示准入、v1↔v3 双向切换、取消空结果及旧请求/延迟事件阻塞均已通过扩展验证；actor 降级仍拒绝 | 2026-10-19 |
| B15–B18 | B3c | [局部变更证据](evidence/b3c/implementation.json) | JSON + SQLite；独立 plain-object rename、单 Native commit owner；235 项组合回归及双后端 Loader 通过 | 私有精确 footprint、提交前重验、关闭受影响准入、取消/撤权和未知范围维护回退 | 多 owner provider 不在首个受支持局部域内，自动回退全 run；双后端 28 项局部变更竞赛含真实退休 receipt；未知 writer 不提前释放 | 2026-10-19 |
| B07–B11 | B2 / 必需 D1 前置 | [源码 hash、命令与范围](evidence/b2/implementation.json) | JSON + SQLite；完整闭包、附件与 staging 故障、真实新锚点 restore/resume、4 个真实 Host 方法及独立快照 | 原身份/hash读回、零自动删除、未物化 Session、未知责任与历史容量保留；旧 manifest 不改写 | 首版限自包含根 Team 与 image 附件；child-Team、workspace/provider artifacts、外部 Session 祖先及未知 branch 严格拒绝；全局门禁已通过 | 2026-10-19 |
| F01、F03、F05 | F0 | [输入 hash](evidence/implementation/f0-baseline.json) | 设计/当前 owner 静态核对；不涉及后端执行 | [各包责任、纵向链与拒绝路径](evidence/implementation/f0-contracts.md) | 运行验收分别保留在各功能项 | 2026-10-16 |
| F04 | F0 | [三批冻结输入与完整矩阵](evidence/implementation/f0-longitudinal-collection/summary.json) | [准确命令/退出码](evidence/implementation/f0-longitudinal-collection/verification.json)；每个 Node 命令见原始 results；source、JSON + SQLite、各场景 32 轮及独立 cold | [集合校验](evidence/implementation/f0-collection-final.log)、[逐字原件](evidence/implementation/f0-longitudinal-collection/raw-copies.json)；6 组、192 轮、12 成功进程，冷恢复 0 模型调用，三批 drift 均为空 | 初始基线；RSS 为轮末采样；不作为 B 阶段性能改善证明；实验室 cold 仅 Native governance/norm | 2026-10-19 |
| A15–A19 | A3 | [源码 hash/版本](evidence/a3-core.json) | source / JSON + SQLite；命令见原件 | [核心验收](evidence/a3-core.json)、[真实两后端权限/因果浏览器](evidence/a19-browser.json)、[独立冷恢复进程](evidence/a3-snapshot-processes.json)；civil/DST、前置组合路线、代理与影响预览通过 | 固定 IANA 2026e；不隐含房间/设备资源预留；全局门禁见最终验收 | 2026-10-18 |
| F02 | F0 | [当前三场景/编译器 hash](evidence/implementation/f0-scene-freeze.json) | `TMPDIR="$PWD/.tmp/world-post-mvp" pnpm exec vitest run packages/simulation/simulation-scenario/tests/post-mvp-baseline.spec.ts`；source，纯编译 | [三场景测试与规模/版本快照](../../../packages/simulation/simulation-scenario/tests/post-mvp-baseline.spec.ts)、[当前执行记录](evidence/implementation/f0-scenes-current.log)；三种定义 JSON/YAML 无损往返及坏引用拒绝 | 此项冻结输入与可观察结果；长期构造输入另见[范围](evidence/implementation/f0-contracts.md#长期基线的场景范围)，不冒充模板逐字运行 | 2026-10-19 |
| A08–A14 | A2 | [source hashes](evidence/a2-core.json) | source；Native、JSON + SQLite、真实 Loader + actor Sessions；命令见原件 | [完整后端与UI聚焦证据](evidence/a2-core.json)、[20例真实Session/进程故障](evidence/a2-market-complete-snapshots.log)；23核心/UI +10实际owner竞争 +165回归 +426 Python通过 | 循环薪酬明确未交付；[两后端真实HTTP Persona浏览器](evidence/a2-browser-integration.log)通过；模型0调用，控制台干净 | 2026-10-18 |
| A01、A02、A03、A05 | A1 | [2026-10-18 源码/格式](evidence/implementation/a1-continuation.json)；前次输入保留 | source；原命令与测试范围见原始日志 | [31项聚焦](evidence/implementation/a1-continuation-focused.log)、[最终8项元数据/恢复/YAML回归](evidence/implementation/a1-continuation-source.log)；双后端 CAS、完整原件、字段冲突、普通重试与显式恢复通过 | A01/A06/A07 已补齐；[两后端真实GUI](evidence/implementation/a1-continuation-browser.log)与[GIF原件信息](evidence/implementation/a1-continuation-gif.json)通过；全局门禁另验 | 2026-10-18 |
| A04、A06、A07 | A1 | [当前源码/格式/浏览器](evidence/implementation/a1-continuation.json) | source Host / built Client；JSON + SQLite，真实认证 HTTP | [边界验证](evidence/implementation/a1-boundaries.log)、[当前浏览器](evidence/implementation/a1-continuation-browser.log)；80节点窗口/覆盖、层级搜索、独立布局保存、许可/依赖模板包与原件恢复 | 运行层级调整缺少合法业务命令时只显示阻塞预览；不能直接改世界 | 2026-10-18 |
| F01–F05、A01–A19 | F0 / A1–A3 集成 | [当前源码/构建复核](evidence/implementation/runtime-revalidation.json)、[完整长期证据](evidence/implementation/f0-longitudinal-collection/summary.json) | 准确命令和原始日志见最终验收；source Host / built Client；JSON + SQLite | [最终验收](evidence/implementation/final-validation.md)：F/A 24/24；build/typecheck、lint、GUI 5541、Python 457、两后端真实浏览器与长期冷恢复通过 | 循环薪酬未交付；日历不自动预留房间/设备；B–E 及整体 H 未计入本次完成 | 2026-10-19 |

2026-10-18 复核状态：旧24/24结论已撤回；字段冲突对比、图覆盖、独立布局与模板包、civil时区、完整Persona/offer及制度影响预览现已补齐并验证。

2026-10-19 最终验收：F01–F05、A01–A19 共 24/24 完成，未新增 checklist 条目。三份静态场景和长期构造输入分别登记；六组场景/后端各 32 轮、独立冷恢复和最终 drift 校验均通过。实验室、协会和公司保留各自原始批次及兼容性证明，早先失败/中断未计为成功。

2026-10-18 A3 续验：A15–A19 已通过核心、冷恢复与真实两后端浏览器验证；原始证据见对应登记，全局构建和GUI门禁见当前验收。
