# P08：原通知、Envelope 与持久消费验收

2026-10-13，Asia/Tokyo。P08 完成。Native86/compiler9 未改变；本项校验既有原发布元数据，不迁移或补造历史。

## 修复与边界

原接收路径只比较 direct-v4 渲染消息和 Envelope 位置。渲染有意省略 trace、correlation、audience 等发布元数据，因此这些字段变化后仍可能写入接收者输入。`trace-reproduction.log` 记录关闭新校验后的真实双后端反例：篡改 traceId 时 receive 返回成功，两项预期拒绝断言失败。最初 `trace-before.log` 因筛选字符串未匹配而全部跳过，不作为证据。

[统一校验](../../../../../packages/simulation/simulation-team/src/accepted-envelope.ts)在实时接收、checkpoint 与 writable restore 中核对：原 Native receipt、accepted decision/closedAt、due simulated time、canonical sender/recipient、原 Team/Channel/Envelope/sequence、完整 payload、audience、fingerprint/trace 和 accepted-operation correlation；额外 task/causation/lifetime 元数据拒绝。Hub 自有的优先级和接受时间不由模型投影重建。实时拒绝发生在输入准入前；恢复拒绝发生在授予可写运行资格前。

消费仍独立证明。发布 receipt、持久 inbox 与 Session entered input 不等价。实际补证测试证明导演已消费原 request 通知，而新 revision 只持久排队时，即使新 context/control input 已进入 Session，真实三工具 submit 仍被拒绝，Native snapshot 完全不变。随后从真实 inbox 消费并 flush 同一通知，原 staged 提交可继续完成原案件招聘和冷重放；没有篡改已持久历史或伪造成功证明。

## 证据

[日志与原件](../../../../../.local/world-completion/thread-01a1336a-notification-proof)均保存在项目内。

| 检查 | 结果与原件 |
| --- | --- |
| 原请求投递与消费 | `notification-after.log` 28 passed；覆盖原 Hub proof 的 operation/recipient、复制 requestId、错误 hash/Envelope/sender/sequence/Channel/trace/correlation/audience/kind、无原消费及上下文准入 |
| 保留目标校验 | `target-validation.log` 22 passed，含双后端 live metadata 拒绝与原 target validation；篡改拒绝后精确原件重试通过 |
| 持久、时间、恢复相邻回归 | `lifecycle-final.log` 47 passed；未到 deliverAt 拒绝、持久 flush 失败、重复消费、原 channel cut、checkpoint metadata、publication/receipt 丢回复及纠正后重试 |
| 补证最新通知消费 | `revision-unconsumed.log` 2 passed，JSON/SQLite；原件为 本轮目录 `json-*` / `sqlite-*` 下的 unconsumed/consumed JSON，保留 Native、真实 Session 与待处理 inbox |
| 实际 Loader/Agent | `loader-source.log` 与 `loader-lib.log` 各 4 passed；JSON/SQLite × 生成/既有人物招聘，source 与 plain Node lib；每项 warm + 两次独立 cold。`matrix.json` 列出 8 案例/24 进程、warm192/cold0，原 request/question/revision 通知与实际招聘链均经相同生产路径 |
| 类型、lint、构建、文档 | `types.log`、`lint.log` 无错误；`build.log` 完整构建通过，197 client artifacts；`doc-sync.log` 29/29 |

1857 个相关源码、编译产物及测试/配置输入保存在 `input-manifest.json`、`source-lib.tar.gz`；manifest SHA-256 为 `d5ea3759ec04256bbcca4ec031d41641022b5163fc330a65415d983e74a71234`。这不是全仓最终发布冻结，也不代表所有领域的 SIGKILL、SDK 分发或浏览器总验收。没有修改预算/超时、刷新快照、提交或推送。

## 准确命令

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'private request input|world publication at the real Hub|world submission without canonical consumed input|read sets when'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'retained target validation|private request input'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'publication|recipient.*failure|contradictory consumption|consumed input and request|failed context flush|flushed physical Session'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-evidence-flow.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-notification-proof/loader" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-notification-proof/loader" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

初次 lifecycle 回归中旧错误文本断言失败；改为统一校验器的精确 Envelope 错误后，最终 47 项通过。失败日志保留，没有放宽实际校验。
