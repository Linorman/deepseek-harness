# P0-01：接手生命周期加固与资源收尾

主责：生命周期程序员。归属：[WP01](wp01-lifecycle.md)，覆盖 G01/G26/G27 的 controller/workspace 部分。与 P0-02、P0-03 并行；生产源码独占 packages/team/team-activation-controller 和 packages/team/team-workspace-recovery。Hub 修改交给 P0-02，类型和生成物由 P0-04 集成。

## 输入与第一步

先读[当前状态](current-state.md)、[共享约定](contracts.md)、[controller](../../../packages/team/team-activation-controller/src/index.ts)和[workspace recovery](../../../packages/team/team-workspace-recovery/src/index.ts)。已有首轮 recoverClosure/fencedAt 实现，不从零另写恢复器。

两包加固已进入主工作区，Root 的七套测试共 124 项通过，选定两包逐文件四项覆盖率为 100%。接手当前共同源码，保留本轮 hash 和实际消费者集合；不要重新应用 .tmp/lifecycle-coverage-baseline 的旧增量。后续优先处理 P0-03 真实资源故障场景暴露的问题，并在 Hub 约束变化后复验。

## 必须交付的行为

| 工作 | 明确结果与拒绝条件 |
|---|---|
| recovery 授权 | 请求、proof、返回 Team、participant、epoch 属于同一对象；Team A 的有效 proof 不能恢复 Team B；异步等待后重新确认 |
| 关闭中的已接纳工作 | close 同步拒绝新工作，但保留已经进入 stopping/cleanup 的 proof，直到处置完成；不能先撤销再使自己的收尾失败 |
| activation 发布失败 | durable bind 后 onStatus/订阅失败时，通过已绑定 entry 的 owner 清理；成功释放后保留 offline/quiesced 事实；原始失败与 cleanup 失败聚合报告 |
| 清理重试 | cleanup 未确认时保持 stopping 和可重试 owner；后续 dispose 可完成；不能提前删除 allocation/authority 或重复破坏资源 |
| 晚到响应 | 旧 phase/health 响应不覆盖已更新 binding，不把 offline 复活成 stopping；CAS 冲突重读后使用新 proof |
| workspace read retry | 可恢复读取失败有有限重试，即使无新事件或 pulse 也能继续；格式/权限等永久失败不吞掉；close 等待已接纳任务 |
| 配置边界 | attempts、delay、容量和 timer 上限显式校验；不允许 Node timer 溢出造成忙循环；配置进入 README/catalog |

上表是需要持续满足的验收条件，已有加固实现可以复用；只有当前版本证据不足或新场景暴露缺陷时才补实现。无需另写恢复器或重构整个 controller。

## 实施顺序

1. 锁定当前 Team/Hub/Core 消费者基线，重放已有 recovery-admission、closure-recovery、edges 和 workspace 测试，记录当前失败。
2. 确认 scope 在异步调用前保留不可变身份，校验点位于实际读取/提交边界。使用实际 Hub-issued proof 测试跨 Team 和 stale cursor，不能伪造私有 registry。
3. 审查 activation bind、订阅、lease 发布、dispose 的所有失败窗口。建立每个窗口的 durable binding、live handle、allocation、proof 所有者表。
4. 覆盖 shutdown 与 policy/health/activation/fence 等待相交；每个已接纳分支都完成或给出精确未确认结果，其他 cleanup 不能因一个异常跳过。
5. 对工作区 read/confirmation 的瞬时错误和永久错误分别验证，测试无 pulse、队列满、重复事件、关闭时排队和已释放确认重试。
6. 重算两包逐文件 coverage，再纳入使用它们的 closure bridge、TeamRun、Agent Client、Hub 场景。用实际缺失行为补测试，不依赖过时行号清单。
7. 更新两包 README、owning Note、必要 JSDoc/双语；将 config/type 增量交给集成人统一生成和验证。

## 验证要求

起步命令从接手的工作区根执行：

```sh
pnpm exec vitest run packages/team/team-activation-controller/tests packages/team/team-workspace-recovery/tests
```

完整覆盖率以该工作区当前 Vitest 配置和 consumer 文件集合执行，四项达到每文件 100%。已通过的两包测量不替代最终 Hub、closure bridge、TeamRun 和真实进程组合验收；输入变化后按实际影响重跑。

对未覆盖 guard 先判断它是否在真实 parser、durable、queue、process 或生命周期边界。删除确实由同进程类型/不变量保证的重复检查需解释保证者；保留必要 authority 检查，不能通过损坏私有 Map、伪造不可能 union 或增加笼统 ignore 凑百分比。

## 完成与交接

交付两包的最小补丁、当前基线与文件 hash、明确资源处置表、全部新增红绿场景、最终 coverage、focused lint/typecheck 和双语记录。把需要 Hub 修改的复现交给 P0-02，把真实进程窗口交给 P0-03。集成到共同版本后重跑关联场景才算本任务完成；独立 worktree 测试通过时标 READY_FOR_INTEGRATION。
