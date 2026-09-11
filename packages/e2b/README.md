# e2b/ — E2B remote runtime family

English | [中文](README.zh.md)

An experimental provider-composition POC that places one filesystem/process execution world in an E2B Linux sandbox. E2B supplies only sandbox lifecycle and the two fundamental OS adapters; provider-neutral consumers build higher capabilities above them.

| Package | ctx key | Role |
|---|---|---|
| [`e2b`](e2b/README.md) (`@clocky/clocky-e2b`) | `ctx.e2b` | Create one sandbox, prepare its working/runtime directories, expose the shared SDK handle, and delete it on timeout or disposal |
| [`fs-e2b`](fs-e2b/README.md) (`@clocky/clocky-fs-e2b`) | `ctx.fs` | Implement the filesystem seam over E2B Filesystem APIs |
| [`subprocess-e2b`](subprocess-e2b/README.md) (`@clocky/clocky-subprocess-e2b`) | `ctx.subprocess` | Implement executable lookup, managed process groups and stdio, remote spill files, and terminal sessions over E2B Commands and PTY APIs |
| [`team-workspace-e2b`](team-workspace-e2b/README.md) (`@clocky/clocky-team-workspace-e2b`) | `ctx.teamWorkspaces` | Allocate isolated remote roots for `remote` Team tasks and publish bounded file artifacts |

The existing [`clocky-bash-local`](../shell/bash-local/README.md), [`clocky-terminal-bash`](../terminal/terminal-bash/README.md), and [`clocky-lsp-stdio`](../lsp/lsp-stdio/README.md) need no E2B-specific forks. They delegate every execution-world operation to `ctx.fs` and `ctx.subprocess`, so mounting the two E2B adapters places their mutable work in the same sandbox.

The optional [`team-workspace-e2b`](team-workspace-e2b/README.md) provider allocates `remote` Team task roots in that same E2B world and publishes bounded files. With explicit integration configuration it can apply its own portable change set to a live remote target directory under an expected-version fence. It does not create a second sandbox or provide cross-process recovery after the E2B owner expires.

This boundary does not move the harness process, Cordis objects, model calls, agent/session state, session persistence, skills, higher-level protocol state, or E2B SDK buffers. The [portable execution-world decision](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md) owns both the generic composition and this POC boundary.
