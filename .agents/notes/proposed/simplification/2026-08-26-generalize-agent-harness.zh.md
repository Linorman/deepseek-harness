# Agent Note: 删除第一方产品耦合，将项目改为通用 agent harness

Status: proposed

[English](2026-08-26-generalize-agent-harness.md) | 中文

## 问题

本仓库的架构足以承载通用 agent harness（智能体框架），但产品身份、默认组合、模型提供方集成、浏览器呈现、存储命名、发布系统、SDK、文档仍编码了单一第一方产品。耦合并不只存在于可见文案中，还包括 npm scope 与包前缀、CLI（命令行界面）和环境变量名称、插件 manifest（元数据清单）键、浏览器全局变量、会话引用 URI、SQLite application id、SDK 协议身份、Python 分发包和模块、构建 profile、Git 标签和 ref、CSS 设计 token 前缀、请求标头、默认模型提供方路由、官方遥测、品牌资产、生成目录、测试、快照与双语文档。

审计执行时排除了 `vendor/`、构建输出、依赖与冻结的已归档 Agent Note；其余 5,527 个文件中有 3,784 个匹配品牌候选模式。仅 `@deepseek-ai` 就出现在 3,222 个文件中，缩写 `dsh` 则出现在 3,507 个文件中。浏览器设计层当时还在 150 个文件中使用了 405 个不同的 `--dsw-*` 或 `--dsh-*` 自定义属性名。这些数字用于发现范围，并非需要长期维护的清单；文本替换仍然无法区分产品身份与 DeepSeek 模型提供方、更新二进制资产，或决定哪些持久化标识和协议标识必须破坏兼容性。

有 5 个包可以直接删除：`packages/llm/llm-deepseek`、`packages/web/web-search-deepseek`、`packages/client/ui-brand-official`、`packages/skill/skill-badge` 与 `packages/identity/anonymous-user-id`。计入跨仓库消费方、生成参考、fixture（测试前置数据）与快照之前，这些包已包含约 11,000 行受 git 跟踪的文本。直接模型适配器还让通用 SDK 服务器与随附组合对一个模型提供方进行特殊处理；Web 设置包则包含 DeepSeek 专用首次使用步骤和直接适配器编辑器。

仓库目前不包含官方插件市场。[`apps/cli/src/plugin.ts`](../../../../apps/cli/src/plugin.ts) 会把显式提供的包、Git、file 或 link spec 转发给 pnpm；[`ui-settings-plugin-inventory`](../../../../packages/client/ui-settings-plugin-inventory/README.zh.md) 读取本地 Loader 树；[`ui-settings-plugins`](../../../../packages/client/ui-settings-plugins/README.zh.md) 编辑已挂载插件注册的设置 namespace。仅有的 `marketplace` 引用位于产品集成测试中，用于禁止 Claude Code 自身的官方 marketplace 自动安装。删除这些本地机制会删掉插件功能，而不是删掉官方商店。

要求文本绝对不存在还会与三类并非活跃产品品牌的记录冲突。MIT 许可证要求保留原始版权声明，DeepSeek 必须继续作为具名的受支持模型提供方，而当前仓库策略又把已归档 Agent Note 冻结为不可变历史记录。本提案因此定义一份严格白名单和明确的归档排除项，不假装每一次词语出现都具有相同含义。

## 提案

采用提供方无关的产品身份，并删除每一项 DeepSeek 专用产品集成。DeepSeek 只通过通用 `llm-pi-ai` 适配器的 `deepseek` 模型提供方 profile 获得支持。它不再是随附默认值，不再拥有专用首次使用面板、搜索 API、模型设置族、请求身份标头、遥测路径或 SDK 后备行为，也不再决定产品名称或视觉设计。

### Clocky 替代身份

所有者已将产品命名为 Clocky，并批准在本地使用以 Clocky 派生的技术标识。npm／PyPI 发布所有权和最终公开仓库 URL 仍是发布阶段的外部输入；本检出不会冒领这些归属。

| 范围 | 当前值 | 必需目标 |
|---|---|---|
| 面向用户的产品名称 | `DeepSeek Harness` | `Clocky` |
| npm 组织与包前缀 | `@deepseek-ai/dsh-*` | `@clocky/clocky-*`；发布所有权仍是发布阶段输入 |
| CLI 可执行文件与根脚本 | `dsh` | `clocky` |
| 环境变量与文件系统身份 | `DSH_*`、`~/.dsh` | `CLOCKY_*`、`~/.clocky` |
| 插件 manifest namespace | `dsh.profile`、`dsh.bundle`、`dsh.client` | `clocky.profile`、`clocky.bundle`、`clocky.client` |
| 浏览器与协议身份 | `__DSH_BOOT__`、`dsh-session:`、`deepseek-harness-sdk-runtime` | `__CLOCKY_BOOT__`、`clocky-session:`、`clocky-sdk-runtime` |
| Python 分发包、模块与公开类 | `deepseek-harness-*`、`deepseek_harness*`、`DeepSeekHarness*` | `clocky-*`、`clocky*`、`Clocky*`，且不提供别名 |
| 仓库与发布身份 | DeepSeek GitHub URL、`clocky-v*`、`build:official`、DSH ref 与产物名 | 所有者提供的仓库 URL；`clocky-v*`、`build:clocky` 以及 Clocky ref 与产物名 |
| 持续存在的视觉身份位置 | 鱼／鲸标记、字标、favicon、PWA 图标与远程徽章 | 一套机器人 SVG 回退图形；在部署提供自有品牌之前始终渲染 |

应优先采用语义名称，而不是把一个缩写机械替换成另一个缩写。通用概念应使用 `agent harness`、`profile bundle`、`client boot manifest`、`session reference`、`release build` 等名称；只有由外部持有的产品标识才需要使用选定的产品 token。

### 定义允许保留的 DeepSeek 模型提供方范围

允许集合仅限模型提供方配置与验证：模型提供方 id 和显示名 `deepseek`／`DeepSeek`、DeepSeek 模型 id、`DEEPSEEK_API_KEY`、可选的模型提供方端点（如 `DEEPSEEK_BASE_URL`）、pi-ai 的 `thinkingFormat: deepseek` 与其他提供方协议值、模型提供方文档，以及聚焦的 mock 或真实 API 测试。除非版权持有人授权另一份合法有效的声明，否则 [`LICENSE`](../../../../LICENSE) 中的原始版权声明保持不变。

禁止集合包括 `DeepSeek Harness`、`DSH`、作为产品或包前缀的 `dsh`、`@deepseek-ai`、`deepseek-harness`、`deepseek-official`、`x-deepseek-harness-*`、DeepSeek 鲸鱼与字标、以 DeepSeek 命名的颜色或 CSS token、DeepSeek 社区与遥测端点，以及通用 fixture 或产品文案中的任何 DeepSeek 引用。新的删除决策本身可以引用禁止标识，以定义并验证其不存在。

目标范围是活跃的受跟踪源码与文档，以及新构建或打包的产物。本提案不重写冻结的已归档 Agent Note、Git 历史、已经发布的注册表版本或外部 issue／discussion 历史。删除或弃用外部产物属于另一项由所有者执行的发布任务；最终结果必须披露归档例外，而不能宣称每一个历史文件都不存在旧文本。

### 删除专用第一方集成

删除 `packages/llm/llm-deepseek/`。移除其直接 HTTP／SSE 转换器、Files API 客户端、上传索引与配额清理、inline 后备、V4 目录默认值、`deepseek-official` 路由、自定义推理与连续对话行为、应用／请求身份标头、包测试与带密钥 e2e。移除只为此包存在的全部依赖、配置行、SDK 后备 import、设置分支、生成目录条目、示例、fixture 与快照。

删除 `packages/web/web-search-deepseek/`。移除兼容 Anthropic 的 DeepSeek Messages 搜索调用、`DEEPSEEK_SEARCH_BASE_URL`、`web/deepseek-search-llm-request`、默认 `web_search` 挂载、专用 Web 搜索设置卡与凭据控制器，以及组装后的浏览器场景。保留提供方无关的 `ctx.web` 能力、`tool-web`、HTTP fetch、Exa 和 Perplexity 包，作为可选的组合构件；随附产品不默认装配任何出站 Web 提供方。

删除 `packages/client/ui-brand-official/`、`packages/skill/skill-badge/`、`BrandWordmark.tsx`、`FishLogo.tsx`、两份品牌 favicon、网站字标、`BRAND_GUIDELINES.*`、徽章资产及快照、社区二维码／图片链接，以及 base 和 Web 组合包中的官方品牌行。保留通用浏览器品牌 slot，使部署插件能够提供自己的标记与名称。每个持续存在的图片位置都使用下文定义的机器人回退图形；任何图片位置都不得回退为空内容、损坏 URL 或仅有文本。

从 `ui-settings-models` 删除 DeepSeek 专用首次使用流程与产品声明：`DeepSeekOnboardingDialog`、`WelcomeNotice`、对应文案和展示文件、`deepseek-official` 就绪投影，以及 `ProviderEditor` 的直接适配器分支。保留通用「模型」分区与 pi-ai 模型提供方编辑器。如果没有可用路由和默认选择，提供方无关的空状态可以链接到「模型」分区，但不得选择某家供应商。

移除 3 个消费方后，删除 `packages/identity/anonymous-user-id/`。DeepSeek 适配器不再发送 `x-deepseek-harness-user-id`、`x-deepseek-harness-session-id` 或 `x-deepseek-harness-compact`；`/feedback` 不再创建或显示跨服务匿名 id；通用 OpenTelemetry 导出也不再携带由仓库创建的 `user.id`。已有 `.anonymous-user-id` 与直接适配器上传索引文件会成为不再使用的用户数据，应用不得自动删除它们。

移除随附 collector `https://harness-telemetry.deepseeksvc.com/v1/logs` 与受反馈约束的官方上传路径。通用 OpenTelemetry 后端只作为可选部署插件保留，必须显式配置端点，且不得带有第一方目标。保留与远程导出无关的本地命令反馈和逐消息反馈存储。

### 为每个持续存在的视觉身份位置渲染机器人图形

删除品牌图片后，原本为图片设计的位置不得变成空 slot、损坏图片、透明像素或纯文本替代。由 client primitive 层提供一套机器人 SVG 回退图形：方形 `BrandPlaceholderMark`、横向 `BrandPlaceholderWordmark` 与紧凑型 `BrandPlaceholderBadge`。图形必须确实可见、使用稳定 viewBox、同时适配浅色和深色主题、保留宿主传入的尺寸与 class，并避免 DeepSeek 图形、字形、名称和品牌专用颜色 token。Web 与文档站的静态副本必须从同一份已评审图形派生，不能各自漂移。

| 持续存在的位置 | 当前源 | 必需替代 | 可观察证明 |
|---|---|---|---|
| 展开侧边栏标记 | `SidebarRoot.tsx`、`sidebar.brand.mark`、24 px | 在同一个 24 px 位置渲染 `BrandPlaceholderMark` | 在真实 Web 展开侧边栏中可见 |
| 收起侧边栏轨道标记 | `SidebarRoot.tsx`、`sidebar.brand.mark`、24 px | 使用同一标记；静止时可见，现有 panel 图标仍负责 hover | 在真实 Web 收起侧边栏中，hover 前可见 |
| 展开侧边栏名称图片 | `SidebarRoot.tsx`、`sidebar.brand.name`、高度 24 px | `BrandPlaceholderWordmark`；构建 revision 继续独立显示 | 宽高非零且不被裁切 |
| 空会话 Hero 标记 | `EmptyHero.tsx`、`conversation.hero.brand.mark`、34 px | 以 34 px 渲染 `BrandPlaceholderMark`；改名鱼类专用 CSS 并删除游动动画 | 在 Hero 标题旁可见 |
| 浏览器标签页与已安装 Web 应用 | `apps/web/public/favicon.svg` 与 `manifest.webmanifest` | favicon 和 PWA 图标共用本地方形机器人 SVG | 资产可解码、manifest 能解析，浅色／深色截图都显示 |
| 文档导航标题 | `website/public/wordmark.svg` 与 VitePress `siteTitle` | 本地横向机器人字标 SVG | 在两种文档语言和两种主题中可见 |
| 文档 favicon | `website/public/favicon.svg` | 本地方形机器人 SVG | 文档构建提供可解码、非空的图片 |
| 教程与署名徽章位置 | `docs/cordis-tutorial/*.md` 中的远程 Shields 徽章及随包徽章引用 | 在现有 121 × 20 位置渲染本地 `BrandPlaceholderBadge` | 每个投影页面都能加载本地图片，不依赖网络 |

3 个浏览器品牌 slot 继续允许替换。没有部署占位者时，其 fallback 始终渲染机器人图形；部署注册占位者后，只替换对应 fallback，不改变侧边栏或 Hero 几何。只有相邻的可访问文本已经命名产品时，装饰性标记才能设置 `aria-hidden`；独立且有含义的机器人标记必须提供明确的可访问名称。

如果某项操作本身不再存在，就应连同内容块和布局一起删除。DeepSeek 社区二维码表、问卷链接和已删除的徽章 skill 目录项因此不使用伪造二维码或死卡片：机器人回退图形会错误暗示仍有可用目标。持续存在的品牌／图片位置必须显示机器人图形；已退役的功能和链接则整块消失。

组件测试必须断言每个 fallback 生成 SVG 图形并遵守请求尺寸。真实浏览器验收覆盖展开侧边栏、收起轨道、空会话 Hero、Web favicon／PWA 与文档站的两种主题；测试检查计算后可见性、非零 bounding box 或图片解码尺寸，并录制截图或仓库要求的 GUI 演示，避免只有 ARIA 快照时漏掉不可见图片。

### 通过通用模型提供方路径保留 DeepSeek

`llm-pi-ai` 已经声明 `deepseek` 模型提供方 profile，可发现其目录，通过共享凭据能力解析 `DEEPSEEK_API_KEY`，接受端点与模型覆盖，并通过提供方无关的附件路径投影图片；它也已经包含 DeepSeek 动态配置的 mock 覆盖。模型提供方指南会在其他提供方旁边记录一份聚焦的 DeepSeek profile；带密钥真实 API 冒烟测试会通过这一路径验证流式响应、工具后续调用、推理以及任何保留的图片能力。

本次删除明确放弃直接适配器的 Files API 生命周期、1,000,000 token 与 V4 模型默认值、任意未列出模型透传、直接 `stop` 支持、提供方专用推理序列化与回传、自定义陈旧文件恢复，以及独立的设计验证孪生实现。只有 pi-ai 目录／配置与测试共同证明的能力才对外宣称。重新引入 DeepSeek 专用适配器必须提交新的「仅模型提供方」提案，且不得恢复产品品牌、默认值、官方面板、遥测、搜索或 SDK 后备行为。

### 把 OpenAI 兼容自定义提供方设为正式支持路径

不新增第二个适配器包。由 `llm-pi-ai` 负责的手动声明路由就是正式支持的 OpenAI 兼容提供方路径，因此目录提供方、私有网关、自托管服务器与未来供应商共用同一套 `ctx.llm` 注册、设置 namespace、凭据能力、模型选择器、回放行为、重试策略与附件投影。单独增加 `llm-openai-compatible` 包会重复这些 owner，并造成路由注册冲突。

公开路由配置位于 `providers.<route>`，包含稳定路由 id、可选 `displayName`、凭据引用 `apiKeyEnv`、绝对 HTTP(S) `baseURL`、`api: openai-completions | openai-responses`；当已安装目录无法提供模型时，还必须声明至少一个模型。模型项包含 id，以及可选显示名称、上下文容量、输出容量、模态、推理声明和逐模型兼容覆盖。最小部署形式如下：

```yaml
llm-pi-ai:
  providers:
    acme-gateway:
      displayName: Acme Gateway
      apiKeyEnv: ACME_GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: acme-chat
          contextWindow: 128000
          maxTokens: 8192
```

Web「模型」页面保留一条提供方无关流程：**添加自定义提供方**要求填写路由 id、显示名称、Base URL、协议、API key 与模型行；编辑时除路由 id 外均可修改，而改名必须删除后重建，因为会话和凭据引用会持久化该 id。**获取可用模型**使用尚未保存的端点与 key 发起有大小上限、可取消的 OpenAI 兼容 `GET /models` 探测，把返回行暂存在表单中但不提交；网关没有模型列表端点时仍可手工录入。

配置只存储 `apiKeyEnv`；secret（密钥）通过 `ctx.credentials` 只写入、每次请求解析一次，并且不会出现在设置描述、日志、会话事件、RPC 响应或提供方发现结果中。普通 `headers` 仅用于非 secret 路由元数据，配置校验会拒绝其中的 `Authorization`、`Proxy-Authorization`、`api-key`、`x-api-key` 及其他已记录的凭据标头名；需要非 Bearer secret 标头的提供方必须使用凭据支持的映射，而不是字面值。产品归属标头继续拥有保留名称优先级。

OpenAI 兼容性被视为协议族，而不是能力承诺。如果未知路由缺少协议、端点或模型集合，配置阶段即失败；引用的凭据缺失时，请求以 `MISSING_CREDENTIAL` 失败；模型不可用时以 `UNKNOWN_MODEL` 失败；`stop`、图片、推理或回放行为只有在对应模型声明与 mock 覆盖共同证明后才受支持，否则继续拒绝。路由级与模型级 `compat` 开关覆盖 developer role、`max_tokens` 与 `max_completion_tokens`、strict 工具、流式 usage、缓存控制及推理序列化等网关差异，不向 agent loop 加入供应商分支。

### 让随附组合保持提供方无关

修改 `agent-default-model`，使部署可以没有已选模型提供方／模型。base profile 挂载没有活动路由的 `llm-pi-ai`；「模型」页面可以声明任意目录或自定义路由，并保存默认选择。Web 在启动模型轮次前以可操作的提供方未配置结果拒绝请求；headless 与 SDK 入口必须获得显式选择或已保存的部署默认值。任何入口都不得猜测 DeepSeek、OpenAI 或其他提供方。

从 `sdk/server`、TypeScript SDK、Python SDK、subagent SDK 配置、ACP／headless／JSON-RPC 示例、标题生成与通用测试 fixture 中移除 DeepSeek 默认值。SDK 服务器不得在 `initialize` 期间挂载适配器；外围 Cordis 组合拥有适配器。通用快照使用脚本化的 `test-provider`／`test-model`；只有 DeepSeek 模型提供方测试才使用 DeepSeek id 与凭据。

保留本地 Host `/api` 网关、Typert Remote、Web BFF、浏览器连接传输与「模型」API。它们是提供方无关的应用接口，并非 DeepSeek 官方 API。它们仍要改写包 scope 与产品名称，但行为保持不变。

### 保留插件能力，不提供商店

保留 profile 组合包、Loader、动态 Cordis 插件、CLI 的显式 pnpm 转发、包／Git／file／link 安装、插件设置 namespace 与卡片、本地插件清单 Remote 与标签页、client 组合包加载、HMR（热模块替换）资源释放、skill（技能）和 MCP 组合。把它们的包 scope、CLI 文本、manifest namespace、GitHub topic、浏览器启动全局变量与文档改为选定的中性身份，但不改变其所有权模型。

不得添加精选目录、推荐 feed、商店端点、包 allowlist、账号要求或静默自动安装。新增验收测试：通过显式 file spec 安装一个本地 fixture 组合包，更新已改名的组合包声明，启动它，并在本地清单中观察到它。保留 `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`；它用于阻止第三方产品自动安装其 marketplace，并不是 harness 商店。

### 不保留兼容别名，改写技术身份

通过一份经过评审且确定性的改名映射，一次覆盖包 manifest 与依赖、import 与 declaration merge、包 JSDoc、`tsconfig` 路径与项目引用、tsdown／Vite／client 组合包正则、Cordis 配置行、包不变式、生成目录源、Python 元数据与模块、可执行文件名、环境变量键、CSS 变量与 keyframe、浏览器全局变量、URI scheme、SQLite 所有权 id、SDK／ACP 身份、Git 配置键和 ref、CI 变量、发布族和标签、产物名、仓库 URL、文档、测试与快照。

vendored Cordis 包也必须离开 `@deepseek-ai`。更新现有确定性 rescope 映射，并通过 vendoring 流程把它重新应用到选定的中性 scope；不得手工编辑 vendored 文件，也不得以 upstream 包名发布它们。把原生 Landlock 包族及其 trusted publishing 配置改到同一中性发布方 scope。

以原子方式修改协议标识与持久化标识。改名后的 client 启动全局变量在 Host 和浏览器中只有一种拼写；改名后的会话引用 scheme 不提供 decoder 别名；SDK 服务器只报告一个新名称；SQLite 后端使用新分配的 application id 并拒绝旧数据库；受管子进程环境只暴露新前缀；插件包只声明新的 manifest 键。预发布策略不保留旧解析器、环境后备、包别名、重新导出、双标头或 profile 迁移。

### 先更新源文件，再更新派生内容

先编辑包 manifest、拥有行为的 TypeScript／Python 源码、手写配置与生成器输入。随后重新生成 `pnpm-lock.yaml`、组合图、模块／能力图、Cordis／配置／工具／持久化目录、第三方声明、client slot 目录、快照、网站投影与翻译配对记录。不得手工编辑生成的英文目录。

把全部活跃双语文档和活跃 Agent Note 更新为新的当前名称。只有在已实现删除决策保存了被完全删除功能的全部独有理由、备选方案、后果、验证和重新引入条件后，才能合并并删除对应旧记录。通用决策继续保持活跃，只更新其中的名称／路径事实。

已归档 Agent Note 保持逐字节不变，并继续排除在 prose 维护与残留验证器之外。活跃文档和活跃 Agent Note 使用新的当前身份；归档只作为历史证据，不作为当前权威。改写、删除或重置已 seal 的归档需要本提案之外的显式仓库策略变更，不属于本次实施范围。

### 按依赖顺序落地

使用一次协调的预发布变更，或使用每个中间分支都能编译的官方 stack。实际顺序是：保留新身份并加入残留验证器；实现提供方无关默认选择；删除 DeepSeek 直接适配器与搜索；删除官方 UI／遥测／徽章；改写源码中的技术身份；改名 vendor／native／Python／发布系统；更新生成产物与双语文档；验证打包产物与真实模型提供方。不得发布或合并同时混用新旧包 scope 或插件 manifest 键的中间状态。

## 兼容性与数据影响

不保留兼容层。现有 npm 与 PyPI import 名、CLI 命令、`DSH_*` 变量、`~/.dsh`、profile manifest、插件组合包、Python import、SDK 服务器名、浏览器全局变量、会话引用 URI 和 SQLite 数据库均不能在改名后的产品中使用。旧数据保持原样；所有者可以用运行时之外的一次性工具移动或转换，应用既不隐式读取，也不删除。

模型提供方为 `deepseek-official` 的已持久化会话不会被改写成 `deepseek`。新产品下受支持的 DeepSeek 会话通过 pi-ai `deepseek` profile 创建，并记录该路由。删除专用搜索事件和修改品牌化协议标识时，必须在同一实现中更新所有已签入 fixture 与两个 SDK 投影。

已发布产物与 Git 历史会继续显示其历史身份。新发布族只发布新包名。注册表弃用、仓库转移、issue 迁移、标签清理和域名重定向需要单独的外部权限；源码不得自行推断这些操作。

## 既有决策影响

本提案仍处于 proposed 状态，因为发布账号和公开仓库 URL 尚未确定。已落地的集成删减与 Clocky 派生的本地技术身份记录在[已实现的移除决策](../../implemented/simplification/2026-08-27-remove-first-party-integrations.zh.md)中；其限定范围的取代审计已将下列完全替代的实现记录归档。发布与远程仓库的变更仍属于所有者单独负责的发布工作。

| 决策组 | 实现后的分类 | 必需处理 |
|---|---|---|
| [双 LLM 适配器](../../archived/architecture/2026-06-13-twin-llm-adapters.md)、直接适配器推理／文件修复、[DeepSeek 请求身份](../../archived/feature/2026-08-11-deepseek-request-user-id-header.md) | 完全取代 | 已实现的移除决策保留了直接孪生实现的动机及放弃的能力；不再适用的三件套冻结为历史记录 |
| [默认 DeepSeek Web 搜索](../../archived/feature/2026-07-31-web-default-search.md)、[DeepSeek 首次使用流程](../../archived/feature/2026-07-30-deepseek-onboarding-credential-setup.md)、[内置 DSH 徽章](../../archived/feature/2026-08-06-bundled-dsh-badge-skill.md) | 完全取代 | 已实现的移除决策保留了删除理由与验证；不再适用的功能三件套冻结为历史记录 |
| [提供方路由适配器](../../implemented/architecture/2026-07-14-provider-routed-llm-adapters.zh.md)、pi-ai 目录／配置、通用模型设置与附件决策 | 部分取代 | 保留提供方无关机制，只替换直接适配器／默认值／后备事实，并链接本决策 |
| [Client 构建环境](../../implemented/architecture/2026-08-18-client-build-environment.zh.md)、[profile 组合包](../../implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)、[单一 harness home](../../implemented/architecture/2026-07-24-single-harness-home-resolver.zh.md)、仓库命名、vendor rescope、native 与 npm 发布决策 | 部分取代 | 保留机制与理由，把产品／包／路径／发布事实更新为选定身份，并链接本决策 |
| [删除 repository 插件](../../implemented/simplification/2026-08-09-remove-repository-plugin.zh.md)、插件设置标签页与插件自有设置 | 未取代 | 保留唯一显式包管理器分发路径及本地设置／清单行为；只改名标识 |
| API 网关、Web client、Cordis Loader、skill／MCP 与能力 seam 决策 | 未取代 | 保留通用架构，只更新品牌化事实引用 |

## 考虑过的替代方案

**把 `llm-deepseek` 保留为隔离的可选模型提供方包。** 这可以保留 Files API、V4 默认值和独立适配器实现；删除其应用标头与默认挂载也能去掉大量产品耦合。不过它仍会在以提供方无关为目标的仓库中保留 8,000 多行第一方 DeepSeek API 实现和一个专用设置族。通用 pi-ai 路径已经支持 DeepSeek，因此本次删减不采用专用实现。

**只做文本改名。** 这会保留行为，但会在数千个文件中把一个名称替换成另一个名称。专用官方搜索、首次使用流程、遥测、徽章、模型提供方后备、模型默认值和身份关联都会换一个标签继续存在。这只是改名，不是用户要求的通用化。

**删除 DeepSeek 的每一次出现，包括模型支持。** 这会得到最小白名单，但与继续保留 DeepSeek 模型提供方的要求冲突。模型提供方配置、模型 id、凭据、协议值、文档和测试会在证明支持所必需的位置保留。

**把「插件」设置页面与 CLI 插件命令视为官方商店并删除。** 它们不进行目录发现，也不调用官方服务。删除它们会移除本地检查、配置和显式安装，却仍然没有商店可删。因此这些能力会被保留并改名。

**新建独立的 `llm-openai-compatible` 适配器。** 这样会让功能拥有醒目的包名，但 `llm-pi-ai` 已经拥有 OpenAI Chat Completions 与 Responses 协议工厂、声明式提供方路由、模型发现、凭据、回放和设置集成。第二个适配器会重复行为并让路由所有权产生歧义，因此应由通用适配器公开正式支持的配置。

**为了迁移保留旧包、环境变量、profile 与协议别名。** 仓库尚未发布正式版本；别名会永久加倍公开词汇，继续保留禁止的品牌字段，并使残留验证器失去意义。如果确实需要迁移，运行时之外的一次性转换工具更合适。

**改写或删除冻结的已归档设计记录。** 这会让当前树的文本搜索更接近字面零结果，但会违反仓库的 append-only 归档规则，并破坏让这些记录可信的内容 seal。活跃记录会更新或合并；冻结归档与 Git 历史继续作为明确的历史例外。

## 验收标准

- 已提交的身份 manifest 解析全部占位符；在可行处由验证或生成流程消费它。组织、产品、CLI、home、仓库或发布身份不得由无关源文件重复定义。
- 顶层残留验证器扫描活跃的已跟踪路径和文本、生成输出、打包后的 npm tarball、Python wheel 与已知二进制资产 hash。除 `LICENSE`、冻结的已归档 Agent Note、已实现删除决策和聚焦的 DeepSeek 模型提供方文件外，它会拒绝 `DeepSeek Harness`、`DSH`、`dsh`、`@deepseek-ai`、`deepseek-harness`、`deepseek-official`、`x-deepseek-harness-*`、旧 URL、旧 CSS 前缀、旧协议名与已删除品牌资产。
- 5 个删除候选包，以及所有官方品牌、徽章、首次使用流程、DeepSeek 搜索、匿名关联和硬编码 DeepSeek 遥测产物，都不会出现在 workspace、依赖图、生成目录、运行时闭包、lockfile 或发布集合中。
- 随附 base 不包含活动模型提供方、提供方／模型默认值、提供方凭据提示、出站 Web 提供方、遥测目标或提供方专用适配器后备。配置缺失时，以可操作且提供方无关的诊断失败。
- `llm-pi-ai` 能配置模型提供方 `deepseek`、解析 DeepSeek 凭据、列出模型，并在 mock 基础设施上完成流式响应和工具后续调用；带密钥真实 DeepSeek 冒烟测试通过。提供方专用文档会列出受支持能力与明确放弃的能力。
- 用户可以通过「设置」或 `settings.yaml`，用任意绝对 HTTP(S) Base URL、凭据引用和模型列表创建、编辑、选择及删除自定义 `openai-completions` 与 `openai-responses` 路由。mock 端点验证 URL 构造、Bearer 鉴权、Chat Completions 与 Responses 流式响应、工具后续调用、有大小上限且可取消的模型发现、兼容开关、热更新和 secret 脱敏；无效 URL、协议、重复路由、缺少模型、缺少凭据及普通标头中的 secret 都以可操作诊断失败。
- 本地 Host `/api`、Web「模型」页面、ACP／SDK 协议与通用能力 seam 在新身份下继续工作，且不包含 DeepSeek 产品默认值。
- 显式本地 fixture 插件可通过已改名的 CLI 与 manifest 键安装，从 profile 组合包启动，出现在本地清单中，公开自己的设置卡，并能干净卸载。不存在 harness marketplace、推荐端点、精选目录、账号检查或自动安装路径。
- 旧 CLI、npm／PyPI 名称、Python import、环境变量前缀、home 路径、插件 manifest 键、浏览器全局变量、会话 URI、SQLite application id、SDK 身份、标头与发布标签，在新运行时中均没有别名或后备。
- 替代表中的每个持续视觉身份位置，在任何部署品牌插件加载之前都以非零尺寸渲染可解码、非空的机器人 SVG 图形；已注册的 slot 占位者仍能替换它。浏览器与文档截图不显示鲸鱼、DeepSeek 字标、品牌徽章、官方 DeepSeek 凭据面板、产品测试声明或 DeepSeek 专用默认模型／搜索。PWA manifest、文档标题、网站 chrome、favicon、教程徽章与社交／社区文案使用选定的中性身份。
- 源码面类型检查、聚焦单元／e2e 测试、无密钥 ACP／headless／Web 快照、两个 SDK 投影、Python 运行时冒烟测试、构建、hygiene、包／运行时闭包、release pack 与已安装产物探测、doc-sync（文档同步门禁）、网站构建、lint、翻译配对、残留验证器和 `git diff --check` 均通过。只报告实际运行的命令。

## 风险

推荐的模型提供方删减会用通用库依赖换掉已经验证的 DeepSeek 专用行为。pi-ai 升级可能改变其 DeepSeek 目录或协议行为，而直接适配器不再提供独立 conformance 孪生实现。聚焦 mock 与真实 API 测试将成为支持范围。

提供方无关的首次运行不再自动完成。用户必须在第一个模型轮次之前选择并配置模型提供方，非 Web 入口必须显式获得模型选择与组合。错误与「模型」页面路径必须足够清晰，避免提供方无关变成无法使用的空白状态。

「OpenAI 兼容」端点实现的是两个持续演进协议中并不统一的子集。`GET /models` 成功或鉴权连接成功，不能证明工具调用、推理、图片、回放、流式 usage、strict schema 或 token 字段拼写可用。配置应显式记录这些声明，通过 mock server 测试两个协议族，并记录手工兼容开关，不能根据提供方名称或 URL 推断能力。

技术改名覆盖整个仓库，会触及持久化、协议、CSS、打包、文档与发布身份。中间分支很可能无法构建，普通搜索替换还可能破坏模型提供方引用或第三方归属声明。因此必须使用确定性映射，遵循源文件优先和生成输出纪律，并扫描打包产物中的残留。

不兼容策略会有意让已有 home、profile、会话、SQLite 数据库、插件、SDK 客户端和 Python import 失效。即使正式版本尚未发布，仓库所有者也可能拥有有价值的本地数据；交接必须写明哪些数据会停止使用，以及如何在运行时之外保存它们。

机器人回退图形可能意外变成事实品牌、在某个主题中消失、造成布局位移，或在实际没有绘制任何内容时仍通过无障碍树快照。由一个 owner 持有图形、固定宽高比、验证图片解码、断言计算后可见性并拍摄真实截图，可以限制这些风险；部署品牌插件始终可以显式替换机器人回退图形。

MIT 版权声明不能按品牌文案删除，而当前流程也不允许改写已归档 Agent Note。两者都是明确例外。声称每一个历史文件都不存在旧文本并不准确；可执行的承诺只覆盖活跃源码、活跃文档与随附产物。

实施完成前必须取得可用的包名与仓库名。npm／PyPI scope、GitHub 组织、trusted publisher、域名与重定向都属于外部状态；源码树无法自行保留或转移它们。
