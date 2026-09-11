# Agent Note: 本地 keyed Team 实机模型 e2e

Status: implemented

[English](2026-09-04-local-team-real-model-e2e.md) | 中文

## 问题

Team product spine 已有 keyless replay 与聚焦 provider 测试，但还没有一个 keyed 测试使用真实模型走完 shipped Team start path、coordinator tool call、持久 worker assignment、worker 文件系统证据与面向 human 的 final output。text ACP 入口的 live prompt 与 sandbox-escalation 测试也没有本地模型路径。

## 决策

`apps/cli/tests/real-team.e2e.ts` 负责一个可选的 real-model 场景，测试 headless Team product entry。coordinator 必须启动一条 default-worker task、等待 worker 完成并发布 Team final result；测试验证 worker 的准确文件 bytes 与 stdout final marker，而不信任模型 prose。场景可以使用既有 DeepSeek route，也可以通过 `CLOCKY_LOCAL_MODEL_BASE_URL`、`CLOCKY_LOCAL_MODEL_ID` 与 `CLOCKY_LOCAL_MODEL_API_KEY` 显式选择本地 OpenAI-compatible route。本地 overlay 让 endpoint 与 model 由环境驱动，使用 `max_tokens`，关闭不支持的 developer role，将 canonical reasoning level 映射为测试 endpoint 支持的拼写（`high` 映射为 `xhigh`，`minimal` 与 `max` 映射为最接近的支持档位），并且绝不保存 credential 或机器特定路径。text ACP 示例与 Python SDK bundled runtime 的 live development 也使用相同的本地 route contract，而图像专用与已记录 snapshot overlay 继续保留各自的 provider contract。

## 考虑过的替代方案

**只使用外部 provider。** 不采用，因为模型可用性、quota 与网络行为会让 Team acceptance signal 在本地开发中昂贵且不确定。

**用 fixture replay 替代真实模型。** 不采用，因为待补的 acceptance gap 是 model-to-tool orchestration 与 worker admission；replay 能证明 transport reconstruction，却不能证明 live coordinator 能选择并等待持久 task。

**把本地 route 设为无条件默认。** 不采用，因为 deployment 仍应通过显式 composition 选择 provider；本地 route 是测试 opt-in，既有外部 route 继续作为 fallback。

## 影响

仓库现在有了一条不把 secret 放入 source、fixture 或 test command 的可复现本地 keyed Team e2e 路径。同一个由环境选择的 route 也复用于已有的 headless live harness、text ACP 示例、Web smoke scaffold 与 Python SDK bundled runtime，因此 real file edit、bash、todo、Code Mode、compaction、resume、ACP prompt、sandbox-escalation、browser smoke 与 Python client 运行都可以使用本地 endpoint，而无需重复 provider setup。Qwen route 会将 canonical `high` reasoning 转换为 endpoint 接受的 `xhigh` 拼写。除非本地 endpoint 可用，这些场景仍不进入 keyless CI；它们的 real-model contract 覆盖了 replay 无法建立的行为。更复杂的 compiled workflow plan、图像 overlay 与 remote endpoint 行为仍需要各自的 keyed 或 transport-specific evidence。

## 验证

使用 `CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1`、`CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit` 与 `CLOCKY_LOCAL_MODEL_API_KEY=EMPTY` 执行 `pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/real-team.e2e.ts --reporter=dot`，1/1 测试通过，耗时约 285 秒。worker 准确生成了 `TEAM_WORKER_PROOF` 加换行，coordinator 输出了 `TEAM_REAL_MODEL_FINAL`。

使用相同的本地变量执行 `pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/real-model.e2e.ts examples/headless-agent/tests/full-loop.e2e.ts examples/headless-agent/tests/coding-task.e2e.ts examples/headless-agent/tests/todo-write.e2e.ts examples/headless-agent/tests/code-mode.e2e.ts examples/headless-agent/tests/compaction.e2e.ts examples/headless-agent/tests/resume.e2e.ts --reporter=dot`，13/13 测试通过。本地 harness 默认保留 endpoint 的 reasoning 行为，只有显式设置 `CLOCKY_LOCAL_MODEL_REASONING_EFFORT` 才会覆盖；canonical `high` 会转换为当前 Qwen endpoint 接受的 `xhigh` 拼写。

使用相同的本地变量执行 `pnpm exec vitest run --config vitest.e2e.config.ts examples/acp-agent/tests/acp.e2e.ts examples/acp-agent/tests/escalation.e2e.ts --reporter=dot`，6/6 测试通过，其中包括真实 ACP prompt／file verification 与 sandbox approval／rejection flow。

设置 `CLOCKY_EXAMPLE_MODE=lib` 并使用相同本地变量时，同一条 ACP 命令通过 built `lib/` entry 运行，也通过 6/6 测试。

设置 `PYTHONPATH=python/sdk/src:python/sdk-runtime/src` 后执行 `python -m pytest python/sdk/tests -q`，所有可运行的 Python SDK 测试通过；由于本地 runtime 产物不可用，12 个依赖 carrier 的测试跳过。bundled runtime 的 local-route case 包含 `CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high`，且不发起模型请求即可完成。
