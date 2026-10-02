# Team A/B 最终验收证据

对应 [实施计划](implementation-plan.md) A04、B09、B10、B11；核对日期：2026-10-01。此文件记录断言、源码和本轮执行证据，checkbox 状态由实施计划维护。最终浏览器范围已使用当前构建执行：11 文件、16 项全部通过（147.12 秒，`.tmp-simulation-plan/ae/team-full-final.log`）。下方 source 证据和最终 browser 共同验证各行，主计划的关闭仍依据完整需求审计。

## 本轮实现与已执行检查

Host 的 `team.capabilities` 使用现有 `humanTeamRead` 保留同一个当前身份 proof，跨越 scheduler／workspace provider 的异步观察，并在成功或失败后重查。传输凭据仍有效、持久成员资格已结束时，不返回先前能力提示。公开行为由 [API README](../../packages/host/apiproxy/README.zh.md) 与[能力观察决策](../../.agents/notes/implemented/architecture/2026-09-28-team-task-capability-observations.zh.md)维护。

| 本轮命令 | 已执行结果 | 明确范围 |
|---|---|---|
| `pnpm exec vitest run packages/client/ui-team/tests packages/client/runtime/tests/task-capabilities.client.spec.ts packages/client/runtime/tests/member-readiness.client.spec.ts packages/client/runtime/tests/attention-query.client.spec.ts packages/client/runtime/tests/team-access.client.spec.ts` | 25 文件、211 项通过 | 当前 UI 及能力／就绪度／待处理／授权 source 测试；当时尚未添加两个拒绝原因测试 |
| `pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts` | 86 项通过 | Team API 原有全部用例，以及持久成员资格在读取／能力观察期间结束的四项新用例；当时尚未添加 active-execution 用例 |
| `pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts -t 'active-execution task edit refusal'` | 1 项通过 | 当前 assignment 不被拒绝的编辑替换；原拒绝可查询及幂等重试 |
| `pnpm exec vitest run packages/client/ui-team/tests/task-draft.client.spec.tsx` | 21 项通过 | 包括 `workflow-owned`／`active-execution` 原结果查询保留输入、不重新提交；stale／invalid／未知结果已有断言 |
| `pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts -t 'capability hints'` | 2 项通过 | scheduler IO 成功／失败期间成员资格结束，均不返回旧能力或私有诊断 |
| `pnpm exec vitest run packages/host/apiproxy/tests/api-proxy-teams.spec.ts -t 'cross-Team dependency'` | 1 项通过 | 外部依赖真实存在且另一 Team 可读，也不得加入本 Team 任务；原拒绝、两个原任务及跨 Team 查询隔离 |
| `pnpm exec vitest run packages/team/team-placement-default/tests/placement.spec.ts packages/team/team-activation-controller/tests/capacity.spec.ts packages/team/team-activation-controller/tests/recovery-admission.spec.ts packages/core/team/tests/member-readiness.spec.ts packages/client/runtime/tests/action-inspector.client.spec.ts packages/client/runtime/tests/task-references.client.spec.ts packages/client/runtime/tests/team-tasks.client.spec.ts` | 7 文件、202 项通过 | 生产 placement／controller 的容量、取消、旧责任及 runtime 精确读取隔离 |
| `pnpm exec vitest run packages/team/team-hub/tests/task-update.spec.ts packages/team/team-hub/tests/attention.spec.ts packages/team/team-hub/tests/identity-resolution.spec.ts packages/client/runtime/tests/identity-resolver.client.spec.ts packages/client/runtime/tests/selection-retention.client.spec.ts packages/client/runtime/tests/task-query.client.spec.ts packages/client/runtime/tests/member-inspector.client.spec.ts packages/client/ui-team/tests/apply.client.spec.tsx` | 8 文件、59 项通过 | JSON／SQLite 原结果持久性、权威待处理、身份解析、选择竞态、分页和 UI 握手组装 |

首次尝试的 `--config vitest.client.config.ts` 因该配置文件不存在而没有执行测试；实际 source 测试使用根配置。成员资格在读取期间结束返回 `TEAM_ACTOR_PROOF_INVALID`；新读取返回权限拒绝，新写入拒绝缺少 active human。未将这些拒绝改成普通内部错误。

## 需求与证据对应

以下表为当前最终复验结果；历史 source 批次保留准确范围，不与本轮浏览器数量相加。

| 计划／需求 | 必须证明的行为 | 权威测试／检查 | 当前证据 |
|---|---|---|---|
| A04／T1 · 离页负责人 | 名称不在成员页时仍已分配，精确 ID 详情和复制；普通离线保留，撤权清理 | [member-readiness 浏览器](../../apps/web/tests/team-member-readiness.snapshot.ts)、[task-workspace 组件](../../packages/client/ui-team/tests/task-workspace.client.spec.tsx)、runtime identity/member inspector | 组件通过；当前构建对应浏览器通过 |
| A04／T2 · 离页依赖 | 候选分页／搜索不改变已选集合，完整提交，缺失／删除可移除 | [collections 浏览器](../../apps/web/tests/team-collections.snapshot.ts)、[draft 浏览器](../../apps/web/tests/team-task-draft.snapshot.ts)、[conflict 组件](../../packages/client/ui-team/tests/task-conflict.client.spec.tsx) | 组件通过；当前构建对应浏览器通过 |
| A04／T3 · 空态 | 空产物／工作流／搜索保留框架、刷新／清除入口，失败另行反馈 | collections 浏览器、[workspace 浏览器](../../apps/web/tests/team-workspace.snapshot.ts)、[acceptance 浏览器](../../apps/web/tests/team-acceptance.snapshot.ts) | source 测试通过；当前构建对应浏览器通过 |
| B09 · revision／循环／跨 Team | 当前版本重新确认，拒绝定位，草稿和原命令保留 | draft 浏览器、collections 浏览器、[Hub 更新](../../packages/team/team-hub/tests/task-update.spec.ts)、[API Team](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts) | revision／循环 source 通过；跨 Team API/Hub拒绝与当前草稿浏览器反馈已核对 |
| B09 · 完整拒绝原因 | stale-revision、workflow-owned、active-execution、invalid-edit 分开；不改变任务／attempt，不绕过原身份 | API 新 active-execution；collections 新生产 workflow-owned 拒绝；draft 组件与浏览器 | API／组件通过；当前生产 workflow 浏览器通过 |
| B09 · 未知结果 | 写入前／后响应丢失，查询 not-found 及网络失败不能认定失败；确认后编辑生成新身份 | draft 浏览器、draft 组件、runtime Team tasks | 组件通过；当前构建对应浏览器通过 |
| B09 · grant 结束 | 持久 self-remove 与 credential retirement 分别验证；旧结果／草稿清理，当前写重新鉴权 | 新 acceptance 浏览器，API 读取期间 self-remove 四用例，draft 浏览器已有 credential retirement | API 通过；当前构建浏览器通过 |
| B09／B10 · 规范父 Team | 来源只读，原任务结果可观察，不继承 task mutation／human answer 授权 | [child-navigation 浏览器](../../apps/web/tests/team-child-navigation.snapshot.ts)：真实 child external integration→production ApprovalService、waiting-permission、拒绝答复／创建 | 当前构建浏览器通过 |
| B10／T6 · 完整待处理集合 | 权威总数大于预览；预览失败仍进入 Team 集合，精确分页与当前记录 | [attention 浏览器](../../apps/web/tests/team-attention.snapshot.ts)、runtime attention-query、team-attention 组件 | runtime／组件通过；当前构建对应浏览器通过 |
| B10 · 人工答复 | 生产 question，关闭／历史／断线保留输入，精确 revision 核对，原 identity 重试及已处理反馈 | [action 浏览器](../../apps/web/tests/team-action.snapshot.ts)、human-inbox／team-action-dialog 组件 | 组件通过；当前构建对应浏览器通过 |
| B10 · 人工事项撤权 | credential retirement 与持久 membership 结束都清除正文和草稿；列表／详情／答复分别拒绝 | action 浏览器新增 self-remove、API current read guard、runtime action-inspector／attention-query | API／runtime 通过；当前构建浏览器通过 |
| B11／T4 · 默认 profile | 仅 shared／已授权 scope 可提交；能力 IO 失败保留并禁用，写重新鉴权 | [capabilities 浏览器](../../apps/web/tests/team-capabilities.snapshot.ts)、API grant/provider/scheduler 测试、runtime task-capabilities | API／runtime／组件通过；当前构建对应浏览器通过 |
| B11／T5 · 自定义真实执行 | 无 route 可登记但不执行；配置 profile 的成员由生产 scheduler 创建 activation／attempt 并发布结果 | member-readiness 浏览器、[placement](../../packages/team/team-placement-default/tests/placement.spec.ts) | placement/controller/runtime源级202项通过；当前自定义真实执行浏览器通过 |
| B11／T5 · 无 WAL 就绪度更新 | provider 移除、容量等待、旧 writer 未确认原因独立，不重复启动 | API provider 注册／移除测试，core member-readiness、placement close-failure／coalescing | API／controller source 通过；成员浏览器新增真实容量、provider 注册／撤销及真实 handle 终止证明失败，当前构建实际执行通过 |
| B11／T7 · 搜索／读取竞态 | 全 Team 搜索走有界 Host 查询；URL、IME、clear focus、分页失败、后退和旧响应隔离 | collections/workspace/draft 浏览器，TaskWorkspace／apply 组件，runtime query／selection | 组件通过；当前构建对应浏览器通过 |
| B09–B11／§5 · 交互与外观 | 两种语言／外观、桌面／短／窄窗口、200% 原生浏览器缩放、长正文／错误、键盘、对比度和语义 | 新 acceptance/support；action/attention/child 扩展矩阵 | 文件已实现；原生缩放 helper 已接入；最终当前构建浏览器通过 |
| §5 · 真实 Loader 生命周期 | slot children／inject、每次 apply 独立 store，卸载清理及重挂无重复 | 真实 scaffold Loader 启动和 API/runtime/UI 的 owning disposal 测试 | 实际Browser Loader启动和Team apply独立store/effect清理source通过；共享模块required service退休/重挂另由C实机两后端及Node sibling生命周期验证 |

## 浏览器证据约定

新增 [Team evidence helper](../../apps/web/tests/team-acceptance-support.ts)对当前可见标题、段落、表头、标签、状态、错误和启用按钮读取实际颜色，并按透明背景的祖先合成测量文字对比度；普通正文要求 4.5:1、大字要求 3:1。每张截图旁的 JSON 保存 viewport、locale、theme、数据状态、具体断言和测量结果。失败测量不构成通过。此范围不代替独立的焦点 outline 对比或完整屏幕阅读器人工审阅。

新矩阵分别覆盖普通 Team 模块、长输入的任务冲突、待处理分页、人工问题和规范父 Team 的权限等待；Modal 键盘检查包括命名、连续 Tab 背景隔离、Escape 和返回触发者。非模态任务摘要允许焦点返回外部搜索。reduced-motion 使用浏览器实际偏好。原生缩放由[共享 Chromium 扩展 helper](../../apps/web/tests/browser-native-zoom.ts)控制，截图 JSON 保存实际 `getZoom` 与 CSS viewport；不采用 DPR／窄 viewport 或 CSS zoom 等效冒充。

浏览器产物目录为项目内 `.tmp/team-acceptance-browser`、`.tmp/team-action-browser`、`.tmp/team-attention-browser`、`.tmp/team-child-navigation-browser-evidence-current`。实际执行后补充准确命令、构建依据、截图路径和残余限制，再由实施计划维护者决定各条完成状态。

## 最终浏览器复验

`CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/team-` 最终 **11文件16项全通过**，包含 grant退出、任务冲突/同旧原请求、数据读失败可刷新、默认form到API、自定义actual provider/activation/attempt、容量1下明确原因、provider移除/重新注册无WAL变化、真实runtime termination-unconfirmed保留oldwriter、问题未知回复/重试、待处理全集和父团队只读child审批。支持性文件均在本轮compiled artifacts上运行；不只依赖初次12pass。

最后child用例通过真实Loader insert加载外部integration、agent/created standing工具贡献和实际模型调用，经production ApprovalService和持久Team pending进入Human request详情；canonical-parent可读但没有任何批准动作，API答复拒绝，当前source不授予child修改。所有4locale/theme×desktop/short/narrow/native200均保存截图/实测。父取消真实收尾。此前失败源于fixture row错误使用replacement id、tool未进入preset层、`审批`误匹配`批准`及只读UI应隐藏批准按钮，而非真实grant策略缺陷；修正测试而未放宽生产权限。

本轮必要可操作性修复仅为stalled普通Team禁改、API持久grant重新核对、冲突说明局部可读颜色及失败读取可刷新/新版本需确认；均保留既有授权与原命令。其他全仓G最终门禁不由本文件认证。
