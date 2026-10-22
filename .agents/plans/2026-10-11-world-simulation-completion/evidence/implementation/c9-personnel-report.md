# C9 离职、职责结算与未来权限撤销

日期：2026-10-12；当前输入 hash `a9db7cf7555055e8df44df1f1af9b9dcf07abbad9655d6b71dc55ad519cff772`，见 [输入清单](c9-personnel-input-manifest.json)。Native stream 68 拒绝旧格式；checkpoint manifest 3、Session format 0、通用 SQLite schema 不变。保留原 dirty tree，未 commit/push/PR。

既有 O10、O11、O12、O13 已完成并勾选，checklist 34/112；未新增 items。完整 MVP 仍未完成。

## 当前契约

实际接受 departure 的同一个 Native 批次立即保存原 assignment fence 并增加角色 generation。旧 writer、旧决策和持久接受批次不能新增普通、资源或世界工作；自己已受理请求的唯一原通知仍按精确来源对账。被 fenced 的 Person 保持 active，Native 拒绝以 inactive／terminated 隐藏其职责。已接受资源效果按原 intent 结算，不按新 generation 重发。

只有 actual held Team／Channel cut 和原维护停稳才能授权离职提交。Native task-target 不再因无法保存终态来源而永久卡住：纯 helper 从实际 Team task book 提取 lease-free terminal metadata，保存原 run/operation/creator/idempotencyKey/fingerprint/task revision/source cursor，并纳入整个 cut hash。Native ready 逐项验证原 applied creation receipt 与 accepted decision，重放同样绑定。它只清偿精确 task-target；task attempts、清理、interaction、resource、wake 和未确认消息仍由各自 owner 负责，不能被 terminal 标签清除。

提交原子关闭任职和当前权限，记录全部旧岗位授权撤销（包括未来授权），保存预留结算/result/wake。未来 Relation 原 interval 保留，当前权限目录从原已提交 reservation 派生撤销，跨过原 validFrom 也不会复权。原 Person/Participant/Session/Persona/私有记忆保持；普通离职仍允许个人活动，retire=true 只有 actual controller 确认后才保持 writer released 并拒绝新 startup。

取消在 started maintenance 仍 draining 时保存 cancel-requested 与原命令，保持 fence 和预留。精确停稳后 `settlePersonnelCancellation()` 才结算首个原命令的唯一 result/wake；额外原命令返回 already-resolved，commit 先赢则原取消返回 already-committed。原 assignment、identity、accepted effects 和旧债务不被取消的人事请求抹去。未结算的人事责任阻止原 maintenance completion。完整实际取消竞争/fault验收仍不勾 O16。

## 实际 Loader／Agent 流程

[source-final10](c9-departure-source-final10.log) 与 [plain Node lib-final10](c9-departure-lib-final10.log) 各10/10：normal8为公司/实验室 × JSON/SQLite × retire false/true；另 JSON/company future1 与 handoff1。每组 fresh 与独立 cold process，20个 cold 均 paused、零模型调用；保持原 resident2、microsteps32、maxBytesPerPlan4096 等 catalog 额度。

真实原通知 post 后、Native receipt 前的屏障证明原 departure 已接受且 plans 为空，原 assignment 尚未闭、Entity active、实际 writer active/charged、Team activation 未确认停稳。释放原 IO 后，独立 director 提交原 apply，再由实际维护、controller、held cut 和 Native mutation 完成。false 后实际个人 wake 在原 Session 执行；true 的实际 Activation 均有 quiescedAt，原 writer released。

future 用例在 World.define 后、模型前以原 trusted `run.change` 把已声明旧 grant 移到 validFrom10；离职2撤销该 grant 而不回填 interval，实际个人 wake11 跨过原时刻，目录仍无旧权限，cold 复核原件一致。

handoff 用例先由 victim 的真实三工具提交 task/create，保留原 NativeTaskReceipt 和 Team pending task。离职返回 handoff-required，Person active、原 assignment 未闭、原 task pending、原 reservation/fence 保持。既有 `connection.cancelTask` 显式取消原任务，再 `driver.reconcile` 原 reservation 取得新 held cut 和 terminal metadata 完成离职。administrator 随后实际三工具另建新 task：不同 task/operation/creator，仍 pending、无 lease/attempt/proposedOwner；原 task source/cancellation snapshot 保持，未假称新 assignee/debtor 接受旧债務。cold 复核实际 Team book。

完整准确命令、四个 fixture 文件 SHA256、最终40份 raw originals SHA256、旧 pilots/stage histories 见 [fixture manifest](c9-departure-agent-manifest.json)。所有原样本 hash 已逐项重核，无 mismatch，源码/lib/future/handoff文件名互不覆盖。

## 验证

- `TMPDIR=$PWD/.local/world-completion/tmp pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-departure.snapshot.ts`：source10。加 `CLOCKY_EXAMPLE_MODE=lib`：lib10；前置 [最终 build](c9-build-final.log)，exit0、197 client artifacts。
- Native／Team／维护／既有招聘／治理回归：实际7文件248/248，[精确日志](c9-regression-final.log)。命令：`pnpm exec vitest run packages/simulation/simulation-local/tests/personnel-admission.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/simulation/simulation-team/tests/personnel-terminal-evidence.spec.ts packages/simulation/simulation-team/tests/personnel-obligations.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/world-governance.spec.ts`。
- 新 terminal owner 单测7项含 JSON/SQLite actual cancellation、actual completion、pending/lease refusal、原 Native retirement-before-append hold、scope/cursor/creator/fingerprint/duplicate拒绝及纯 ready JSON重放。记录在项目 `.local/world-completion/tmp/personnel-terminal-manifest.json`；isolated纯prefix正例不冒充完整人员流程，保留原 resourcecontrol 时仍 block。
- C8 调岗在当前 Native68继续真实 source4/lib4：[source](c9-transfer-source-regression.log)、[lib](c9-transfer-lib-regression.log)。相同 snapshot 命令增加 `WORLD_PERSONNEL_SNAPSHOT_EVIDENCE_ROOT=$PWD/.agents/plans/2026-10-11-world-simulation-completion/evidence/implementation/c9-transfer-regression`，lib增加其mode。产物在独立子目录，旧C8 raw不覆盖。
- Control／RunStatus114/114：[日志](c9-control-tests.log)；Python parser101/101：[日志](c9-python-tests.log)，使用项目已有 `.venv` 与项目内 cache，不安装项目外依赖。
- `pnpm exec tsc -b --pretty false` exit0：[当前日志](c9-types-current.log)。`pnpm run lint:contracts-ready` exit0：[当前日志](c9-lint-current.log)；完整 lint 的类型/产物前置通过，最后仅snapshot evidence参数缩进修复后重跑contracts gate。原失败不覆盖。
- `pnpm run doc-sync`：29/29，[日志](c9-doc-sync-fixed.log)。首次只有 Cordis API catalog stale，按 owner 重生成后通过。JSDoc/中英README/Agent Note与配对一起维护。
- `git diff --check` 通过；全部 TMPDIR、构建、缓存、日志与raw样本均在项目目录。既有 source8/pilots保留，最终新目录 source/lib各20样本。

## 仍待验收

O08严格生效时间的有限专属时钟与真实 missed-time 流程、O14超时/卸载/迟到callback未知退休、O15重新入职及产品计数、O16完整实际取消竞争和未知IO清理、O17 SIGKILL矩阵仍待。当前 cancellation folding unit 不替代这些整项的完整真实Owner流程。

Future/handoff整条Loader流程仅JSON/company；两后端owner unit另外覆盖终态/未退休attempt边界，不扩大该范围。没有自动资源/debtor迁移、长期工资、任意policy或任意task继承。v1编写、完整public人员DTO、双SDK新分布包行为、UI/浏览器/GIF和外部领域仍待；此批只增加停止原因文案，未声称UI综合验收。
