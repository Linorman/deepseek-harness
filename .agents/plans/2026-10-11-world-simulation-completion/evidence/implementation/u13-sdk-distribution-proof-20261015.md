# U13 Source、compiled TS 与已安装 wheel

2026-10-15；Native96／manifest6／Product4。完成原 U13，102/112；未新增 checklist 项。

最终选定 owner 输入 hash 为 `c2e0cd869b43322472a01892967e081de51f827240a4bdc790549e03b8f9a125`，包括 1,142 个 Native／Team／Product／scenario／SDK／JSON-RPC owner 源码、声明、实际 lib、Python 与 fixture、manifest、lock 和启动配置，见[逐文件 hash](../../../../../.local/world-completion/u13-sdk/inputs-final.json)。[归档](../../../../../.local/world-completion/u13-sdk/inputs-final.tar.gz) SHA-256 为 `78cdf83fccdb30362518f87d3f349dbe0f40fbc53f8c2e5779596fe8c0d3a696`；[Root 重新读取核验](../../../../../.local/world-completion/u13-sdk/root-archive-verification.json)全部 1,142 个文件。矩阵开始冻结的 1,118 个 runtime／fixture 输入在执行期间零变化；额外 manifest/config 输入另存，不宣称覆盖每个传递依赖或整个仓库。历史归档和失败均保留。

## 真实分发流程

先构建当前 Host 和 TS SDK，再从当前工作区运行 `node examples/simulation-company/tests/sdk-world-wheel.mjs`。脚本实际调用 uv 构建 wheel，安装到唯一项目内 target，然后串行运行 source 12 格和 lib／wheel 12 格；准确命令、先决条件及每个原件 root 见[最终报告](../../../../../.local/world-completion/u13-sdk/report.json)和[独立审计](../../../../../.local/world-completion/u13-sdk/audit-final.json)。[双语示例说明](../../../../../examples/simulation-company/README.zh.md)记录 build、uv、Python 测试依赖与入口。

最终 wheel 为 `clocky_sdk-0.0.0.dev0-py3-none-any.whl`，SHA-256 `4db98621f353891f51b982b60f0427e9eefaca4dcc4dfc7b030e22d05e88dd52`；14 个 Python 模块逐字节等于当前 source 和实际安装 target。Python proof 断言 `clocky.__file__` 位于安装目录，TS proof 断言实际 SDK、Native、Product、server 模块路径。Source 使用显式 tsx／tsconfig source 映射；lib 为没有 source loader／execArgv 的普通 Node，实际 runtime 路径为 lib。没有用 Vitest/browser 入口推断 Host 模式。

| 范围 | 实际结果 |
|---|---|
| Source SDK | [3 files / 12 passed](../../../../../.local/world-completion/u13-sdk/distribution-i8Xjht/source.stdout.log)，127.12s；JSON/SQLite × TS/Python，新 v1 管理和旧公司／实验室生产性控制分别验证。精确日志名见最终报告／分发 root。 |
| compiled TS／installed Python wheel | [3 files / 12 passed](../../../../../.local/world-completion/u13-sdk/distribution-i8Xjht/lib-wheel.stdout.log)，33.34s；同一真实 stdio Host 链、普通 Node lib runtime。 |
| 新 v1 用户管理 8 格 | 每格 3 个独立 Host PID；真实预检→暂停创建→hire-existing 字段／预览→固定原件提交→四区案件查询→暂停 checkpoint。每格仅 1 次 Native admission、1 mutation、armed／settled 两条观察，0 decision／model。新进程只读查询、同 ID submit／selector retry 均 0 open／attach／model；第二个 cold 进程显式 restore 后，原 person／plan／result／任职和 case 恒等。 |
| 旧 v0 生产性控制 16 格 | 实际 create／prepare／query／start／pause／checkpoint／独立 cold query／restore；每个 warm 18 次真实 Agent scripted 调用、cold 0。保留原创建／管理／终态取消原件，不把旧用例计作新 v1 DTO 证明。 |
| 原件审计 | 共 24 格、56 个唯一 Host PID、3,716 对实际成功 simulation RPC request/result。保存的是解码后的真实 SDK transport 调用，不是逐字节 stdio 帧或通知 dump。每格保留 backend 原库、实际返回值、进程路径／PID 与 stdout/stderr，见[audit-final.json](../../../../../.local/world-completion/u13-sdk/audit-final.json)。 |
| 安装 wheel 完整 parser 回归 | [954/954](../../../../../.local/world-completion/u13-sdk/wheel-python-full-first.log)，10.29s；此独立 wheel 与最终矩阵 wheel 字节相同。 |
| 静态和文档 | SDK owning Host face 0 diagnostics、scoped lint 退出0；Root [teams 修复后的 Host build](../../../../../.local/world-completion/u13-sdk/root-build-teams-first.log)退出0，Host／Client aggregate 通过；目录重生成后 [doc-sync 29/29](../../../../../.local/world-completion/u13-sdk/root-doc-sync-first.log)。 |

## 修复与保留失败

真实 source Loader 首次预览返回 `SIMULATION_PRODUCT_INTERNAL`：Administration 的管理 authority 访问 `ctx.teams`，却未在 static inject 声明依赖。已添加实际 `teams` 依赖并重建 Host，两种 source SDK 及 lib／wheel 矩阵重新通过。没有改授权判断、Native 格式、预算或 parser。Raw Context owner 测试和 built Web 路径没有替代这次 source Loader 证据。

其他首次失败都在[最终报告](../../../../../.local/world-completion/u13-sdk/report.json)列明：错误 Vitest config 无 snapshot、observer 自身漏声明真实依赖、查询 limit128 超部署上限、retry fixture 漏 runId、Python 误选 v0 class 及风格诊断。分别修正启动／fixture，不增加上限或放宽生产拒绝路径。

缓存、TMPDIR、wheel、安装 target、后端原库和过程证据全部留在项目内。测试显式选择 Node stdio Host，现有 Python 测试环境提供声明的依赖；不宣称 bundled runtime-bin 平台可执行文件、所有管理动作、真实模型质量或完整 GUI 剧情已验收。U14／U15 与最终 diff 门禁仍独立；后续运行实现变化需要 R11 重新选择相关验证。
