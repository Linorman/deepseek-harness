# Simulation 自动执行验收

范围：实施计划 E08、产品设计 S5，以及执行相关的第 4.3、5 节。覆盖现有采购模型／确定性策略和受信任三 actor、双频道报告工作流；不放开任意外部副作用。本文记录当前证据位置与本轮执行结果，主计划状态由协调者维护。

## 故障与恢复矩阵

| 要求 | 现有实现与回归 | 本轮补齐与结果 |
|---|---|---|
| 目的端任务已落盘，源 receipt 未返回 | [产品进程场景](../../examples/simulation-company/tests/product-task.snapshot.ts)的 `created`；规范 Team 幂等任务身份 | 三 actor 工作流 `created` record／replay 已通过；同任务 ID、创建操作 ID，不重复创建 |
| execution link 后、assignment 前 | 同场景 `reserved`；[原生关联回归](../../packages/simulation/simulation-local/tests/task-execution.spec.ts) | 三 actor `reserved` record／replay 已通过；旧关联对账、新 epoch 与规范 attempt 次数分别检查 |
| assignment 后、input 前 | 同场景 `assigned`；精确原 attempt 与交付责任 | 三 actor `assigned` record／replay 已通过；无第二个有效旧 attempt |
| input 持久化后、认知前 | 同场景 `input`；输入和 Session 前缀先记录 | 三 actor `input` record／replay 已通过；旧取消证据、新输入／decision、零模型请求 |
| proposal 提交后、window 提交前 | Native 有序窗口与恢复取消规则 | 三 actor `submitted`／`window` record／replay 已通过；恢复不自动接受旧提案 |
| 效果已执行、结果 receipt 前 | 同场景 `effect`；采购 transfer continuation | 三 actor report continuation 与 `effect`／`result` record／replay 已通过；只复用原报告和匹配的持久接收证据 |
| 目标结果持久化后、reconcile 前 | 同场景 `settled`／`observed`；[executor 对账](../../packages/simulation/simulation-product/tests/task-executor.spec.ts) | 三 actor `settled`／`observed` record／replay 已通过；旧目标完成不重复结算或报告 |
| 没有 interaction 或错误关联 | 原生来源、执行者、窗口、交互和承诺验证 | 三 actor 普通报告无需 interaction；报告 selector 的错误运行／任务／执行者／participant／Session／操作／context 指纹、旧 epoch／ordinal、缺失及错误交付回执拒绝且不追加日志；JSON／SQLite 已通过 |
| 旧 epoch／attempt 迟到 | 物理 writer 退役与来源 proof fencing | 新 epoch 不能借旧 epoch 预约；旧结果与审核精确重试只作用于原 attempt，真实返工后当前结果保持不变；取消 fence 后迟到提案拒绝。JSON／SQLite 已通过 |
| review／rework／cancel／maxAttempts | [工作流审核](../../packages/simulation/simulation-product/tests/task-scenario.spec.ts)、[审核权威](../../packages/simulation/simulation-team/tests/task-review.spec.ts)、[多步骤](../../packages/simulation/simulation-product/tests/task-executor-progression.spec.ts) | 新场景返工交错、真实 pending／assigned／running／submitted 取消及次数耗尽已通过；已提交窗口在取消 fence 后拒绝接受，保留先前已受理效果。真实模型 task 的 token／compaction 准入在 active writer 清理前拒绝；无新费用／模型调用。取消源级10项通过，完成仍由生产 executor 产生 |
| checkpoint 与关联／交付并发 | checkpoint 关闭准入、排空并核对所有者 | 三 actor 两频道的关联／交付并发采集 JSON／SQLite 4 项已通过；完整记录或明确失败 |

显式债权人确认、资源转移与 `task-completed` 必须分别验收，不能以 Team 任务完成越权满足其他策略。测试 helper 仅暂停真实提交点或终止进程，不直接制造任务完成／业务结果。

## 浏览器与交互矩阵

| 维度 | E08 所需证据 | 本轮结果 |
|---|---|---|
| 实际执行与只创建模式 | 真实 Loader、scheduler、executor、交付与审核；未配置 executor 清楚标明能力 | 三 actor 双频道实际报告／独立审核的 JSON／SQLite 已通过；现有 catalog executionMode 标明只认知与自动任务 |
| 原操作结果与失败 | 审核响应丢失、原请求发现／查询／重试、后来编辑保留；失败和空集合分开 | 审核响应丢失／查询，取消响应丢失／查询失败／同原 payload 重试终态，以及后编辑 draft 保留，JSON／SQLite 已通过；持久原请求发现／Host 进程恢复由 D07 真实进程矩阵覆盖 |
| 状态与权限 | 审核目标变化、认证撤销、重连、暂停仍有收尾；禁止越过场景来源／审核人 | 真实返工改变版本后旧取消 draft 必须显式确认 fence。实际认证退休在重新认证前删除私有 dialog／draft；原 cookie 请求401，当前认证重开原任务为 cancelled 且理由空白。禁止替换 buyer／supplier 为第三 reviewer，以及 paused 审核／cold recovery，分别由[已运行工作流](../../apps/web/tests/simulation-task-workflow.snapshot.ts)和[审核浏览器](../../apps/web/tests/simulation-task-review.snapshot.ts)覆盖；link／delivery／取消收尾并发暂停的完整责任由本轮 source tests 覆盖 |
| 数据与导航 | 空、单条、跨页、长 ID／文本、局部加载失败、前进后退及草稿保护 | 空初始审核、两条真实报告／pageSize1 跨页，失败 continuation 保留原行和 alert；长运行名称、操作 ID 与私有理由可读，关闭保留输入，JSON／SQLite 已通过 |
| 输入 | 键盘、中文 IME、重复提交、Escape、关闭和返回焦点；inspector 不锁住焦点 | 审核／取消 native dialog 的 Tab、Enter、Escape、焦点隔离及返回，取消 composition 期间点确认不产生请求，后续显式取消的网络重试复用原 ID，JSON／SQLite 已通过；inspector 导航由 C 浏览器矩阵覆盖 |
| 语言、主题与尺寸 | 中英、明暗、reduced-motion、桌面／短窗口／窄屏、真实 200% 浏览器缩放 | 每后端审核16条件与取消16条件均通过：locale2×theme2×1440×1000／1280×480／390×844／1440×1000 native factor2；共64组证据，均 reduced-motion |
| 语义与对比度 | 表头、状态播报、字段错误、icon-only 名称及实际渲染对比度 | native dialog 名称、可见状态／网络错误与实际渲染文本 contrast、document 横向边界、控制名称逐组测量；两后端通过 |

## 执行记录

本轮已完成 JSON／SQLite 22 项真实进程断点的 record 与 replay，以及原报告 continuation、实际任务取消、关联／送达并发检查点、旧审核／结果 fencing 与尝试上限的源级回归。TS／Python 两个 SDK owner 的实际冷恢复、冻结输入与原报告证据各 2 项，以及三种履约策略各 2 项，共 10 项已完成 record 与 replay。随后增加实际持久 Session 的输入 decoder，并重放两个 SDK 与原执行器共12项通过。完整审核／取消浏览器矩阵4项已通过。旧快照和 helper 构造状态不能替代本轮真实运行证据；coverage 百分比不作为本轮功能完成依据。

本轮原生执行证据：[真实进程故障场景](../../examples/simulation-company/tests/task-workflow-fault.snapshot.ts)、[报告 continuation](../../packages/simulation/simulation-product/tests/report-continuation.spec.ts)、[实际取消](../../packages/simulation/simulation-product/tests/task-cancellation.spec.ts)、[检查点并发](../../packages/simulation/simulation-product/tests/execution-checkpoint-concurrency.spec.ts)、[返工与旧结果 fencing](../../packages/simulation/simulation-product/tests/report-rework-fencing.spec.ts)。

SDK／履约命令：`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/sdk-execution.snapshot.ts examples/simulation-company/tests/sdk-execution-python.snapshot.ts examples/simulation-company/tests/task-fulfillment.snapshot.ts`；本轮 3 文件、10 项通过。TS／Python 均启动真实 SDK Server，保存完整检查点后退出并重新打开进程，显式恢复与推进；新输入的原 report selector、创建操作与 context fingerprint 从已记录冻结上下文读取，最终审核仍通过规范 participant 权限。`explicit` 必须由债权人确认，`transfer` 以已应用转移兑现，`task-completed` 以关联规范完成兑现；执行者确认或普通任务完成不能替代显式债权人确认。

Session 镜像：同次真实 SDK 执行由 test fixture 读取原 actor 的 Session persistence 前缀；[TS owner](../../examples/simulation-company/tests/sdk-execution.snapshot.ts) 以 `Session.create` 重建 messages 并验证 typed `simulation/context-view`，实际 required input 含原 selector；[Python owner](../../python/sdk/tests/simulation_execution_snapshot.py) 通过 SDK `validated_coordinator_event` 解码真实持久事件，验证同运行／buyer 作用域与原 selector，不生成模拟 Session 通知。两 owner 均要求原 prepared view 与已记录事件 data 完全相等，Session header 的 Team／participant／Session 与原 task source 精确一致。`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/sdk-execution.snapshot.ts examples/simulation-company/tests/sdk-execution-python.snapshot.ts examples/simulation-company/tests/task-executor.snapshot.ts` 共12项通过；日志 `.tmp/e08-sdk-history-replay.log`。最终 exact view／header 加强后两个 owner 4项回放通过，日志 `.tmp/e08-sdk-history-exact-replay.log`。

浏览器命令：`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/simulation-task-execution-matrix.snapshot.ts`；使用协调者已成功构建的33186产物，4项通过，日志 `.tmp/e08-browser-matrix-cancel-run.log`。截图与逐组 contrast／viewport／nativeZoom JSON 在 `.tmp/e08-browser-matrix/{json,sqlite}` 与 `.tmp/e08-browser-cancel/{json,sqlite}`。取消针对真实已送达报告的后续返工 attempt；需明确确认改变后的 canonical revision，再用单任务权限提交，结果终态仍保留报告2、库存2及零模型请求。

身份退休补充：`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/simulation-task-execution-matrix.snapshot.ts -t 'retains exact public cancellation'` 两后端2项通过，日志 `.tmp/e08-browser-auth-run.log`；先验证真正 retired 身份的私有 draft 已被删除及旧 HTTP cookie401，再安装当前认证并重新加载／读取原 cancelled 任务。普通响应丢失保留 later draft，真实身份退休清除它，两者不混用。

取消准入补充：`pnpm exec vitest run packages/simulation/simulation-product/tests/task-cancellation.spec.ts` 10项通过，日志 `.tmp/e08-final-source-rejection.log`。实际 submit 返回与物理停止被持有期间，原 slot 保持 submitted；规范／Native 取消已落盘后 `commitWindow` 拒绝且不改 revision。模型任务在真实 prepared inference 与 active writer 状态下，取消阻断 model／compaction token 准入，已受理费用计数不变；并发检查点等待清理后完成。报告来源拒绝2项通过，日志 `.tmp/e08-source-rejection.log`。

本记录的11行执行故障／拒绝、三种履约、两个 SDK 输入 owner，以及新增场景审核／取消的完整显示与恢复路径均已取得本轮证据。Team 和 Simulation 全产品页面／只创建模式／inspector／行政管理分别由其 owning acceptance 记录负责；完整产品验收不能仅凭本记录宣称通过。
