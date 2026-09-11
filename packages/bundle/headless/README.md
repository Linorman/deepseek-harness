# `@clocky/clocky-headless`

English | [中文](README.zh.md)

The clocky one-shot bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`clocky-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR and the base same-Session Goal rows, mounts Code Mode's worker plus the local Team SQLite journal at `$CLOCKY_HOME/team-storage.sqlite`, Hub/activation/Link stack, bounded shared-task foundation, and coordinator-scoped default-worker and declarative workflow tools, and inserts this package's `headless-runner` plugin (config `{task}`, resolved from the injected `headlessStartup` provider). Its `team-workspace-shared` row uses `process.cwd()` as a fallback and accepts an explicitly retained Team `workspacePath`; `team-run` starts with one `minimal` worker and lets the coordinator grow the pool to 32 with `team_worker_pool_set`, so independent assignments run in parallel and excess ready tasks queue without stalling. Its `agent-presets` row receives the shipped preset root from profile boot; `team-run` selects `minimal` for lazily activated worker and reviewer Participants, while the coordinator retains the base composition. Mutating task reports carry provider-owned changed-path/artifact manifests through the explicit report-only publish boundary. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner creates a default Team through [`ctx.teamRuns`](../../team/team-run/README.md), posts the task as one trusted human text block, waits for the coordinator's explicit `team_final` Envelope, writes that final text to stdout, and requests exit through the launcher-provided `ctx.appExit` host hook ([`clocky-cmdline`](../../boot/cmdline/README.md)). A Team-run failure writes its message to stderr and exits 1; successful runs keep stderr empty. The process opens no listening port. The task text is this app's command line: the ordinary `headless-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`clocky-cmdline`](../../boot/cmdline/README.md)), reads the positional argument of `clocky --profile headless "task"`, prints the app's `--help`, and provides `headlessStartup`; the runner injects that service and reads its task from lazy config. A missing or whitespace-only task is rejected before the runner activates.

## Model Experience

None, as the runner only delegates to `ctx.teamRuns`; coordinator prompts and tools belong to the Team stack.

#### KV Cache effect

None; the runner adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **One Team task only** — the runner has no interactive follow-up surface; it waits for the default coordinator's explicit final Envelope.
- **Coordinator-scoped task tools** — `team_task_start`, `team_task_wait`, `team_task_list`, `team_task_watch`, `team_task_cancel`, `team_task_propose_owner`, `team_workflow_start`, and `team_workflow_wait` register only for a live default TeamRun coordinator; the worker and ordinary Sessions do not receive them.
- **`ctx.appExit` is launcher-owned** — booting the headless profile outside the `clocky` launcher fails loud at activation until the host provides the exit request.
