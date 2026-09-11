# WP10：成员与频道管理 UI

主责：成员/频道 UI 程序员。负责 G17/G18。前置：WP09 C6、WP02 C1、WP08 C5。实际远程 activation 场景依赖 WP04/WP07。独占新增成员/频道子组件与对应浏览器场景，TeamPage/TeamBrowser 的组合修改交给 WP09。

## 当前基础与目标

[Host Team API](../../../packages/host/apiproxy/src/api/teams.ts)已有 authenticated member/channel 方法；[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx)已展示 roster、channel WAL 和 participant transcript。目标是完成实际管理行为，不能用本地数组增删伪装 mutation 成功。

## 成员操作

成员列表显示 durable membership 与 live activation 两种状态。invite 表单提供 kind、display name、role、capabilities、允许的 provider/preset/model；字段选项从可访问目录和 grant 解析，不允许传 raw principal owner。

“加入成员”和“启动执行”分别展示：当前 memberActivate 可能只是 membership phase，真正模型执行必须由 placement/activation owner 完成。失败时显示具体原因，不能把 active member 当作正在运行。

remove/interrupt 操作绑定当前 cursor 和 exact target；对仍有任务、review、channel invitation 的成员明确展示影响，并由后端 authority 决定允许或拒绝。若产品操作需要确认，显示实际被影响资源，不能泛化为每次操作都多一个确认步骤。

## 频道操作

创建表单选择协议、成员与角色、bounds、view policy；读取支持的精确版本。频道详情区分 pending invitations、active、closing、terminal，展示每个 recipient 的 delivery/receipt 状态。

post 支持明确 audience subset 和 broadcast、text/image、合法 delivery intent。广播不是自动选中所有未来成员；final 不出现在普通群发入口。pending channel 禁用普通发送，解释尚待哪些 required acknowledgement。

close 使用 current cursor 和 typed reason。历史展示来源为 channel projection/view；WAL JSON 可以保留在诊断详情，不作为人类对话唯一呈现。

## 实现步骤

1. 使用 C6 page/query 和 mutation command，增加成员详情及 invite/editable form，不重新建立网络 cache。
2. 连接目录、grant-aware disabled 状态和 membership/activation 区别。
3. 增加频道创建、invitation 状态、audience composer、post/close。
4. 加入 retry、stale cursor、offline、provider unavailable、权限撤销；保留未发送表单内容。
5. 验证 image 使用已接纳 attachment 引用，无凭证或未界定大字节数据进入请求。
6. 完成 browser 真实流程和 GIF；与 WP13 共享完整场景 id。

## 验收矩阵

| 流程 | 结果 |
|---|---|
| invite → membership active → placement running | 每个阶段真实请求且显示正确状态 |
| 无 invite/remove/interrupt grant | 禁用有原因；绕过 UI 直接调用也被后端拒绝 |
| remove 与 task assignment 竞态 | 权威刷新，不本地删除仍合法执行的成员 |
| create pending → required ack → active | 禁止提前发送，超时有明确终态 |
| subset/broadcast → 部分 receipt | 每个收件人独立状态，不报全体完成 |
| 普通 post 或 close 发生冲突 | draft 保留，重试不重复 Envelope |
| human/service 无 Session | 可查看成员；不会调用不存在的 transcript |
| remote 断开与重连 | offline/unknown/terminated 不混为同一状态 |

## 交接与检查

提交成员和频道的 component tests、真实-server 浏览器场景、键盘/focus/错误关联断言及对应 GIF。浏览器场景应验证 durable Team/channel 数据或真实服务返回，不只看按钮出现。

建议两片：成员管理；频道管理与广播。每片带自己的 GIF 和 snapshot。下游交接表单字段、实际操作映射、状态选择器和场景路径；WP13 负责组合证据整理，不承担本包欠缺的 UI 测试。
