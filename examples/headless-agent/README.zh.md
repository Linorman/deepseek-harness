# headless-agent

[English](README.md) | 中文

本目录负责 headless agent（智能体）行为的回放和真实模型测试组合。其主 `cordis.yml` 刻意挂载已配置的提供方／模型路由、本地 bash 与文件系统工具、直接 subagent 委托、工作流、全新 Agent Ralph 迭代、`todo_write` 和 JSONL 持久化，作为显式自定义／内部覆盖。它不是随附的产品 profile；随附 headless 任务入口会启动 Team。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
#   CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1  # optional local OpenAI-compatible route
#   CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit                       # optional
#   CLOCKY_LOCAL_MODEL_API_KEY=EMPTY                                # required by the adapter; EMPTY for an unauthenticated local route
#   CLOCKY_LOCAL_MODEL_REASONING_EFFORT=medium                       # optional, endpoint-dependent
pnpm clocky --profile headless "fix the failing test in this workspace"
```

当 `CLOCKY_LOCAL_MODEL_BASE_URL` 非空时，真实模型 e2e 套件会选择显式的
`local-vllm` route 和配置的本地模型；否则继续使用 DeepSeek route。本地
profile 发送 `max_tokens`，不会发送不支持的 developer role，并会把 canonical
reasoning level 映射为测试 endpoint 支持的拼写（`high` 映射为 `xhigh`，`minimal`
与 `max` 使用最接近的支持档位）。只有需要 reasoning 时才设置
`CLOCKY_LOCAL_MODEL_REASONING_EFFORT`；省略它会保留提供方默认值。带 key 的
headless 测试使用同样的三个 `CLOCKY_LOCAL_MODEL_*` 变量，无需把 credential 写入
组合或测试 fixture。仓库中的示例组合使用 canonical 的
`http://127.0.0.1:18000/v1` endpoint；programmatic 与 Web smoke harness 会
遵循自定义 base URL。

命令是 [`clocky --profile headless`](../../apps/cli/README.zh.md)：它接受一项非空任务，启动并持久化一个全新的默认 Team，打印 coordinator 明确的最终文本，然后退出。

自定义组合快照套件通过 [`tests/fixtures/headless-driver.ts`](tests/fixtures/headless-driver.ts) 运行本目录的配置。这个未导出且仅供测试使用的进程会在结果记录之前，以 JSONL 发出规范会话事件。随附 Team profile 由 [`tests/headless-team-run.snapshot.ts`](tests/headless-team-run.snapshot.ts) 覆盖，它断言持久 Team 日志和 Participant Session provenance。两种流都属于测试基础设施，不是受支持的 CLI（命令行界面）输出格式；child Session 诊断仅保留为测试覆盖。

## E2B POC overlay

[`e2b.cordis.yml`](e2b.cordis.yml) 使用一个共享 E2B 沙箱替换本地文件系统与子进程提供方，同时保留 `clocky-bash-local` 和相同的面向模型工具。请在 git 忽略的根目录 `.env` 中，将 `E2B_API_KEY` 与 `DEEPSEEK_API_KEY` 放在一起，然后运行凭据门控的实机组合测试；它在同一个沙箱中驱动 FS、Bash、PTY 和 LSP，并证明沙箱最终被删除：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/e2b/e2b/tests/composition.e2e.ts
```

该 overlay 会在沙箱中创建相同的绝对 cwd，但不会上传或挂载宿主工作区。文件与 Bash 变更只存在于 E2B；Cordis、模型调用、agent／会话状态、会话日志、skill（技能）和 SDK 缓冲仍在宿主上。该组合会在超时和资源释放时终止其沙箱。它是提供方组合 POC，而不是完整 harness 迁移或工作区同步功能。

## 高级配置

[`advanced.cordis.yml`](advanced.cordis.yml) 在测试组装中添加 Code Mode 和 Cordis 工具。
