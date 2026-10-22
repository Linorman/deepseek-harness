# P11：原案件补证闭环验收

2026-10-13，Asia/Tokyo。P11 的 Native、实际模型三工具、私有 Channel 和冷恢复闭环完成；Native86/compiler9。数据格式基础的[早期记录](evidence-data-contract-progress-20261013.md)保留其当时未完成边界。

## 实现边界

导演只能询问原领域声明的字段；Native 冻结原请求人、问题版本、期限及次数。实际原 Channel 通知被原 Session 消费后，回答形成同案件不可变输入修订；导演必须消费修订通知才能继续规划，执行读集包含输入修订和 hash。原 request、既有 plan、角色身份及原通知均保留。模型不能指定响应者、身份或修改原业务 payload，不能引用实际上下文未披露的来源。

询问消耗规划机会并保留后续规划槽位；准备回答即计入 `maxEvidenceAttemptsPerRequest`，放弃、取消不退还。到期使用真实截止事件，耗尽使用真实已关闭决策，各记录唯一信息不足拒绝及安全结果唤醒。取消关闭原问题、期限及已投递待处理唤醒；未结算的结构/资金职责阻止插入询问。离职职责包含待补证案件，仅允许屏障前原案件及精确原通知的补证。完整补证、终止与调度记录均纳入冻结的批次字节上限。

Native 回放验证字段、来源、实际回答、修订链、deadline 与 terminal result 的双向关系。模型工具独立 schema 同步支持询问、回答和 world-input 引用。产品、TS/Python 与只读 UI 提供有界的最新问题/修订，继续使用正文权限；没有添加管理者代答入口。本项不代表 U12/U13/U14/U15 或整套故障矩阵完成。

## 证据

所有原件均在项目内：[本轮目录](../../../../../.local/world-completion/thread-01a1336a-evidence-native)。

- `loader-source-verified.log` 与 `loader-lib-final.log`：各 4 项，JSON/SQLite × generate-and-hire/hire-existing；每项 warm + 两个独立 cold 进程。选定矩阵共 8 案例/24 进程，warm 192 次 scripted 模型调用，cold 0；每次冷恢复精确比较完整 Native、Session 和 journal。`verified-matrix.json` 给出具体目录、PID 与调用数。不是实际外部模型/provider 验收。
- `owner-final.log`：4 文件/28 项通过；真实 Native/Team 问答→后续 apply→招聘/资金一次结算、原请求保持、到期、最后一次放弃导致耗尽、取消、非法字段/引用/actor/版本/期限/额度及持久来源篡改拒绝。`reverse-source.log` 另验证不能把已回答问题伪装成耗尽结果。
- `focused.log` 中相邻 acceptance/resource/execution 通过；旧 existing-hire fixture 的 reservedAt、preparation 及结构额度错误断言已修，`existing-hire-fixed.log` 17 项通过并包含在最终 28 项中。`fence/` 保留离职准入与职责 32 项通过、types/lint。
- `consumers/exhausted-tests.log`：产品/TS 合同 120 项；`consumers/exhausted-python-tests.log`：Python 31 项；`consumers/exhausted-ui-tests.log`：UI 11 项。`product-views.log` 通过实际 Native 原件调用生产 `worldCaseDetail` 验证 body=false/true；输入路径在 `product-view-inputs.json`，不冒充完整 HTTP 权限链。
- `build-verified.log`：完整构建通过，197 client artifacts；`doc-sync-verified.log`：29/29。core/consumer/test 的最终定向 lint 均通过；没有提交、推送或打开 PR。

`implementation-manifest.json` 与 `implementation-source-lib.tar.gz` 冻结 2306 个相关源码/编译产物/测试输入，manifest SHA-256 为 `c366c4823f1574cbf267abe4447d461cc673599995903efd40f6a3aa81937ff9`；范围是 simulation、UI、Python 与 Loader fixture，不是全仓最终发布快照。

## 复验命令

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-evidence-flow.spec.ts packages/simulation/simulation-local/tests/world-evidence-deadline.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/tool-simulation/tests/schema.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-evidence.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

新补证 Loader 场景在编译前声明 32768 字节的 request/plan 上限及相同 deployment ceiling；原招聘场景保持原额度，不修改超时或刷新快照。早期失败日志保留：目录 ceiling 未同步、模型上下文字段路径错误、独立工具 schema 缺项、旧夹具和 lint/配对问题均已修复；没有将这些失败作为通过证据。
