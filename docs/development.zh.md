# 开发指南

[English](development.md) | 中文

请从搭建教程开始；构建、检查和 Git 恢复操作见贡献者参考。

<a id="setup-tutorial"></a>

## 搭建教程

### 前置条件

- Node.js 22.19–22.x 或 24+，以 [`package.json`](../package.json) 的声明为准。CI 覆盖 22.19、24 和 26。
- 启用了 Corepack 的 pnpm。仓库固定使用 `pnpm@11.7.0`；如果 `pnpm --version` 无法通过 Corepack 解析，请运行 `corepack enable`。
- Git 2.26 或更高版本；钩子设置使用 worktree 专属配置。
- 可选：演示和真实模型 e2e 测试所需的提供方凭证；见[环境变量](#environment-variables)。

### 首次搭建

在仓库根目录运行：

```sh
pnpm install
pnpm run typecheck
```

类型检查成功即表示搭建完成。安装还会配置 worktree 本地的 Lefthook 钩子和 `clocky-translation-pairing` Git 合并驱动。如果缓存恢复或跳过 `postinstall` 导致任一集成缺失，请运行：

```sh
node scripts/install-lefthook.mjs
```

移动检出目录后，请重新运行安装脚本。如果脚本拒绝现有 Git 配置或陈旧锁，请遵循其诊断；[钩子路径决策](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.zh.md)和[配对合并决策](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.zh.md)说明所有权与恢复方法。

## 贡献者参考

<a id="typescript-project-layout"></a>

### TypeScript 项目布局

Host 与 Client 使用独立的 aggregate program，因为它们以不同服务类型对 Cordis `Context` 的相同键做声明合并。每个普通包只登记进一个 aggregate。

| 文件 | 角色 | 是否构成 program？ |
|---|---|---|
| `tsconfig.json` | solution 根、tsserver 入口，以及示例和脚本的 tsx 解析配置；引用两个 aggregate。 | 否 |
| `tsconfig.host.json` | Host 包、示例、测试、脚本、website，以及 `api/remotes` 的 Host project。 | 是 |
| `tsconfig.client.json` | Client 包及其测试、`apps/web`，以及 `api/remotes` 的 Client project。 | 是 |
| `tsconfig.base.json` | 共享编译选项与源码 `paths`；Vitest 的解析配置。不要添加 `include` 或 `files`。 | 否 |
| `tsconfig.base.client.json` | Client aggregate 与 Client 包继承的浏览器设置。 | 否 |

全仓 `ts.Program` 必须显式以 Host 或 Client aggregate 为种子。把根 solution 展平进一个 program 会导致 `Context` 合并冲突。模块解析可以横跨两侧而不产生该冲突；见[双 aggregate 决策](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.zh.md)。

仅 `api/remotes` 将包 tsconfig 拆成 Host 与 Client leaf：Host Typert 生成 Client 导入的声明。直接消费方必须引用匹配的 leaf，`constraints` 会检查这一点。普通 Client 插件在 Client 阶段生成 Node 与浏览器入口。[`api-remotes` README](../packages/api/remotes/README.zh.md)负责说明拆分和构建顺序。

完整构建依次执行 Host tsc → Host tsdown/Typert → Client tsc → Client tsdown → Web 构建。tsdown 消费 `lib/types` 中的 tsc 输出；实现细节见[发射所有权决策](../.agents/notes/implemented/process/2026-06-17-ts-build-config.zh.md)和[生成约定构建决策](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.zh.md)。[API Gateway](api-gateway.zh.md)说明生成的 Remote 产物及其开发回退。

静态检查和测试将工作区 import 解析到 `src`。消费构建产物的检查显式声明构建依赖。公共 `typecheck`、`lint`、`lint:fix` 和 `doc-typecheck` 会准备生成的 Host-for-Client 声明；内部 `*:contracts-ready` 命令要求该准备已经完成。类型感知 lint 还需要两侧声明；Client project 使用 `disableSourceOfProjectReferenceRedirect`，避免将 Host 实现引入 Client program。

`pnpm run build` 内联调用方精确的公开 `CLOCKY_CLIENT_*` 值；未设置的值保持缺省。完整构建会记录这些值和 Client 产物摘要。release 打包和基于构建产物的 Web 测试会拒绝缺失或陈旧记录。`pnpm run build:clocky` 使用 CI/release 配置。

运行消费 `lib/` 的检查前，请先构建一次；这包括 `hygiene` 中的 `publint` 和 NodeNext 声明消费方。普通提交和推送无需完整构建，除非所选检查会消费产物。

<a id="environment-variables"></a>

### 环境变量

DeepSeek profile 和需要密钥的演示从环境变量或仓库根目录被 gitignore 的 `.env` 读取凭证。Headless Team、headless-agent 与 text ACP（Agent Client Protocol）live 测试也接受本地 OpenAI 兼容 route：

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1
CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high # optional; local Qwen maps high to xhigh
```

`DEEPSEEK_BASE_URL` 默认为公开 API。非空的本地 base URL 会选择本地测试 route；model id 可选，但该 route 需要 `CLOCKY_LOCAL_MODEL_API_KEY`（仓库提供的未认证服务器使用 `EMPTY`）。仓库内的 headless 与 ACP 示例使用 `http://127.0.0.1:18000/v1`。可选推理强度 `high` 在实测 Qwen endpoint 上映射成 `xhigh`。两种 route 均不可用时，这些套件会跳过；其他套件保留各自提供方的凭证条件。请勿提交凭证；见[测试策略](testing.zh.md)。

### Git 集成

仅当两侧配对文档均使用 Git 默认文本策略且能干净合并时，配对合并驱动才会推导发生冲突的 `.i18n.yaml` 记录。配对文档冲突、非文本策略和无效记录会保持未解决状态。合并停止后，请运行：

```sh
pnpm run resolve-translation-pairing-conflicts
```

该命令暂存每份可安全生成的配对记录；如果其他配对冲突仍需手工处理，则以非零状态退出。[配对约定](i18n/README.zh.md#the-pairing-contract)定义接受的文件和状态。

如果已安装驱动的运行时变得不可用，启动器会写入 Git 的普通文本结果，并让伴随文件保持未解决状态。请恢复依赖后重新运行恢复命令，或使用 `git merge --abort`。如果 `pre-merge-commit` 拒绝干净合并，结果会保持暂存但不创建提交：修复后运行 `git commit`，或中止合并。确切的索引与 `MERGE_HEAD` 状态见[失败约定](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.zh.md#failure-contract)。

[Lefthook 配置](../lefthook.yml)定义本地检查点：

- `pre-commit`：暂存配对及冻结 Agent Note 检查、不加载项目的 Oxlint 修复及一次有界重试、输入变更时重新生成 notices、空白检查与 vendor manifest（元数据清单）守卫。vendored 源码改动必须与其 manifest 更新一起暂存。
- `pre-merge-commit`：自动合并提交前检查暂存配对和冻结 Agent Note。
- `pre-push`：`pnpm run typecheck`，包含 Client tsc 前的 Host 约定生成。

钩子不运行测试、快照、全量文档检查或 hygiene。请运行下列相关检查；CI 负责全量覆盖率和兼容性。`pnpm run check:all` 是可选的全面本地检查，独立于钩子。

### CI 门禁

无密钥 [CI 工作流](../.github/workflows/ci.yml)将独立检查分组到各 lane；产物消费方等待各自 lane 内的一次构建。单独的真实 API 工作流按配置的 worker 上限运行 e2e 测试。当前门禁与 job 清单以 [scripts/run-gates.ts](../scripts/run-gates.ts) 和工作流文件为准。

<a id="daily-commands"></a>

### 日常命令

请使用 [dsh-pre-push-checks](../.agents/skills/dsh-pre-push-checks/SKILL.md) 按改动行为选择检查。必需检查运行一次；输入变化、失败或风险未解决时再扩展或重跑。可用脚本以 [`package.json`](../package.json) 为准。

| 命令 | 用途 |
|---|---|
| `pnpm run clean` | 删除构建输出及已删除包的安全残留。 |
| `pnpm run test` | 单元测试，可按路径或测试名称筛选。 |
| `pnpm run test:coverage` | 包源码的逐文件覆盖率门禁。 |
| `pnpm run test:e2e` | 真实模型测试；route 不可用时自动跳过。 |
| `pnpm run test:snapshot` | 无密钥的组合输出回放。 |
| `pnpm run test:snapshot:record` | 使用凭证重新录制模型 transcript（文本记录）。 |
| `pnpm run test:snapshot:refresh` | 从有效回放输入刷新预期输出。 |
| `pnpm run typecheck` | 准备 Host 约定，再检查 Client 类型。 |
| `pnpm run lint` | 类型检查后的类型感知 lint。 |
| `pnpm run duplication` | 跨文件 TypeScript 克隆检测。 |
| `pnpm run build` | 准备全部运行时与 Web 产物。 |
| `pnpm run hygiene` | 构建后的包与工作区检查，需先构建。 |
| `pnpm run doc-sync` | 文档检查。 |
| `pnpm run docs:dev` / `pnpm run docs:check` | 预览／验证文档站。 |

包公开行为变更需更新其 README 和 JSDoc；有意更新快照时需评审每份 diff。`check:windows-wine` 仅用于诊断已知 Windows 失败；常规 Windows 检查由 CI 负责。

### 演示

运行以下源码演示前，请先构建一次。每项演示均需通过环境变量或仓库根目录 `.env` 提供其提供方 profile 命名的 API key：

```sh
pnpm run build
pnpm clocky --profile headless "summarize this workspace"
pnpm run demo:cordis
pnpm run demo:acp
```

Headless 执行一次编程任务。Cordis 演示检查并修改其实时插件运行时（默认 `web`，也可使用 `acp`）。ACP 演示通过 JSON-RPC stdio 提供全新 agent（智能体）会话。

### TODO 标记

- `FIXME`：发布阻塞项；带此标记发布需评审者明确同意。
- `TODO`：资源到位后尽快修复。
- `XXX`：可能的未来工作，不作承诺。

<a id="documenting-types-verbatim-ts-type-equiv"></a>

### 逐字记录类型定义（`ts type-equiv`）

[子系统页面](subsystems/README.zh.md)粘贴源码声明及其原始 JSDoc。请使用 ` ```ts type-equiv ` 围栏，并在 `scripts/type-equiv.manifest.json` 登记文档、源码和符号：

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

对省略实现体的类，请使用 ` ```ts public-api ` 和 `"projection": "public-api"`。投影保留公共字段、构造函数、访问器、方法及类／成员 JSDoc，省略实现体和私有／受保护成员。

`verify-type-equiv` 比较声明和每条原始 JSDoc，忽略空白与非 JSDoc 注释。主块与 manifest 条目按文档、符号和投影一一对应。声明／JSDoc 变化时需更新粘贴内容；增删主块时需更新 manifest。

仅当中文对侧的完整受跟踪围栏序列按字节一致且顺序相同时，才会复用主条目。`doc-typecheck` 对可编译围栏使用同一派生规则；两种源码等价围栏均排除在编译及其 opt-out 比例计算之外。
