# Agent Note: 当前 World 作用域披露

Status: implemented

[English](2026-10-13-world-scope-disclosure.md) | 中文

## 问题

查询历史内容不能恢复已离开成员的读取权限。只检查 assignment 日期也无法识别失活岗位和组织。准备后还有另一竞态：冻结上下文包含当时获准的作用域正文，但任职撤销时，这些正文尚未进入 Session 或模型。普通 knowledge 检查不覆盖自动选择的 WorldFact 和 Norm。

## 决策

[当前成员关系](../../../../packages/simulation/simulation/src/world-membership.ts)由请求准入、scope-members 事实/制度投影及新公告收件人共同使用。它读取所提供 Native 前缀的当前时间及 active 的读者、岗位和组织。内容时间/cursor 选择不可变版本，不选择过去的授权；提供原历史前缀仍可重建原选择。

[上下文生产者](../../../../packages/simulation/simulation-local/src/context.ts)从实际选中的 WorldFact/Norm 正文派生 `worldScopeAccess`。Native 在重复准备、重取、模型准入、报告物化及提交时重验这些成员关系。缺少必要证据或权限失效则拒绝，不改写冻结 view。Team 检查覆盖同一原选择，无需解析任意模型文本。下游 pre-step 监听器和展示校验结束后，Session 插入紧前同步检查当前 Native snapshot。异步准入结束后，进入模型 waterfall 紧前再次同步检查；拒绝仍以确定未派发结算 Token。这些边界不撤回已进入下游的 IO。

Goal preparation 也保留原任职和操作授权引用。实时披露要求每条原关系仍然有效；授权到期后不能复用缓存 goal，即使事实 audience 成员资格仍有效。招聘费用、候选人/任职机会和委员会规则与请求准入共享当前目标、active 端点和原 relationRules 核验。一条有效授权不能披露另一失效目标的材料。

所有附带的治理提案均在 `governanceAccess` 保留准确 proposal revision/hash、原投票 operation pin 和授权关系引用；此要求也覆盖 request/result，不限于 goal。实时披露重新核验原 electorate 与每条原授权，不能用其他权限或无关有效岗位替换缺失证据。拒绝后冻结 preparation 与已消费历史保持原样。

新作用域公告排除已经失去资格的成员；已接受公告的收件人仍是冻结职责。已消费的 Session 历史继续保留，不承诺擦除过去记忆，也不重解释 explicit actors/public audience。

## 考虑的替代方案

**按请求的过去时间判断成员资格。** 这会把历史内容选择变成访问绕过。

**只在准备时检查。** Session 插入前或真实模型 permit 排队期间仍可能撤权。

**撤权后改写旧 view。** 这会破坏原历史输入，并隐藏为何拒绝原派发。

## 影响

Native stream 94 拒绝旧 prepared 披露语义；Compiler 9 不变。双后端测试覆盖任职到期、端点失活、历史查询、原前缀不变、prepare 重试、首次输入、真实模型池等待、下游 pre-step 等待以及 Session 历史保留。真实 Loader 探针在未派发的 scope canary 进入 Session/模型前拒绝，并在冷恢复中只保留原 Native context。

真实 Loader 公司/实验室探针在非 goal request 已准备后仅撤销投票权限，保留任职和提案权限。缓存读取及下游 pre-step 派发在提案正文追加或进入 provider 前拒绝；新的 turn/error 元数据仍可记录拒绝尝试。JSON/SQLite 的 source 与 plain-Node lib 运行在新进程暂停恢复后保留原 view。三角色 Fact/Norm source/lib 及真实认证浏览器正文 grant/撤权证据见[完成清单](../../../plans/2026-10-11-world-simulation-completion/checklist.md)；双 SDK 通过共享 wire corpus 保留完整 context-view 及其中不透明的 JSON 文本。这些检查证明记录的分角色披露，不承诺擦除合法历史知识，也不证明任意低权限通信正文都没有隐写泄露。
