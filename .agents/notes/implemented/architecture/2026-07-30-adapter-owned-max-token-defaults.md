# Agent Note: Adapter-owned max-token defaults

Status: implemented

English | [中文](2026-07-30-adapter-owned-max-token-defaults.zh.md)

## Problem

An LLM adapter could serialize an explicit `GenerateOptions.maxTokens`, but its Cordis configuration could not establish a reconstructable conversation default. Applying a fallback only inside provider serialization would make the wire request differ from the durable `request/header`; putting every provider's default in Agent Loop would instead transfer deployment and model policy into the provider-neutral driver.

## Decision

`LlmResolvedModelInfo.defaultMaxTokens` carries an optional adapter-configured per-request output cap for one exact provider/model route. `LlmRuntime` validates it as a positive safe integer and materializes it into `LlmCallConfig.maxTokens` only when the caller omitted a value. A prepared call identifies materialized `maxTokens` and `reasoningEffort` fields as adapter defaults; explicit request or Agent options remain unmarked and therefore win without clamping.

The agent loop continues to prepare calls before logging `request/header`, so the effective config and markers for fields supplied by adapter defaults become durable request facts before dispatch. Before the next `agent/request` waterfall, the loop removes marked fields from the proposal; exact-model resolution then materializes the current route's defaults again. A provider/model switch therefore cannot mistake a previous adapter's default for an explicit override, while explicit conversation values persist. Direct `LlmRuntime.stream()` calls resolve the same default at the final adapter boundary. The field is a request default rather than a hard model output limit; adapters that preserve provider-owned defaults omit it.

The current pi-ai profile uses `defaultMaxTokens` as a capability fallback of 32,768 tokens and `defaultContextWindow` as a capability fallback of 262,144 tokens for models that neither their profile entry nor the installed catalog sizes. A model entry's explicit `maxTokens` remains the only value that becomes a per-request default.

## Alternatives considered

**Apply the default only in provider serialization.** Rejected because the provider wire would contain a model-visible value absent from the durable request header.

**Set `AgentOptions.maxTokens` in every shipped application.** Rejected because applications would duplicate adapter deployment policy, direct LLM calls would behave differently, and selecting another provider would retain a provider-specific cap.

**Represent the default as a hard per-model maximum.** Rejected because the configured value is the desired request budget, not evidence that every configured endpoint rejects larger outputs. Explicit callers remain authoritative.

**Leave the adapter default in provider control.** Rejected when a deployment needs a stable conversation budget across compatible endpoints; explicit profile data makes that choice reconstructable.

## Consequences

A model entry that explicitly sets `maxTokens` supplies that value as the request default, and the session request header records both the value and that the adapter supplied it. Per-agent and per-request values override it. Changing the route rematerializes the current route's exact default instead of carrying a previous adapter's value forward. Route-level `defaultMaxTokens` remains a capability fallback and never becomes a request default by itself.

The explicit request budget is separate from the model's context and output capabilities. Deployments whose gateway or model supports a smaller budget must configure a smaller model-entry value; explicit configuration is preferable to an undocumented provider fallback.
