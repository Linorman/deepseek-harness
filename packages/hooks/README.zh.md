# hooks/ — 钩子桥接与共享协议

[English](README.md) | 中文

hooks 子系统包含供桥接实现使用的共享协议库。规范扩展接口本身是 harness 的类型化拦截点（参见[拦截扩展点 Agent Note](../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.zh.md)）；「原生钩子」只是这些扩展点上的普通 Cordis 插件。

| 包 | 职责 | 形态 |
|---|---|---|
| [`hook-protocol/`](hook-protocol/README.zh.md) | 共享 shell 钩子协议库 | 库 |

共享库负责与方言无关的解析、匹配、执行和持久事件辅助函数；桥接实现负责其方言特有的事件映射。
