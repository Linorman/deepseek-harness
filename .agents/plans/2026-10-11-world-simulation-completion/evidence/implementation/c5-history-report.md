# C5 制度更正、撤销与真实上下文历史

输入见 [c5-history-input-manifest.json](c5-history-input-manifest.json)，SHA-256 为
`c755672d152409709a0cd67f5f67331b63670f60d11673bd98839940224842d7`。
本次保留 Native stream 65、checkpoint manifest 3 和 Session 格式 0，没有增加生产工具或修改核心。
全部测试、编译及临时产物位于项目内。

## 真实流程

V1 经实际委员的独立 Agent/Session 投票、制度 request/Channel/enact、独立招聘审批及实际入职。
V2 是新提案、新独立票据和新 enact：获准委员当天可知私密正文，实际生效在未来。
低权限新人在生效前后分别以普通真实 Agent 决策读取背景，全部 Session 和模型输入均无 private canary。
Native 在原模拟边界切换硬授权；授权角色分别观察 scheduled 与 effective 版本。
V3 再经实际提案/独立投票/revoke，立即撤销而 availableAt 在未来。
公告前硬规则已撤，新人尚未获新正文；到实际 availableAt 后其真实 Session 才可读取公开撤销文档。
公告、可知、消费与理解没有被混作同一状态。

每次普通 probe 都核对实际 canonical Session 中原 context-view、唯一 entered user input 和 sequence 顺序，并执行 flush。
普通非 World 决策没有 Native World consumption receipt；测试核对实际 Session 证据，不构造该 receipt。
每份旧 context/view/source/consumption、原 hash、旧 Norm/votes 和合法 hire/result/assignment 保持精确原件。
结束后 checkpoint、新进程恢复保持 paused，原三版本、两 closure、所有票据与入职记录一致，模型调用为 0。
模型只从真实已记录 operations.material/background 获取原引用，适配器不读取 Native 来伪造已知 IDs。

## 命令与结果

命令设置 `TMPDIR="$PWD/.local/world-completion/tmp"`，保持原 microstep/模型额度。

- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-history.snapshot.ts`：
  [4 passed](c5-history-source-final.log)，公司/实验室 × JSON/SQLite，312.54s。
- `CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-history.snapshot.ts`：
  [4 passed](c5-history-lib.log)，相同四组合，plain Node，264.90s；构建前置条件已执行。
- 编译 `[MessageId]` 与 `[SimulationInputId]` 的比较改为原字符串比较，未 cast 或伪造 proof。
  最后纯类型注解格式修复前后 emit JavaScript 完全相同，见 [字节检查](c5-history-format-runtime.log)；原 runtime 断言未减少。
- 根完整构建：[通过](c5-build-fixed.log)，197 client artifacts；原失败只在 fixture 的跨 namespace 类型比较，见 [原日志](c5-build.log)。

## 验收范围

勾选 F02/F03/G11，清单现为 25/112，未增加条目。
v0 受信测试 composition 不等于 v1 作者入口；完整领域 API/双 SDK/产品 UI 和外部代表观众仍待完成。
本报告的普通冷恢复不代替 G12 的 append/barrier/SIGKILL 故障矩阵，后者独立记录。
