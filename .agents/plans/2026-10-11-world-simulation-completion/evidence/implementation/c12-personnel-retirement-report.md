# C12 退休责任验收

日期：2026-10-12；Native stream 69。O14 已完成，整体 MVP 仍未完成。源码输入为 `personnel-retirement-unknown.spec.ts`，SHA-256 `567c5f511a8f04398916894cc22fb27b15ea659f944a27d324970badb4dfa9c5`；生产及测试输入见 [输入清单](c12-retirement-input-manifest.json)。准确命令、日志和范围见 [Root manifest](c12-retirement-root-manifest.json) 与 [执行者 manifest](../../../../../.local/world-completion/tmp/personnel-retirement-c12-manifest.json)。

JSON/SQLite 共 10 个真实 owner 测试通过：原 Controller 撤销 writer 后等待原 raw handle 的实际 dispose；期间原 writer 仍 charged，Team 原 Activation 未 quiescent，不能再启动 writer。只在实际 dispose 和原维护确认停稳后释放容量。测试暂停原实际 dispose，不替换停止证明。

超时测试调用 public Controller.close 并推进原默认 5000ms 计时器；stopOwnedActivation 本身没有超时。超时后保留原 writer、维护和 reservation，迟到实际停止仍可精确完成。卸载测试 await 实际 SimulationTeams plugin fiber.dispose；原停止未知时卸载尚未完成且容量未释放，实际停止后才卸载终态，并用原维护／取消命令对账。连接关闭另有独立测试，不冒称插件卸载。

原 Person／Session 恢复新 epoch 后，调用原 handle 的实际 health、保留的旧 status listener 和旧 stop 请求；当前 Agent 引用、完整 Team Activation binding 和 Native snapshot 均不变，当前 writer 仍 charged。整个 owner 单测没有模型调用。Controller 59 项及 checkpoint／Participant 40 项相关回归通过。该项证据为 source owner 测试；不声称这些单测通过 compiled lib 路由。

O17 的真实进程 SIGKILL 扩展矩阵随后完成，见 [崩溃恢复验收](c12-personnel-crash-report.md)。O15 重新入职／产品计数也保持未勾选。所有临时、日志和编译输出保留在项目内。

本批统一构建197 artifacts、完整lint含Host/Client类型检查、doc-sync29/29和diff whitespace检查均exit0；当前门禁及最终完成范围见 [检查记录](c12-final-checks.json)。
