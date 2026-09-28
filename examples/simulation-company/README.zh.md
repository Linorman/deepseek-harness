# 模拟公司

[English](README.md) | 中文

此显式启用的组合使用脚本化模型，通过真实 Agent 回合运行买方与供应商。他们请求一个库存单位，等待延迟投递、接受承诺、转移库存、发送证据并观察结果。角色 preset 只开放 Simulation 工具。

在仓库根目录运行无密钥场景：

```sh
pnpm run test:snapshot examples/simulation-company/tests
```

测试覆盖 JSON 和 SQLite，包括提案接受前／后及库存效果发生后终止进程、在相同 Session 中恢复。未接受的决策保留取消状态，由新决策重试工作；已接受的决策不重复推理。断言检查实际数量、承诺、投递回执、私有 profile 隔离与决策重试。先运行 `pnpm run build`，再设置 `CLOCKY_EXAMPLE_MODE=lib`，即可验证构建产物。

[场景](tests/scenario.ts)提供显式授权的决策输入。`executeDecision()` 仅在选定模型输入所属回合结束、提案被接受且 Session 已 flush 后返回。`run.snapshot()` 检查持久状态，`connection.drive()` 推进到显式时间界限，`run.setPhase('paused', revision)` 与 `run.setPhase('running', revision)` 控制准入。这些 API 不推断角色知识，也不自动选择决策。[开发计划](../../.agents/plans/2026-09-18-durable-simulation-coordination/development-plan.md)记录剩余验收与调度工作。

停用 Simulation 前，先暂停各 run，再关闭连接与 run，然后移除 Simulation 组合条目。保留 run、Team 与 Session 存储。旧二进制若拒绝保留格式或必读事件，应配套恢复一致备份；不要删除事件或改写版本标记来强行回退。

窗口场景让两个模型角色并发竞争最后一个库存单位。反转模型完成顺序不会改变 slot 接受与资源结果。收集中终止进程会保留旧 slot 的取消记录，并在 writer 恢复后使用新窗口重试。截止时间场景中断慢模型、保留已完成的后续 slot 提案，并恢复已记录的超时。冲突场景刷新观察或耗尽反复陈旧读取的重试，并在排队、领取和耗尽边界恢复。首次成功转移不会重复。ingress 场景在冻结窗口期间接收文本，并在接收、领取、上下文 flush、输入消费或接受后恢复，验证有序可见性及每条输入只形成一个已接受决策。

容量场景保留双角色窗口，同时将服务限制为一个模型流，验证 FIFO 推进，以及连接关闭时仍占用许可直到模型清理结束。

人口场景限制一个驻留角色，在延迟清理和进程终止期间保留其额度，并拒绝通过控制器直调用绕过。实体终止释放活体额度，不删除历史身份。

公司场景让供应商携带已回执输入休眠，在决策前恢复同一 Session。人口场景通过休眠 API 延迟拆除，并验证显式恢复不会启动推理。

[五角色采购场景](tests/procurement-scenario.ts)使用 CEO、Warehouse、Purchasing、Finance 和 Supplier，仅驻留两个角色。它检查工作时段准入、报价可见时间、资金／库存各自守恒、双重授权后的原子预留、定时收货付款、资金拒绝、逾期履约、逾期未交付、重复报价、原子调岗、休眠及预留／调岗后恢复。CEO 报告包含已验证的变化、阻塞依赖、风险、待决策事项、证据及下次更新时间。未完成场景保留已调度的更新唤醒；完成报告不再安排更新。财务与供应商的私有历史保持隔离。

存储基线测量持久文本输入（`--workload ingress`）或 Entity 资料更新（`--workload world`），不启动驻留角色、模型调用或 Team 消息投递。从仓库根目录运行：

```sh
pnpm run benchmark:simulation --backend sqlite --workload ingress --entities 1000 --operations 100000 --duration-ms 15000 --timeout-ms 120000 --sample-every 100 --entity-batch-size 100 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

`--replay-page-size` 显式限制工作进程与冷恢复进程的重放页大小。世界事件基准要求显式设置 `--world-batch-size`；每个原子批次仍为每次更新保留独立 journal 事件。`write-batch` 延迟统计整个批次，吞吐统计逐次更新。每次运行在持久数据旁保留原始延迟样本、进度、stderr、源码摘要及附硬件信息的 JSON 报告。`duration-ms` 在各工作阶段的操作之间停止；`timeout-ms` 终止超过总进程时限的子进程。时间预算耗尽或超时不证明已达到目标规模。报告区分已接受输入、已消费事件与未解决 wake，并以完整保留投影验证检查点恢复。

使用 `--workload actors` 并指定 `--residents`、`--models` 和 `--model-delay-ms` 测量脚本化认知。`--operations` 表示接受的决策数；每个决策通过三次真实模型／工具步骤完成观察、暂存空提案和提交。持久队列选择窗口，驻留管理逐出空闲角色并恢复其规范 Session。运行器按请求的工作量设置专用 Team 的参与者与激活历史上限。

`--workload actors-world` 先按显式 `--world-batch-size` 写入 `--world-events` 次 profile 更新，再在同一 run 中执行有界认知阶段。提名前按需绑定参与者；报告区分逻辑实体、已绑定参与者、已服务角色和实际并发。世界事件与决策目标均达到才算完成，冷恢复核对组合状态。

```sh
pnpm run benchmark:simulation --backend sqlite --workload actors --entities 40 --operations 80 --residents 20 --models 10 --model-delay-ms 100 --duration-ms 30000 --timeout-ms 180000 --sample-every 20 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

报告区分配置上限与实际模型／驻留峰值，并记录队列观测、启动／恢复次数和未获服务实体。脚本化 token 用量验证计费逻辑，不代表真实提供者的用量或成本。空提案决策不测量 Team 消息吞吐或业务效果。

`--workload messages` 测量 direct 频道环上的串行投递，要求至少两个驻留槽位和一个模型许可。每个操作包含发送者决策、到期 outbox 发布、接收者输入／回执持久化、读取 Envelope 的接收者决策，以及重复发布／接收探测。WAL 中 Envelope／回执数和物理 Session 输入身份必须与完成消息数一致。

```sh
pnpm run benchmark:simulation --backend sqlite --workload messages --entities 20 --operations 40 --residents 2 --models 1 --model-delay-ms 5 --duration-ms 30000 --timeout-ms 120000 --sample-every 10 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

报告版本 2 在原总时限内另启新进程恢复；只有重放一致且没有模型调用或发布效果时才报告测量成功。`result.restoreMs` 保留同进程耗时，`coldRecovery.restoreMs` 包含新所有者启动及恢复，`coldProcessMs` 包含进程启动和退出。串行投递测量不证明并发消息吞吐。

`--workload parallel-messages` 将并行发送者／接收者决策窗口接到有序 Team IO。每批使用互不重叠的发送者／接收者配对，完成到期投递，再只汇集同一时间／microstep／阶段的 wake，随后打开接收者窗口。要求至少四个驻留槽位，且 `models <= floor(residents / 2)`。软时限在完整批次之间检查；`transport` 延迟样本按批次记录，`message` 样本按完成消息记录。

```sh
pnpm run benchmark:simulation --backend sqlite --workload parallel-messages --entities 40 --operations 80 --residents 20 --models 10 --model-delay-ms 100 --duration-ms 60000 --timeout-ms 180000 --sample-every 10 --entity-batch-size 20 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

模型流并发运行；发布与回执仍遵循协调器的确定顺序。最后一个不足容量的批次只处理剩余消息数。

`--workload organization` 通过真实 Team 角色测量确定性工作指令，不调用模型或发送 Team 消息。`--entities` 包含员工、经理和部门；要求 `--operations = (entities - managers - departments) * days`。每天原子轮换部门经理；新请求使用当前组织关系，次日资源履约保留已接受承诺的原债务方。报告记录调岗、原债务方保留、待履行承诺、冻结上下文字节数、内存／磁盘增长及同进程／冷恢复。软时限在请求／接受组合与交付之间检查；未完成承诺保留于检查点。这一层不测量模型上下文压缩或消息吞吐。

```sh
pnpm run benchmark:simulation --backend sqlite --workload organization --entities 570 --departments 20 --managers 50 --days 30 --operations 15000 --residents 20 --duration-ms 60000 --timeout-ms 180000 --sample-every 100 --entity-batch-size 100 --replay-page-size 1000 --output .tmp-simulation-development/benchmarks
```

## 有预算的真实模型小样本

`live-model` 通过 OpenAI 兼容端点运行一个观察者决策，记录提供方报告的 token 与请求延迟，并验证不推理的独立检查点恢复。显式导出 `SIMULATION_MODEL_API_KEY`；基准不会加载 `.env`。运行前选定端点、模型、上下文上限、思考强度（`off`、`minimal`、`low`、`medium`、`high`、`xhigh` 或 `max`）、协议格式（`openai` 或 `deepseek`）与预算：

```sh
pnpm run benchmark:simulation --backend sqlite --workload live-model --entities 1 --operations 1 --duration-ms 30000 --timeout-ms 120000 --sample-every 1 --entity-batch-size 1 --replay-page-size 1000 --output .tmp-simulation-development/live --endpoint "$MODEL_ENDPOINT" --model "$MODEL_ID" --context-window "$MODEL_CONTEXT" --reasoning-effort "$REASONING_EFFORT" --thinking-format "$THINKING_FORMAT" --token-budget "$TOKEN_BUDGET" --tokens-per-request "$REQUEST_RESERVATION" --max-output-tokens "$OUTPUT_LIMIT" --max-model-calls "$CALL_LIMIT"
```

每次请求从 run 预算保留 `tokens-per-request`，再按提供方用量结算。这是准入计量，不是提供方账单硬上限：提供方可能超出保留量；样本随后失败并保留用量。输出上限发送给提供方；调用／token 准入额度耗尽或用量未知会阻止后续请求。缺失或为零的输入／输出用量不算成本测量完成。不从 token 推测货币成本。本地 HTTP 测试不算真实模型验收证据。
