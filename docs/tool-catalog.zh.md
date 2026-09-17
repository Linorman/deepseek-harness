<!-- 英文源文件由 scripts/gen-tool-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-tool-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/tool-catalog.md` 重新记录配对。 -->

# 工具 Schema 目录

[English](tool-catalog.md) | 中文

`packages/*/tool-*` 下的每个面向模型工具包：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 `cordis-surface` 接线区域）的补充；本页列出的是 agent（智能体）可获得的*工具*。

英文源文件由系统**生成**，并通过 `pnpm run verify-tool-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。与 Cordis 目录（纯源码 AST 处理）不同，英文生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定，例如运行时展开的枚举、拼接的描述、由配置决定的名称以及使用原始 JSON Schema 的 MCP 工具。完整性守卫会 glob 匹配 `packages/*/tool-*`；如果生成器的启动 manifest（元数据清单）遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。参见[工具 schema 目录 Agent Note](../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.zh.md)。

范围：`packages/*/tool-*` 下的面向模型工具包，每个工具均使用其**默认**配置启动；但如果某个 Config 字段是**必填项**且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具**名称**可以是加载时配置，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名称或额外名称提供某个包。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

## Tool Package Map

This table connects model-visible tool names to the plugin package and service seams behind them. Exact JSON Schemas follow in the package sections below.

| Tool package | Model-visible names | Requires | Writes / affects | Configured aliases | Deployment note |
| --- | --- | --- | --- | --- | --- |
| `@clocky/clocky-tool-ask-user` | `ask_user_question` | `ctx.tools`, `ctx.userQuestions` | `tool/call`, `tool/result after a UI/provider answers the question` | - | ask_user_question pauses the tool call until the active UI provider returns a human answer. |
| `@clocky/clocky-tools` | `run_code` | `ctx.tools`, `ctx.codeRuntime (execution time)`, `ctx.systemPrompt` | `tool/call`, `one tool/code-dispatch-start + tool/code-dispatch pair per bridged sub-call`, `tool/result` | - | Owned by the tool registry as a reserved transport outside filterable capability layers under `mode: code` / `mode: both` (see the Code Mode Agent Note). Under `code` it is the registry's only wire contribution; the other visible capabilities are declared in a generated SDK section in the loaded runtime's language, and a program calls them through bindings scheduled under the native concurrency contract (submission-ordered starts and policy; concurrency-safe bodies overlap up to `maxParallelSubCalls`) that re-enter the complete guarded tool pipeline and link each nested execution to this outer result. |
| `@clocky/clocky-plan-mode` | `exit_plan_mode` | `ctx.tools`, `ctx.systemPrompt`, `ctx.userQuestions (execution time, opportunistic)` | `tool/call`, `plan/mode inactive on an approved review`, `tool/result` | - | exit_plan_mode stays in the model-facing schema while planning is inactive so transitions add no tool-catalog churn on top of the plan-policy change. Its execute path rejects calls outside plan mode; in plan mode it presents the plan over the user-questions seam (approve / keep planning with feedback), and approval logs plan mode inactive at the step boundary. |
| `@clocky/clocky-tool-bash` | `bash` | `ctx.tools`, `ctx.shell`, `ctx.systemPrompt`, `ctx.shellEnv`, `ctx.jobs at call time for run_in_background` | `tool/call`, `tool/result` | - | The bash tool is the model-facing consumer of the bash executor seam. A `run_in_background` run registers with the generic `ctx.jobs` runtime and is collected/stopped through the `job_*` tools from `@clocky/clocky-tool-jobs`; the `enableRunInBackground` config (default true) removes the parameter entirely when disabled. |
| `@clocky/clocky-tool-pwsh` | `pwsh` | `ctx.tools`, `ctx.shell`, `ctx.systemPrompt`, `ctx.shellEnv`, `ctx.jobs at call time for run_in_background` | `tool/call`, `tool/result` | - | The pwsh tool is the PowerShell-dialect consumer of the bash executor seam for Windows compositions (a PowerShell executor such as `@clocky/clocky-pwsh-local` backs `ctx.shell`); it mirrors the bash tool call-for-call minus sandbox controls — `run_in_background` runs register with the generic `ctx.jobs` runtime and are collected/stopped through the `job_*` tools, and the managed `CLOCKY_*` environment comes from `@clocky/clocky-shell-env`. Each call runs in a fresh process (no persistent PTY session), with native `C:\...` paths and `$env:NAME` variables. |
| `@clocky/clocky-tool-cordis` | `cordis_define`, `cordis_inspect_list`, `cordis_inspect_query`, `cordis_inspect_self`, `cordis_run`, `cordis_stop`, `cordis_undefine` | `ctx.tools`, `ctx.dynamicCordisRunner` | `tool/call`, `tool/result`, `process-local dynamic package lifecycle` | - | Not in any shipped tree (a deliberate opt-in — dynamic package code reaches the real runtime, see .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md). The toolset injects `ctx.dynamicCordisRunner` from `@clocky/clocky-cordis-host-runner`, which owns the definition registry and the vm sandbox; a composition missing it never activates the tools. A running package may register ADDITIONAL model-visible tools until it is stopped, undefined, or Clocky restarts; a full changed request header logs those tool-set changes. |
| `@clocky/clocky-tool-bash-persistent` | `bash` | `ctx.tools`, `ctx.terminals`, `an owning Agent at execution time` | `tool/call`, `PTY shell state`, `tool/result` | - | One owner-isolated persistent bash tool; deployment composition supplies the PTY backend and may override the model-facing environment description. |
| `@clocky/clocky-tool-pwsh-persistent` | `pwsh` | `ctx.tools`, `ctx.terminals`, `an owning Agent at execution time` | `tool/call`, `PTY shell state`, `tool/result` | - | One owner-isolated persistent pwsh tool, the Windows counterpart of the persistent bash tool; deployment composition supplies a pwsh-dialect PTY backend and may override the model-facing environment description. |
| `@clocky/clocky-tool-str-replace-editor` | `str_replace_editor` | `ctx.tools`, `ctx.fs` | `tool/call`, `fs/observed after view presence/absence, edit absence, or successful mutation`, `tool/result` | - | Standalone view/create/unique literal replace/line insert tool over the filesystem seam; it composes with any shell or terminal API. |
| `@clocky/clocky-tool-fs` | `edit`, `read`, `read_image`, `write` | `ctx.tools`, `ctx.fs`, `ctx.systemPrompt`, `ctx.attachments (image-tool registration)`, `ctx.llm + an image-capable route (image-tool execution)` | `tool/call`, `fs/write-intent or fs/edit-intent for mutations`, `fs/observed after read presence/absence or successful file operation`, `durable attachment (read_image)`, `tool/result` | - | The read-before-write/edit policy is added by `@clocky/clocky-fs-observation-policy` (an `fs/*` event-gate plugin, no schema change); a deployment that loads these tools is expected to also load it. The image tool is not registered without `ctx.attachments`; its schema is route-independent, and execution refuses unless the exact routed model declares image input. |
| `@clocky/clocky-tool-fs-search` | `glob`, `grep` | `ctx.tools`, `ctx.subprocess`, `ctx.systemPrompt` | `tool/call`, `tool/result` | - | glob and grep are unconditional discovery tools that spawn the packaged ripgrep binary (`@vscode/ripgrep`) through ctx.subprocess as ordinary foreground calls (never background jobs) — no host `rg` install and no shell layer. The catalog uses `sampleOverCapGlobResults: true`; deployments must choose that behavior explicitly. Capped results save the complete formatted list through the optional ctx.spillStore backend; returned locators are follow-up-readable/searchable when the backend exposes local paths in co-located deployments. |
| `@clocky/clocky-tool-terminal` | `terminal_close`, `terminal_list`, `terminal_open`, `terminal_read`, `terminal_send`, `terminal_signal` | `ctx.tools`, `ctx.terminals`, `ctx.systemPrompt`, `ctx.jobs at call time for run_in_background` | `tool/call`, `tool/result` | - | The six terminal tools are opt-in and complement one-shot shell/filesystem tools. `terminal_send(run_in_background: true)` registers with `ctx.jobs`; TUI, named key sequences, BEL, resize, auto-start, and cross-agent sharing are absent from the schema. |
| `@clocky/clocky-schedule` | `schedule_create`, `schedule_delete`, `schedule_list` | `ctx.tools`, `ctx.sessions`, `Session persistence`, `a future live root Agent` | `tool/call`, `schedule/change create or delete`, `tool/result` | - | Registered only inside live root Agent scopes created after the opt-in Schedule plugin loads. Version 1 accepts after_seconds, explicit absolute at, and bounded fixed-rate every_seconds, and discloses session-local delivery; management reads and mutations require the shared Session persistence barrier. |
| `@clocky/clocky-tool-lsp` | `lsp` | `ctx.tools`, `ctx.lsp`, `ctx.systemPrompt` | `tool/call`, `tool/result` | - | The lsp tool keeps provider selection and language-server subprocesses behind ctx.lsp, so its model-visible schema stays stable across providers. Requires a registered provider (e.g. `@clocky/clocky-lsp-stdio`) at runtime; without one, a query returns the structured `LSP_UNAVAILABLE` error rather than changing the schema. |
| `@clocky/clocky-tool-skill` | `skill` | `ctx.tools`, `ctx.agents`, `ctx.skills` | `tool/call`, `tool/result`, `user/message replacement catalogs via agent.inject()` | - | - |
| `@clocky/clocky-tool-session-query` | `session_event_read`, `session_event_search`, `session_event_trace`, `session_search`, `session_trace` | `ctx.tools`, `ctx.systemPrompt`, `ctx.sessionQuery`, `a calling Agent for workspace authority` | `tool/call`, `tool/result` | - | The five read-only tools hide provider cursors and authorize every result from the immutable calling agent session. The package is opt-in; compositions that need enforced deadlines or bounded inline output also mount the generic timeout or spill policies. |
| `@clocky/clocky-tool-jobs` | `job_kill`, `job_list`, `job_output` | `ctx.tools`, `ctx.jobs`, `ctx.systemPrompt` | `tool/call`, `tool/result`, `user/message via agent.inject() for background completion notices` | - | The kind-agnostic background-job controller: background bash commands, PTY sends, and subagents are read, listed, and killed through the same three tools. Loading the plugin attaches the controller that arms producers' `ctx.jobs.start()`. |
| `@clocky/clocky-tool-team` | `team_final`, `team_message`, `team_task_heartbeat`, `team_task_integrate`, `team_task_report`, `team_task_review` | `ctx.tools`, `ctx.agents`, `ctx.teams`, `ctx.teamLinks`, `a Team-bound calling Agent` | `tool/call`, `tool/result`, `Team task attempt settlement through an activation-bound Link` | - | team_task_report 和 team_task_integrate 只作用于由 durable assignment source 证明 running task attempt 的 Agent。目录使用 synthetic Team-bound Agent 仅 harvest schema；实际执行仍要求 live bound Link 和 Team lease。 |
| `@clocky/clocky-team-channel-summary/tool` | `team_channel_summarize` | `ctx.tools`, `ctx.teamRuns`, `ctx.teamChannelSummaries`, `ctx.teams`, `ctx.agents`, `a live default TeamRun coordinator Agent` | `tool/call`, `authorized durable channel summary with source fingerprint`, `tool/result` | - | team_channel_summarize 仅作用于当前默认协调者。目录只提供 schema 提取所需作用域；执行要求真实活跃协调者和生产摘要 Consumer。结果为有界抽取文本，私密子集来源会被拒绝。 |
| `@clocky/clocky-tool-team-goal` | `get_goal`, `team_goal_phase`, `update_goal` | `ctx.tools`, `ctx.teamRuns`, `ctx.agents`, `a live default TeamRun coordinator Agent` | `tool/call`, `activation-fenced durable Team objective read or edit`, `tool/result` | - | get_goal and update_goal are scoped only to the default TeamRun coordinator. The catalog supplies a synthetic authority-approved coordinator to harvest schemas; execution still requires a current human direct-v3 Team input and an activation-fenced TeamRun operation. |
| `@clocky/clocky-tool-team-task` | `team_task_cancel`, `team_task_list`, `team_task_propose_owner`, `team_task_start`, `team_task_wait`, `team_task_watch`, `team_workflow_start`, `team_workflow_wait` | `ctx.tools`, `ctx.teamRuns`, `ctx.agents`, `a live default TeamRun coordinator Agent` | `tool/call`, `durable default-worker task creation, inspection, owner proposal, cancellation, or Team-journal wait`, `tool/result` | - | team_task_start、team_task_wait、team_task_list、team_task_watch、team_task_propose_owner、team_task_cancel、team_workflow_start 和 team_workflow_wait 只作用于 default TeamRun coordinator。目录使用 synthetic authority-approved coordinator harvest schema；实际执行仍要求 TeamRun 重新验证 exact current activation。 |
| `@clocky/clocky-tool-todo` | `todo_write` | `ctx.tools`, `owning Agent session` | `tool/call`, `todo/write`, `tool/result` | - | todo_write is session-owned state; UIs render the latest todo/write event as a checklist. `allowParallelInProgress` is required with no default, so the catalog states its choice: `true`, whose description invites several `in_progress` items. A deployment choosing `false` receives the same tool with a description asking for exactly one active task. |
| `@clocky/clocky-tool-web` | `web_fetch`, `web_search` | `ctx.tools`, `ctx.web`, `ctx.systemPrompt` | `tool/call`, `tool/result` | - | web_search and web_fetch keep provider selection behind ctx.web so model-visible schemas stay stable across backend swaps. |

<a id="clockyclocky-tool-ask-user"></a>

接口声明、模型实际接收的工具描述、JSON Schema 和示例按源码保留英文；各包的中文说明见对应 README。

## `@clocky/clocky-tool-ask-user`

### `ask_user_question`

Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable id that will be echoed in the answer.

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Questions to ask the user before continuing.",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable id for this question; echoed in the answer."
          },
          "question": {
            "type": "string",
            "description": "The specific question to ask the user."
          },
          "header": {
            "type": "string",
            "description": "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"."
          },
          "options": {
            "type": "array",
            "description": "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
            "items": {
              "type": "object",
              "additionalProperties": true,
              "properties": {
                "label": {
                  "type": "string",
                  "description": "Short user-facing option label."
                },
                "description": {
                  "type": "string",
                  "description": "One sentence explaining the tradeoff or impact."
                }
              },
              "required": [
                "label"
              ]
            }
          },
          "multi_select": {
            "type": "boolean",
            "description": "Whether the user may select more than one option. Defaults to false."
          }
        },
        "required": [
          "id",
          "question"
        ]
      }
    }
  },
  "required": [
    "questions"
  ]
}
```

Source: [`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)

ask_user_question pauses the tool call until the active UI provider returns a human answer.

<a id="clockyclocky-tools"></a>

## `@clocky/clocky-tools`

### `run_code`

Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The program: the body of an async TypeScript function."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
    }
  },
  "required": [
    "code",
    "description"
  ]
}
```

Source: [`packages/core/tools/src/code-mode.ts`](../packages/core/tools/src/code-mode.ts)

Owned by the tool registry as a reserved transport outside filterable capability layers under `mode: code` / `mode: both` (see the Code Mode Agent Note). Under `code` it is the registry's only wire contribution; the other visible capabilities are declared in a generated SDK section in the loaded runtime's language, and a program calls them through bindings scheduled under the native concurrency contract (submission-ordered starts and policy; concurrency-safe bodies overlap up to `maxParallelSubCalls`) that re-enter the complete guarded tool pipeline and link each nested execution to this outer result.

<a id="clockyclocky-plan-mode"></a>

## `@clocky/clocky-plan-mode`

### `exit_plan_mode`

Use only in plan mode. Present your plan for the user's review and, on approval, leave plan mode. Send the COMPLETE plan as markdown, starting with a # heading that names it. The user may approve (carry out the plan from your next step) or keep planning — their feedback comes back in the tool result; revise and present again.

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "description": "The complete plan, as markdown, starting with a # heading that names it."
    }
  },
  "required": [
    "plan"
  ]
}
```

Source: [`packages/plan/plan-mode/src/index.ts`](../packages/plan/plan-mode/src/index.ts)

exit_plan_mode stays in the model-facing schema while planning is inactive so transitions add no tool-catalog churn on top of the plan-policy change. Its execute path rejects calls outside plan mode; in plan mode it presents the plan over the user-questions seam (approve / keep planning with feedback), and approval logs plan mode inactive at the step boundary.

<a id="clockyclocky-tool-bash"></a>

## `@clocky/clocky-tool-bash`

### `bash`

Execute a bash command (`bash -c`) and return its stdout/stderr. Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. Current harness environment facts are exposed through managed `$CLOCKY_*` variables; inspect them when needed. Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

Source: [`packages/shell/tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)

The bash tool is the model-facing consumer of the bash executor seam. A `run_in_background` run registers with the generic `ctx.jobs` runtime and is collected/stopped through the `job_*` tools from `@clocky/clocky-tool-jobs`; the `enableRunInBackground` config (default true) removes the parameter entirely when disabled.

<a id="clockyclocky-tool-pwsh"></a>

## `@clocky/clocky-tool-pwsh`

### `pwsh`

Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. Each call runs in a fresh pwsh process: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\...`); read environment variables with `$env:NAME`. Non-zero exits are reported as `[exit code: N]`. Current harness environment facts are exposed through managed `$env:CLOCKY_*` variables; inspect them when needed. Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. On Windows a force-killed command settles as `[exit code: 1]` without a signal marker — treat it as an interruption, not a command failure. Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"Get-Process\" → \"List running processes\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

Source: [`packages/shell/tool-pwsh/src/index.ts`](../packages/shell/tool-pwsh/src/index.ts)

The pwsh tool is the PowerShell-dialect consumer of the bash executor seam for Windows compositions (a PowerShell executor such as `@clocky/clocky-pwsh-local` backs `ctx.shell`); it mirrors the bash tool call-for-call minus sandbox controls — `run_in_background` runs register with the generic `ctx.jobs` runtime and are collected/stopped through the `job_*` tools, and the managed `CLOCKY_*` environment comes from `@clocky/clocky-shell-env`. Each call runs in a fresh process (no persistent PTY session), with native `C:\...` paths and `$env:NAME` variables.

<a id="clockyclocky-tool-cordis"></a>

## `@clocky/clocky-tool-cordis`

### `cordis_define`

Define an immutable Cordis Package. For a new Plugin, use kind:"new" and provide only a semantic prefix of 3–6 lowercase English letters; the Host returns the final pluginId and packageId. To modify an existing Plugin, use kind:"existing" with its exact pluginId to append a Package without overwriting older versions. Provide at least one of code.host and code.client. Each value is a plain JavaScript function body that returns a Cordis Plugin; no TypeScript, JSX, or import transformation occurs. Query Inspect before depending on a Service, Event, Builtin, Slot, or token. Define only validates parameters and syntax and records source: it does not request approval, execute apply, or change currentPackageId. On success, call cordis_run with the returned IDs.

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "new"
            },
            "idPrefix": {
              "type": "string",
              "description": "Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."
            }
          },
          "required": [
            "kind",
            "idPrefix"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "existing"
            },
            "pluginId": {
              "type": "string",
              "description": "Exact ID of an existing Plugin; the new Package is appended to that instance."
            }
          },
          "required": [
            "kind",
            "pluginId"
          ]
        }
      ]
    },
    "name": {
      "type": "string",
      "description": "Short, readable Package name."
    },
    "purpose": {
      "type": "string",
      "description": "One-sentence, user-facing description of the Package purpose."
    },
    "code": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the Host-half Cordis Plugin."
        },
        "client": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the browser Client-half Cordis Plugin."
        }
      }
    }
  },
  "required": [
    "plugin",
    "name",
    "purpose",
    "code"
  ]
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_list`

List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest manifests synchronized from the Client. Each entry includes its platform, purpose, read-only methods, and input/output schemas. Call this Tool before creating or modifying a Package, then select the provider and method for cordis_inspect_query from its result. Do not guess names or treat an Inspect method as a business Service that Plugin code can call.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_query`

Run a read-only query explicitly declared by an Inspect Provider. platform, provider, and method must come from cordis_inspect_list, and input must satisfy that method's schema. Use this Tool before cordis_define to read exact Service methods, Event modes, Builtin signatures, Tool schemas, theme tokens, or live Slot trees and props. Host queries run locally. A Client query waits for the first valid page response and remains pending until a page answers or the Tool is cancelled. This Tool cannot invoke business Service methods or modify the runtime. For Service.listService and Event.listEvents, query without input to navigate the compact signature directory, then query the exact service or event for its structured contract and referenced types. For Slots.listSubTree, query without root to navigate the compact tree, then query the exact root for its complete registration contract and props.

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "description": "Runtime platform that owns the Provider.",
      "enum": [
        "host",
        "client"
      ]
    },
    "provider": {
      "type": "string",
      "description": "Exact Provider ID returned by cordis_inspect_list."
    },
    "method": {
      "type": "string",
      "description": "Exact method name declared by the Provider manifest."
    },
    "input": {
      "description": "Optional query input; it must satisfy the method input schema."
    }
  },
  "required": [
    "platform",
    "provider",
    "method"
  ]
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_self`

Inspect dynamic Cordis objects owned by the current Session at increasing levels of detail. With no IDs, list only Plugin summaries. With pluginId alone, return version pointers, the latest Run, and every Package summary. Only pluginId plus packageId returns that immutable Package's Host/Client source and runtime diagnostics. packageId cannot be supplied alone. Query an exact Package before handling @pluginId, repairing an asynchronous failure, or defining an updated version. This Tool is read-only: it neither executes code nor changes version pointers.

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."
    }
  }
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_run`

Activate one exact Package of a dynamic Plugin. Use mode:"run" for the first activation, restarting currentPackageId, or rollback. When current exists, use mode:"update" to switch to a different Package, even if the Plugin is currently stopped. An unauthorized Client Package creates an approval request and returns awaiting-approval; an authorized Package returns starting and continues asynchronously in the browser. Neither result waits for the final outcome inside the Tool. currentPackageId changes only after complete success; on failure, the old current and target next remain. Asynchronous success, rejection, or technical failure is reported through state and steering. After a technical failure, read diagnostics with cordis_inspect_self, correct the same Plugin, and retry autonomously. Do not request approval again after the user rejects it.

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID to activate under that Plugin."
    },
    "mode": {
      "type": "string",
      "description": "Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.",
      "enum": [
        "run",
        "update"
      ]
    }
  },
  "required": [
    "pluginId",
    "packageId",
    "mode"
  ]
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_stop`

Stop the current Run of a dynamic Plugin and cancel unfinished approval or activation requests. Retain the Plugin, every immutable Package, grants, currentPackageId, and nextPackageId so it can later run or update directly. Stopping an already stopped Plugin succeeds idempotently. Use this Tool to disable effects temporarily; use cordis_undefine for permanent removal.

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to stop."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_undefine`

Permanently remove a dynamic Plugin owned by the current Session. If it is running or awaiting approval, first stop it and cancel the request, then delete every Package, grant, and version pointer. After this returns, its pluginId, packageIds, @ reference, and Package business views are invalid; historical cards retain only a "Plugin removed" record. Do not call this Tool when versions must remain available for restart or rollback; use cordis_stop instead.

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to remove permanently."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

Source: [`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

Not in any shipped tree (a deliberate opt-in — dynamic package code reaches the real runtime, see .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md). The toolset injects `ctx.dynamicCordisRunner` from `@clocky/clocky-cordis-host-runner`, which owns the definition registry and the vm sandbox; a composition missing it never activates the tools. A running package may register ADDITIONAL model-visible tools until it is stopped, undefined, or Clocky restarts; a full changed request header logs those tool-set changes.

<a id="clockyclocky-tool-bash-persistent"></a>

## `@clocky/clocky-tool-bash-persistent`

### `bash`

Run commands in a persistent bash shell. State, including the current directory and exported environment variables, persists across calls for this agent.

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

Source: [`packages/shell/tool-bash-persistent/src/index.ts`](../packages/shell/tool-bash-persistent/src/index.ts)

One owner-isolated persistent bash tool; deployment composition supplies the PTY backend and may override the model-facing environment description.

<a id="clockyclocky-tool-pwsh-persistent"></a>

## `@clocky/clocky-tool-pwsh-persistent`

### `pwsh`

Run commands in a persistent PowerShell shell. State, including the current directory and exported environment variables, persists across calls for this agent.

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

Source: [`packages/shell/tool-pwsh-persistent/src/index.ts`](../packages/shell/tool-pwsh-persistent/src/index.ts)

One owner-isolated persistent pwsh tool, the Windows counterpart of the persistent bash tool; deployment composition supplies a pwsh-dialect PTY backend and may override the model-facing environment description.

<a id="clockyclocky-tool-str-replace-editor"></a>

## `@clocky/clocky-tool-str-replace-editor`

### `str_replace_editor`

Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If `path` is a file, `view` displays the result of applying `cat -n`. If `path` is a directory, `view` lists non-hidden files and directories up to 2 levels deep
* The `create` command cannot be used if the specified `path` already exists as a file
* If a `command` generates a long output, it will be truncated and marked with `<response clipped>`

Notes for using the `str_replace` command:
* The `old_str` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the `old_str` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in `old_str` to make it unique
* The `new_str` parameter should contain the edited lines that should replace the `old_str`

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      "enum": [
        "view",
        "create",
        "str_replace",
        "insert"
      ]
    },
    "path": {
      "type": "string",
      "description": "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`."
    },
    "file_text": {
      "type": "string",
      "description": "Required parameter of `create` command, with the content of the file to be created."
    },
    "insert_line": {
      "type": "integer",
      "description": "Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`."
    },
    "new_str": {
      "type": "string",
      "description": "Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert."
    },
    "old_str": {
      "type": "string",
      "description": "Required parameter of `str_replace` command containing the string in `path` to replace."
    },
    "view_range": {
      "type": "array",
      "description": "Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.",
      "items": {
        "type": "integer"
      }
    }
  },
  "required": [
    "command",
    "path"
  ]
}
```

Source: [`packages/fs/tool-str-replace-editor/src/index.ts`](../packages/fs/tool-str-replace-editor/src/index.ts)

Standalone view/create/unique literal replace/line insert tool over the filesystem seam; it composes with any shell or terminal API.

<a id="clockyclocky-tool-fs"></a>

## `@clocky/clocky-tool-fs`

### `edit`

Edit an existing UTF-8 text file by replacing literal text.

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to edit, resolved by the filesystem backend."
    },
    "old_string": {
      "type": "string",
      "description": "Literal text to replace. Must match exactly."
    },
    "new_string": {
      "type": "string",
      "description": "Literal replacement text. Use an empty string to delete the match."
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all matches. Defaults to false; when false, old_string must appear exactly once."
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ]
}
```

Source: [`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read`

Read a UTF-8 text file and return line-numbered content.

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to read, resolved by the filesystem backend."
    },
    "offset": {
      "type": "number",
      "description": "1-based first line to return. Defaults to 1."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to return. Defaults to 2000."
    }
  },
  "required": [
    "file_path"
  ]
}
```

Source: [`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read_image`

Read a PNG/JPEG/WebP/GIF file and return the image itself. Harness validates and downscales large supported images before the next model request, so use this tool directly instead of installing image libraries or creating thumbnails merely to inspect an image. Independent files may be read concurrently in small batches. Requires the current model to accept image input.

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the image file, resolved by the filesystem backend."
    }
  },
  "required": [
    "file_path"
  ]
}
```

Source: [`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `write`

Create or fully replace a UTF-8 text file.

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to write, resolved by the filesystem backend."
    },
    "content": {
      "type": "string",
      "description": "Full UTF-8 text content to write."
    }
  },
  "required": [
    "file_path",
    "content"
  ]
}
```

Source: [`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

The read-before-write/edit policy is added by `@clocky/clocky-fs-observation-policy` (an `fs/*` event-gate plugin, no schema change); a deployment that loads these tools is expected to also load it. The image tool is not registered without `ctx.attachments`; its schema is route-independent, and execution refuses unless the exact routed model declares image input.

<a id="clockyclocky-tool-fs-search"></a>

## `@clocky/clocky-tool-fs-search`

### `glob`

Find files whose paths match a glob pattern. Returns matching file paths — never directories — including hidden and ignored files (VCS metadata directories are excluded). Up to 100 paths come back in modification-time order; a larger result instead returns 100 paths sampled across top-level entries, says so, and reports where the complete sorted list was saved. This tool does not enumerate directory entries.

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
    },
    "path": {
      "type": "string",
      "description": "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
    }
  },
  "required": [
    "pattern"
  ]
}
```

Source: [`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

### `grep`

Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. Returns the first 250 matches inline; a capped result reports where the complete match list was saved. Use read on a matched file for surrounding context.

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for (ripgrep syntax)."
    },
    "path": {
      "type": "string",
      "description": "File or directory to search. Defaults to the session workspace; a relative path resolves against it."
    },
    "include": {
      "type": "string",
      "description": "One glob filter for which files to search (e.g. \"*.ts\", \"*.{js,jsx}\"). Not a list; negation is not supported."
    }
  },
  "required": [
    "pattern"
  ]
}
```

Source: [`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

glob and grep are unconditional discovery tools that spawn the packaged ripgrep binary (`@vscode/ripgrep`) through ctx.subprocess as ordinary foreground calls (never background jobs) — no host `rg` install and no shell layer. The catalog uses `sampleOverCapGlobResults: true`; deployments must choose that behavior explicitly. Capped results save the complete formatted list through the optional ctx.spillStore backend; returned locators are follow-up-readable/searchable when the backend exposes local paths in co-located deployments.

<a id="clockyclocky-tool-terminal"></a>

## `@clocky/clocky-tool-terminal`

### `terminal_close`

Close one persistent terminal and wait until its captured owned process tree is gone.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_list`

List persistent terminal sessions owned by the current agent.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_open`

Create a persistent, owner-isolated terminal session from a registered backend type. Use this for shell or REPL state that must survive across tool calls.

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Registered terminal backend type, usually \"shell\"."
    },
    "name": {
      "type": "string",
      "description": "Optional owner-local display name such as \"main\" or \"gdb\"."
    },
    "cwd": {
      "type": "string",
      "description": "Initial working directory. Defaults to the deployment workspace root."
    }
  },
  "required": [
    "type"
  ]
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_read`

Read a bounded page of retained output from a persistent terminal without sending input.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "offset": {
      "type": "number",
      "description": "Newest-relative line offset (default 0)."
    },
    "count": {
      "type": "number",
      "description": "Requested line count (default 500; backend caps apply)."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_send`

Send text to a persistent terminal. By default Enter is submitted and the call waits for a prompt, stdin wait, output silence, timeout, or session exit. Background mode returns a job id for job_output/job_kill.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id returned by terminal_open or terminal_list."
    },
    "text": {
      "type": "string",
      "description": "UTF-8 text to write to the terminal."
    },
    "submit": {
      "type": "boolean",
      "description": "Submit Enter after text (default true). Set false for control characters or incomplete REPL input."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Return a job id immediately; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_signal`

Send an allowed signal to the current foreground process group of a persistent terminal.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "signal": {
      "type": "string",
      "description": "Signal to deliver. Shell-targeted SIGKILL is rejected; use terminal_close.",
      "enum": [
        "SIGINT",
        "SIGTERM",
        "SIGKILL",
        "SIGTSTP",
        "SIGHUP"
      ]
    }
  },
  "required": [
    "sessionId",
    "signal"
  ]
}
```

Source: [`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

The six terminal tools are opt-in and complement one-shot shell/filesystem tools. `terminal_send(run_in_background: true)` registers with `ctx.jobs`; TUI, named key sequences, BEL, resize, auto-start, and cross-agent sharing are absent from the schema.

<a id="clockyclocky-schedule"></a>

## `@clocky/clocky-schedule`

### `schedule_create`

Create one reminder in the current session. Supply a non-empty prompt and exactly one selector: a positive safe-integer after_seconds delay, at as a strict offset date-time or local date/time object, or safe-integer every_seconds of at least 300. Fixed-rate reminders stay creation-aligned, skip missed occurrences, and batch one latest occurrence per overdue rule. Delivery is session-local: the reminder runs on time only while this session is live and otherwise becomes overdue until the session is resumed.

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Reminder content to present when the target becomes due."
    },
    "after_seconds": {
      "type": "number",
      "description": "Positive safe-integer delay in seconds."
    },
    "every_seconds": {
      "type": "number",
      "description": "Fixed-rate safe-integer interval in seconds, at least 300."
    },
    "at": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "date": {
              "type": "string"
            },
            "time": {
              "type": "string"
            },
            "time_zone": {
              "type": "string"
            }
          },
          "required": [
            "date",
            "time",
            "time_zone"
          ]
        }
      ],
      "description": "Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone."
    }
  },
  "required": [
    "prompt"
  ]
}
```

Source: [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_delete`

Delete one active reminder in the current session by the exact id returned by schedule_create or schedule_list. Unknown or already-finished ids return deleted false.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Exact session-local schedule id."
    }
  },
  "required": [
    "id"
  ]
}
```

Source: [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_list`

List every active reminder in the current session in creation order, including its exact id, UTC target, scheduled or overdue state, and session-local delivery mode.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

Registered only inside live root Agent scopes created after the opt-in Schedule plugin loads. Version 1 accepts after_seconds, explicit absolute at, and bounded fixed-rate every_seconds, and discloses session-local delivery; management reads and mutations require the shared Session persistence barrier.

<a id="clockyclocky-tool-lsp"></a>

## `@clocky/clocky-tool-lsp`

### `lsp`

Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration.

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "goToDefinition, findReferences, goToImplementation, or hover.",
      "enum": [
        "goToDefinition",
        "findReferences",
        "goToImplementation",
        "hover"
      ]
    },
    "file_path": {
      "type": "string",
      "description": "The source file to query, relative to the workspace or absolute."
    },
    "line": {
      "type": "number",
      "description": "One-based line of the cursor."
    },
    "character": {
      "type": "number",
      "description": "One-based UTF-16 column of the cursor."
    }
  },
  "required": [
    "operation",
    "file_path",
    "line",
    "character"
  ]
}
```

Source: [`packages/lsp/tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)

The lsp tool keeps provider selection and language-server subprocesses behind ctx.lsp, so its model-visible schema stays stable across providers. Requires a registered provider (e.g. `@clocky/clocky-lsp-stdio`) at runtime; without one, a query returns the structured `LSP_UNAVAILABLE` error rather than changing the schema.

<a id="clockyclocky-tool-skill"></a>

## `@clocky/clocky-tool-skill`

### `skill`

Load the full instructions for an available skill. Call this with the exact skill name from the session skill catalog before acting on a task that names or clearly matches that skill.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The exact skill name from the available skills list."
    }
  },
  "required": [
    "name"
  ]
}
```

Source: [`packages/skill/tool-skill/src/index.ts`](../packages/skill/tool-skill/src/index.ts)

<a id="clockyclocky-tool-session-query"></a>

## `@clocky/clocky-tool-session-query`

### `session_event_read`

Read one full unabridged event and optional neighboring raw-event summaries from an authorized session.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    },
    "before": {
      "type": "integer",
      "description": "Number of preceding raw events to summarize. Omit for none."
    },
    "after": {
      "type": "integer",
      "description": "Number of following raw events to summarize. Omit for none."
    }
  },
  "required": [
    "seq"
  ]
}
```

Source: [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_search`

Search prior events in one authorized session; the current session excludes the step performing this call.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "query": {
      "type": "string",
      "description": "Literal full-text query over the target session."
    },
    "seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

Source: [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_trace`

Read every direct replacement and relationship to a cited source event for one event in an authorized session.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    }
  },
  "required": [
    "seq"
  ]
}
```

Source: [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_search`

Search prior sessions in the caller workspace and return the strongest matching event from each session.

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Literal full-text query over prior session history."
    },
    "session_ids": {
      "type": "array",
      "description": "Optional session ids to include.",
      "items": {
        "type": "string"
      }
    },
    "created_at_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time lower bound."
    },
    "created_at_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time upper bound."
    },
    "parent_session_ids": {
      "type": "array",
      "description": "Optional direct parent session ids.",
      "items": {
        "type": "string"
      }
    },
    "include_root_sessions": {
      "type": "boolean",
      "description": "Include sessions with no parent in the parent filter."
    },
    "availability": {
      "type": "array",
      "description": "Require at least one selected source availability.",
      "items": {
        "type": "string",
        "enum": [
          "live",
          "persisted"
        ]
      }
    },
    "event_seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "event_seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "event_time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "event_time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "event_surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

Source: [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_trace`

Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    }
  }
}
```

Source: [`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

The five read-only tools hide provider cursors and authorize every result from the immutable calling agent session. The package is opt-in; compositions that need enforced deadlines or bounded inline output also mount the generic timeout or spill policies.

<a id="clockyclocky-tool-jobs"></a>

## `@clocky/clocky-tool-jobs`

### `job_kill`

Request cancellation of a running background job by job id. Returns immediately; the job settles as killed once its work actually stops.

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "reason": {
      "type": "string",
      "description": "Optional short reason, recorded in the log and forwarded to the job."
    }
  },
  "required": [
    "job_id"
  ]
}
```

Source: [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_list`

List your background jobs (running and finished) with their ids, kinds, and statuses.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_output`

Read a background job. Stream jobs return only output since the previous read; final-output jobs return their result after settlement. Every response ends with `[status: ...]`. Reads are non-blocking unless `wait: true`, which waits up to the configured cap.

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "wait": {
      "type": "boolean",
      "description": "Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive."
    },
    "timeout_ms": {
      "type": "number",
      "description": "Max wait in milliseconds (only meaningful with wait: true). Defaults to the configured wait timeout; capped by the configured maximum."
    }
  },
  "required": [
    "job_id"
  ]
}
```

Source: [`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

The kind-agnostic background-job controller: background bash commands, PTY sends, and subagents are read, listed, and killed through the same three tools. Loading the plugin attaches the controller that arms producers' `ctx.jobs.start()`.

<a id="clockyclocky-tool-team"></a>

## `@clocky/clocky-tool-team`

### `team_final`

Send the final answer through the assigned Team result channel. Use the exact channel_id of the final-answer channel; the recipient is derived from that channel.

```json
{
  "type": "object",
  "properties": {
    "channel_id": {
      "type": "string",
      "description": "Exact two-party direct Team channel id."
    },
    "text": {
      "type": "string",
      "description": "Non-empty final answer for the other channel participant."
    }
  },
  "required": [
    "channel_id",
    "text"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

### `team_message`

Send an explicit text message to a Team channel. The sender is derived from your current activation; the channel adapter validates recipients, turn order, and delivery intent. For an ordinary consult, answer its logged request with turn delivery; task reviews require team_task_review.

```json
{
  "type": "object",
  "properties": {
    "channel_id": {
      "type": "string",
      "description": "Exact Team channel id."
    },
    "text": {
      "type": "string",
      "description": "Non-empty message text."
    },
    "audience": {
      "type": "array",
      "description": "Optional explicit recipients; omit for adapter-defined broadcast.",
      "items": {
        "type": "string"
      }
    },
    "delivery": {
      "type": "string",
      "enum": [
        "context",
        "turn",
        "steer"
      ]
    }
  },
  "required": [
    "channel_id",
    "text",
    "delivery"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

### `team_task_heartbeat`

Renew the lease for one running Team task attempt assigned to you. Use the exact task_id and attempt_id from the task assignment message before the lease expires.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact Team task id from the task assignment message."
    },
    "attempt_id": {
      "type": "string",
      "description": "Exact attempt id from the task assignment message."
    }
  },
  "required": [
    "task_id",
    "attempt_id"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

### `team_task_integrate`

Execute the current assigned Team integration task from its completed source attempt. The Hub derives the source task, provider, target, expected target revision, and operation mode from the durable task; use the exact task_id and attempt_id from the task assignment message. The provider validates the source attempt artifact manifest; integration-capable providers consume one provenance-bound patch artifact in their provider-owned format; directory providers use the portable change-set encoding.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact integration task id from the task assignment message."
    },
    "attempt_id": {
      "type": "string",
      "description": "Exact integration attempt id from the task assignment message."
    },
    "verification": {
      "type": "string",
      "description": "Optional verification command or summary to retain with the integration result."
    }
  },
  "required": [
    "task_id",
    "attempt_id"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

### `team_task_report`

Report completion, failure, or release for one running Team task attempt assigned to you. Use the exact task_id and attempt_id from the task assignment message. completed records summary and enters review only when the task names a reviewer; otherwise it completes the task directly; failed or released returns it to pending unless its attempt limit is exhausted.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact Team task id from the task assignment message."
    },
    "attempt_id": {
      "type": "string",
      "description": "Exact attempt id from the task assignment message."
    },
    "outcome": {
      "type": "string",
      "enum": [
        "completed",
        "failed",
        "released"
      ]
    },
    "summary": {
      "type": "string",
      "description": "Concise result summary; required only with completed."
    },
    "evidence": {
      "type": "array",
      "description": "Optional evidence statements supporting the result.",
      "items": {
        "type": "string"
      }
    },
    "artifacts": {
      "type": "array",
      "description": "Optional artifact references produced by this attempt.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "file",
              "patch",
              "log",
              "screenshot",
              "report"
            ]
          },
          "uri": {
            "type": "string"
          },
          "contentHash": {
            "type": "string"
          },
          "sourceAttemptId": {
            "type": "string"
          },
          "visibility": {
            "type": "string",
            "enum": [
              "private",
              "team",
              "human"
            ]
          }
        },
        "required": [
          "id",
          "kind",
          "uri",
          "visibility"
        ]
      }
    },
    "changed_paths": {
      "type": "array",
      "description": "Optional changed paths from the execution workspace.",
      "items": {
        "type": "string"
      }
    },
    "verification": {
      "type": "string",
      "description": "Optional verification command or summary."
    },
    "failure_code": {
      "type": "string",
      "description": "Stable failure classification; required only with failed."
    },
    "failure_message": {
      "type": "string",
      "description": "Concrete failure explanation; required only with failed."
    }
  },
  "required": [
    "task_id",
    "attempt_id",
    "outcome"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

### `team_task_review`

Accept or return one Team task result for rework when you are the configured reviewer. Use the task_id from the current review assignment and a concise reason; its durable revision fence is derived from that assignment.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact Team task id awaiting your review."
    },
    "decision": {
      "type": "string",
      "enum": [
        "accepted",
        "rework"
      ]
    },
    "reason": {
      "type": "string",
      "description": "Non-empty explanation for the review decision."
    }
  },
  "required": [
    "task_id",
    "decision",
    "reason"
  ]
}
```

Source: [`packages/team/tool-team/src/index.ts`](../packages/team/tool-team/src/index.ts)

team_task_report and team_task_integrate are scoped to an Agent whose durable assignment source proves one running task attempt. The catalog boots a synthetic Team-bound Agent only to harvest their schemas; execution still requires a live bound Link and Team lease.

<a id="clockyclocky-team-channel-summarytool"></a>

## `@clocky/clocky-team-channel-summary/tool`

### `team_channel_summarize`

Create an explicit channel-wide extractive summary of a committed message range. The channel must use an allowed summary view policy. All selected messages must be visible to every channel member; private subset ranges are rejected. Use the same idempotency key and range to retry. This does not send a message or call another model.

```json
{
  "type": "object",
  "properties": {
    "channel_id": {
      "type": "string",
      "description": "Selected channel id."
    },
    "expected_cursor": {
      "type": "integer",
      "description": "Current channel WAL cursor."
    },
    "from_sequence": {
      "type": "integer",
      "description": "First included WAL sequence."
    },
    "to_sequence": {
      "type": "integer",
      "description": "Last included WAL sequence."
    },
    "idempotency_key": {
      "type": "string",
      "description": "Stable retry identity for this exact range."
    }
  },
  "required": [
    "channel_id",
    "expected_cursor",
    "from_sequence",
    "to_sequence",
    "idempotency_key"
  ]
}
```

Source: [`packages/team/team-channel-summary/src/tool.ts`](../packages/team/team-channel-summary/src/tool.ts)

team_channel_summarize is scoped to the current default coordinator. Schema harvest supplies only the scope; execution requires a real active coordinator and the production summary Consumer. The result contains bounded extractive text; private subset sources are rejected.

<a id="clockyclocky-tool-team-goal"></a>

## `@clocky/clocky-tool-team-goal`

### `get_goal`

Read this Team’s durable objective, including its exact revision, phase, blocker, and budget.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/team/tool-team-goal/src/index.ts`](../packages/team/tool-team-goal/src/index.ts)

### `team_goal_phase`

Advance this Team objective to active, paused, blocked, or complete at the exact revision. A blocked objective must include a code and explanation.

```json
{
  "type": "object",
  "properties": {
    "revision": {
      "type": "integer",
      "description": "Exact positive revision returned by get_goal."
    },
    "phase": {
      "type": "string",
      "enum": [
        "active",
        "paused",
        "blocked",
        "complete"
      ]
    },
    "blocker_code": {
      "type": "string",
      "description": "Required with blocked."
    },
    "blocker_message": {
      "type": "string",
      "description": "Required with blocked."
    }
  },
  "required": [
    "revision",
    "phase"
  ]
}
```

Source: [`packages/team/tool-team-goal/src/index.ts`](../packages/team/tool-team-goal/src/index.ts)

### `update_goal`

Replace this Team’s objective at the exact revision returned by get_goal. Use only when the current human message asks to revise the task.

```json
{
  "type": "object",
  "properties": {
    "revision": {
      "type": "integer",
      "description": "Exact positive revision returned by get_goal."
    },
    "objective": {
      "type": "string",
      "description": "Replacement non-empty Team objective."
    }
  },
  "required": [
    "revision",
    "objective"
  ]
}
```

Source: [`packages/team/tool-team-goal/src/index.ts`](../packages/team/tool-team-goal/src/index.ts)

get_goal and update_goal are scoped only to the default TeamRun coordinator. The catalog supplies a synthetic authority-approved coordinator to harvest schemas; execution still requires a current human direct-v3 Team input and an activation-fenced TeamRun operation.

<a id="clockyclocky-tool-team-task"></a>

## `@clocky/clocky-tool-team-task`

### `team_task_cancel`

Request cancellation of one worker-pool Team task while the Team and other tasks continue. Assigned or running tasks remain non-terminal until their exact owner stops work and releases resources; use team_task_wait to observe settlement.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact task id returned by team_task_start."
    },
    "reason": {
      "type": "string",
      "description": "Optional explanation retained with the first accepted cancellation."
    }
  },
  "required": [
    "task_id"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_delegate`

Delegate a bounded task to a child Team with its own coordinator. Provide complete instructions, workspace-relative scopes, and explicit resource ceilings. The child shares this workspace and remains within this Team’s authority. Use team_task_list, team_task_watch, team_task_wait, or team_task_cancel with the returned task_id.

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Concise task subject."
    },
    "instructions": {
      "type": "string",
      "description": "Self-contained child Team objective and expected result."
    },
    "read_scopes": {
      "type": "array",
      "description": "Workspace-relative readable paths.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Workspace-relative writable paths.",
      "items": {
        "type": "string"
      }
    },
    "budget": {
      "description": "Resource ceilings: maxInputTokens, maxOutputTokens, maxTotalTokens, maxTurns, maxWallTimeMs, maxCostUnits, maxRetries, maxConcurrency, maxChildTeams, maxLiveActivations, maxArtifactBytes. Values cannot exceed this Team’s allowance. A bounded parent requires maxChildTeams (zero for a leaf child) and maxLiveActivations (including the child coordinator and idle workers)."
    },
    "template_id": {
      "type": "string",
      "description": "Configured child template; supply template_version together. Omit both for this Team’s template."
    },
    "template_version": {
      "type": "integer",
      "description": "Exact version of template_id."
    }
  },
  "required": [
    "subject",
    "instructions",
    "budget"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_list`

List the current phase, review facts, and accepted child response of every worker or child-Team task started by this coordinator. The list is bounded by the durable Team task set and excludes workflow-plan tasks. Review facts select the active attempt, or the latest settled attempt when none is active. A null review_result means that attempt has no review decision, not that review is disabled.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_propose_owner`

Set or clear an advisory preferred owner for one pending default-worker Team task. The proposal grants no authority; the scheduler still checks capabilities, availability, workspace, and budgets.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact task id returned by team_task_start."
    },
    "participant_id": {
      "type": "string",
      "description": "Preferred Team Participant id; omit to clear the current proposal."
    }
  },
  "required": [
    "task_id"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_start`

Start one independent, bounded Team task for the configured worker pool. Provide a concise subject, complete instructions, the expected deliverable, validation, and any filesystem regions the task may read or modify. Use narrow, non-overlapping workspace-relative scopes for concurrent writers; leave scopes empty for work that does not touch files. Use workspace-relative read_scopes and write_scopes; absolute paths under the current workspace are converted, while paths outside the workspace are rejected. The current workspace and permission mode are shown in runtime context. The coordinator may set the pool with team_worker_pool_set; the scheduler assigns this task to an eligible idle worker, or leaves it queued when every worker is busy. The returned review_policy identifies the selected reviewer or none. The task continues after this call; start other independent tasks before waiting when useful, then use team_task_wait when a result is needed. Review facts select the active attempt, or the latest settled attempt when none is active. A null review_result means that attempt has no review decision, not that review is disabled.

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Concise statement of the task to perform."
    },
    "instructions": {
      "type": "string",
      "description": "Complete self-contained instructions for the worker."
    },
    "read_scopes": {
      "type": "array",
      "description": "Workspace-relative paths the task may read, such as src/file.ts. An absolute path under the current workspace is converted.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Workspace-relative paths the task may modify, such as src/file.ts. An absolute path under the current workspace is converted.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "subject",
    "instructions"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_wait`

Wait for a worker or child-Team task started by this coordinator, including any configured review. If its reviewer stops without a decision, the call reports an error and leaves the task in review; correct the reviewer or cancel the task before rescheduling. The result reports its review policy and the decision for its latest attempt. Use the task_id returned by team_task_start or team_task_delegate. Cancelling this call stops only the wait, not the task. Review facts select the active attempt, or the latest settled attempt when none is active. A null review_result means that attempt has no review decision, not that review is disabled.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Exact task id returned by team_task_start."
    }
  },
  "required": [
    "task_id"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_task_watch`

Wait for a bounded Team cursor advance and return the compact state of this coordinator's worker and child-Team tasks. Omit after_cursor for an immediate first snapshot; thereafter use the cursor from the previous watch result; cancelling this call stops only the watch. Review facts select the active attempt, or the latest settled attempt when none is active. A null review_result means that attempt has no review decision, not that review is disabled.

```json
{
  "type": "object",
  "properties": {
    "after_cursor": {
      "type": "integer",
      "description": "Last Team cursor already observed; omit for an immediate snapshot."
    }
  }
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_worker_pool_set`

Set the desired number of worker agents for this Team. The request is capped by the deployment limit; tasks beyond currently available workers stay queued and are assigned as workers become idle, so do not wait for a slot before starting independent tasks.

```json
{
  "type": "object",
  "properties": {
    "worker_count": {
      "type": "integer",
      "description": "Desired worker-pool size, including the default worker slot."
    }
  },
  "required": [
    "worker_count"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_workflow_start`

Compile one bounded declarative Team workflow from JSON. Provide task templates, plan-local dependencies, explicit bounds, and a versioned workflow channel graph. Use workspace-relative readScopes and writeScopes in every task template; absolute paths under the current workspace are converted, while outside paths are rejected. Do not provide JavaScript, filesystem code, or hidden control flow; the complete plan is validated before any task can run. The workflow continues after this call; use team_workflow_wait for its projected result.

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "object",
      "description": "A complete task DAG. Use plan-local task ids in blockedBy and result.taskTemplateIds. Select only configured participant roles and capabilities; extensions require explicit installation.",
      "examples": [
        {
          "version": 1,
          "name": "two-stage",
          "tasks": [
            {
              "id": "research",
              "subject": "Gather evidence",
              "description": "Collect evidence and write findings to findings.txt.",
              "blockedBy": [],
              "requiredCapabilities": [],
              "priority": 0,
              "readScopes": [],
              "writeScopes": [
                "findings.txt"
              ],
              "workspaceMode": "shared",
              "budget": {},
              "reviewPolicy": {
                "kind": "none"
              },
              "maxAttempts": 1
            },
            {
              "id": "report",
              "subject": "Write the report",
              "description": "Read findings.txt and produce the requested report.",
              "blockedBy": [
                "research"
              ],
              "requiredCapabilities": [],
              "priority": 0,
              "readScopes": [
                "findings.txt"
              ],
              "writeScopes": [],
              "workspaceMode": "shared",
              "budget": {},
              "reviewPolicy": {
                "kind": "none"
              },
              "maxAttempts": 1
            }
          ],
          "bounds": {
            "maxTasks": 2,
            "maxParallelism": 1,
            "maxTotalAttempts": 2
          },
          "channel": {
            "participantRoles": [
              "coordinator",
              "worker"
            ],
            "viewPolicy": {
              "type": "recent-window",
              "version": 1
            },
            "graph": {
              "initial": {
                "kind": "participant",
                "role": "coordinator"
              },
              "transitions": [
                {
                  "condition": {
                    "kind": "always"
                  },
                  "target": {
                    "kind": "terminate"
                  }
                }
              ],
              "maxTurns": 1
            }
          },
          "result": {
            "kind": "task-results",
            "taskTemplateIds": [
              "report"
            ]
          }
        }
      ],
      "additionalProperties": false,
      "properties": {
        "version": {
          "type": "integer",
          "const": 1
        },
        "name": {
          "type": "string"
        },
        "tasks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "subject": {
                "type": "string"
              },
              "description": {
                "type": "string",
                "description": "Self-contained task brief, expected output, and verification."
              },
              "blockedBy": {
                "type": "array",
                "description": "Prerequisite task ids; use [] for a ready task.",
                "items": {
                  "type": "string"
                }
              },
              "requiredCapabilities": {
                "type": "array",
                "description": "Use the configured worker capability shown in your Team instructions.",
                "items": {
                  "type": "string"
                }
              },
              "priority": {
                "type": "integer",
                "description": "Nonnegative priority; 0 is ordinary priority."
              },
              "readScopes": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "writeScopes": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "workspaceMode": {
                "type": "string",
                "description": "Use shared unless another provider is mounted.",
                "enum": [
                  "shared",
                  "worktree",
                  "sandbox",
                  "remote"
                ]
              },
              "budget": {
                "type": "object",
                "description": "Task-specific resource restrictions; {} adds none.",
                "additionalProperties": true
              },
              "reviewPolicy": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "type": "string",
                        "const": "none"
                      }
                    },
                    "required": [
                      "kind"
                    ]
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "type": "string",
                        "const": "participant"
                      },
                      "reviewerRole": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "kind",
                      "reviewerRole"
                    ]
                  }
                ]
              },
              "maxAttempts": {
                "type": "integer",
                "description": "Positive attempt limit, including the first attempt."
              }
            },
            "required": [
              "id",
              "subject",
              "description",
              "blockedBy",
              "requiredCapabilities",
              "priority",
              "readScopes",
              "writeScopes",
              "workspaceMode",
              "budget",
              "reviewPolicy",
              "maxAttempts"
            ]
          }
        },
        "bounds": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "maxTasks": {
              "type": "integer",
              "description": "Positive limit at least the number of tasks."
            },
            "maxParallelism": {
              "type": "integer",
              "description": "Positive simultaneous-task limit."
            },
            "maxTotalAttempts": {
              "type": "integer",
              "description": "Positive total attempt limit for the plan."
            }
          },
          "required": [
            "maxTasks",
            "maxParallelism",
            "maxTotalAttempts"
          ]
        },
        "channel": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "participantRoles": {
              "type": "array",
              "description": "Configured roles, normally coordinator and worker.",
              "items": {
                "type": "string"
              }
            },
            "viewPolicy": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "type": {
                  "type": "string",
                  "description": "Installed policy, for example recent-window."
                },
                "version": {
                  "type": "integer",
                  "description": "Exact installed policy version, normally 1."
                }
              },
              "required": [
                "type",
                "version"
              ]
            },
            "graph": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "initial": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "const": "participant"
                        },
                        "role": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "role"
                      ]
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "enum": [
                            "round-robin",
                            "stay",
                            "return-to-initiator",
                            "terminate"
                          ]
                        }
                      },
                      "required": [
                        "kind"
                      ]
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "const": "extension"
                        },
                        "name": {
                          "type": "string"
                        },
                        "version": {
                          "type": "integer"
                        },
                        "config": {}
                      },
                      "required": [
                        "kind",
                        "name",
                        "version",
                        "config"
                      ]
                    }
                  ]
                },
                "transitions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "condition": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "always"
                              }
                            },
                            "required": [
                              "kind"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "envelope-kind"
                              },
                              "value": {
                                "type": "string"
                              }
                            },
                            "required": [
                              "kind",
                              "value"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "payload-present"
                              },
                              "path": {
                                "type": "string"
                              }
                            },
                            "required": [
                              "kind",
                              "path"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "payload-equals"
                              },
                              "path": {
                                "type": "string"
                              },
                              "value": {}
                            },
                            "required": [
                              "kind",
                              "path",
                              "value"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "extension"
                              },
                              "name": {
                                "type": "string"
                              },
                              "version": {
                                "type": "integer"
                              },
                              "config": {}
                            },
                            "required": [
                              "kind",
                              "name",
                              "version",
                              "config"
                            ]
                          }
                        ]
                      },
                      "target": {
                        "oneOf": [
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "participant"
                              },
                              "role": {
                                "type": "string"
                              }
                            },
                            "required": [
                              "kind",
                              "role"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "enum": [
                                  "round-robin",
                                  "stay",
                                  "return-to-initiator",
                                  "terminate"
                                ]
                              }
                            },
                            "required": [
                              "kind"
                            ]
                          },
                          {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": {
                              "kind": {
                                "type": "string",
                                "const": "extension"
                              },
                              "name": {
                                "type": "string"
                              },
                              "version": {
                                "type": "integer"
                              },
                              "config": {}
                            },
                            "required": [
                              "kind",
                              "name",
                              "version",
                              "config"
                            ]
                          }
                        ]
                      }
                    },
                    "required": [
                      "condition",
                      "target"
                    ]
                  }
                },
                "defaultTarget": {
                  "oneOf": [
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "const": "participant"
                        },
                        "role": {
                          "type": "string"
                        }
                      },
                      "required": [
                        "kind",
                        "role"
                      ]
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "enum": [
                            "round-robin",
                            "stay",
                            "return-to-initiator",
                            "terminate"
                          ]
                        }
                      },
                      "required": [
                        "kind"
                      ]
                    },
                    {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "kind": {
                          "type": "string",
                          "const": "extension"
                        },
                        "name": {
                          "type": "string"
                        },
                        "version": {
                          "type": "integer"
                        },
                        "config": {}
                      },
                      "required": [
                        "kind",
                        "name",
                        "version",
                        "config"
                      ]
                    }
                  ]
                },
                "maxTurns": {
                  "type": "integer",
                  "description": "Positive channel-turn limit."
                }
              },
              "required": [
                "initial",
                "transitions",
                "maxTurns"
              ]
            }
          },
          "required": [
            "participantRoles",
            "viewPolicy",
            "graph"
          ]
        },
        "result": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "task-results"
            },
            "taskTemplateIds": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "kind",
            "taskTemplateIds"
          ]
        }
      },
      "required": [
        "version",
        "name",
        "tasks",
        "bounds",
        "channel",
        "result"
      ]
    }
  },
  "required": [
    "plan"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_workflow_task_cancel`

Cancel one task in a workflow created by this coordinator, selected by its plan and task template. Its blocked descendants cancel when their prerequisite cannot complete; independent tasks continue. Use team_workflow_wait for the aggregate outcome and configured results.

```json
{
  "type": "object",
  "properties": {
    "plan_id": {
      "type": "string",
      "description": "Exact plan id returned by team_workflow_start."
    },
    "task_template_id": {
      "type": "string",
      "description": "Task template id in the admitted plan."
    },
    "reason": {
      "type": "string",
      "description": "Optional reason retained by the task stop intent."
    }
  },
  "required": [
    "plan_id",
    "task_template_id"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

### `team_workflow_wait`

Wait for a declarative Team workflow started by this coordinator. A stopped reviewer without a decision is reported as an error instead of an indefinite wait. Use the plan_id returned by team_workflow_start. Cancelling this call stops only the wait, not the workflow.

```json
{
  "type": "object",
  "properties": {
    "plan_id": {
      "type": "string",
      "description": "Exact plan id returned by team_workflow_start."
    }
  },
  "required": [
    "plan_id"
  ]
}
```

Source: [`packages/team/tool-team-task/src/index.ts`](../packages/team/tool-team-task/src/index.ts)

team_task_start, team_task_wait, team_task_list, team_task_watch, team_task_propose_owner, team_task_cancel, team_workflow_start, and team_workflow_wait are scoped only to the default TeamRun coordinator. The catalog supplies a synthetic authority-approved coordinator to harvest schemas; execution still requires TeamRun to revalidate the exact current activation.

<a id="clockyclocky-tool-todo"></a>

## `@clocky/clocky-tool-todo`

### `todo_write`

Record and update a structured task list for the current work. Send the ENTIRE list every call — it REPLACES the previous list (there are no partial updates, no per-item edits). Use it to plan multi-step work and show progress: add one todo per concrete step before you start. Mark every todo being actively worked on `in_progress` — several at once when work genuinely runs in parallel (e.g. concurrent subagents or background commands), one for sequential work; while work remains, at least one task should be `in_progress`. Mark a todo `completed` the moment it is done (do not batch completions), and allow no `in_progress` item only once all work is complete. Skip the list for trivial single-step tasks. Statuses: `pending` (not started), `in_progress` (being worked on now), `completed` (finished).

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "description": "The COMPLETE task list, replacing any previous list.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string",
            "description": "What the task is — a short imperative line."
          },
          "status": {
            "type": "string",
            "description": "pending (not started) | in_progress (now) | completed (done).",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          }
        },
        "required": [
          "content",
          "status"
        ]
      }
    }
  },
  "required": [
    "todos"
  ]
}
```

Source: [`packages/todo/tool-todo/src/index.ts`](../packages/todo/tool-todo/src/index.ts)

todo_write is session-owned state; UIs render the latest todo/write event as a checklist. `allowParallelInProgress` is required with no default, so the catalog states its choice: `true`, whose description invites several `in_progress` items. A deployment choosing `false` receives the same tool with a description asking for exactly one active task.

<a id="clockyclocky-tool-web"></a>

## `@clocky/clocky-tool-web`

### `web_fetch`

Fetch the content of a specific HTTP(S) URL and return it decoded to text.

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The HTTP(S) URL to fetch."
    }
  },
  "required": [
    "url"
  ]
}
```

Source: [`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

### `web_search`

Search the web for current information. Provide 1–4 queries in the required queries array. Returns an optional summary answer and a list of source URLs.

```json
{
  "type": "object",
  "properties": {
    "queries": {
      "type": "array",
      "description": "Required search queries; accepts 1–4 items and merges their results.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "queries"
  ]
}
```

Source: [`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

web_search and web_fetch keep provider selection behind ctx.web so model-visible schemas stay stable across backend swaps.
