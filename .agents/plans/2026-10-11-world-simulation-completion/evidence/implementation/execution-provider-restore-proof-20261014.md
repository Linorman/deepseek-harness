# P16：可写恢复前的实际执行 provider 准入

2026-10-14，Asia/Tokyo。完成 P16，清单 85/112，没有新增 item。Native stream 91、v1 compiler 9 不变；没有新增持久字段或迁移旧格式。

## 实现合同

此前 Native manifest 会核验纯 schema/reducer，但缺少实际 execution handler 时仍可恢复 World 并到 Driver 执行时才发现。现在独立的 `@clocky/clocky-simulation-world/providers` Loader 插件安装实际工厂及中立 Team 恢复 catalog。同一内建工厂表用于准入和正式 owner 的 handler 构造；Product 目录/HMR 不重复安装。会议室扩展另通过自身 effect 注册实际工厂。共同示例、正式 web bundle、headless 测试组合及 resolver 依赖均已接入。

`SimulationTeams.restore()` 先纯 inspect 原 Native journal，在 writable open 前取得全部冻结操作和历史 pin 的原 execution-generation lease。四类 strict payload parser 必须与 Native 声明是相同对象；相同 schemaRef 但换 refinement/parser 的版本不能通过。Intent/request、apply plan、committed domain result 及 mutation 使用原 parser；核心拒绝/取消结果仍由闭合 Native outcome parser 核验。取得独占 open 后再次准入，再验证 checkpoint/canonical suffix、改变 phase、附着 Team 和退休 writer。成功和失败都释放恢复 lease，没有调用工厂、模型或替代实现。

Product 恢复还在关闭先前持有的 owner/run 前执行同一 provider 准入。缺失时记录原失败命令，保持旧 owner 和业务状态；精确重试返回同一失败 receipt。`handlers()` 填齐当前 run 的必需工厂，并比较实际 handler 的 schema/artifact/generation 和 parser 对象；Driver 构造也拒绝不完整的实际 handler manifest。显式故障测试 adapter 保留原方法和屏障，补足其余必需领域，未替换故障注入行为。原 run-bound dispatcher 继续拥有 callback 排空及未知 Native 责任，不把工厂安装当作已执行或已清理。

恢复并不要求 LLM 在线；模型路由的启动准入保持原职责。基础仿真不要求 World 工厂。纯 Native open 仍是底层 Native 能力，完整 World 可写恢复由 Team/Product 入口执行上述跨 owner 合同；没有把纯原始检查宣称为完整 World 恢复。

## 当前进程与原件证据

公司/实验室 × JSON/SQLite × source/plain Node lib，共 8 个实际 Loader 原件，96 PID。每格先真实执行一次预约，再分别移除/替换 Native schema、artifact、generation，以及 execution provider 的 missing/schema/artifact/generation/parser/closed 六种配置，最后恢复原正确工厂。

48 次仅 execution-provider 反例均在 writable open、Team attachment 和 factory binding 前拒绝，三个计数及模型调用均为 0。独立审计逐个比较完整 Native records、snapshot 和 paused 状态，原预约 mutation 保留。另 32 次 Native 原版本拒绝仍通过，正确工厂重开保持原预约与规范通知；88 个 cold PID 模型调用 0。lib 启动没有 `--import/--loader/--require`，实际 resolution 都是 `/lib/`。[原件及 hash 审计](execution-provider-restore-audit-20261014.json)包含全部命令、PID、48 次原拒绝类别、236 产物 hash 与包分发记录。

真实双后端 provider 单测 18 项涵盖缺 catalog、缺操作、替换 schema/artifact/generation、parser 不一致、关闭准入、inspection/open 之间退休、正常 paused 恢复、Driver 缺 handler 和 provider Fiber 卸载后拒绝。相关 Team/领域/World 准备与行政回归合计 436 通过；另新增两项 Product 反例证明当前持有的 World owner 不被关闭、无新 open/attachment/model，原失败命令精确重试不改 Native。

补充当前公司完整 v1 工作流 source/lib × 双后端 4 case、12 PID：8 个冷回放的完整 state、Session events、Native journal 都与各自真实原件相等，paused/0 model。每个原件声明 8 个必需操作并通过治理、招聘、外部和非空离职交接；实际 warm 模型调用各 189。源码补充回归曾与文档构建重叠，保留其原运行范围，不声称输入执行前冻结；关键预约 source/lib 准入矩阵均在构建之外运行，lib 完整回归在前次文档门禁结束后执行。

当前源码/lib 各重跑双后端版本策略：744 次旧/未来 stream 的 inspect/open 拒绝、8 次未知必需 Native 记录拒绝，保留原两条记录，模型为 0。两端真实 stdio wire corpus TS 82、Python 79 通过；未知必需 Session 事件以及 false/字符串 ignorable 均拒绝，只有显式 Boolean true 可从 typed transcript 省略而保留 raw notification。没有新增 SDK 事件或错误字段，P16 沿用两端既有严格拒绝规则；SDK wheel/发行完整工作流仍由 U13 验收。

输入保存于 `.local/world-completion/p16-execution-providers/inputs`：4,538 份相关 source/lib/config/SDK/Python 副本、54,973,890 字节，manifest SHA-256 `1c74385d66796b70a212d41dd979ded15d1695f7d8e9fdd4086f02ec4e655f00`。最终 live bytes 与副本逐个核对。这是验证后的相关输入捕获，非执行前或全发行冻结。所有任务输出、Python cache、pack tarball 和编译产物均在项目内。

## 命令、门禁与失败记录

所有命令从项目根执行，使用 `TMPDIR="$PWD/.local/world-completion/tmp"`。准确原件和日志均在 `.local/world-completion/p16-execution-providers`；B05 当前追加原件在审计列出的 `.local/world-completion/b05-version-policy` 新目录；补充 source 完整场景目录在 `complete-company-source-roots.json` 中。

```sh
pnpm exec vitest run packages/simulation/simulation-world/tests packages/simulation/simulation-team/tests/restore.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts --maxWorkers=2
pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts -t 'missing execution' --maxWorkers=1
WORLD_BOOKING_VERSION_EVIDENCE_ROOT="$PWD/.local/world-completion/p16-execution-providers/booking-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-booking-version.snapshot.ts
pnpm run build
CLOCKY_EXAMPLE_MODE=lib WORLD_BOOKING_VERSION_EVIDENCE_ROOT="$PWD/.local/world-completion/p16-execution-providers/booking-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-booking-version.snapshot.ts
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts --testNamePattern company
CLOCKY_EXAMPLE_MODE=lib WORLD_COMPLETE_EVIDENCE_ROOT="$PWD/.local/world-completion/p16-execution-providers/complete-company-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts --testNamePattern company
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" PYTHONDONTWRITEBYTECODE=1 .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp .local/world-completion/p16-execution-providers/python-wire-tmp -o cache_dir="$PWD/.local/world-completion/p16-execution-providers/pytest-cache"
pnpm --dir packages/simulation/simulation-world pack --json --out "$PWD/.local/world-completion/p16-execution-providers/simulation-world.tgz"
pnpm exec tsc -b tsconfig.host.json
pnpm run gen-cordis-catalog
pnpm run gen-doc-graphs
pnpm run gen-config-catalog
pnpm run doc-sync
PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/p16-execution-providers/audit.py
```

执行中使用现有 `.bin/vitest/tsc/tsx` 与 pnpm exec 的同一项目入口；scoped lint 文件清单保存在 `lint-inputs.json`，后加 Product 测试/文档生成器及 invariant 单独 lint。最终类型、完整 build、scoped lint、双语全配对 1,141 组及 doc-sync 29/29 通过。新插件 pack 的 27 个文件包含所有 exported entry、声明和共享 chunk；独立 tarball 审计验证 entry 的相对 JS import 都在包中，未仅靠 workspace symlink 掩盖缺文件。

保留初轮失败及修复：strict selector 错收完整 pin 导致 10 项失败；现分离 selector/pin，没有放宽 parser。新 `/providers` 缺 source alias 使 Loader 首轮失败；补正式映射及 resolver dependency 后通过。测试误从 Context 代理取得 `service.ctx.fiber` 并退休整个 Context，已改用安装时的真实 provider Fiber，新增两项产品反例通过。初次 doc-sync 26/29：新类型/服务/能力图归属缺失及 config catalog 过时；补正式 owner 映射并生成目录。次轮 28/29 是能力图中文表/图未同步；更新实际新增行及对应图后最终 29/29。格式、测试依赖和临时类型错误均修复，不增加 suppressions、不放宽超时或预算。pnpm 首次因 manifest 变化自动同步依赖；另一个重复在线 lockfile 进程已终止，随后离线同步完成，日志保留。

本项不代替 R01/R02/R06 的完整 checkpoint 引用与危险边界证据，也不宣称真实 provider 模型、全 GUI、性能或原设计 MVP 完成。沿用一个已有只读 subagent 做恢复合同审计，未另建 agent、item、PR 或远端发布。
