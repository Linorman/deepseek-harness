# WP09：Team 客户端权威状态、分页与操作生命周期

主责：客户端状态程序员。负责 G22/G23，拥有 C6；负责 ui-team 组合文件。按用户功能优先要求复用当前 API 开发；inbox 分页依赖 WP08，完整 P0 不作为独立功能开发前置。下游：WP10/WP11。必读[共享约定](contracts.md)。

## 当前基础与范围

[TeamTaskRuntime](../../../packages/client/runtime/src/client/teams/service.ts)有 Team list/selection 和 Host API；[TeamBrowser](../../../packages/client/ui-team/src/client/TeamBrowser.tsx)保存独立 selected snapshot；[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx)主要展示首批 channel/audit 数据。

本包负责状态和组合位置，不代写 WP10/11 的领域操作表单。禁止从多个 Session transcript 拼接 Team truth，或维护一份乐观完成/取消状态替代服务端事实。

## 状态与分页约定

按 TeamId 建立可观察 selection store，包含已确认的 Team cursor、分页集合、当前请求、typed error 和本地 draft。业务快照与未发送表单数据分开，事件只失效/刷新相应查询，不把临时 UI 字段写回业务模型。

每个集合具有 items、afterCursor、nextCursor、hasMore、loading、error、requestGeneration。响应只在 TeamId、查询条件和 generation 仍匹配时合入。切换 Team、unmount、取消 fetch 时撤销旧请求；晚到响应不得覆盖新页面。

Teams、members、tasks、channels、channel records、audit、artifacts、principal inbox 都有有限页面。缺少后端 page 时与对应 owner 增补；不能循环拉完全部数据再显示 Load more。Team/task DAG 只显示已载入节点，外部依赖提供明确待加载引用，不能假称完整图。

## Mutation 结果

统一 command 层处理 exact cursor/revision、幂等键、authenticated connection、abort、业务冲突和成功后 revalidate。它只规范传输及状态，不决定 reviewer、recipient、provider 或 grant。

abort 表示停止本地等待；已提交 mutation 的结果可能仍会发生。UI 在恢复连接后查原 key/业务状态，不自动发第二个新 key。对 CAS conflict 刷新权威实体、保留未发送内容并指出被其他操作改变的对象。

## 实现步骤

1. 整理当前 Team selections 与 list 监听，创建单一权威 selection 生命周期；移除组件内长期复制的业务 state。
2. 定义 WP10/11 共用的 page/mutation props，以及 participant/channel/task/inbox 子组件的稳定组合位置。
3. 实现有限 Team list 与 detail 集合 loadMore、refresh、query invalidation；不能因每两秒刷新导致全量下载历史。
4. 对 Team/channel/task changes 和 reconnect 执行有限重新读取，保留选择及本地 draft；不要将只刷新 humanActions 当成详情已经刷新。
5. 连接 inbox/action 状态，区分 durable admitted、display acknowledged 和正在发送回答。
6. 统一 loading/empty/denied/stale/offline/partial/retryable/terminal/provider-unavailable 呈现数据，交给功能组件消费。
7. 让 cancel/resume/archive 更新真实返回值并重新读取；取消失败保留真实 phase。

## 验收

| 场景 | 断言 |
|---|---|
| 多页 Team 与详情 | 每次请求受 limit 约束，无启动时无界循环 |
| 两次选择响应倒序 | 第二次选择保留，第一次结果不覆盖 |
| remote task 完成/预算改变 | 详情更新到新 cursor，不依赖手工重新打开 |
| CAS conflict | draft 保留，权威快照刷新，用户可明确重试 |
| abort 后服务端已提交 | 重连显示原结果，不重复创建 |
| compacted cursor/删除节点 | typed 提示、有限重读，不无限翻页 |
| 不存在 Session 的 human/service/remote | 可查看成员详情，不创建假 Session |
| 键盘与错误 | focus 稳定、错误关联、有非颜色状态标识 |

## 检查与交接

```sh
pnpm exec vitest run packages/client/runtime/tests/team-tasks.client.spec.ts packages/client/ui-team/tests
```

增加真实 Host/browser 分页和 reconnect 场景，按[GIF 工作流](../../skills/record-browser-gif/SKILL.md)提交真实服务录制。实现 React 时遵守项目适用设计和性能规则；这里不要求整体视觉重设计。

先交付 state/page/mutation 层，再交付组合迁移与浏览器证明。交接稳定 props、错误/取消语义、query invalidation、draft owner 和样例测试；WP10/11 不另建第二份 API cache。
