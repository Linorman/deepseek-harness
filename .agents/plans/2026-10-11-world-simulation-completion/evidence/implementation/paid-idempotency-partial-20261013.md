# P05 部分补证：实际收费后的原命令与业务键重试

2026-10-13，Asia/Tokyo。P05 保持未勾选；本轮不增加清单 items，不将重复效果未发生等同于全部重试入口完成。新测试 source SHA-256 为 `5e8eef5696be0917f308b76c907f25947dcdfc31a9e76c641fff5daa8d1025c0`。

[新增双后端回归](../../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts)通过真实 Native/Team/Agent/Session/Channel owner 和三工具能力，先让已有人员录用实际支付 6 credit，余额由 10/0 变为 4/6。随后重排原 JSON 字段，重试同 decision 提交、原 mutation 提交和原业务 intent；返回原件且 snapshot 不变。改变原描述或 mutation 载荷被拒绝且不追加。普通生产 `goal` 上下文中的新 decision 重用原 businessKey，只留下一个去重请求 operation，不再创建通知、人员、assignment、hold、mutation 或 result。关闭原 connection/run 后，在同一进程通过 provider 重新打开 Native，再次返回原结果，拒绝改件，余额和 journal 不变。NoInference adapter 记录零调用。

[独立审计](paid-idempotency-audit-20261013.json)读取项目内实际 owner 导出的完整 journal/snapshot，逐项检查原前缀、唯一 mutation 的 commit sequence、资金 hold 与 result 同序号、唯一 candidate 任职、唯一通知、两个 request operation 及唯一业务事项。7 组保留成功样本包括先导与重跑，不作为 7 个独立场景或进程计数。样本读取实际 LogStream；没有复制底层原库，因此不声称原库离线审计或新进程 SIGKILL 恢复。未运行 compiled SDK 或 wheel。

## 仍未完成的边界

最初测试使用 `{ kind: 'request', intentId }` 重新准备已完成 hire-existing 的上下文。两后端均失败：`worldContextSelection` 调用 `worldExecutionReads`，后者重新调用 `ExistingHireNativeWorldDomain.admitRequest`；已经入职的原 candidate 被“已有 current/future assignment”规则拒绝。原业务命令及生产 goal 重试成功，但此已暴露入口尚未修复，不能整体勾选 P05。

[first.log](../../../../../.local/world-completion/thread-01a1336a-idempotency/first.log)保留真实失败及完整堆栈；本轮只把后续新测试改为实际生产 goal 路径，未放松 candidate 准入或修改 Native 守卫。后续需让已接受事项的收据重试与新的业务准入明确分离，并验证权限、原载荷和已保存 context-view/replay 的一致性；不能简单吞掉异常或把任何改变过的请求当成功。已有历史日志如何重建该上下文也需要相应格式策略。本轮未修改正在由并发 C42 任务演进的核心上下文/stream 实现。

## 检查和原始日志

所有路径与输出均在项目内，命令从项目根运行。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/world-completion/thread-01a1336a-idempotency/host.tsbuildinfo --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" node --import tsx/esm scripts/run-oxlint.ts packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-10-13-one-time-hiring-resource-reservations.md
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-typecheck
PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/thread-01a1336a-idempotency/audit.py
```

[日志目录](../../../../../.local/world-completion/thread-01a1336a-idempotency)保存完整历史：生产 goal 版两后端通过；World/产品命令三个文件 183 tests 通过。其后类型检查发现测试中三处 unknown 未经过 schema，修复为已有严格解析器，再修复 lint 长行。最新类型与 lint 均 exit0，最终 focused 两项通过（tests 1.28s）。在并发文档检查期间有一次 JSON 用例到原 5000ms 测试超时；未提高阈值，原限制下单独复跑通过，保留失败日志，不据此断言超时原因。

第一次 doc-sync 为 26 passed/3 failed：本轮新测试的旧类型问题、并发 C42 Note 的 Status 格式及 simulation-local README Model Experience 段落位置。类型问题修正后单独重跑 `doc-typecheck` exit0，82 block 编译完成；其余两项没有改动或虚报通过，R11/R12 保持未验收。183 项先前回归与最终两项存在重叠，不相加；最终 schema 收窄后仅重跑受影响的新测试。
