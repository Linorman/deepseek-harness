# Agent Note：认证用户的 World 人员管理

Status: implemented

[English](2026-10-14-authenticated-world-personnel-management.md) | 中文

## 问题

产品 owner 需要在保留原身份的前提下调岗、结束任职或录用已有合资格人员。复用模拟 director 或虚构 Decision 会伪造来源并绕过普通角色协议。预览还需要稳定的 Native 与规范 Team 观察，不能仅依据过时的界面状态承诺执行。

## 决定

[Native 管理合同](../../../../packages/simulation/simulation/src/world-management.ts)接受 transfer、depart、hire-existing 三个封闭动作。可信产品 owner 根据真实人物及任职解析完整表单，读取有界规范人员义务盘点，并将有限 Team/Channel 事件栅栏保留到 Native 队列准入。认证来源记录实际 principal、credential generation、已安装策略身份及 generation、原 command ID 和 Native 时间。客户端不能提供这些授权字段。

只读字段与预览不打开运行、不 attach 连接、不保留业务预留、不推理。预览绑定完整解析动作、Native 前缀、typed 依赖、规范来源指纹和当前授权策略；实际身份、费用、准入阻塞与后续结清条件分别返回。在任职开始的同一时刻结束任职，会在执行 armed 前拒绝。来源缺失或不完整不能声称可准入。

调岗和离职盘点精确的原任职。Native 在本次 mutation 中关闭的关系不会误报为交接条件；其余规范义务保留真实 owner 和处置状态。资源控制、已受理工作和未知责任不能仅因人物离开岗位而消失。

产品 format 4 日志在 Native 受理前保留唯一不可变用户表单和解析后的 Native 命令。Native 根据原 run/principal/command 身份派生唯一 request 与直接 plan；相同输入重试返回原件。用户 request/plan 没有 Operation 或模拟 requester，来源明确为 `authenticated-user`。产品 case v3 公开可空 requester 和封闭 origin/source 联合；角色案件保留真实 Decision/Operation 来源。用户命令不通过虚构 Channel post 或人类结果 wake 表示。

调度就绪提示在显示允许开始之前核对已安装的原执行 generation 与 Native parser 合同。暂停运行不能在缺失或已卸载的 provider 下开始调度；恢复声明的部署并显式刷新控制状态本身不会开始调度。人员提示说明在途管理原因并提供原义务盘点；待结算的任职栅栏不把调岗描述为已经离职。

原产品持有的 World owner 在受理后持久暂停调度，只执行该直接 plan。它独立排空较新暂停意图之前已受理的工作，不调用模型，结束后仍保持暂停。中断回调在原结果和执行责任明确前保持 accepted；精确重试对账原计划。具备 typed 拒绝且 Native 原件不存在，才可将产品尝试结为失败。查询原回执不会恢复可写 owner。

提交响应在认证调用 lease 有效期间等待 Native 准入；较长的执行随后保留独立完成责任。案件取消使用独立有界控制 job 和固定影响预览，其 Native 确认不等待尚未返回的 provider 回调。清理责任一直保留到原执行和预留明确结清。

招聘费用要求已安装的 principal 到 Native controller 的显式委托。真实 controller 仍是资源 actor，用户 principal 单独保留在原 World 资源 hold 上，created Operation 为 null。一次已提交 hold 支付一次原招聘。缺委托、资金不足或需要审批，都不能通过隐式选择 director 或账户 controller 绕过。

独立、带 scope 的招聘资格属于人物；声明的岗位权限属于原任职。Native 根据已持久化的静态/派生 grant 目录及冻结岗位策略分类，来源歧义直接拒绝。离开岗位结束其派生权限，同时保留独立资格及原 Participant、Session 和 profile。退休仍需原人员责任结清证明；未知责任继续保留。

Native stream 97 和 checkpoint manifest 7 绑定这些原认证 request、plan、来源及 hold，明确拒绝旧格式。Compiler 版本及通用 SQLite/Session 格式不变。

## 考虑过的替代方案

**冒充模拟 director 提交。** 这虚构 Decision 或 sender，并混淆产品授权与角色权限。

**另建管理业务数据库。** 这重复 Native request、plan、result 和资源责任。产品日志保留行政意图，Native 保持业务所有权。

**响应丢失后重新解析输入。** 这可能改变任职、费用或身份。保留原输入并按来源查询，才能保持唯一业务尝试。

## 后果

严格的[产品合同](../../../../packages/simulation/simulation-product/src/world-management-schema.ts)、认证 Host handler 和双 SDK client 互认每个原选择及结果身份。Client runtime 拥有预览失效与查询后重试；UI 只呈现这些事实，并在提交前保留唯一命令。规范来源覆盖、回调确认、业务结果和未来首次行动仍是独立观察。

浏览器刷新后，Client 通过持久请求历史找回原 run/command 选择器。查询先核对返回的管理案件元数据，才公开原 Native 案件链接。显式重试要求 Host 复用完整保留输入，无需在浏览器历史或存储中保存私有表单正文。元数据查询失败不能替换成其他运行或命令。

流程要求独立的确认点击。预览或提交双击的第二次点击不会触发下一步确认，也不会关闭已保留的原件。键盘确认和关闭仍可使用。
