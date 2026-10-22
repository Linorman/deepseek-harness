# C3 治理提案、独立投票与结案证据

完整输入见 [c3-governance-input-manifest.json](c3-governance-input-manifest.json)，SHA-256 为
`59485a36707939e6cec99fcebf079f10277ded47fdf174172bae5ec8c8e37d0e`。
agent 新文件与精确命令另见 [c3-governance-agent-manifest.json](c3-governance-agent-manifest.json)。
当前 Native stream 64 拒绝 63 及此前 stream；checkpoint manifest 3 拒绝旧 manifest。
Session 与通用 SQLite 格式不变。所有中间文件和产物均在项目中。

## 完成边界

严格 proposal/vote schema 不接受 proposer、voter、binding 或 epoch。
Native 在实际 world/request acceptance 同一批次派生记录，冻结实际 committee electorate、各自 binding、正文 hash、目标 Norm 版本、scope、policy、quorum、阈值与 deadline。
Native 选择原提案正文与引用到 context-view，再从实际 accepted Decision 和真实 Session 消费证据派生每票主体。
director 通过原 Channel 消费请求，只能 apply 确认原件；不能改正文、票据、选项或结案结果。

投票业务键为 proposal 与实际 voter；同原件返回原票，改变 choice 或 source 拒绝。
成员关系变更不重写 electorate。unanimity、绝对 yes 阈值、quorum、no/abstain 和不可能阈值均由固定纯 Native 规则核验。
vote 要求模拟时间严格早于 deadline；close 等待窗口关闭，并在所有票齐、结果不可改变或截止后计算唯一 resolution。
resolution 与唯一 wake 在同一 Native append 批次保存；精确重试不追加。
checkpoint 记录 proposal、各票和 resolution 的原引用；冷恢复保持暂停且不调用模型。

## 验证

命令均设置 `TMPDIR="$PWD/.local/world-completion/tmp"`。

- `pnpm exec vitest run packages/simulation/simulation-local/tests/world-governance.spec.ts`：
  [30 passed](c3-governance-tests.log)。覆盖非成员、替人字段、旧 epoch/错 Session/未消费、错 hash/revision、正文缺失但伪造引用、已结案/截止投票、同票异选项、成员变更、空/不可达 electorate、quorum/no/abstain、早结案与窗口拒绝、重复旧 sequence。
- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-governance.snapshot.ts`：
  [4 passed](c3-governance-source-current.log)，公司/实验室 × JSON/SQLite，每例 39 次真实模型适配调用。
  两位委员各有独立 canonical Participant/Session，实际 Agent 使用 observe/stage/submit；三份原 request 经真实 Channel、director ack 和原 mutation，最终保留唯一 passed resolution/wake。
  同 close 重试不增 revision；每例新进程恢复 0 次推理，并比对完整原票据、请求、计划、结果、mutation 和 wake。
- `CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-governance.snapshot.ts`：
  [最新产物 4 passed](c3-governance-lib-final.log)，使用 plain Node，构建前置条件已执行。
- `pnpm run build`：[完整构建通过](c3-build-final.log)，Host/Client/Web 与 197 个 client artifact。
- root 接线：[lint 通过](c3-wire-lint-pass.log)；agent 新文件类型/lint 结果见其 manifest。
- 浏览器编译边界：[17 passed](c3-client-purity.log)，共享 Session schema/type 使用既有纯 `/types` 入口，Team schema 使用 `/schema`。
- 既有 Native/checkpoint/dispatcher：[71 passed](c3-native-regression.log)；事实/预约产物：[10 passed](c3-booking-facts-lib.log)。
- 最终共运行 Native/checkpoint/事实/治理/dispatcher/collection 六个文件：[105 passed](c3-integrated-tests-final.log)。
- 原招聘与自主请求继续通过：[source 16](c3-hiring-source-final.log)、[lib 12](c3-hiring-lib-final.log)，公司/实验室及双后端原身份、Persona、提交与冷恢复断言保留。
- `pnpm run doc-sync`：[29 passed](c3-doc-sync-final.log)。初次 27/29 的 source 链接与双语配对失败保留在 [原日志](c3-doc-sync.log)；生成目录并同步同一代码引用后全部通过。

## 未完成

勾选 G01–G05 和 G07。G06 继续保留：已有时间和早结案纯边界验证，但尚无自动 deadline 阶段调度。
通过不自动生效 Norm；G08–G11 的真实 enact、validated hiring policy、撤销和旧义务语义待开发。
G12 的 append/barrier/SIGKILL 故障矩阵尚未执行，冷恢复不能代替该矩阵。
场景使用 v0 compiler 的受信测试 composition，未证明 v1 作者输入、产品编辑器或双 SDK 新领域 DTO。
当前还不能宣布完整原设计 MVP 完成。
