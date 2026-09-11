# AGENTS.md

Clocky is a plugin-based agent harness on vendored Cordis: **everything is a plugin**. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for docs.

## Agent workflow (GPT-6 Astra)

[Rationale and official guidance](.agents/notes/implemented/process/2026-09-05-astra-agent-instructions.md).

- Complete authorized work through verification; infer routine details from context. Ask only when missing information materially changes the outcome; continue independent work.
- User instructions override skill guidance, subject to system/developer instructions. Reuse existing authorization; prepare reviewable results before requesting any missing approval.
- Infer scope from the request and touched files. Load only relevant skills/references; review-only tasks stay read-only. If an instruction blocks progress, link its file, quote the rule, and explain its applicability.
- When permitted, delegate bounded independent work that saves time; assign separate ownership and verify results. Keep small or sequential tasks local; respect available slots.
- Preserve the task across interruptions. Communicate concise outcomes, evidence, and blockers in the user's language; omit empty report sections.

## Pre-release stance: foundation over blast radius

**Remove this section at the first tagged release.** With no consumers, prefer foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `clocky-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

Package groups live under `packages/<group>/<pkg>/`; [packages/README.md](packages/README.md) is the current package and group map. Other top-level trees include `apps/`, `python/`, `native/`, `examples/`, `docs/`, `.agents/`, `scripts/`, and `website/`; consult their local READMEs and `AGENTS.md` files for detail.

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run test           # vitest unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:snapshot  # keyless ACP/headless replay vs expected outputs; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm clocky --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run demo:cordis    # the agent modifies its own runtime (needs key)
pnpm run demo:acp       # ACP automation server (needs DEEPSEEK_API_KEY)
```

### Host sandbox failures

When required `gh`, `pnpm`, build, test, or generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation before diagnosing authentication or project failure. Require sandbox evidence; never bypass genuine test failures or the product sandbox under test.

### Run relevant checks locally

Before pushes and after `gh stack sync`, use [dsh-pre-push-checks](.agents/skills/dsh-pre-push-checks/SKILL.md); report commands run, validate rewritten branches before merging, and follow its focused-evidence rules.

Run required, relevant checks once; broaden or repeat only for changed inputs, failures, or unresolved risks. Test behavior, not instruction wording.

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- Every npm package is `@clocky/clocky-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)) and `private: true`. `@clocky/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `clocky` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-clocky-source-launch-tsx-esm.md)). Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service or method presence, plugin metadata or effects, or fixed pure examples. Without a plausible relationship, an explained empty companion is correct ([package invariant rules](packages/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@clockyScopeScan unsupported`. A `SessionEventMap` member is required-on-read by default — builds that do not know its type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles;** never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests ([policy](.agents/notes/implemented/process/2026-07-26-dependencies-over-hand-rolling.md)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `clocky-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `clocky-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** Each package uses one aggregate except `api/remotes`; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Non-trivial changes MUST include an Agent Note in the same PR;** only mechanical/local edits are exempt ([scope](.agents/notes/README.md#when-to-write-one)). Archived notes are frozen: never edit or treat them as current authority ([archive policy](.agents/notes/README.md#archiving-and-deletion)).
- **Every non-trivial model-, protocol-, or human-visible change requires a keyless runnable-example snapshot**; changes to `agent-loop`, session lifecycle, or `SessionEventMap` update both SDK snapshot owners. See [testing policy](docs/testing.md#when-a-snapshot-test-is-required).
- **A tool's UI render intent is part of its design**, decided up front (`generic`/`terminal`/`diff`, `locations`); presentation methods are pure functions of `args` ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Choose PR history deliberately.** Split independent changes; fix the introducing PR before propagation. Standalone PRs and official stacks may merge-forward or rebase after review. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; an in-progress merge-forward preserves its checkpoint before taking a newer base ([rationale](.agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)).
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type ([taxonomy](.agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; public service methods document parameters and non-void returns, and function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context: name exact actors, checks, types, APIs, behavior, failure, timing, ownership, and safe use. Use exact technical terms; reserve `contract`, `boundary`, and `shape` for their defined uses and literal process/wire/security/transaction/lifecycle boundaries. Remove code restatement, control-flow/test narration, review history, and metaphor; link non-obvious rationale to its owner and use [dsh-prose-standard](.agents/skills/dsh-prose-standard/SKILL.md) for decisions. Wire mechanically checkable invariants into executed top-level gates, prove each changed acceptance path rejects invalid cases, and prefer narrow justified exceptions over global disables.

Update affected README and JSDoc contracts with code changes. Follow [docs/AGENTS.md](docs/AGENTS.md) for documentation and bilingual pairing; run `dsh-translate-docs` only when explicitly requested.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root, `packages/`, and `examples/`; edit the real file. Keep local rules concise and link their source of truth.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; rerun `pnpm run test && pnpm run build`.

## Temp files and storing policy
Store temporary files and build/test outputs inside the project directory.

## Design Review Rules

For UI/UX design reviews, follow [.design-rules/SKILL.md](.design-rules/SKILL.md) and load the relevant HIG references it maps to before giving feedback.
