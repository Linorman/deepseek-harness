# Agent Note: 适配器持有的最大 token 默认值

Status: implemented

[English](2026-07-30-adapter-owned-max-token-defaults.md) | 中文

## Problem

LLM（大语言模型）适配器可以序列化显式的 `GenerateOptions.maxTokens`，但无法通过 Cordis 配置建立可重建的对话默认值。仅在提供方序列化中应用回退，会导致协议请求与持久 `request/header` 不一致；若将各提供方默认值都放进 agent loop（智能体循环），则会把部署与模型策略转移到提供方无关的驱动器中。

## Decision

`LlmResolvedModelInfo.defaultMaxTokens` 携带一条确切提供方／模型路由的可选单次请求输出上限，该值由适配器配置。`LlmRuntime` 将其校验为正的安全整数，并且仅在调用方省略值时才填入 `LlmCallConfig.maxTokens`。准备后的调用会将已填入的 `maxTokens` 和 `reasoningEffort` 字段标记为适配器默认值；显式请求值或 agent 选项不带该标记，因此优先且不会被自动调整。

agent loop 仍在记录 `request/header` 前准备调用，因此生效配置和标明哪些字段由适配器默认值填入的标记，会在分派前成为持久请求事实。下一次 `agent/request` waterfall（瀑布式事件）前，agent loop 会从提议中移除带标记字段，随后精确模型解析会再次填入当前路由的默认值。因此，切换提供方／模型不会把前一个适配器的默认值误当成显式覆盖，而显式对话值则会保留。直接调用 `LlmRuntime.stream()` 时，也会在最终适配器边界解析同一默认值。该字段是请求默认值，而非模型输出硬上限；沿用提供方自有默认值的适配器会省略它。

当前 pi-ai profile 使用 `defaultMaxTokens` 作为 32,768 token 的能力回退值，使用 `defaultContextWindow` 作为 262,144 token 的能力回退值，适用于 profile 条目和已安装目录都没有给模型标定容量的情况。只有模型条目显式设置的 `maxTokens` 会继续成为单次请求默认值。

## Alternatives considered

**仅在提供方序列化中应用默认值。** 不予采纳，因为提供方协议会包含持久请求 header 中缺失的模型可见值。

**在每个已发布应用中设置 `AgentOptions.maxTokens`。** 不予采纳，因为应用会重复适配器部署策略，直接 LLM 调用的行为将不同，而且选择另一个提供方后仍会保留提供方专用上限。

**将默认值表示为每模型硬上限。** 不予采纳，因为配置值是所需请求预算，无法证明每个已配置端点都会拒绝更大的输出。显式调用方仍具有最终决定权。

**由适配器默认值控制。** 当部署需要兼容端点使用稳定的对话预算时不予采纳；显式 profile 数据才能让该选择可重建。

## Consequences

模型条目显式设置的 `maxTokens` 会提供单次请求默认值，会话请求 header 会同时记录该值以及它由适配器提供。每个 agent 和每次请求的值都会覆盖它。更改路由会重新填入当前路由的精确默认值，而不会继续沿用前一个适配器的值。路由级 `defaultMaxTokens` 仍是能力回退值，不会自行成为请求默认值。

显式请求预算与模型的上下文及输出能力彼此独立。如果部署使用的 gateway 或模型仅支持较小预算，则应配置更小的模型条目值；显式配置优于无文档说明的提供方回退值。
