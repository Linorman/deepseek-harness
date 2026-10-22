# C3 事实与检查点证据

输入文件 hash 见 [c3-input-manifest.json](c3-input-manifest.json)，SHA-256 为
`4ec6befecd20789c9d08ecf8ee9c5365d631da21aa838aa18e93d9cd99e273fd`。
当前 Native stream 为 64，checkpoint manifest 为 3；Session 格式仍为 0，通用 SQLite schema 未改变。
临时文件、测试数据与编译产物均保存在项目中。

## 已验证行为

事实使用唯一 Native journal，严格 text schema，追加版本与精确 supersedes。
Native 派生 owner、记录时钟和 sequence；可知与生效使用各自的模拟时间条件。
成员和 director 只从 Native 保存的 context-view 读取获准版本，真实 Session 正文与该 view 相符。
belief、director summary 和真实 Channel report 保留各自来源，不自动成为事实。
伪造事实工具被拒绝，私密或未公告事实与不存在的请求都投影为 unknown。
旧 view 不被更正覆盖；新版本、半开区间、全部保留版本的 UTF-8 总量限制和新进程零推理恢复均有验证。
事实额度复用冻结的 maxKnowledgeBytes，未改变原 KB 写入的额度语义；完整查询超限拒绝，不能静默截断。

checkpoint 保存原领域 pin、定义和完整投影 hash，以及每条业务/事实/治理记录的身份、版本、sequence 和 hash。
原正文保留在 Native，不进入 manifest 摘要。
真实预约恢复覆盖缺失 schema、改变 schema、implementationRef 和 generation；均在推理前拒绝。
随后恢复原安装，仍可读取同一份原运行，证明失败恢复没有遗留 owner 锁或修改业务效果。

## 命令与结果

每条命令均设置 `TMPDIR="$PWD/.local/world-completion/tmp"`。

- `pnpm exec vitest run packages/simulation/simulation/tests/world-facts.spec.ts packages/simulation/simulation-local/tests/world-facts.spec.ts`：
  [15 passed](c3-facts-native-current.log)，包含双后端实际持久化及拒绝前原 prefix 不动。
- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-facts.snapshot.ts`：
  [2 passed](c3-facts-source-current.log)，各 14 次真实模型适配调用，恢复阶段 0 次。
- `pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-product/tests/collections.spec.ts packages/simulation/simulation-world/tests/execution.spec.ts`：
  [71 passed](c3-native-regression.log)。
- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-booking-version.snapshot.ts`：
  [4 passed](c3-booking-version-64-source.log)，公司/实验室 × JSON/SQLite，每例六个独立进程。
- `CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-booking.snapshot.ts examples/simulation-company/tests/world-booking-version.snapshot.ts examples/simulation-company/tests/world-facts.snapshot.ts`：
  [10 passed](c3-booking-facts-lib.log)，构建前置条件已执行。
- `pnpm run build`：[完整构建](c3-build-64.log)，Host/Client/Web 通过，197 个 client artifact。
- `pnpm exec tsx scripts/verify-export-jsdoc.ts`：[通过](c3-exports.log)。
- 最终完整构建：[通过](c3-build-final.log)；集成单测：[105 passed](c3-integrated-tests-final.log)；文档检查：[29 passed](c3-doc-sync-final.log)。
- 原招聘/自主请求回归：[source 16](c3-hiring-source-final.log)、[lib 12](c3-hiring-lib-final.log)。

初始构建 [c3-build.log](c3-build.log) 发生在治理类型导出尚未接线时，失败结果保留。
[c3-build-current.log](c3-build-current.log) 暴露了 Host Session 类型进入 Client 的问题。
共享服务定义改用既有 Session `/types` 和 Team `/schema` 纯入口后，Client 和完整构建通过；没有放宽类型检查。

## 保留缺口

仅勾选 F04。Norm 尚未生效；事实的成员/director 验证不能代替外部代表和用户投影验收。
治理 acceptance、close、wake 与 checkpoint 接线已存在，实际独立投票验收单独进行。
checkpoint 中尚无未实现的 Norm 和外部 registry，不能据此勾选 R01。
完整领域产品 DTO、双 SDK 拒绝策略、v1 场景和真实 provider 试验仍待完成。
原 75 项清单未改变，新清单仍保持 112 项。
