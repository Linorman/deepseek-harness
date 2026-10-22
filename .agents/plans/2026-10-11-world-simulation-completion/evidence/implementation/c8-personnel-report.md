# C8 人员调岗结算证据

日期：2026-10-12。当前输入 hash：`4c0fa05093663209b2f30780efb9c2148fd0ab8c2cb01b55f512cd1c14e89684`，见 [输入原件](c8-personnel-input-manifest.json)。Native stream 67；checkpoint manifest 3；Session format 0；通用 SQLite schema 未变。保留已有 dirty tree，无 commit/push/PR。

本批仅完成既有 O07，checklist 为 30/112，未新增 items。完整 MVP 仍未完成。

## 实现与真实流程

显式安装 organization.transfer/1 与 organization.depart/1 纯模块。调岗保存原 plan、Person/Participant/Session、assignment revision、维护 owner 和目标岗位预留，再 fence 旧任职并取得真实 controller 停稳。Team→排序 Channel 持锁，严格重验 live runtime-only proof、全部来源 cursor 和 pending 原 Envelope WAL 槽位。持锁 callback 只执行 Native append，不重入 Team 或模型；默认 provider 不支持该 cut 时明确拒绝。

Native 重验旧任职与 source/target 授权、原 profile/binding、当前/未来 assignment 和其他有效预留，保持原请求和 plan。只有职责清偿后，旧 assignment 与选定权限关闭、新 assignment、场景事先声明的新权限、预留结算、result、首次行动和请求者 wake 才共享一个原子批次。按原 intent 保存 fence 历史与 role generation；串行/window 的实时接受及持久 fold 都拒绝旧 generation 新工作。Person、Persona、私有记忆和 Session 不替换。

实际 Loader／独立 Agent／三工具／Team／私有 Channel 流程通过 company/laboratory × JSON/SQLite：source 四组、plain Node lib 四组，各有独立新进程 cold restore。真实新岗位 Context、首次行动和原 Session prefix 校验通过；精确 commit 重试零 append，cold restore paused 且零模型调用。预算保持 resident2、microsteps32、maxBytesPerPlan4096 等原 catalog 原件。原验证命令与四个 fixture 文件 hash 见 [fixture manifest](c8-personnel-fixture-agent-manifest.json)。当前16份源／lib raw originals及每份hash见 [最终样本清单](c8-personnel-raw-final.json)：source8保持原样，最终重复运行覆盖旧同名lib8；旧agent manifest中的lib raw hash仅为历史记录，不用于当前文件归属。

## 验证命令与结果

- `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-personnel.snapshot.ts`：source 4/4，[日志](c8-personnel-source-final.log)。
- 上述命令加 `CLOCKY_EXAMPLE_MODE=lib`：plain Node 4/4，[日志](c8-personnel-lib-final.log)。build 前置见 [c8-build](c8-build.log)。最终构建后的重复矩阵另外保存 [rebuilt log](c8-personnel-lib-rebuilt.log)，4/4通过，最终构建前置为 [c8-build-final](c8-build-final.log)，当前样本hash以 [最终样本清单](c8-personnel-raw-final.json) 为准。
- `pnpm exec vitest run packages/core/team/tests/personnel-settlement-cut.spec.ts packages/team/team-hub/tests/personnel-settlement-cut.spec.ts packages/team/team-hub/tests/envelope-admission.spec.ts packages/core/team/tests/runtime.spec.ts`：117/117，含25新增 cut/parser测试；准确命令/原文件hash见 [Team cut manifest](c8-team-personnel-cut-manifest.json)。这是 owner boundary 单测，不能替代上面的 Native Ledger 集成。
- `pnpm exec vitest run packages/simulation/simulation-local/tests/personnel-admission.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/core/team/tests/personnel-settlement-cut.spec.ts packages/team/team-hub/tests/personnel-settlement-cut.spec.ts`：50/50，[日志](c8-integrated-personnel-unit.log)。6项 admission 独立证据在项目 `.local/world-completion/tmp/personnel-admission-manifest.json`，retirement 部分只验证已结算 prefix 的 writer 门，不声称实际离职/退休闭环。
- `pnpm exec vitest run packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation/tests/world-protocol.spec.ts packages/simulation/simulation-product/tests/world-creation.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-local/tests/personnel-admission.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/simulation/simulation-local/tests/personnel-obligations.spec.ts packages/simulation/simulation-team/tests/personnel-obligations.spec.ts`：实际7文件342/342，[日志](c8-final-personnel-regression-fixed.log)。world-creation.spec.ts 未存在，不计入文件；world-preparation 覆盖相关预检。第一次9项失败来自旧fixture遗漏 required positionRolePermissions/approvals/payload，保留 [失败日志](c8-final-personnel-regression.log)，按现有严格契约修正后通过，未增加默认值或删拒绝断言。
- `pnpm exec vitest run packages/client/ui-simulation/tests/run-status.client.spec.tsx packages/simulation/simulation-product/tests/control-schema.spec.ts`：114/114，[日志](c8-control-regression.log)。新增停止原因同步 typed DTO、英文/中文和 Python parser；不代表完整 UI 验收。
- `python/sdk/.venv/bin/python -m pytest python/sdk/tests/test_simulation.py -o cache_dir=$PWD/.local/world-completion/tmp/pytest-cache`：101/101，[日志](c8-python-simulation-venv.log)。`TMPDIR`/Python cache 均为项目内路径。初次系统 Python 无 pytest，保留 [诊断](c8-python-simulation.log)，未安装项目外依赖。
- `pnpm exec tsc -b --pretty false`：exit0，[日志](c8-types-final.log)。`pnpm run lint:contracts-ready`：exit0，[日志](c8-lint-contracts-final.log)。完整 `pnpm run lint` 的类型/产物前置先通过，style余项修复后单独重跑最终contracts gate；失败与修复日志未覆盖。
- `pnpm run build`：exit0，197 client artifacts，[最终日志](c8-build-final.log)。
- `pnpm run doc-sync`：29/29，[最终日志](c8-doc-sync-fixed.log)。补齐新 JSDoc，按 owner 重生成 Cordis/config/event catalogs 并同步中英引用与配对；初次4道失败记录保留。
- `git diff --check`：exit0，[日志](c8-diff-check.log)。所有 TMPDIR、编译产物、raw evidence 和缓存均留项目目录内；意外落在 tests 目录的4个 fixture compiler outputs 移至 `.local/world-completion/tmp/c8-fixture-compiler-outputs/`，保留原 bytes。

## 已修复的拒绝路径

source1 暴露原执行被当作 fresh admission，自己的 reservation 被重复计算。执行重验现在接受仅 Native 提供的 original intent，并核对 actual retained intent/pin/body/key/actor/time/evidence，只排除自身；fresh request 不带 original。没有增 capacity。

source3 的精确原责任真实重试暴露完整 batch 超4096；原109 prefix无 append或部分提交。ready record 改为来源 cursor/channel/hash；Native 原义务从同 prefix 重建，实时 proof 与 fold 各自拒绝未清偿职责，并校验空 foreign duty fingerprint。没有增字节额度。

Native serial fold 曾允许 fence 前预计算、fence 后追加的 acceptance；新增回归证明拒绝。自己受理离职产生的唯一原 notification 仅在 source/decision/文本/Channel/recipient/time/dependency 全相符时保留，未泛允许新的岗位通信。

## 仍未验收的范围

O08严格未来/错过时间的实际模型流程与专属有限时钟；完整 depart、交接显式取消/再建、controller退休未知、重新入职与计数、取消竞争和SIGKILL矩阵仍待。旧 terminal Team task-target 的 Native 引用当前保守阻塞人员提交，不会因只读 source projector 省略该项而假称清偿；后续需保存并验证原终态 owner 证据。

未来权限、资源/debtor、旧任务/未确认消息和任意独立义务均不自动迁移或擦除；未知退休/IO保持占用。维护未证明停稳时取消拒绝并保留责任，尚未交付完整 durable cancel-requested/cleanup 流程。因此不勾 O10–O17，也不声称纯领域unit完成这些整项。

v0受信 composition、新 public人员 DTO、双 SDK 分布包新行为、v1编写/完整产品UI与外部领域仍待。没有新 GUI 浏览器/GIF 证据。premium静态audit [记录](c8-premium-audit.json) 保留4个既有编辑界面问题（其中 sourceText已有CSS resize:none、静态误报）；未修改这些布局/表单，也不以component tests宣布U15完成。
