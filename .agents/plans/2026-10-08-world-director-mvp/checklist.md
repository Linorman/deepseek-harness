# 世界调控者 MVP 验收 checklist

设计见[提案](../../notes/implemented/feature/2026-10-08-world-director-mvp.zh.md)，实施顺序见[开发计划](development-plan.md)。创建日期 2026-10-08。以下总体验收项按实际完成情况更新；阅读、评估和文档检查不计作功能完成。每项勾选后附提交 SHA、测试/演示命令与证据路径；“代码已写”或“页面已完成”不足以勾选。

## W0 协议与生命周期

- [x] 请求、计划、结果、HireIntent、readiness、维护和取消的严格 parser、Branded ID、错误分类及存储所有者已固定。
- [x] 技术幂等键与业务事项去重分别验证；同身份异 payload 拒绝，同事项换 decision ID 不能重复办理。
- [x] 请求展开在一次 Decision acceptance 冻结，额度按展开后的 operation/消息/字节计数。
- [x] 普通 actor 伪造 director role/profile、调用 resolve、使用旧 epoch 或未消费上下文均失败。
- [x] preparing Entity 经 driver、Native API、直接 activation controller、冷替换/恢复均不能取得普通运行资格。
- [x] 普通 `communication/post` 的精确正文、依赖、身份、fingerprint 与到期检查未被放宽。
- [x] director 工具只提交计划，不等待窗口关闭后才能执行的 provisioning；未发生窗口/维护死锁。
- [x] 格式版本与拒绝旧格式的落点明确；无隐式 ready 默认值或双写 world 数据库。

## W1 创建与定义

- [x] 公司和实验室 JSON 场景不含强制 buyer/supplier/purchase 基础，并都能预检。
- [x] 未知字段、重复身份、坏引用、非法关系、超限、不可用模型、任意宿主路径/代码/凭证输入在副作用前拒绝。
- [x] validate/preview/read 的存储写入、身份分配与模型调用计数为零。
- [x] 部署默认值、模板/策略/模型引用解析并冻结；创建时预览 hash/世代变化要求重新预检。
- [x] 初始 director 和其他角色全部通过可信 bootstrap、canonical binding 与 readiness 完成准备。
- [x] 创建返回暂停运行；显式 start 之前无模型执行。
- [x] 创建中断后同 commandId 复用原定义和全部身份，异 payload 不覆盖原件。
- [x] 导出/重新导入保留定义语义，且不泄漏凭证、私有 Session 或运行数据；未宣称可移植备份。

## W2 请求与调控者

- [x] 成员通过真实 Agent/三工具发请求，Channel 通过真实 Team 提交；没有直接调用 executor 的测试捷径。
- [x] 未到 deliverAt、错误原 operation/Envelope/recipient、复制 requestId、错误 hash 或缺少持久收件输入均不能受理。
- [x] director 的 Session 已消费精确请求输入，重复通知仍只有一个 case。
- [x] director 使用真实 Agent/Session/三工具提交 apply 或 reject；拒绝产生真实原因，缺信息不无限补证。
- [x] stage/submitted/accepted 明确分离；未 accepted 的计划绝不执行。
- [x] accepted 计划保存完整 Persona、模板选择、模型/策略版本与来源；重试不重新生成。
- [x] 无关 revision 变化不使计划失效；岗位/授权等关键 read-set 变化产生可追溯 stale 与有界后继计划。
- [x] HireIntent 最多一次成功；资料不足的新申请关联旧案，满额时新业务 ID 也不能绕过岗位容量。

## W3 维护、原子入职与取消

- [x] occupied + reserved 始终不超过岗位 capacity；预留本身持久、可重试、可结算。
- [x] 维护关闭新窗口准入、结束旧窗口、排空已接受 IO、暂停调度并确认旧 writer 退休；模型/Team IO 不占住 run 写队列。
- [x] Entity、Participant、Session 与 Channel 预留在 IO 前保存；每次重试核对并复用原身份。
- [x] Team active membership 没有被误当成 world ready；半准备人物不能收新任务或执行模型决策。
- [x] 任职 Relation、ready、WorldResult、首次行动 wake 和预留结算原子提交；故障时不存在部分入职。
- [x] 提交前重新验证权限、关键 read-set、通道和容量；实际生效时间记录为安全边界的模拟时间。
- [x] 维护结束尊重更新的暂停/取消意图；不会自动撤销用户刚发出的暂停。
- [x] 取消先提交则该事项永久不能入职；入职先提交则取消返回 already-committed。
- [x] 结果未知的准备/退休保留 cancel-requested、清理责任和必要占用，不按超时假定不存在。
- [x] 取消完成不删除历史身份、不借给另一人；终止/释放行为经过真实责任清点。

## W3 故障矩阵与冷恢复

- [x] F1 请求接受、发送之前：重启后保留原请求与通信意图。
- [x] F2 Channel 已写、Native receipt 丢失：重试核对原 Envelope，无第二个 case。
- [x] F3 plan accepted、预留之前：原 Persona/hash/计划不变，无第二次生成。
- [x] F4 Participant 已建、binding/Channel 未确认：全部身份复用，direct controller 仍拒绝提前运行。
- [x] F5 入职 append 前后：零或一份完整任职/ready/result/wake，丢回复不重复提交。
- [x] F6 committed、通知未完成：只重试通知，新人任职与世界效果不重复。
- [x] F7 退休超时/卸载/迟到回调：未确认停止仍占容量，旧 epoch 不能提交。
- [x] F8 取消与 prepare/commit 竞争：仅一个业务终态，未知 IO 可精确对账。
- [x] F1–F8 在 JSON 和 SQLite 持久后端验证；跨日志关键点另有真实子进程退出/重启证据。
- [x] checkpoint 包含场景版本、world 记录、预留、通知责任和新增身份/Session/Channel 的引用。
- [x] 缺失必需实现版本或跨所有者证据拒绝可写恢复；不套用最新模板修补历史。
- [x] 纯回放模型调用计数不增加，冷恢复保持暂停；显式继续后最终完成原责任。

## W4 调度、上下文与容量

- [x] 公司与实验室仅换定义/模板即可跑完整链，driver 无领域名条件分支。
- [x] 新人使用独立 Session 消费首次 wake，并通过普通消息与招聘者交互。
- [x] director 仅收到当前请求及授权依据；observer 私有信念/无关私聊不进入其输入。
- [x] 新人只看到获准 Persona、职责和新消息，没有旧管理通道历史。
- [x] Persona 公开描述由可信模板渲染；director 自由文本不直接降级公开。
- [x] 每次模型输入都从 Session/context-view 重建，没有隐藏 callback 或未记录 system prompt 状态。
- [x] 模型池/token、实体、历史身份、resident、未释放 writer、请求、计划、重试、字节与 microstep 限额均覆盖 director 和新人。
- [x] director 与普通成员的轮转有有限批次服务证据；预算不足或维护阻塞时有真实停止原因。
- [x] idle、预算不足、容量不足、授权缺失、维护阻塞、结果未知分别呈现；暂停不忙循环。

## W5 产品与 SDK

- [x] 浏览器 JSON 导入 → 预检 → 创建暂停运行 → start → 请求 → 入职 → 新人行动完整可用。
- [x] 创建预览列出 director 权限、模型、角色/岗位容量与额度，明确不含薪酬和委员会批准。
- [x] 案件列表有分页和 revision 绑定，正文分权限读取，不暴露 Native snapshot。
- [x] request、plan、execution、notification 分别显示；committed 不等于所有人收到或理解。
- [x] 失败、拒绝、容量满、维护中、空状态和结果未知均可定位原因与下一步。
- [x] HTTP 超时保留原 commandId/payload，先查后重试；刷新、双击和第二标签不重复创建业务或 owner。
- [x] 用户暂停、取消与冷恢复流程可用；只读浏览、刷新与导出不请求模型或启动运行。
- [x] 授权撤销清除敏感内容，迟到读取不能重新显示；断网保留明确标记陈旧的数据。
- [x] 键盘、窄屏、浅/深主题与减少动效通过适用 UI 检查；GUI PR 附真实 server/model flow GIF。
- [x] Host、Client runtime、TypeScript SDK 和 Python SDK 同步 parser/协议；未知必需事件明确拒绝。
- [x] SDK 既验证源码路径，也验证声明 build 前置条件后的分发产物与进程恢复路径。

## W6 发布门槛

- [x] 两个新 keyless runnable-example 通过真实产品/Agent/持久后端链路，不用预构造成功对象代替业务执行。
- [x] 原采购、消息 proof、身份、窗口和 checkpoint 的相关回归通过。
- [x] 按实际 diff 完成 focused tests、snapshot、typecheck、lint、build、doc-sync 及必要产物检查，记录实际命令。
- [ ] 有预算的真实模型小样本试验完成，含有效/缺字段/越权需求及 token/版本记录；不替代确定性测试。
- [x] 冷恢复时间、历史量和占用有原始测量；未声明未经测试的规模或无限运行能力。
- [x] 新 public/persisted/tool 输入有严格 parser，变更拒绝路径有测试，所有权关系有运行时不变量。
- [x] 包 README、架构/子系统/API/模型体验及双语对应按实际变更更新；编排没有绕过扩展点。
- [x] 文档明确区分场景导出/运行备份、提案/实现、模拟/真实效果及后续领域范围。
- [ ] 所有必需项证据齐全后才宣布 MVP 完成；治理、离职和外部世界没有被误标已交付。

## 验收证据登记

逐条命令、结果及未完成验证见[实施证据](implementation-evidence.md)。

| 项目/工作包 | 提交 SHA | 实际命令或产品操作 | backend/模型 | 结果与证据路径 |
|---|---|---|---|---|
| W0-a 产品创建/文档 | 工作区未提交，基线 `b49dd0e` | `CLOCKY_SNAPSHOT=refresh pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/product-administration.snapshot.ts --update`；`pnpm run doc-sync` | JSON/SQLite，keyless | 17 项 snapshot、29 项文档门禁通过；日志见上方子项 |
| W0-a readiness | 工作区未提交，基线 `b49dd0e` | `pnpm exec vitest run` 对应 readiness、writers、scheduler、dispatch、company-task-policies；另 participants | JSON/SQLite，无模型或脚本模型 | 45 + 30 项通过；日志见上方子项 |

## 本轮文档交付检查

本节只记录 2026-10-08 设计材料本身的验证，不用于勾选上述功能验收项。

| 检查 | 实际结果 | 范围与限制 |
|---|---|---|
| 附件与源码核对 | 附件 22 章已阅读；源码基线与附件提交一致 | 静态阅读，不代表任何新能力已运行 |
| `pnpm run verify-translation-pairing` 指定两组文档 | 2 组一致 | 新设计双语及原架构 note 的关联链接 |
| `pnpm run doc-sync` | 29 passed，0 failed，0 skipped | 日志保存在项目内 `.local/world-design-review/doc-sync.log` |
| 新增 Markdown 的补充检查 | 4 个文件、55 个本地链接通过；文件末尾换行与尾随空白通过 | 覆盖不在标准 Markdown 门禁扫描目录内的两份计划文件 |
| `git diff --check` | 通过 | 已跟踪变更；新文件另由上一项覆盖 |

初始设计交付未修改运行时代码，未执行拟议 MVP 的功能测试、冷恢复实验或真实模型试验；后续实施证据见上方登记。既有 note 保持有效，仅增加到新设计的关联链接；没有归档或删除既有记录。
