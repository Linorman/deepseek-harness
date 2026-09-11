# WP05：Child Team 委派与跨日志结算

主责：委派程序员。负责 G09/G10。按用户功能优先要求，立即复用现有 child proof 开发；对应切片接入 WP04 C2、WP02 service channel admission 与 WP08 结果接纳约定。远程 child 场景依赖 WP07，完整 P0 不作为独立功能开发前置。必读[共享约定](contracts.md)和[P1 child-Team 规格](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.zh.md)。

## 已有基础

[Core](../../../packages/core/team/src/types.ts)有独立 Team/Participant/Task 标识、parent hierarchy 和 child creation proof；[Hub](../../../packages/team/team-hub/src/index.ts)有深度/authority/parent charging 基础，canonical child source 未由生产 Consumer 注册。不能把 parentTeamId 或 parentTaskId 当创建权限。

新增 team-delegation Consumer，拥有 parent-task/child-Team saga；Task union、Hub/fold、TeamRun template、tool/Host/SDK 为共享改动。运行一个 child 仍使用现有 Team 创建、placement、频道和 closure，不直接私有 spawn Session。

## 数据与权限

child-team execution 在创建时冻结 templateId/version、authorityGrant、budget。delegation projection 保存请求幂等键、phase、childTeamId、已观察 parent/child cursor、result Envelope/产物引用和 terminal reason。participant execution 不得携带 delegation binding。

child grant/budget 同时受 parent task、剩余 parent Team 和 initiator authority 约束。校验 max depth、总 child 数、live activation、token/turn/wall-time/cost/retry/concurrency/artifact limits。pending parent charge 阻塞新 child work，修复不能绕过先前拒绝。

child template 创建代表本次 delegation 的 service Participant。child 的结果只投递给它并进入 durable service sink；root final 仍投给 authorized human。不要伪造人类收件人，也不把 private assistant output 自动当结果。

本包拥有 versioned delegation-result 频道约定和 delegated completion policy；可复用 consult 的请求/响应机制，但不能把 direct 的 human-only final 放宽为任意 service 收件人。closure 的结果目标显式区分 root-human 与 parent-delegation-service，后者必须解析到当前 parent task/child binding 和 service sink receipt。C0/C1/C5 的对应增量随本包同一逻辑切片合入。

## Saga 顺序与恢复

| durable 前缀 | 恢复动作 |
|---|---|
| parent requested，无 child | 用原 key 和完整 payload 创建或找回同一 child |
| child 已创建，无 parent binding | 通过创建幂等记录证明归属，CAS 绑定；不靠扫描同名 Team |
| binding 已写，未 start | 按冻结 template provision，启动幂等 |
| child 已 start，parent observer 丢失 | 读取 child cursor 后注册无 await gap 的 watch |
| child terminal/result durable，parent 未结算 | 校验 result/service receipt、产物、usage charges 后结算一次 |
| parent cancel，child 活跃 | 先记录传播意图，再经 child closure owner 取消并等待 |
| child 不可终止或 charge 未修复 | parent 保持非终态或明确 stalled，不提前 archive |

每次跨日志动作都有 source-scoped proof、完整 payload、observed cursor 和独立幂等记录。不存在 parent+child 跨数据库原子事务；禁止用事务名称掩盖实际跨 stream 顺序。

## 实现步骤

1. 与 WP04 合入 execution union 及现有 participant 路径不变的测试；新增 child 数据只在本 Consumer 同时到位时启用。
2. 注册 canonical team-child-delegation proof source，限定 exact parent task/revision 和 child payload。
3. 实现有限批次 drive 和 startup scan，不对每个 change 无界扫描全部层级。
4. 接入 service result sink，保存 source child final 和产物引用，再修复 parent charge，最后 task terminal。
5. 加入 parent cancel、child fail/stall、archive fence；按子层级先释放，汇总全部 branch errors。
6. 增加 team_task_delegate，以及 Host/TypeScript/Python 的相同 task-create 数据；模型不得传 child id、parent depth 或 actor。
7. 添加默认本地委派 runnable example，再扩展跨主机 child 和 child restart 场景。

## 验收

对每个上表窗口 kill/restart，断言一个 delegation key 最多创建一个 child，一个 child 结果只结算一次 parent task。grant/budget/depth 越权在 child 首记录前拒绝；旧 parent revision 不能创建新 child。取消过程中 child 成功返回时，根据已接纳意图决定结果，不丢历史。

证明 child work 的全部模型输入仍有 Session 日志，parent 只接收显式总结和引用，不复制所有 child reasoning。参与者数量、channel/task 数及产物大小都受冻结上限。

## 检查与交接

复用[child authority suite](../../../packages/team/team-hub/tests/child-creation-authority.spec.ts)、[task property suite](../../../packages/team/team-hub/tests/task-state-machine-properties.spec.ts)，新增 delegation 包的模型状态机、saga kill-point 和 Headless/两 SDK 场景。

交接 task-create payload、service result/receipt 格式、charge 修复策略、child 导航最小投影、取消/归档错误。建议三个切片：创建与绑定；结果/usage 恢复；取消/产品入口与远程组合。每片必须实际完成对应 saga 前缀，不能只返回预分配 child id。
