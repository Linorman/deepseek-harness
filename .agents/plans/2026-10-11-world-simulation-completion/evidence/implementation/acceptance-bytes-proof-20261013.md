# P07/P09：完整接受批次与不可变计划

2026-10-13，Asia/Tokyo。Native85、v1 compiler8。本记录对应原 P07 和 P09，不新增 items，不代表完整 World 或真实 provider 验收完成。

## 修复与合同

P07 的原实现已把 request、标准私有 Channel post 和 `worldExpansion` 映射放在同次 acceptance 中，但普通请求/计划的字节检查只包含内部 BusinessRecord。实际写入的 runId、expectedRevision、完成记录及 scheduler 责任可能使完整 append 超过冻结上限；原来只有 timed/scenario request 另查完整封装。

[最终 Native append owner](../../../../../packages/simulation/simulation-local/src/run.ts)现在对本次新接受的 `world/request` / `world/resolve` 计量最终 `JSON.stringify(batch)` 的 UTF-8 字节，包括自动追加的招聘资金 scheduler 记录。请求使用原 `maxBytesPerRequest`，计划使用原 `maxBytesPerPlan`。超限在 append 前拒绝，不发布 request、post、plan 或部分调度责任。operation/message 限额仍按可信展开后的数量检查；原件已接受重试不追加。Native85拒绝旧流，compiler8与SDK结构不变。

窗口另有真实缺口：Session 工具已成功提交 proposal，随后 `commitWindow()` 接受失败，原来只抛异常，未保存可显示/恢复的停止状态。现在[决策 fold](../../../../../packages/simulation/simulation-local/src/decisions.ts)允许准确归属于原 window/submission/inference-finish 的拒绝：保留原 submission 与 hash，取消被拒 slot，全部 slot 终态时同批关闭 window，持久记录 `SIM_WORLD_SUBMISSION_BLOCKED`。driver 显示 `world-byte-limit`；此前已接受 slot 不回滚。损坏 submission hash 拒绝投影。此路径不伪造 Session 失败回执：工具提交当时确实成功，后续 Native 接受拒绝是另一事实。

窗口的 finished/submitted 属于另一 append，不冒称与 acceptance 同批。历史投影继续校验内层 business records；恢复不重新计算完整历史 append 字节。完整字节额度由原接受写入点执行，本轮没有引入新的历史批次重计量机制。

P09 的阶段边界保持：`simulation_stage` 只保留待提交提案并返回无业务效果；window submit 持久化 proposal，仍不创建 accepted plan。只有 Native acceptance 才建立原计划/实际 Persona，执行发生在其后。双后端测试明确验证原已接受计划精确重试不写入，改动原 Persona traits 的同身份请求拒绝且完整 snapshot 不变；未接受的 window 计划可取消，不产生业务效果。

## 当前验证

[Native 完整批次测试](../../../../../packages/simulation/simulation-local/tests/world-acceptance-budget.spec.ts)在真实 Native/Team/Agent/Session owners 上直接观察 storage append：中文/emoji 输入按 UTF-8 计费，请求与计划的 exact N 成功、N−1拒绝；window 另测其实际接受批次；operation 上限1或message上限0拒绝两项展开；append 前故障不发布 request/post，精确重试只保留一份映射。此组无 provider 推理，不能替代下面的真实 Loader 链。

[Team/Agent 测试](../../../../../packages/simulation/simulation-team/tests/world.spec.ts)覆盖真实三工具 stage/submit、submitted plan 与 accepted plan 分离、提交未接受时取消、已接受 Persona 修改拒绝，以及多 slot window：先前 slot 已接受，后一个超额被拒，原消费/提交证据仍可核验，重复 commit 不改状态。

[真实边界 Loader](../../../../../examples/simulation-company/tests/world-acceptance-bytes.snapshot.ts)以两种招聘操作 × JSON/SQLite × source/plain Node lib 运行：每组合先用正常预算测量真正 append，再用独立运行冻结 exact N 和 N−1。每次均经过原模型工具、Channel、driver、Native 与 checkpoint，warm 后两次独立进程冷恢复。生成招聘边界2807字节，既有录用2813字节；小一字节时保留原 submitted 输入及 Native 拒绝，request/operation/plan/hold/result 均为空。成功案各有一个原请求、计划、支付/任职结果；生成实际 profile.persona 等于原 accepted payload。

更严格的上游检查使旧外部字节故障样本提前失败。本轮没有提高其1400/4096字节上限：[外部 fixture](../../../../../examples/simulation-company/tests/world-external-limits-scenario.ts)缩短 reserve 案 runId，使计划可接受但原 reservation 仍超限；commit 案去掉旧1800字符runId填充，用长 canonical 接收者使完整结果 wake 在准备之后超限。后者是明确的可信 Native 测试 composition，不宣称 portable author schema 接受超长符号键。公司/实验室 × JSON/SQLite × source/lib 重新证明 reserve 前无新身份，以及 commit 拒绝后原 preparing/maintenance责任仍保留。原模型、token、时间和重试额度不变。

## 冻结证据

[正式矩阵](../../../../../.local/world-completion/thread-01a1336a-acceptance-bytes/final-matrix)共40个原案例、120个独立PID：24个校准/精确/拒绝招聘案例，加16个外部 reserve/commit 故障案例。408次keyless adapter调用，80个cold进程全为零调用且保持paused。lib检查实际包路径及无tsx启动参数；fixture入口仍是Node执行的`.ts`，不冒称编译JS。

5,971份输入、65,977,086字节完整source/lib副本运行前后hash一致：`3394838852830adc171874c8e845e9d07310e49dfb4d6baf51714fd2d8a27022`。[审计](acceptance-bytes-audit-20261013.json)核对实际85版JSON/SQLite日志、Session事件前缀、每个接受批次的逐值journal范围与UTF-8长度、request/post依赖及logical映射、原成功stage/submit和拒绝hash、计划/Persona对应关系、两次cold完整state/session/journal不变。外部故障核对原准备责任未丢失。最终文档门禁后5,971份当前输入仍与冻结副本逐项相同。

## 命令与结果

所有命令从项目根执行，临时、构建、模型、原库和Session文件均留在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/windows.spec.ts packages/simulation/simulation-local/tests/world-acceptance-budget.spec.ts packages/simulation/simulation-local/tests/world-execution-time.spec.ts packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-execution-time.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'director submission before window closure|window byte refusal|submitted window plan'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-governance.snapshot.ts examples/simulation-company/tests/world-director-events.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
sh .local/world-completion/thread-01a1336a-acceptance-bytes/run-final.sh
/opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/thread-01a1336a-acceptance-bytes/audit.py
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[全部日志](../../../../../.local/world-completion/thread-01a1336a-acceptance-bytes)保留开发失败与最终结果：

- `regression.log`：241项中240通过，唯一失败是旧timed诊断文本；改为稳定typed failure断言后`timed-retry.log`7项通过，字节额度未改。
- `native-final.log`18项、`stage-immutability.log`6项、`window-late-boundary.log`2项通过；集合重叠，不相加作为唯一测试数。
- `governance-events.log`8个真实source治理/主动环境案例通过。
- 最终矩阵各face：4组边界套件和8个外部故障案例通过；每组边界套件含3个独立预算案例，每案3个进程。
- 定向lint、类型检查、build197及`doc-sync-final.log`及加入验收记录后的`doc-sync-evidence.log`均29/29通过。

首轮失败如实保留：组合测试包含三次独立owner启动，遇默认5秒超时，拆为各自校准/单次断言，未提高超时；窗口测试的512字节先触发内部提交检查，改用位于两层检查之间的2400字节以验证真正的后续接受拒绝，仍要求拒绝；新类型推断与格式错误已修。Loader开发期先纠正finished跨batch和可缺省change的证据假设，随后真正复现并修复window拒绝无持久stop。一次进程内“append成功但回复丢失”试验因旧writer仍存活而发生正确的sequence-conflict，不能冒充SIGKILL冷恢复，未将其作为通过证据；完整危险边界仍属R06。旧外部fault样本提前拒绝已通过上述输入调整保留原边界与原硬预算。

这些证据完成P07/P09所列合同。缺资料补证、其他授权/投影、SDK发行、完整危险边界、真实provider与最终全仓验收继续由原未勾选项跟踪。
