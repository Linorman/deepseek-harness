# WP01：生命周期恢复与 P0 验收

主责：生命周期程序员。负责 G01/G26/G27。前置：WP00 共同基线。下游：所有 P1 工作包。必读[接口 C0/C3/C5](contracts.md)、[P0 规格](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p0-safety-closure.zh.md)和[防御模式](../../../docs/defensive-patterns.md)。

当前可交接范围已细分为[P0-01 生命周期加固](p0-01-lifecycle-hardening.md)、[P0-02 Hub 验证](p0-02-hub-validation.md)、[P0-03 真实组合](p0-03-assembled-verification.md)和[P0-04 集成放行](p0-04-integration-gate.md)。本页保留完整目标和矩阵；接手人依[当前状态](current-state.md)复用已合入实现，不能将下列完整步骤全部当作尚未开发。

## 当前基础与需补行为

[closure driver](../../../packages/team/team-closure-driver/src/index.ts)和[Hub bridge](../../../packages/team/team-closure-driver/src/hub.ts)已经接入；[Hub](../../../packages/team/team-hub/src/index.ts)保存 complete/fail/cancel intent、独立 final admission，支持 missing-final 和预算 stall。[activation controller](../../../packages/team/team-activation-controller/src/index.ts)已有 recoverClosure 和 exact fencedAt 处理，bridge 在恢复改变 cursor 时重新读取；[workspace recovery](../../../packages/team/team-workspace-recovery/src/index.ts)处理 release-requested。

首轮代码已补充失败业务资源收尾及旧 epoch 恢复；待集成加固覆盖异步 recovery 授权、关闭时保留 proof、发布失败清理和有界 workspace read retry。仍需以真实组合逐项验证未标记 offline/release-requested 的进程崩溃，以及 failure intent 与 task/workflow/human action 交错窗口。源码显示可能等待不是证明所有窗口必然挂死；已满足窗口保留证据，不重复改写。

## 代码归属

工作包整体覆盖 closure-driver、controller、workspace recovery 与新增生命周期场景。当前子任务按 P0-01/02/03 的独占范围执行；closure bridge、TeamRun、TeamAgentClient 的关联变化由 P0-04 登记方法后合入。Hub/type/schema/fold 的合入次序由 WP00 管理，不新增第二个运行循环。

## 拟议资源处置模型

每个 durable closure intent 的资源集合从 Team/task/activation/allocation/human-action/workflow 事实导出，不能从进程 Map 推断完整集合。一次 drive 选择有限批次，每项处置带 exact id、observed revision/epoch 和结果：requested、released、preserved、unconfirmed，必要时附结构化原因。

本地进程丢失、owned subprocess、外部 cooperative endpoint 使用不同证明。没有精确持久 host/process owner 的旧 epoch 不应被猜成 offline；在可证明的本地恢复范围之外记录精确 stall，跨主机扩展由 WP07 提供。reserved/active allocation 不因目录存在就恢复或删除；通过 provider metadata 恢复或保留。

failure 路径定义未开始任务、review、workflow、人类请求的终态原因；已执行 attempt 保留结果与失败事实，不能覆盖历史。取消任务与取消整个 Team 共用 settlement 规则，但保持各自授权和 idempotency key。

## 实现步骤

1. 建立资源处置表：每种资源的 durable owner、当前 live owner、恢复入口、无法证明时的错误和最终 phase。确认所有非终态资源都有生产者或有明确 stall。
2. 给缺失窗口添加初始失败测试：intent 后立即杀 Host、stopping 未 offline、allocation 仍 active、release 已执行未确认、fail intent 仍有 pending task/action。
3. 让 closure drive 先记录有限的处置意图，再在锁外调用 owner，最后以最新 fence 回写。对 coalesced events、pulse、重复 startup 维持单 flight。
4. 添加 startup recovery 所需的窄 proof：只重建已经 durable 接纳的 closure，不得创建新 final、恢复普通 stalled Team 或修改无关任务。
5. 关闭失败路径的资源遗漏。所有接受分支 settle 后才抛 AggregateError；observer 异常只记录，不使其他分支跳过。
6. 按 C0/C5 先完成 WP01-result：当前已授权 TeamRun 的最小 durable final admission 事实独立于 intent，收尾据此修复 receipt。完整 principal inbox 在 WP08；P0 不等待 P1，也不扩大现有 human authority。
7. 核验 wall-time 无新 mutation 也可触发；并发容量暂时用满只排队，不能被判为永久预算耗尽。
8. 补齐实际未覆盖行为；若某分支来自无必要的同进程防御，依照类型和当前约定删除该分支，不编造 hostile-object 测试凑覆盖率。

## 故障矩阵

| 故障窗口 | 必须观察到的结果 |
|---|---|
| intent 未提交前失败 | 无 closure authority，原状态不被伪造结算 |
| intent 已提交、Host 被 kill | startup scan 找到工作，不依赖旧 TeamRun proof |
| task 仍 running，controller Map 消失 | owner 证明、fence 或精确 stall；不能永久无解释等待 |
| release 成功、确认 append 失败 | 重试不重复破坏资源，保留同一 allocation provenance |
| failure 有 pending/review/workflow/action | 每项有 durable 处置结果，不阻塞在无生产者状态 |
| final sink/receipt 任意一处 append 失败 | 不提前 completed，不遗失已经持久接纳的 final |
| provider 终止无证明 | REMOTE_CANCELLATION_UNCONFIRMED 或对应 typed stall |
| 一个 cleanup/observer 失败 | 其他已接纳分支仍被等待，最终报告全部失败 |
| cancellation 与 accepted final 并发 | 只保留一个合法 closure 分支，重复操作返回一致结果 |
| HMR/关机与 drive 并发 | 停止新接纳，已接纳 proof 持续到操作完成后撤销 |

JSON 与 SQLite 都运行持久故障矩阵。需要真正 kill 的场景使用独立进程与明确同步点；禁止用 sleep 猜测窗口，禁止测试提前把全部 epoch 标为 offline 来绕过关键失败。

## 验证入口

```sh
pnpm exec vitest run packages/team/team-closure-driver/tests packages/team/team-activation-controller/tests packages/team/team-workspace-recovery/tests packages/team/team-hub/tests/closure-authority.spec.ts
pnpm exec vitest run packages/team/team-closure-driver/tests --coverage --coverage.include='packages/team/team-closure-driver/src/**/*.ts'
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/team-channel-view.snapshot.ts
```

上述是现有入口，新增跨包场景随实际文件补入命令。coverage 选取与实现相关的全部 owning tests；package-only 数字不能替代聚合证据。Session 生命周期变化同时更新 TypeScript JSON-RPC 示例及 Python 单文件运行时快照，路径见[测试规则](../../../docs/testing.md)。

## 提交与交接

建议三个可构建切片：资源模型和故障证明；恢复/结算实现；P0 组装与覆盖率。每个行为切片自带必要测试，不把所有测试拖到最后。

交接 C0 资源处置接口、每类恢复证明、无法自动恢复的精确条件、JSON/SQLite kill-point 输出和当前提交 coverage。P0-AUTH/LEASE/VIEW 的现有实现也须在同一基线核验；不得以本包测试代替它们。
