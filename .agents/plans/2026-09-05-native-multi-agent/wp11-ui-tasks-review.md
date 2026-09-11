# WP11：任务、审阅与产物集成 UI

主责：任务/审阅 UI 程序员。负责 G19–G21。前置：WP09 C6、WP04 C2、WP08 C5；child 导航依赖 WP05，远程集成依赖 WP07。独占新增任务、review、integration 子组件，组合文件由 WP09 合入。

## 当前基础

[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx)已有 task 列表、attempt/result 摘要、产物读取和下载。[Host API](../../../packages/host/apiproxy/src/api/teams.ts)与 Hub 拥有 task/review/integration 约定。需要完成操作流程和状态，而不是重新创建产物存储。

## 任务与依赖

表单提供 subject/description、dependencies、read/write scopes、workspace mode、review policy、placement constraints、预算及 execution。选项来自被授权的实际 provider/template；不存在 provider 时不能默默退回 shared。

DAG 展示与列表共用同一 task projection，支持键盘访问和文本依赖描述。未加载依赖明确标记为待加载，不凭缺失节点判断 dependency 已完成。修改依赖先由 Hub 验证 acyclic/CAS，再显示成功。

取消显示 pending/review 的直接结算与 assigned/running 的 cancellation-requested，不能把按钮点击立即渲染成 cancelled。attempt history 保留已完成和失败事实；child task 链接到实际 child Team，创建中的 child 不伪造 id。

## 人工审阅与问答

review 卡片展示 exact task、completed attempt、review revision、evidence、verification、changed paths、可见产物。accept/rework 由当前 principal 的 human proof 提交，rework 原因必填；旧 revision 的卡片不能完成新 attempt。

approval/question 使用 WP08 可回答的 exact action。continuation unavailable 时呈现不可恢复原因及任务后续状态，不能显示一个点击后注定失败的普通回答框。其他 participant 的 authority 不因同属 Team 自动继承。

## 产物与 integration

保留已实现的 verified read、preview/download 和 private visibility 限制。integration 操作选择来源 attempt 产物、provider-owned target、expected version 和验证要求，创建显式 Team integration task。

界面区分 proposal、awaiting authorization、integrating、conflict、integrated、failed。冲突显示 provider 返回路径和目标版本，不能通过前端“重试”去掉 expected version；验证结果未给出时不显示检查通过。用户已有修改保持不被隐式提交、覆盖或强推。

## 实现步骤

1. 接入 C6 的分页 task query，建立详情及 attempt history 子组件。
2. 交付 participant task 的创建/编辑/依赖/取消；字段和错误从 C2 对齐。
3. 交付 review、approval、question，连接 C5 principal inbox 和 response。
4. 交付 integration proposal/result，保持 artifact owner 的 verified read。
5. 接入 child 和 remote 场景，完善 unavailable/partial/terminal 状态。
6. 完成真实服务路径、replay snapshots、a11y 断言和每片 GIF。

## 验收

| 场景 | 必需结果 |
|---|---|
| DAG fan-out/fan-in | 依赖来自 authoritative task，非法 cycle 被拒绝 |
| 编辑时后台 task revision 增加 | 保存失败后刷新，原表单保留 |
| running task 取消 | 显示请求及确认/失联状态，不提前 terminal |
| review accepted/rework | 正确 attempt/revision，原因保留，无重复结算 |
| principal 变更或 grant 撤销 | 旧卡片无法提交 |
| artifact private/missing/oversized/provider absent | typed 状态，无未验证字节或越权下载 |
| integration target 变化 | conflict，可查看版本，不覆盖用户变更 |
| child creating/failed/stalled/completed | 正确导航和 parent settlement 状态 |
| 键盘/屏幕阅读 | DAG 文本替代、表单错误关联、操作后 focus 可预期 |

## 提交与交接

建议三片：任务和 DAG；human review/action；integration/child/remote。每片自带真实-server 场景及 GIF。共享 UI 状态问题反馈 WP09，不私自增加长期 optimistic business copy。

交接实际 task API payload、状态映射、产物可见性处理、typed errors 和场景 id。WP13 组合验收时可从真实任务创建一直走到 review、integration 和 root final，不需要手工种业务数据跳过中间过程。
