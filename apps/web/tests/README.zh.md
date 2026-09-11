# apps/web 浏览器 e2e

[English](README.md) | 中文

这些测试在进程内启动真实的 web 组合，并用真实 Chromium 通过真实 HTTP 驱动它。该 lane
的运行机制——模式、fixture、golden，以及与 `clocky web` 之间刻意保留的组合差异——记录在
[`scaffold.ts`](scaffold.ts) 和
[浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md)中。

随附组合场景从 Team 草稿或已选 Team 协调者转录开始。direct subagent 和 workflow-run UI 场景不属于此 lane。legacy Workspace／Session 浏览器 owner 通过 `legacyWorkspaceSurface: true` 显式加入；该选项只为 custom composition 测试停用 adaptive native picker 并挂载 browse-only Workspace client／Host 行，默认 scaffold 仍保持随附的 Team-first roster。

真实模型 record／smoke 运行可以通过设置 `CLOCKY_LOCAL_MODEL_BASE_URL`、`CLOCKY_LOCAL_MODEL_ID` 和 `CLOCKY_LOCAL_MODEL_API_KEY` 使用本地 OpenAI 兼容服务（未认证的本地 route 使用 `EMPTY`）。需要时可设置 `CLOCKY_LOCAL_MODEL_REASONING_EFFORT`；Qwen profile 会将 canonical `high` 映射为 endpoint 的 `xhigh` 拼写。本地 route 是显式配置，并优先于 DeepSeek route；本 lane 默认仍使用无 key replay。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取
Host 服务：`ctx.apiProxy`、Host 侧 `SessionStore`、`ctx.sessionProjectionCache`。运行时驱动
浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 cordis
`Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处
Host 服务访问都无法编译。

## 不要在此 import `@clocky/clocky-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程
拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的
Client face，而该 face 必须等 Host tsdown 生成 `@clocky/clocky-goal/remote` 之后才能编译，
于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的
import 点明源模块。这样漂移会表现为选择器未命中或镜像值过期——是响亮的失败，绝不会是静默
通过。`scaffold.ts` 按此规则镜像欢迎声明的 namespace、确认字段、版本和被断言的中文文案。

有两类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从
`@clocky/clocky-client-web` import `AppWebEntry`、从
`@clocky/clocky-client-modules/client` import boot manifest 类型：启动真实 shell 正是该
harness 的用途，且这两个包本来就在 Host 图中。另外，chat 场景从
`@clocky/clocky-client-runtime/client` import `conversationContextKey`，因为 Web 组合包为
浏览器名录声明了该 runtime。若这种可达性离开图，就像其余情形那样镜像该 helper。

没有任何机制强制这条规则；靠 review 守住它。
