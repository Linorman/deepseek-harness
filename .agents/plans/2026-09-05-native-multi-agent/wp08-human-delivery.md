# WP08：持久 Human inbox、final 接纳与重启回答

主责：Human/API 程序员。负责 G15/G16，拥有 C5。复用当前 C0/C1 与 sink/receipt，按用户功能优先要求开发，不等待完整 P0。下游：WP05/09/10/11。必读[共享约定](contracts.md)及[现有认证决策](../../notes/implemented/architecture/2026-09-04-authenticated-product-principal-team-control.zh.md)。

## 当前基础与源码

[product-principal](../../../packages/core/product-principal/src/index.ts)和[team-human-actor](../../../packages/team/team-human-actor/src/index.ts)已经提供认证调用和短期 proof。[TeamRun](../../../packages/team/team-run/src/index.ts)接收本地 final，并通过独立 durable admission 实现封闭 system sink；这不是 principal inbox。[Host proxy](../../../packages/host/apiproxy/src/api-proxy.ts)在缺 verified pending entry 的 restart 情况下 fail closed。

新增 team-human-client Consumer 及 principal-inbox 的 versioned storage-log owner。保留已有 authentication provider；不把 principal id、Session header 或 Team membership 当认证凭证。

本包负责人复核 C5-design 与已合入 WP01-result 的实际接口，保留 sink/receipt 时序。先交 WP08-inbox 与普通 human ack，再接 WP02-admission，最后交 WP08-actions；完整 P0 与发行验收由集成计划统一安排，具体先后见[总计划](overview.md)。

## Inbox 与接纳

principal-inbox 按稳定 ProductPrincipalId 分区，保存 final、approval/question、human review、lifecycle notice 的 exact Team/channel/task/action provenance、渲染内容、幂等键和 sequence。对 principal 的绑定从当前 authenticated call 和 durable human owner 解析。

channel receipt 证明 sink durable admission，display cursor 证明客户端已查看或确认，二者独立。浏览器离线不应阻止已经持久接纳的 final 完成；sink append 失败则不允许写 receipt。

无 principal 的 Headless run 使用封闭 system result sink；child Team 使用 delegation service sink。定义带 discriminant 的 sink provenance 和验证接口，不把三种 authority 混成可以传任意 recipientId 的通用回执命令。

## 写入与恢复步骤

1. 设计 inbox schema、版本、单调 cursor、幂等 scope、可见性检查和有界页；保存 owner 归属，不保存 secret/proof。
2. channel pending delivery 在 principal human binding 确认后追加 inbox；flush 后提交 receipt。窗口重试使用同一 Envelope 身份，不能追加重复卡片或重放模型。
3. closure recovery 查到已有 sink 接纳事实后补 receipt；仅有 completion intent 时先重新投递 sink，不能直接合成 human receipt。
4. principal inbox 提供 list/watch/display-ack，重连从 durable display cursor 继续。不同设备的 display cursor 语义在 C5 冻结：建议 principal 级共享已确认位置，客户端本地滚动位置不写入它。
5. 对每一页和每次回答重查 principal lease、active human、Team visibility 和 operation grant。删除或撤销 principal 后拒绝访问，不重写历史 attribution。
6. approval/question/review 的恢复必须还原可回答的 exact action 和原业务执行 continuation。请求显示在 inbox 不等于旧工具回调可恢复；若 provider 不支持恢复，应明确 action unavailable/cancelled，并推动原任务 retry 或 stall。
7. 回答只携带 action id、cursor/revision、typed answer 和 retry key，由 human actor 重新 mint proof。重复答案幂等，旧任务/旧 review revision 的回答拒绝。
8. retention 同时检查 display、Team audit、channel replay 及仍 pending action 的水位；未显示或未结算请求不能被通用 terminal cleanup 顺手删除。

## 产品接入

Host、TypeScript SDK、Python SDK 暴露相同的 inbox page/watch/ack/response 约定；认证只在连接入口，操作数据保持 actor-free。UI runtime 由 WP09 维护 projection，WP10/11 负责界面。

participant invite 不能接受用户随意指定 principalId 来获得另一个人的身份。多 human 加入需相应 principal admission 或已认证邀请流程；第一版可以明确仅支持配置的本地 principal，但必须如实暴露限制。

本地 principal 限制只允许作为阶段性切片，不能据此关闭整个工作包。完整验收需要 provider-neutral 的绑定/邀请约定，以及多 principal 的隔离、没有匹配 owner、歧义 owner 和权限撤销测试；默认本地单用户 provider 可保持单用户部署方式。

## 验收矩阵

| 窗口或拒绝路径 | 结果 |
|---|---|
| WAL 已有，inbox 未写 | 保持 pending，可重投 |
| inbox 已写，receipt 未写 | 重启补同一 receipt，无重复 inbox |
| receipt 已写，display 未确认 | Team 可按策略完成；用户重连仍能读取 |
| 只有 closure intent | 不得直接推断 human 已接纳 |
| 其他 principal、权限撤销、重复 active owner | 在敏感页或 mutation 前拒绝 |
| Host restart 后回答 approval/question | continuation 可证明时恢复；否则明确 unavailable 并结算 |
| 旧 review revision 与 rework 新 attempt | 不改变新 attempt |
| Answer append 与连接断开 | 同 key 重试返回原结果 |
| Inbox compaction 后旧 cursor | typed compacted/stale，有限重载 |
| Headless/child sink | 不伪造 principal，不放宽 root final |

## 检查与交接

复用 product-principal、team-human-actor、Host team API 和 closure-authority suites；新增 inbox JSON/SQLite conformance、full Host restart、两 SDK disconnect/retry 和 browser reconnect 场景。Session 事件变化按仓库要求更新两 SDK snapshots。

建议切片：inbox 与 final sink；Host/SDK delivery/ack；action continuation 与 retention。交接 C5 schema、可恢复 action 类型表、sink proof 校验、权限错误、UI payload 样例和真实重启结果。不能只交一个持久通知列表就宣称人工请求恢复完成。
