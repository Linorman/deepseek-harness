# P0-03：真实 Loader、重启与双 SDK 组合验证

主责：系统测试程序员。归属：[WP13](wp13-system-verification.md)协作 WP01 的 G27 与 G26。独占新 Headless/SDK 场景和测试故障编排，产品漏洞交 P0-01/P0-02 修复。先读[测试策略](../../../docs/testing.md)和[当前状态](current-state.md)。

## 接手已有场景

当前主工作区已有 [final-lifecycle](../../../examples/headless-agent/tests/final-lifecycle.snapshot.ts)、[final-restart](../../../examples/headless-agent/tests/final-restart.snapshot.ts) 和 [terminal-restart](../../../examples/headless-agent/tests/terminal-restart.snapshot.ts)。它们通过正式 Loader、TeamRun、实际 Link、controller、closure driver 和真实 JSON/SQLite 存储验证生命周期；keyless 模型仅替代外部模型服务。

Final 场景覆盖 TTL 拒绝与替换、intent/sink/receipt 三个进程崩溃窗口和第三次独立冷读。Failure/cancellation 场景覆盖 intent 与 durable quiescence 后崩溃：无证明时明确 stall，有证明时恢复 failed/cancelled；未读 human 消息通过 expiry 结算，不制造 final admission 或 human receipt。正式 tsdown 入口和 HMR 关闭修复已合入，不再重复补临时 lib 文件。

[Workspace release restart](../../../examples/headless-agent/tests/workspace-release-restart.snapshot.ts) 已覆盖实际 provider 释放后、Hub confirmation 写入失败时的进程丢失；新的 Loader reconciliation 重试确认且不重复物理清理。[Review terminal restart](../../../examples/headless-agent/tests/review-terminal-restart.snapshot.ts) 已覆盖真实 worker report、consult delivery 和 running reviewer 后的失败/取消重启，保留 attempt/result/request 历史并准确识别未确认 epoch。

正式 UserQuestions/ApiProxy 产生的 pending human question、公开取消及 intent 后 Host loss 已有场景。真实受限 write 产生的 approval producer、其 SQLite 扩展和 failure/cancel Host-loss 四场景也已合入并通过共同版本 src/lib 验证。后续补 workflow 和多资源并存的失败收尾，以及 intent 提交前丢失 Host 的无授权负向验证。每次接手使用[当前证据](current-state.md)识别哪些源码与运行模式已验证，不能重复制作已通过的单资源场景来代替缺失组合。历史全仓 HMR 时序失败与尚未确定的原因继续单独保留。

## 本轮应完成的矩阵

| 场景组 | 注入窗口 | 必须观察 |
|---|---|---|
| Final result | intent、sink、receipt 各次 append 前后 | 无提前 completed、无伪造 human sink、合法重投一份接纳事实 |
| TTL 与替换 | expiry durable 后，及仅 deadline 已到但尚无 expiry | 两者语义不同；无效 final 不占 key，replacement 可完成 |
| 资源恢复 | closure intent 后 kill、stopping 未 offline、active allocation | 新进程恢复或精确 stall，不能靠已丢失的 Map/原 TeamRun proof |
| 释放确认 | provider 已释放、确认 append 失败 | 幂等恢复，exact allocation provenance 不丢失 |
| Failure cleanup | pending/review/task/workflow/human action 并存 | 每项有 durable 处置，历史保留，无无生产者等待 |
| 关闭竞态 | dispose 与 delivery/activate/fence/policy 相交 | 关闭新接纳，已接纳工作 settle；所有分支结束后汇总错误 |
| 双 SDK view | channel-only 及 task/review context、重排 JSON key、重投 | TS/Python 接收同一内容/provenance，Session flush 先于 receipt |

JSON/SQLite 的持久化窗口均需覆盖。纯 adapter、真实同机子进程、独立 Host 重启和双主机是不同证据层级。本轮关闭本地 P0 的真实进程窗口；双主机完整矩阵和外部 supervisor 仍归 WP07/WP13。

## 实施方式

1. 先核对共同源码中已有场景与本次新窗口的覆盖范围，复用真实 producer 路径；新切片同时保留 src 与正式构建产物的 replay 证据。
2. 为故障窗口建立具名同步点：实际 append 已提交、provider 已确认、Session 已 flush、receipt 尚未提交。等待可观察事件或 cursor，不用固定 sleep 猜测竞态。
3. 通过正式 Loader/bundle 启动与恢复。外部模型可用现有 keyless replay 代替，但 Hub、日志、Link、controller、workspace 和进程关系保持真实。
4. Kill 后创建独立进程、独立 runtime，读取原持久状态；不复用同一个对象实例充当“重启”。确认没有遗留子进程、watcher、socket 或 allocation。
5. 复用已有两 SDK 16 场景 channel-view 语料，缺少的场景扩展同一来源；不复制两套含义逐渐漂移的 expected 数据。
6. 新增 snapshot 的 expectation 由真实场景生成后人工审查，再以 replay 模式复验；不能手写一个期望成功的终态文件代替运行。

## 交付与验收

交付各窗口的 scenario id、实际 provider/数据库/运行模式、精确命令、成功与失败/跳过数、durable 断言、退出证明及 artifact。必需场景遇到环境缺项，写出具体依赖和解除方法，保持 BLOCKED_ENV；不把跳过作为 PASS。

本任务完成要求当前共同源码的 src/lib 新场景、已影响 Headless/SDK 场景和 P0 真实进程矩阵通过。实际产品修复合入后重新跑受影响行；P0-04 负责整合为同一基线的放行记录。
