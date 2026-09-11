# `@clocky/clocky-base`

English | [中文](README.zh.md)

The shared agent-harness core as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts every base plugin row — provider adapters, the shared [`agent-default-model`](../../core/agent-default-model/README.md) selection, tools, persistence, policy, settings/credentials, and optional telemetry — over the empty profile root, as the first layer of every profile's `clocky.profile.bundles` list. The default composition has no active provider route or selected model; a profile or settings document supplies those explicitly. Later bundle layers (e.g. [`clocky-web-app`](../web-app/README.md)) and the user's profile `cordis.patch.yml` override these rows by id; a patch replaces a row's whole `config`, so mode-specific values live in mode bundles, not here. The package has no runtime API; the profile composer resolves the patch through the `clocky.bundle.patch` manifest field, never through code.

Direct subagent, workflow, and Ralph tools are not base rows. A deployment that needs them mounts the matching packages and providers in an explicit custom composition.

The patch gates both shell stacks by platform on its own rows: `bash-sandbox`/`tool-bash` carry `disabled: !!js process.platform === 'win32'` (bash has no Windows runner), and their twins `pwsh-sandbox`/`tool-pwsh` mount on win32 only with the inverted expression — one shared patch file, exactly one shell stack per host. The permission surface stays exactly as on POSIX: `sandbox`/`sandbox-policy` enforce the file-effect policy through the Windows ACL restricted-token runner (the win32 chain of `clocky-sandbox-local` → `@clocky/clocky-sandbox-windows-acl`), the permission switcher and the approval service run unchanged, and `fs-sandbox` keeps fencing `ctx.fs` writes — mounting `clocky-fs-local` alongside it would double-register `ctx.fs` and fail the load. A Windows host that prefers the unconfined local pwsh executor or full access overrides these rows through its profile or home `cordis.patch.yml` (the bash-restore recipe must be complete: disable `pwsh-sandbox`/`tool-pwsh` AND re-enable `bash-sandbox`/`tool-bash` — both executor families register the same `bash` service, so an incomplete recipe fails loud at load). POSIX hosts see the pwsh rows disabled.

The row set and its rationale are documented inline in the patch file; the [generated composition graph](../../../apps/cli/composition.md) renders it.

## Model Experience

Indirectly, through the inserted rows: this bundle selects the shipped persona-less prompt base and tool set, and contributes no model-visible text of its own.

#### KV Cache effect

None directly; each inserted row's package owns its effect.

## Known Limitations and Deferred Work

- **A patch replaces whole row configs** — profile overrides must restate every field a row keeps; there is no deep-merge layer.
- **The Windows temp grant is a private per-session subdirectory** — `workspace-write` confines writes to the workspace plus the session's own temp subdirectory (`<temp>\clocky-<hash>`, TMP/TEMP rewritten for confined children); `read-only` grants nothing. See `@clocky/clocky-sandbox-windows-acl`.
