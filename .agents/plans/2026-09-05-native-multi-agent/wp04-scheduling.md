# WP04：通用 placement、排名、任务取消与模板

主责：调度程序员。负责 G05–G08，拥有 C2。按用户最新优先级先实现单任务取消垂直功能，不等待完整 P0 覆盖率；placement、排名、模板继续保留在本包后续范围。依赖交接：WP02 的 active channel、WP07 的 provider descriptor、WP08 的 human authority；首片复用当前已存在的对应能力，后续随接口升级接入。下游 WP05/WP11。必读[共享约定](contracts.md)。

## 当前基础与代码归属

[scheduler](../../../packages/team/team-scheduler-dag/src/index.ts)已扫描整个 roster 的 idle local/remote binding，处理 DAG、lease、shared scope 和 proposal/capability/load/id 排名。[TeamRun](../../../packages/team/team-run/src/index.ts)拥有固定 worker pool 和 workflow compiler；[Hub cancelTask](../../../packages/team/team-hub/src/index.ts)只接受 lease-free pending task。

独占 scheduler 和拟新增 team-placement-default；Task 类型、Hub mutation、TeamRun 方法按 C2/C0 合入。不要将 provider 启动、credential 或 subprocess 逻辑塞进 scheduler。

## 冻结的任务意图

任务创建通过显式 resolve 固定 execution、placement constraints、required capabilities、workspace mode、review route、预算和 ranking policy/version。约束只能缩小创建者 grant；不能在 run() 内临时默认到某个本地 worker。

execution 预留 participant 和 WP05 child-team 两种明确分支。participant 分支沿用 lease；child-team 分支由 delegation owner 接管，scheduler 不能为它同时创建 participant lease。WP05 提交 child 分支的具体类型与消费者时再一并启用。

## Placement 流程

1. 读取 ready task 和完整分页 roster；过滤 active membership、角色、capability、允许 provider/model/preset/workspace、grant 和 Team/task 剩余预算。
2. 有合适 idle binding 时无需启动新 agent。没有时由 placement 选择可 provision/resume 的 descriptor，登记 task/revision 和 exact participant 的启动意图或等效可恢复绑定。
3. 在 provider 启动前预留 concurrency/cost；同一 Team/Participant 的并发启动合并到同一次合法操作，不能多次收费或发布不同 Session。
4. 使用 activation controller 取得 durable idle binding；provider 成功但 task 已取消或不再需要时，通过 owner 释放未使用 epoch。
5. scheduler 重新检查完整约束和 task CAS 后分配 lease，并等待 wake channel active 后 dispatch。
6. 无候选时记录具体阻塞原因。临时繁忙继续等待；没有可能生产者才触发 durable stall，不能偷偷改 provider 或降低权限。

## 排名

按 P1 固定 tuple：显式 owner proposal、最小 capability surplus、最低当前 load、同能力集合的完成次数减失败/过期/释放/取消次数、有限 median latency bucket、受成本约束时的 frozen rate bucket、ParticipantId。

历史来自 Hub durable stats，使用整数和配置桶。无历史候选在相同正向证据之后、负向证据之前；profile/version 固定在 Team rules。不要用浮点加权总分或当前 wall-clock 抖动参与比较。proposal 是提示，不能让不符合约束的成员成为候选。

## 单任务取消

| Task 状态 | 接纳后的行为 |
|---|---|
| pending | 无 provider 工作时直接 cancelled，保留原因和 actor attribution |
| review | 关闭或取消对应 review request/channel 后 cancelled，旧 review 回复不能完成任务 |
| assigned/running | 写入 exact revision/attempt/activation 的 cancellation request；保持非终态直到 owner ack 或精确 fence |
| terminal | 相同幂等命令返回原结果；不修改 immutable attempt result |

task-assignment Link 传输精确取消请求及结果；旧 attempt acknowledgement 不影响新 attempt。lease expiry 在取消意图存在时记载取消失败/过期的结果，不把被取消任务静默重新 pending。与 Team cancellation 同时发生时保留一致的最先合法意图和幂等结果。

## 模板和 workflow 角色

将 fixed local topology 解析为 versioned Team template：成员数量、角色、provider route、preset、初始 activation 策略和 review policy。默认仍是 coordinator 加 inactive worker；单模型成员配置走同样的 Team/Hub/closure 路径，不创建第二产品模式。

workflow 根据角色和任务约束解析 roster，允许多个 worker/reviewer；显式定义角色选择规则和不存在/歧义错误。单成员配置遇到自身无法满足的审阅或并行任务必须拒绝或 blocked，不偷偷加 worker。

## 实现拆分

第一片：placement 请求解析及本地完整路径。第二片：durable stats 和排名。第三片：单任务取消，包含 Link/Host/SDK/tool 同步。第四片：模板、workflow role 和 remote provider 组合。每片带 keyless 场景，具体顺序可在 C2 不变时调整。

## 验收矩阵与检查

覆盖两个 ready tasks 同时请求一个 participant、activation 成功后 task 取消、预算预留失败及释放、provider 缺失、policy 拒绝、scope 冲突、所有排名 tie、无历史候选、重启重复 drive、取消与 review/expiry/replace 竞态。

验证 local/SDK/ACP 相同任务语义；远程完整证明依赖 WP07，缺环境记录为 BLOCKED_ENV。默认 worker pool 的已通过场景必须继续通过。

```sh
pnpm exec vitest run packages/team/team-scheduler-dag/tests packages/team/team-run/tests packages/team/tool-team-task/tests
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless-team-run.snapshot.ts
```

新增 placement、cancel 及 Host/SDK suites 随实现加入；分别选择相关源文件证明逐文件覆盖率。交接解析后的 task spec、取消状态机、排名版本、模板样例、失败 code 和消费者调用实例。
