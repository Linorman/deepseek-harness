# Development guide

English | [中文](development.zh.md)

Start with the setup tutorial; use the contributor reference for builds, checks, and Git recovery.

## Setup tutorial

### Prerequisites

- Node.js 22.19–22.x or 24+, as declared in [`package.json`](../package.json). CI covers 22.19, 24, and 26.
- Corepack-enabled pnpm. The repo pins `pnpm@11.7.0`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- Git 2.26 or newer; hook setup uses worktree-specific configuration.
- Optional: provider credentials for demos and real-model e2e tests; see [environment variables](#environment-variables).

### First-time setup

From the repo root:

```sh
pnpm install
pnpm run typecheck
```

Setup is complete when typecheck succeeds. Installation also configures worktree-local Lefthook hooks and the `clocky-translation-pairing` Git merge driver. If cache restoration or a skipped `postinstall` leaves either missing, run:

```sh
node scripts/install-lefthook.mjs
```

Rerun the installer after moving a checkout. If it rejects existing Git configuration or a stale lock, follow its diagnostic; the [hook-path decision](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.md) and [pairing-merge decision](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) explain ownership and recovery.

## Contributor reference

### TypeScript project layout

Host and Client have separate aggregate programs because they declaration-merge Cordis `Context` keys with different service types. Register each ordinary package in exactly one aggregate.

| File | Role | Forms a program? |
|---|---|---|
| `tsconfig.json` | Solution root, tsserver entry, and tsx resolution config for examples and scripts; references both aggregates. | No |
| `tsconfig.host.json` | Host packages, examples, tests, scripts, website, and the Host project of `api/remotes`. | Yes |
| `tsconfig.client.json` | Client packages and their tests, `apps/web`, and the Client project of `api/remotes`. | Yes |
| `tsconfig.base.json` | Shared compiler options and source `paths`; the Vitest resolution config. Keep it free of `include` and `files`. | No |
| `tsconfig.base.client.json` | Browser settings inherited by the Client aggregate and Client packages. | No |

A repo-wide `ts.Program` must seed the Host or Client aggregate explicitly. Flattening the root solution into one program collides the `Context` merges. Module resolution can span both faces without creating this collision; see the [two-aggregate decision](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.md).

`api/remotes` alone splits its package tsconfig into Host and Client leaves: Host Typert generates declarations the Client imports. Direct consumers must reference the matching leaf; `constraints` checks this. Ordinary Client plugins emit both Node and browser entries in the Client phase. The [`api-remotes` README](../packages/api/remotes/README.md) owns the split and build ordering.

The complete build runs Host tsc → Host tsdown/Typert → Client tsc → Client tsdown → Web build. Tsdown consumes tsc output in `lib/types`; the [emit-ownership decision](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md) and [generated-contract build decision](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.md) own implementation details. [API Gateway](api-gateway.md) explains generated Remote artifacts and their development fallback.

Static checks and tests resolve workspace imports to `src`. Built-artifact consumers declare a build dependency. Public `typecheck`, `lint`, `lint:fix`, and `doc-typecheck` prepare generated Host-for-Client declarations; internal `*:contracts-ready` commands require that preparation already complete. Type-aware lint also needs declarations from both faces; Client projects use `disableSourceOfProjectReferenceRedirect` to avoid importing Host implementations into the Client program.

`pnpm run build` embeds the caller's exact public `CLOCKY_CLIENT_*` values; unset values stay absent. A complete build records those values and client artifact digests. Release packing and built Web tests reject missing or stale records. `pnpm run build:clocky` uses the CI/release profile.

Build once before checks that consume `lib/`, including `hygiene` (`publint` and the NodeNext declaration consumer). Ordinary commits and pushes need no complete build unless their selected checks consume artifacts.

### Environment variables

DeepSeek profiles and key-backed demos read credentials from the environment or a gitignored repo-root `.env`. Headless Team, headless-agent, and text ACP live tests also accept a local OpenAI-compatible route:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
CLOCKY_LOCAL_MODEL_BASE_URL=http://127.0.0.1:18000/v1
CLOCKY_LOCAL_MODEL_ID=Qwen3.8-27B-AWQ-4bit
CLOCKY_LOCAL_MODEL_API_KEY=EMPTY
CLOCKY_LOCAL_MODEL_REASONING_EFFORT=high # optional; local Qwen maps high to xhigh
```

`DEEPSEEK_BASE_URL` defaults to the public API. A nonempty local base URL selects the local test route; model id is optional, but that route requires `CLOCKY_LOCAL_MODEL_API_KEY` (`EMPTY` for the supplied unauthenticated server). Checked-in headless and ACP examples use `http://127.0.0.1:18000/v1`. Optional reasoning effort `high` maps to `xhigh` on the tested Qwen endpoint. These suites skip without either route; other suites retain provider-specific credential conditions. Never commit credentials; see [testing policy](testing.md).

### Git integrations

The pairing merge driver derives a conflicted `.i18n.yaml` record only when both owner files use Git's default text strategy and merge cleanly. Owner conflicts, non-text strategies, and invalid records remain unresolved. After a stopped merge, run:

```sh
pnpm run resolve-translation-pairing-conflicts
```

This stages every safe pairing record and exits unsuccessfully if other pairing conflicts still need manual work. The [pairing contract](i18n/README.md#the-pairing-contract) defines accepted files and states.

If the installed driver runtime becomes unavailable, the launcher writes Git's ordinary text result and leaves the sidecar unresolved. Restore dependencies and rerun the recovery command, or use `git merge --abort`. If `pre-merge-commit` rejects a clean merge, its result remains staged without a commit: repair and run `git commit`, or abort. The [failure contract](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md#failure-contract) owns exact index and `MERGE_HEAD` states.

[Lefthook configuration](../lefthook.yml) defines the local checkpoints:

- `pre-commit`: staged pairing and frozen-note checks, project-free Oxlint fixes with one bounded retry, notices regeneration when an input changes, whitespace checks, and the vendor manifest guard. Vendored source changes require their manifest update staged together.
- `pre-merge-commit`: staged pairing and frozen-note checks before an automatic merge commit.
- `pre-push`: `pnpm run typecheck`, including Host contract generation before Client tsc.

Hooks do not run tests, snapshots, full documentation checks, or hygiene. Run the relevant checks below; CI owns exhaustive coverage and compatibility. `pnpm run check:all` is an optional comprehensive local run, independent of hooks.

### CI gates

The keyless [CI workflow](../.github/workflows/ci.yml) groups independent checks into lanes; artifact consumers wait for one build per lane. The separate real-API workflow runs e2e tests with its configured worker bound. [scripts/run-gates.ts](../scripts/run-gates.ts) and the workflow files own the current gate/job inventory.

### Daily commands

Choose checks for the changed behavior using [dsh-pre-push-checks](../.agents/skills/dsh-pre-push-checks/SKILL.md). Run required checks once; broaden or repeat for changed inputs, failures, or unresolved risks. [`package.json`](../package.json) owns available scripts.

| Command | Use |
|---|---|
| `pnpm run clean` | Remove build outputs and safe residue from deleted packages. |
| `pnpm run test` | Unit tests; filter by path or test name. |
| `pnpm run test:coverage` | Per-file coverage gate on package source. |
| `pnpm run test:e2e` | Real-model tests; unavailable routes self-skip. |
| `pnpm run test:snapshot` | Keyless assembled-output replay. |
| `pnpm run test:snapshot:record` | Re-record model transcripts with credentials. |
| `pnpm run test:snapshot:refresh` | Refresh expected output from valid replay input. |
| `pnpm run typecheck` | Prepare Host contracts, then check Client types. |
| `pnpm run lint` | Type-aware lint after typecheck. |
| `pnpm run duplication` | Cross-file TypeScript clone detection. |
| `pnpm run build` | Prepare all runtime and Web artifacts. |
| `pnpm run hygiene` | Built-package and workspace checks; build first. |
| `pnpm run doc-sync` | Documentation checks. |
| `pnpm run docs:dev` / `pnpm run docs:check` | Preview / validate the documentation site. |

Package-public changes update their README and JSDoc; intentional snapshot updates require reviewing every diff. Use `check:windows-wine` only to diagnose a known Windows failure; CI owns routine Windows checks.

### Demos

Build once before these source-checkout demos. Each needs the API key named by its provider profile, supplied through the environment or repo-root `.env`:

```sh
pnpm run build
pnpm clocky --profile headless "summarize this workspace"
pnpm run demo:cordis
pnpm run demo:acp
```

Headless runs one coding task. The Cordis demo inspects and modifies its live plugin runtime (`web` by default, or `acp`). The ACP demo serves fresh agent sessions over JSON-RPC stdio.

### TODO markers

- `FIXME`: release blocker; shipping with it requires explicit reviewer agreement.
- `TODO`: fix soon when resources are available.
- `XXX`: possible future work, without a commitment.

### Documenting types verbatim (`ts type-equiv`)

[Subsystem pages](subsystems/README.md) paste source declarations with their original JSDoc. Use a ` ```ts type-equiv ` fence and register its document, source, and symbol in `scripts/type-equiv.manifest.json`:

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

For a class without implementation bodies, use ` ```ts public-api ` and `"projection": "public-api"`. The projection retains public fields, constructor, accessors, methods, and class/member JSDoc; it omits bodies and private/protected members.

`verify-type-equiv` compares declarations and every original JSDoc, ignoring whitespace and non-JSDoc comments. Primary blocks and manifest entries correspond one to one by document, symbol, and projection. Update the paste when its declaration/JSDoc changes, and update the manifest when adding or removing a primary block.

A Chinese counterpart reuses the primary entry only when its complete tracked fence sequence is byte-identical and ordered identically. `doc-typecheck` uses the same derivative rule for compilable fences; both source-equivalence fence kinds are excluded from compilation and its opt-out ratio.
