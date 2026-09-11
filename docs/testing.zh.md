# 测试策略

[English](testing.md) | 中文

本文定义测试层级及其各自负责的证据。命令见根目录 [AGENTS.md](../AGENTS.md)；Agent Note 承载设计动机。

## 层级

- **单元测试**（`pnpm run test`）：vitest 运行包/示例测试与仓库脚本测试。测试与被覆盖的代码放在一起；每个注册表测试 HMR 清理。优先覆盖边界、错误路径、顺序、竞态和永久约定回归（见 `packages/core/agent-loop/tests/contract-regressions.spec.ts`）。
- **覆盖率门禁**（`pnpm run test:coverage`）：要求 `packages/*/*/src` 按文件 100% 覆盖。未覆盖代码通常应删除。行覆盖只证明执行，不证明交付行为。`packages/shell/pwsh-local/src` 需要真实 `pwsh`；无 pwsh 主机会跳过并豁免，CI 仍执行完整标准。
- **真实模型 e2e**（`pnpm run test:e2e`）：带凭证测试调用各自配置的模型／提供方 route；headless Team、headless-agent 和 text ACP 套件接受通过 `CLOCKY_LOCAL_MODEL_BASE_URL`、`CLOCKY_LOCAL_MODEL_ID` 与 `CLOCKY_LOCAL_MODEL_API_KEY` 配置的本地 OpenAI 兼容 route，而提供方专用和图像套件仍使用各自 credential。每个 suite 在自身 route 不可用时跳过，使 keyless CI 保持绿色（[Agent Note](../.agents/notes/implemented/testing/2026-06-19-real-api-e2e-ci.zh.md)、[本地 Team route](../.agents/notes/implemented/testing/2026-09-04-local-team-real-model-e2e.zh.md)）。
- **快照**（`pnpm run test:snapshot`）：无密钥预期输出覆盖传输/呈现，持久化日志覆盖组装行为。ACP 回放真实 automation-server 会话并比较归一化 JSON-RPC 与重新持久化日志（[Agent Note](../.agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.zh.md)）；headless 场景使用显式 JSONL driver，`apps/cli`负责产品 `clocky --profile headless` 验收。模型 transcript 改动后使用 `test:snapshot:record`，回放输入有效时使用 `test:snapshot:refresh`，并审查每处 diff。`text-turn`固定完整 prompt/tool-schema，其余 fixture 使用 token（[pinned-header Agent Note](../.agents/notes/archived/testing/2026-07-06-pin-request-header-content-in-one-scenario.md)）。
- **Web 浏览器快照**（`pnpm run test:web`；必需的 Linux PR 门禁）：Chromium 比较回放输出与 `apps/web/tests/snapshots/`。CI 使用只读 `CLOCKY_SNAPSHOT=replay`；record/refresh 仅在本地运行并审查 diff（[web e2e 车道](../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)、[CI 门禁决策](../.agents/notes/implemented/testing/2026-07-30-web-browser-snapshot-ci-gate.zh.md)）。`test:web`会[先构建](../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md)以生成插件 CSS。

会话 fixture 保留 header 与 payload，但省略正文序号／时间 envelope。回放会合成这些字段；运行时持久化不变。fixture 使用规范打包行；[迁移器](../scripts/migrate-packed-session-fixtures.ts)会改写旧布局。

Team Hub load lane 默认覆盖 4,096 条 SQLite record；设置 `CLOCKY_TEAM_HUB_LARGE_LOAD=1` 可运行 opt-in 的 16,384-record bounded replay benchmark。两者都不定义生产 latency budget。

## 带密钥策略：推理（inference）在这里很便宜

真实 API 覆盖是 harness 约定：无密钥测试证明通路，带密钥运行证明模型集成。覆盖文件写入、多轮对话、工具和流中取消。价值最高的是**冒烟测试**：启动真实示例、发送一条提示词并检查外部世界（[事故复盘 0001](postmortem/0001-acp-default-export-drops-inject.zh.md)）。自动跳过保持无密钥 CI 不受阻塞，每个示例都提供两种冒烟测试（[examples/AGENTS.md](../examples/AGENTS.md)）。

## 优先使用真实实现而非 mock

只 mock 高成本或不确定的边界（LLM 适配器、网络、时钟）；下游保持真实。替身只能证明字节通过桥接，不能证明交付工具行为正确。桥接测试将脚本化模型与真实工具、执行器配合：`makeBridgeHarness({ withBash: true })`接入 `clocky-bash-local` 与 `clocky-tool-bash`，然后运行 `echo`。

恢复测试按步骤区分分片前与分片后的失败，并证明失败分片不会派生出消息或工具副作用。覆盖耗尽、取消、策略组合、持久化、状态、协议计数、会关闭传输的空闲超时，以及交付的 Loader 组合。

## 验证外部世界，而非自我报告

e2e 断言应重新运行命令或从外部读取文件；探测 agent 输出可能让作弊的 agent 通过。断言未修改文件逐字节一致。测试自行管理资源：在测试中创建 harness，在 `afterEach`中 dispose；共享 fixture 放在 `tests/harness.ts`，不要放在另一个 `*.e2e.ts` 中，否则导入 spec 会重复注册并重复真实 API 调用。

## 测试真实入口路径

- 产品可见的插件必须有一个非单元的真实组合测试。手动构建的 `ctx.plugin(...)` 套件不够：通过 Loader 和 app/process 启动仅用于测试的 `cordis.yml`，只 mock 外部服务或非确定性输入，断言模型可见的请求/日志、持久状态或用户可见输出。不要把 opt-in 选项混入交付默认值。
- 一个守卫只有在回归真的能让它失败时才有效。对于没有 `inject` 的插件（bundle/组合插件），Loader 冒烟测试在默认导出替换必需的具名导出时仍然绿着——需要添加显式的 `expect('default' in mod).toBe(false)` 加 `unwrapExports` 往返断言，并证明它有效：引入回归、观察变红、回退。
- 「真实入口路径」指已发布的产物：包的 `bin` 所运行的是构建后的 `lib/bin.js`，并由普通 `node` 执行，从而暴露 tsx 会掩盖的失败（结算竞态、模块解析、被吞掉的加载失败）。同样的规则适用于非 index 运行时入口（worker-thread 的同级文件 `lib/worker.cjs`），也适用于多个 bundle 共享的单例模块（`packages/sdk/server/tests/built-scope-carrier.e2e.ts`）。保持构建产物冒烟测试绿色（`packages/examples/*/tests/built-bin.e2e.ts`、`packages/code-runtime/code-runtime-worker-thread/tests/built-lib.e2e.ts`），并断言真正缺失的配置以非零状态退出。

## 测试解析：仅限源码

- 每个 vitest 配置都将 vite-tsconfig-paths 指向 `tsconfig.base.json`；工作区包的裸导入解析到 `src`（[布局](development.zh.md#typescript-project-layout)），绝不会经由包的 `exports` 解析到构建后的 `lib/`，因为其中的陈旧产物会加载第二份模块单例。构建产物只在显式指定时使用：以 `lib` 模式运行的子进程，以及下文的构建产物冒烟测试。

## 测试子进程启动模式

- CI 与已有构建产物的测试通道通过共享双模式启动器，从构建后的 `lib/` 运行每个示例或 Cordis 配置子进程。不要为这些子进程手写 `--import tsx`。
- 不加载 Cordis 的协议与操作系统 fixture 直接通过 Node 运行使用可擦除语法的 `.ts` 文件，不经过 tsx 或根路径映射。
- 只有测试对象本身是源码路径解析时，才可以选择 `src`；在测试中写明这一约定。

## 何时需要快照测试

每项非平凡的模型可见、协议可见或人类可见变更，都必须在同一 PR 中，通过可运行示例所属的快照套件添加或更新无密钥场景。包测试、e2e 断言、mock 与仅测试组合、PR 理由都不能取代组装后的 transcript；必要时应扩展 harness。ACP 自动化场景使用 `examples/<name>/tests/snapshots/`，即基于 [`clocky-acp-snapshot`](../packages/test-support/acp-snapshot/README.zh.md) 套件工厂的场景表（`examples/acp-agent` 为主套件）；`examples/headless-agent` 拥有内部规范事件 JSONL 快照与回放 fixture。`pwsh-tool-turn` ACP 场景启动真实 `pwsh`，在无 `pwsh` 的主机上跳过。已完成的交互式终端旅程使用 `apps/cli/tests/snapshots/` 下由 JSONL 驱动的场景；瞬态呈现使用包内语义矩阵，输入、Loader 选择或终端清理发生变化时还要添加 PTY 用例。浏览器渲染的 Web GUI 旅程使用上述 Web 应用快照套件。两个 SDK 各自独立地投影 agent loop、会话生命周期与 `SessionEventMap`，因此改动其中任何一项都要同时更新两者：`examples/jsonrpc-agent/tests/snapshots/` 拥有 TypeScript 客户端；`scripts/snapshots/python-sdk-single-exe/` 拥有 Python 客户端，且只有必需的 `python-runtime` CI 作业会运行它。新的能力 seam、生命周期变体或 transcript 呈现接口在计划阶段就要列出每个覆盖层级，并在实现前验证 harness 能够表达它们。
