# Agent Note: 有限日历与不可变组合治理

Status: implemented

[English](2026-10-16-world-calendar-review-routes.md) | 中文

## Problem

固定周期触发和单委员会批准无法表达有界班次、改排班、独立审核路线与显式代理票。改变历史解释会重定向已接受工作，或把旧批准用于不同正文。

## Decision

现有 Native journal 是唯一 owner。日历支持模拟 tick 和 civil 排班；civil 使用精确 moment-timezone 0.6.5 随包 IANA tzdb 2026e（MIT），冻结时区、UTC 起点、tick 大小、星期、本地班次、排除日期和额外班次。DST 缺口/重复必须声明 reject/earlier/later；不使用宿主 Intl 或本地时区。两种时钟均有有限 horizon/展开上限。priority 在同时间/phase 内先于稳定 slot 排序。未知房间/设备预约字段拒绝；wake 不预约资源。暂停编辑保留原命令、预期规则 revision 和认证 Host principal，仅取消待触发旧 occurrence、排入新规则首个后继，保留旧正文与冻结收件人。director 授权日历不能经此操作修改。

`governance.define-review-route` 在投票前接受不可变原路线，要求每个委员会的明确权限；hash 绑定原提案、冻结 electorate、规则、期限及依赖。依赖 ballot 的原 context 必须已包含前置通过事实。完成证明引用精确 Resolution；OR 的尚未完成分支保留显式 null 引用。route-bound 制度请求不能用单一委员会批准绕过组合路线。每步使用相同正文、目标和 scope；拒绝重复审批人、循环依赖及递归路线替代。

`governance.delegate-vote` 从真实 Decision/Session 派生独立 principal，持久保留精确提案/revision/hash、delegate 和模拟到期。撤销/替代关闭新代理准入，旧票按原接受 cursor 保持有效。代理不授予正文读取或工具权限，只能委托原冻结投票人；唯一键仍为 proposal 加 principal。

Native 先保留每作者/run 的单个未解决 quote，再接受独立执行调用；retention 回执丢失不会迟到执行。作者限定的只读查询在刷新后恢复原件，不获取执行 ownership；取消保留竞态中已执行回执。浏览器 runtime 保留有界活动视图；timeout 为 unknown，精确重试、切换 run 保留责任，认证失效清除私密状态。规则正文仍按普通披露权限读取。

制度规划及 Product/SDK 提案 impact 读取覆盖全部未来规则范围（含惰性后继）、真实案件/任务/承诺/hold/operation/wake 和已安装的全部适用招聘批准规则。私有 case 与操作责任分别检查权限；不可读义务使整份报告 withheld，不能静默遗漏后假称完整。不支持的已有义务迁移明确阻塞。产品审计链接真实票据、生效边界和通知消费，并显示未完成步骤。

## Alternatives considered

重写 bootstrap 日历会破坏旧 wake 正文与收件人。第二套可变日历/治理数据库会引入 owner 冲突。从关系推断代理允许冒名。用模型解决自由文本政策冲突无法产生可执行授权规则。

## Consequences

Native journal 98 与 checkpoint manifest 8 拒绝旧产物；代理授权、前置路线、保留日历命令和日历修订原件各有绑定内容的独立 checkpoint 引用。Session 格式不变，已消费模型材料仍由现有 context 事件保留。日历替换要求已经恢复且暂停的 owner，不隐式恢复或获取执行。固定 civil 编译拒绝未知 tzdb 和未明确处理的歧义时间；同 electorate 代理拒绝外部代理权限。

## Testing

[Native 日历恢复](../../../../packages/simulation/simulation-local/tests/world-bootstrap.spec.ts) 验证 JSON/SQLite 重开、CAS 与精确重试。[独立治理恢复](../../../../packages/simulation/simulation-local/tests/world-governance-proxy-recovery.spec.ts) 使用 Loader、canonical Team/Session 接受、两个委员会、代理撤销和冷重放。[Runtime 测试](../../../../packages/client/runtime/tests/simulation-calendar.client.spec.ts) 覆盖回执丢失、超时、运行切换、撤权和完整 payload 上限。[产品管理测试](../../../../packages/simulation/simulation-product/tests/world-management.spec.ts) 经过实际认证浏览器传输。[工作包证据](../../../plans/2026-10-16-world-post-mvp/evidence/a3-core.json) 记录命令与源码 hash；更广集成门禁单独报告。

[可运行快照](../../../../examples/simulation-company/tests/world-post-mvp.snapshot.ts) 为 JSON/SQLite 的代理/组合路线流程加载生产 Cordis 配置，并在独立恢复进程中无需推理地核对原治理与制度。

原件格式：Native journal 98、checkpoint manifest 8 拒绝旧制品；delegation、前置 route、calendar-command 和 calendar-revision 均有独立内容 hash 引用。Session 格式不变。propose 为 schema4/native4 generation3，vote 为 schema3/native5 generation4，enact/revoke 为 schema2/native2 generation2；重放拒绝旧安装 pin。
